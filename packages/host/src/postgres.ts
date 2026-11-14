import {randomBytes,randomUUID} from 'node:crypto';
import {CollaborationError,isCollaborationError,type Scope} from '../../shared/src/collaboration';
import {assertRemovable,collections,scopedTransaction,type Backend,type Collection,type RecordValue,type Scan,type Transaction} from './backend';
import {abortable} from './cancellation';
import {digest} from './validation';

export type PostgresResult = {rows: Record<string,unknown>[]; rowCount: number | null};
export interface PostgresClient {
  query(text: string,values?: unknown[]): Promise<PostgresResult>;
  release(destroy?: boolean): void;
  on?(event: 'error',listener: (error: Error) => void): unknown;
  removeListener?(event: 'error',listener: (error: Error) => void): unknown;
}
export interface PostgresPool {connect(): Promise<PostgresClient>}
export type PostgresOptions = {
  schema?: string; timeoutMs?: number; snapshotTimeoutMs?: number; lockTimeoutMs?: number;
  beforeQuery?: (query: {text: string; values: readonly unknown[]; scope?: Scope}) => void | Promise<void>;
};
type Options = Required<Omit<PostgresOptions,'beforeQuery'>> & Pick<PostgresOptions,'beforeQuery'>;
type Query = (text: string,values?: unknown[],scope?: Scope) => Promise<PostgresResult>;
const schemaVersion = '1';
function settings(input: PostgresOptions): Options {
  const result = {schema:'huddle',timeoutMs:15000,snapshotTimeoutMs:120000,lockTimeoutMs:1000,...input};
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(result.schema)) throw new Error('Use a lowercase PostgreSQL schema identifier of at most 63 characters.');
  for (const value of [result.timeoutMs,result.snapshotTimeoutMs,result.lockTimeoutMs]) if (!Number.isSafeInteger(value) || value < 1 || value > 86400000) throw new Error('PostgreSQL timeouts must be positive integers of at most one day.');
  return result;
}
function table(schema: string,collection: Collection | 'meta') {
  if (collection !== 'meta' && !collections.includes(collection)) throw new Error('Unknown feedback collection.');
  return `"${schema}"."${collection}"`;
}
const lockId = (value: unknown) => BigInt.asIntN(64,BigInt(`0x${digest(value).slice(0,16)}`)).toString();
function failure(value: unknown): Error {
  if (isCollaborationError(value)) return value;
  const code = value && typeof value === 'object' && 'code' in value ? value.code : undefined;
  if (code === '57014' || code === '55P03') return new CollaborationError('timeout','Feedback storage timed out. Retry explicitly with the original request key.');
  if (code === '40001' || code === '40P01') return new CollaborationError('conflict','Feedback changed concurrently. Refetch before retrying.');
  return new CollaborationError('unavailable','Feedback PostgreSQL storage could not complete this operation.');
}
async function withClient<T>(pool: PostgresPool,options: Options,scope: Scope | undefined,signal: AbortSignal,readOnly: boolean,run: (query: Query) => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  const pending = pool.connect(); let client: PostgresClient;
  try {client = await abortable(() => pending,signal);} catch (value) {void pending.then(late => late.release(),() => {}); if (signal.aborted) throw signal.reason; throw failure(value);}
  const disconnected = new AbortController(), combined = AbortSignal.any([signal,disconnected.signal]);
  let released = false;
  const destroy = () => {if (!released) {released = true; client.release(true);}};
  const lost = () => disconnected.abort(new CollaborationError('unavailable','The feedback database connection ended.'));
  client.on?.('error',lost); combined.addEventListener('abort',destroy,{once:true});
  const query: Query = async (text,values = [],requestScope = scope) => {combined.throwIfAborted(); await options.beforeQuery?.({text,values,scope:requestScope}); combined.throwIfAborted(); return client.query(text,values);};
  try {
    return await abortable(async () => {
      await query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
      await query("SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true)",[`${options.lockTimeoutMs}ms`,`${options.timeoutMs}ms`]);
      if (scope) await query('SELECT pg_advisory_xact_lock($1::bigint)',[lockId({schema:options.schema,scope:{workspace:scope.workspace,environment:scope.environment}})]);
      const result = await run(query); combined.throwIfAborted(); await query('COMMIT'); return result;
    },combined);
  } catch (value) {
    if (!released) {try {await client.query('ROLLBACK');} catch {destroy();}}
    if (combined.aborted) throw combined.reason; throw failure(value);
  } finally {
    combined.removeEventListener('abort',destroy);
    if (!released) {client.removeListener?.('error',lost); released = true; client.release();}
  }
}
type Row = {id: string; workspace: string; environment: string; sort_time: string; data: string; thread_id: string | null; status: string | null; page: string | null; actor_id: string | null; expires_at: string | null};
// JSON text encoding preserves NUL/control characters without relying on PostgreSQL JSONB restrictions.
const text = (value: string) => JSON.stringify(value);
const optionalText = (value: string | undefined) => value === undefined ? null : text(value);
const decode = <T>(row: Row): RecordValue<T> => ({id:JSON.parse(row.id),workspace:JSON.parse(row.workspace),environment:JSON.parse(row.environment),time:row.sort_time,data:JSON.parse(row.data),threadId:row.thread_id === null ? undefined : JSON.parse(row.thread_id),status:row.status ?? undefined,page:row.page === null ? undefined : JSON.parse(row.page),actorId:row.actor_id === null ? undefined : JSON.parse(row.actor_id),expiresAt:row.expires_at === null ? undefined : Number(row.expires_at)});
function view(query: Query,schema: string): Transaction {
  const where = (scope: Scope) => ({clauses:['scope_key=$1','workspace=$2','environment=$3'],values:[digest({workspace:scope.workspace,environment:scope.environment}),text(scope.workspace),text(scope.environment)] as unknown[]});
  const tx: Transaction = {
    async remove(collection,scope,id) {await assertRemovable(tx,collection,scope,id); await query(`DELETE FROM ${table(schema,collection)} WHERE scope_key=$1 AND workspace=$2 AND environment=$3 AND id=$4`,[digest({workspace:scope.workspace,environment:scope.environment}),text(scope.workspace),text(scope.environment),text(id)],scope);},
    async get<T>(collection: Collection,scope: Scope,id: string) {const {clauses,values} = where(scope); values.push(text(id)); const result = await query(`SELECT * FROM ${table(schema,collection)} WHERE ${clauses.join(' AND ')} AND id=$4`,values,scope); return result.rows[0] ? decode<T>(result.rows[0] as Row) : undefined;},
    async scan<T>(collection: Collection,scope: Scope,input: Scan) {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 101) throw new CollaborationError('validation','Invalid feedback page limit.');
      const {clauses,values} = where(scope), bind = (value: unknown) => {values.push(value); return `$${values.length}`;};
      for (const [key,column] of [['threadId','thread_id'],['page','page_key'],['actorId','actor_key'],['status','status']] as const) if (input[key] !== undefined) clauses.push(`${column}=${bind(key === 'status' ? input[key] : key === 'threadId' ? text(input[key]!) : digest(input[key]))}`);
      // Hash filters also retain exact values, so a hash collision cannot mix record scopes or filters.
      if (input.page !== undefined) clauses.push(`page=${bind(text(input.page))}`); if (input.actorId !== undefined) clauses.push(`actor_id=${bind(text(input.actorId))}`);
      for (const boundary of ['after','before'] as const) if (input[boundary]) {const edge = input[boundary]!, op = boundary === 'after' ? '>' : '<'; clauses.push(`(sort_time,id) ${op} (${bind(edge.time)},${bind(text(edge.id))})`);}
      if(input.expiresBefore !== undefined) {if(!Number.isSafeInteger(input.expiresBefore) || input.expiresBefore < 0) throw new CollaborationError('validation','Invalid transfer expiry cutoff.'); clauses.push(`expires_at<=${bind(input.expiresBefore)}`);}
      const direction = input.direction === 'desc' ? 'DESC' : 'ASC';
      const result = await query(`SELECT * FROM ${table(schema,collection)} WHERE ${clauses.join(' AND ')} ORDER BY sort_time ${direction},id ${direction} LIMIT ${bind(input.limit)}`,values,scope); return result.rows.map(row => decode<T>(row as Row));
    },
    async put(collection,record,insert) {
      const values = [record.time,optionalText(record.threadId),record.status ?? null,optionalText(record.page),record.page === undefined ? null : digest(record.page),optionalText(record.actorId),record.actorId === undefined ? null : digest(record.actorId),record.expiresAt ?? null,JSON.stringify(record.data),digest({workspace:record.workspace,environment:record.environment}),text(record.workspace),text(record.environment),text(record.id)];
      if (insert) await query(`INSERT INTO ${table(schema,collection)}(sort_time,thread_id,status,page,page_key,actor_id,actor_key,expires_at,data,scope_key,workspace,environment,id) VALUES(${values.map((_,index) => `$${index+1}`).join(',')})`,values,{workspace:record.workspace,environment:record.environment});
      else {const result = await query(`UPDATE ${table(schema,collection)} SET sort_time=$1,thread_id=$2,status=$3,page=$4,page_key=$5,actor_id=$6,actor_key=$7,expires_at=$8,data=$9 WHERE scope_key=$10 AND workspace=$11 AND environment=$12 AND id=$13`,values,{workspace:record.workspace,environment:record.environment}); if (result.rowCount !== 1) throw new CollaborationError('conflict','Feedback changed during the transaction.');}
    },
  };
  return tx;
}
export async function installPostgres(pool: PostgresPool,input: PostgresOptions = {},signal = new AbortController().signal) {
  const options = settings(input), deadline = AbortSignal.timeout(options.snapshotTimeoutMs);
  await withClient(pool,options,undefined,AbortSignal.any([signal,deadline]),false,async query => {
    await query('SELECT pg_advisory_xact_lock($1::bigint)',[lockId({schema:options.schema,install:true})]);
    await query(`CREATE SCHEMA IF NOT EXISTS "${options.schema}"`);
    await query(`CREATE TABLE IF NOT EXISTS ${table(options.schema,'meta')}(key TEXT PRIMARY KEY,value TEXT NOT NULL)`);
    const previous = await query(`SELECT value FROM ${table(options.schema,'meta')} WHERE key=$1`,['schema']); if (previous.rows.length && previous.rows[0].value !== schemaVersion) throw new CollaborationError('unavailable','Unsupported PostgreSQL feedback schema version. Run its documented upgrade explicitly.');
    for (const collection of collections) {
      const target = table(options.schema,collection);
      await query(`CREATE TABLE IF NOT EXISTS ${target}(scope_key TEXT COLLATE "C" NOT NULL,workspace TEXT NOT NULL,environment TEXT NOT NULL,id TEXT COLLATE "C" NOT NULL,sort_time TEXT COLLATE "C" NOT NULL,thread_id TEXT COLLATE "C",status TEXT,page TEXT,page_key TEXT COLLATE "C",actor_id TEXT,actor_key TEXT COLLATE "C",expires_at BIGINT,data TEXT NOT NULL,PRIMARY KEY(scope_key,id))`);
      for (const [name,fields] of [['order','sort_time,id'],['thread','thread_id,sort_time,id'],['status','status,sort_time,id'],['page','page_key,sort_time,id'],['actor','actor_key,expires_at']] as const) await query(`CREATE INDEX IF NOT EXISTS "${collection}_${name}" ON ${target}(scope_key,${fields})`);
    }
    for (const [key,value] of [['schema',schemaVersion],['dataset',randomUUID()],['cursor_secret',randomBytes(32).toString('hex')]]) await query(`INSERT INTO ${table(options.schema,'meta')}(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING`,[key,value]);
  });
}
export class PostgresBackend implements Backend {
  private lifetime = new AbortController(); private active = new Set<Promise<unknown>>(); private closing?: Promise<void>;
  private constructor(private pool: PostgresPool,private options: Options,readonly datasetId: string,readonly cursorSecret: string) {}
  static async open(pool: PostgresPool,input: PostgresOptions = {},signal = new AbortController().signal) {
    const options = settings(input);
    const meta = await withClient(pool,options,undefined,AbortSignal.any([signal,AbortSignal.timeout(options.timeoutMs)]),true,async query => {
      const result = await query(`SELECT key,value FROM ${table(options.schema,'meta')}`); return Object.fromEntries(result.rows.map(row => [String(row.key),String(row.value)]));
    });
    if (meta.schema !== schemaVersion || !meta.dataset || !meta.cursor_secret) throw new CollaborationError('unavailable','Install the PostgreSQL feedback schema explicitly before opening it.');
    return new PostgresBackend(pool,options,meta.dataset,meta.cursor_secret);
  }
  private async execute<T>(scope: Scope | undefined,signal: AbortSignal,readOnly: boolean,run: (tx: Transaction) => Promise<T>) {
    const combined = AbortSignal.any([signal,this.lifetime.signal,AbortSignal.timeout(readOnly ? this.options.snapshotTimeoutMs : this.options.timeoutMs)]); combined.throwIfAborted();
    const work = withClient(this.pool,this.options,scope,combined,readOnly,query => {const tx = view(query,this.options.schema); return run(scope ? scopedTransaction(tx,scope) : tx);}); this.active.add(work);
    try {return await work;} catch (value) {if (this.lifetime.signal.aborted) throw this.lifetime.signal.reason; if (signal.aborted) throw signal.reason; if (combined.aborted) throw new CollaborationError('timeout','Feedback storage timed out.'); throw value;}
    finally {this.active.delete(work);}
  }
  transaction<T>(scope: Scope,signal: AbortSignal,run: (tx: Transaction) => Promise<T>) {return this.execute(scope,signal,false,run);}
  snapshot<T>(signal: AbortSignal,run: (tx: Transaction) => Promise<T>) {return this.execute(undefined,signal,true,run);}
  async close() {if (!this.closing) {this.lifetime.abort(new CollaborationError('unavailable','Feedback storage is closed.')); this.closing = Promise.allSettled([...this.active]).then(() => {});} return this.closing;}
}
