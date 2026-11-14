import {randomBytes,randomUUID} from 'node:crypto';
import {CollaborationError,isCollaborationError,type Scope} from '../../shared/src/collaboration';
import {collections,scopedTransaction,type Backend,type Collection,type RecordValue,type Scan,type Transaction} from './backend';
import {abortable} from './cancellation';
import {digest} from './validation';

type MysqlValue = string | number | Buffer | null;
export interface MysqlConnection {
  execute(text: string,values?: MysqlValue[]): Promise<[unknown,unknown]>;
  release(): void; destroy(): void;
  on?(event: 'error',listener: (error: Error) => void): unknown;
  removeListener?(event: 'error',listener: (error: Error) => void): unknown;
}
export interface MysqlPool {getConnection(): Promise<MysqlConnection>}
export type MysqlOptions = {prefix?: string; timeoutMs?: number; snapshotTimeoutMs?: number; lockTimeoutMs?: number; beforeQuery?: (query: {text: string; values: readonly unknown[]; scope?: Scope}) => void | Promise<void>};
type Options = Required<Omit<MysqlOptions,'beforeQuery'>> & Pick<MysqlOptions,'beforeQuery'>;
type Query = (text: string,values?: MysqlValue[],scope?: Scope) => Promise<unknown>;
const version = '1';
function settings(input: MysqlOptions): Options {
  const result = {prefix:'huddle_',timeoutMs:15000,snapshotTimeoutMs:120000,lockTimeoutMs:1000,...input};
  if (!/^[a-z][a-z0-9_]{0,23}$/.test(result.prefix)) throw new Error('Use a lowercase MySQL table prefix of at most 24 characters.');
  for (const value of [result.timeoutMs,result.snapshotTimeoutMs,result.lockTimeoutMs]) if (!Number.isSafeInteger(value) || value < 1 || value > 86400000) throw new Error('MySQL timeouts must be positive integers of at most one day.');
  return result;
}
const name = (prefix: string,collection: Collection | 'meta') => {if(collection !== 'meta' && !collections.includes(collection)) throw new Error('Unknown feedback collection.'); return prefix + collection;};
const table = (prefix: string,collection: Collection | 'meta') => '`' + name(prefix,collection) + '`';
function failure(value: unknown): Error {
  if (isCollaborationError(value)) return value;
  const code = value && typeof value === 'object' && 'code' in value ? value.code : undefined;
  if (code === 'ER_LOCK_WAIT_TIMEOUT' || code === 'ER_QUERY_TIMEOUT') return new CollaborationError('timeout','Feedback storage timed out. Retry explicitly with the original request key.');
  if (code === 'ER_LOCK_DEADLOCK') return new CollaborationError('conflict','Feedback changed concurrently. Refetch before retrying.');
  return new CollaborationError('unavailable','Feedback MySQL storage could not complete this operation.');
}
const rows = (value: unknown) => value as Record<string,unknown>[];
async function withConnection<T>(pool: MysqlPool,options: Options,scope: Scope | undefined,signal: AbortSignal,run: (query: Query) => Promise<T>): Promise<T> {
  signal.throwIfAborted(); const pending = pool.getConnection(); let connection: MysqlConnection;
  try {connection = await abortable(() => pending,signal);} catch (value) {void pending.then(late => late.release(),() => {}); if (signal.aborted) throw signal.reason; throw failure(value);}
  const disconnected = new AbortController(), combined = AbortSignal.any([signal,disconnected.signal]); let released = false, oldLock: string | undefined;
  const destroy = () => {if (!released) {released = true; connection.destroy();}};
  const lost = () => disconnected.abort(new CollaborationError('unavailable','The feedback database connection ended.'));
  connection.on?.('error',lost); combined.addEventListener('abort',destroy,{once:true});
  const query: Query = async (text,values = [],selectedScope = scope) => {combined.throwIfAborted(); await options.beforeQuery?.({text,values,scope:selectedScope}); combined.throwIfAborted(); return (await connection.execute(text,values))[0];};
  try {
    return await abortable(async () => {
      const session = rows(await query('SELECT @@session.innodb_lock_wait_timeout old_lock,@@session.character_set_client charset,@@session.sql_mode modes'))[0];
      if (session.charset !== 'utf8mb4' || !String(session.modes).split(',').some(item => ['STRICT_TRANS_TABLES','STRICT_ALL_TABLES'].includes(item))) throw new CollaborationError('unavailable','Configure the host MySQL connection for utf8mb4 and strict SQL mode.');
      oldLock = String(session.old_lock); await query('SET SESSION innodb_lock_wait_timeout=CAST(? AS UNSIGNED)',[String(Math.max(1,Math.ceil(options.lockTimeoutMs/1000)))]);
      const result = await run(query); combined.throwIfAborted(); return result;
    },combined);
  } catch (value) {
    if (!released) {try {await connection.execute('ROLLBACK');} catch {destroy();}}
    if (combined.aborted) throw combined.reason; throw failure(value);
  } finally {
    if (!released && oldLock !== undefined) {try {await connection.execute('SET SESSION innodb_lock_wait_timeout=CAST(? AS UNSIGNED)',[oldLock]);} catch {destroy();}}
    combined.removeEventListener('abort',destroy);
    if (!released) {connection.removeListener?.('error',lost); released = true; connection.release();}
    if (combined.aborted) throw combined.reason;
  }
}
const text = (value: string) => JSON.stringify(value), binary = (value: string) => Buffer.from(text(value));
const optionalText = (value: string | undefined) => value === undefined ? null : text(value);
type Row = {id: Buffer; workspace: string; environment: string; sort_time: string; data: string; thread_id: Buffer | null; status: string | null; page: string | null; actor_id: string | null; expires_at: string | number | null};
const decode = <T>(row: Row): RecordValue<T> => ({id:JSON.parse(row.id.toString()),workspace:JSON.parse(row.workspace),environment:JSON.parse(row.environment),time:row.sort_time,data:JSON.parse(row.data),threadId:row.thread_id === null ? undefined : JSON.parse(row.thread_id.toString()),status:row.status ?? undefined,page:row.page === null ? undefined : JSON.parse(row.page),actorId:row.actor_id === null ? undefined : JSON.parse(row.actor_id),expiresAt:row.expires_at === null ? undefined : Number(row.expires_at)});
function view(query: Query,prefix: string): Transaction {
  const where = (scope: Scope) => ({clauses:['scope_key=?','workspace=?','environment=?'],values:[digest(scope),text(scope.workspace),text(scope.environment)] as MysqlValue[]});
  return {
    async get<T>(collection: Collection,scope: Scope,id: string) {const {clauses,values} = where(scope); values.push(binary(id)); const result = rows(await query(`SELECT * FROM ${table(prefix,collection)} WHERE ${clauses.join(' AND ')} AND id=?`,values,scope)); return result[0] ? decode<T>(result[0] as Row) : undefined;},
    async scan<T>(collection: Collection,scope: Scope,input: Scan) {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 101) throw new CollaborationError('validation','Invalid feedback page limit.');
      const {clauses,values} = where(scope);
      for (const [key,column] of [['threadId','thread_id'],['page','page_key'],['actorId','actor_key'],['status','status']] as const) if (input[key] !== undefined) {clauses.push(`${column}=?`); values.push(key === 'status' ? input[key] : key === 'threadId' ? binary(input[key]!) : digest(input[key]));}
      if (input.page !== undefined) {clauses.push('page=?'); values.push(text(input.page));} if (input.actorId !== undefined) {clauses.push('actor_id=?'); values.push(text(input.actorId));}
      for (const boundary of ['after','before'] as const) if (input[boundary]) {const edge = input[boundary]!, op = boundary === 'after' ? '>' : '<'; clauses.push(`(sort_time ${op} ? OR (sort_time=? AND id ${op} ?))`); values.push(edge.time,edge.time,binary(edge.id));}
      const direction = input.direction === 'desc' ? 'DESC' : 'ASC';
      return rows(await query(`SELECT * FROM ${table(prefix,collection)} WHERE ${clauses.join(' AND ')} ORDER BY sort_time ${direction},id ${direction} LIMIT ${input.limit}`,values,scope)).map(row => decode<T>(row as Row));
    },
    async put(collection,record,insert) {
      const scope = {workspace:record.workspace,environment:record.environment}, values = [record.time,record.threadId === undefined ? null : binary(record.threadId),record.status ?? null,optionalText(record.page),record.page === undefined ? null : digest(record.page),optionalText(record.actorId),record.actorId === undefined ? null : digest(record.actorId),record.expiresAt ?? null,JSON.stringify(record.data),digest(scope),text(record.workspace),text(record.environment),binary(record.id)];
      if (insert) await query(`INSERT INTO ${table(prefix,collection)}(sort_time,thread_id,status,page,page_key,actor_id,actor_key,expires_at,data,scope_key,workspace,environment,id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,values,scope);
      else {const result = await query(`UPDATE ${table(prefix,collection)} SET sort_time=?,thread_id=?,status=?,page=?,page_key=?,actor_id=?,actor_key=?,expires_at=?,data=? WHERE scope_key=? AND workspace=? AND environment=? AND id=?`,values,scope) as {affectedRows: number}; if (result.affectedRows !== 1) throw new CollaborationError('conflict','Feedback changed during the transaction.');}
    },
  };
}
async function validateTables(query: Query,prefix: string) {
  const names = ['meta',...collections].map(item => name(prefix,item as Collection | 'meta'));
  const result = rows(await query(`SELECT TABLE_NAME name,ENGINE engine,TABLE_COLLATION collation FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${names.map(() => '?').join(',')})`,names));
  if (result.length !== names.length || result.some(item => item.engine !== 'InnoDB' || item.collation !== 'utf8mb4_bin')) throw new CollaborationError('unavailable','Feedback tables must all use InnoDB and utf8mb4_bin. Run installation or a verified schema upgrade explicitly.');
}
export async function installMysql(pool: MysqlPool,input: MysqlOptions = {},signal = new AbortController().signal) {
  const options = settings(input), combined = AbortSignal.any([signal,AbortSignal.timeout(options.snapshotTimeoutMs)]);
  await withConnection(pool,options,undefined,combined,async query => {
    const database = rows(await query('SELECT DATABASE() name'))[0].name; if (!database) throw new CollaborationError('unavailable','Select the existing host MySQL database before installing feedback.');
    const lock = digest({database,prefix:options.prefix,install:true}); const acquired = rows(await query('SELECT GET_LOCK(?,?) acquired',[lock,Math.max(1,Math.ceil(options.lockTimeoutMs/1000))]))[0].acquired;
    if (Number(acquired) !== 1) throw new CollaborationError('timeout','Feedback schema installation is busy.');
    try {
      await query(`CREATE TABLE IF NOT EXISTS ${table(options.prefix,'meta')}(meta_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,value LONGTEXT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);
      const previous = rows(await query(`SELECT value FROM ${table(options.prefix,'meta')} WHERE meta_key=?`,['schema'])); if (previous.length && previous[0].value !== version) throw new CollaborationError('unavailable','Unsupported MySQL feedback schema version. Run its documented upgrade explicitly.');
      for (const collection of collections) await query(`CREATE TABLE IF NOT EXISTS ${table(options.prefix,collection)}(scope_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,workspace LONGTEXT NOT NULL,environment LONGTEXT NOT NULL,id VARBINARY(512) NOT NULL,sort_time VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,thread_id VARBINARY(512),status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin,page LONGTEXT,page_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin,actor_id LONGTEXT,actor_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin,expires_at BIGINT,data LONGTEXT NOT NULL,PRIMARY KEY(scope_key,id),INDEX scope_order(scope_key,sort_time,id),INDEX scope_thread(scope_key,thread_id,sort_time,id),INDEX scope_status(scope_key,status,sort_time,id),INDEX scope_page(scope_key,page_key,sort_time,id),INDEX scope_actor(scope_key,actor_key,expires_at)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);
      await validateTables(query,options.prefix); await query('START TRANSACTION');
      for (const [key,value] of [['dataset',randomUUID()],['cursor_secret',randomBytes(32).toString('hex')],['schema',version]]) await query(`INSERT INTO ${table(options.prefix,'meta')}(meta_key,value) VALUES(?,?) ON DUPLICATE KEY UPDATE meta_key=meta_key`,[key,value]);
      await query('COMMIT');
    } finally {if (!combined.aborted) await query('SELECT RELEASE_LOCK(?) released',[lock]);}
  });
}
export class MysqlBackend implements Backend {
  private lifetime = new AbortController(); private active = new Set<Promise<unknown>>(); private closing?: Promise<void>;
  private constructor(private pool: MysqlPool,private options: Options,readonly datasetId: string,readonly cursorSecret: string) {}
  static async open(pool: MysqlPool,input: MysqlOptions = {},signal = new AbortController().signal) {
    const options = settings(input), combined = AbortSignal.any([signal,AbortSignal.timeout(options.timeoutMs)]);
    const meta = await withConnection(pool,options,undefined,combined,async query => {await validateTables(query,options.prefix); return Object.fromEntries(rows(await query(`SELECT meta_key,value FROM ${table(options.prefix,'meta')}`)).map(row => [String(row.meta_key),String(row.value)]));});
    if (meta.schema !== version || !meta.dataset || !meta.cursor_secret) throw new CollaborationError('unavailable','Install the MySQL feedback schema explicitly before opening it.');
    return new MysqlBackend(pool,options,meta.dataset,meta.cursor_secret);
  }
  private async execute<T>(scope: Scope | undefined,signal: AbortSignal,readOnly: boolean,run: (tx: Transaction) => Promise<T>) {
    const combined = AbortSignal.any([signal,this.lifetime.signal,AbortSignal.timeout(readOnly ? this.options.snapshotTimeoutMs : this.options.timeoutMs)]); combined.throwIfAborted();
    const work = withConnection(this.pool,this.options,scope,combined,async query => {
      await query(`SET TRANSACTION ISOLATION LEVEL ${readOnly ? 'REPEATABLE READ' : 'READ COMMITTED'}`); await query(readOnly ? 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY' : 'START TRANSACTION READ WRITE');
      if (scope) await query(`INSERT INTO ${table(this.options.prefix,'scopes')}(scope_key,workspace,environment,id,sort_time,data) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`,[digest(scope),text(scope.workspace),text(scope.environment),binary('clock'),'','{"value":"0"}'],scope);
      const tx = view(query,this.options.prefix), result = await run(scope ? scopedTransaction(tx,scope) : tx); combined.throwIfAborted(); await query('COMMIT'); return result;
    }); this.active.add(work);
    try {return await work;} catch (value) {if (this.lifetime.signal.aborted) throw this.lifetime.signal.reason; if (signal.aborted) throw signal.reason; if (combined.aborted) throw new CollaborationError('timeout','Feedback storage timed out.'); throw value;}
    finally {this.active.delete(work);}
  }
  transaction<T>(scope: Scope,signal: AbortSignal,run: (tx: Transaction) => Promise<T>) {return this.execute(scope,signal,false,run);}
  snapshot<T>(signal: AbortSignal,run: (tx: Transaction) => Promise<T>) {return this.execute(undefined,signal,true,run);}
  async close() {if (!this.closing) {this.lifetime.abort(new CollaborationError('unavailable','Feedback storage is closed.')); this.closing = Promise.allSettled([...this.active]).then(() => {});} return this.closing;}
}
