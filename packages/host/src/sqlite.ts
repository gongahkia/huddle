import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import {randomBytes,randomUUID} from 'node:crypto';
import {chmodSync,existsSync} from 'node:fs';
import type {Scope} from '../../shared/src/collaboration';
import {CollaborationError,isCollaborationError} from '../../shared/src/collaboration';
import {assertRemovable,collections,scopedTransaction,type Backend,type Collection,type RecordValue,type Scan,type Transaction} from './backend';
import {abortable} from './cancellation';

const schemaVersion = '1';
const table = (name: Collection) => {if (!collections.includes(name)) throw new Error('Unknown feedback collection.'); return `huddle_${name}`;};
const fields = {threadId: 'thread_id',status: 'status',page: 'page',actorId: 'actor_id'} as const;
type Row = {id: string; workspace: string; environment: string; sort_time: string; data: string; thread_id: string | null; status: string | null; page: string | null; actor_id: string | null; expires_at: number | null};
const decode = <T>(row: Row): RecordValue<T> => ({id: row.id,workspace: row.workspace,environment: row.environment,time: row.sort_time,data: JSON.parse(row.data),threadId: row.thread_id ?? undefined,status: row.status ?? undefined,page: row.page ?? undefined,actorId: row.actor_id ?? undefined,expiresAt: row.expires_at ?? undefined});
function transactionView(db: DatabaseSync,signal: AbortSignal): Transaction {
  const tx: Transaction = {
    async remove(collection,scope,id) {signal.throwIfAborted(); await assertRemovable(tx,collection,scope,id); db.prepare(`DELETE FROM ${table(collection)} WHERE workspace=? AND environment=? AND id=?`).run(scope.workspace,scope.environment,id);},
    async get<T>(collection: Collection,scope: Scope,id: string) {signal.throwIfAborted(); const row = db.prepare(`SELECT * FROM ${table(collection)} WHERE workspace=? AND environment=? AND id=?`).get(scope.workspace,scope.environment,id) as Row | undefined; return row ? decode<T>(row) : undefined;},
    async scan<T>(collection: Collection,scope: Scope,query: Scan) {
      signal.throwIfAborted(); if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 101) throw new CollaborationError('validation','Invalid feedback page limit.');
      const clauses = ['workspace=?','environment=?'], values: SQLInputValue[] = [scope.workspace,scope.environment];
      for (const [key,column] of Object.entries(fields)) {const value = query[key as keyof typeof fields]; if (value !== undefined) {clauses.push(`${column}=?`); values.push(value);}}
      for (const boundary of ['after','before'] as const) if (query[boundary]) {const edge = query[boundary]!, op = boundary === 'after' ? '>' : '<'; clauses.push(`(sort_time ${op} ? OR (sort_time=? AND id ${op} ?))`); values.push(edge.time,edge.time,edge.id);}
      if(query.expiresBefore !== undefined) {if(!Number.isSafeInteger(query.expiresBefore) || query.expiresBefore < 0) throw new CollaborationError('validation','Invalid transfer expiry cutoff.'); clauses.push('expires_at<=?'); values.push(query.expiresBefore);}
      const direction = query.direction === 'desc' ? 'DESC' : 'ASC';
      return (db.prepare(`SELECT * FROM ${table(collection)} WHERE ${clauses.join(' AND ')} ORDER BY sort_time ${direction},id ${direction} LIMIT ?`).all(...values,query.limit) as Row[]).map(row => decode<T>(row));
    },
    async put(collection,record,insert) {
      signal.throwIfAborted();
      const values = [record.time,record.threadId ?? null,record.status ?? null,record.page ?? null,record.actorId ?? null,record.expiresAt ?? null,JSON.stringify(record.data),record.workspace,record.environment,record.id] satisfies SQLInputValue[];
      if (insert) db.prepare(`INSERT INTO ${table(collection)}(sort_time,thread_id,status,page,actor_id,expires_at,data,workspace,environment,id) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(...values);
      else {const result = db.prepare(`UPDATE ${table(collection)} SET sort_time=?,thread_id=?,status=?,page=?,actor_id=?,expires_at=?,data=? WHERE workspace=? AND environment=? AND id=?`).run(...values); if (result.changes !== 1) throw new CollaborationError('conflict','Feedback changed during the transaction.');}
    },
  };
  return tx;
}
function configure(db: DatabaseSync) {db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000;');}

// Installation is explicit and additive. Opening a store never creates its schema.
export function installSqlite(path: string) {
  if (path === ':memory:') throw new Error('Use an explicit durable SQLite file.');
  const existed = existsSync(path), db = new DatabaseSync(path);
  try {
    if (!existed) chmodSync(path,0o600); configure(db);
    db.exec('PRAGMA journal_mode=WAL; BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS huddle_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);');
    const previous = db.prepare('SELECT value FROM huddle_meta WHERE key=?').get('schema') as {value: string} | undefined;
    if (previous && previous.value !== schemaVersion) throw new Error('Unsupported Huddle schema version; run its documented upgrade explicitly.');
    for (const name of collections) {
      const target = table(name);
      db.exec(`CREATE TABLE IF NOT EXISTS ${target}(workspace TEXT NOT NULL,environment TEXT NOT NULL,id TEXT NOT NULL,sort_time TEXT NOT NULL,thread_id TEXT,status TEXT,page TEXT,actor_id TEXT,expires_at INTEGER,data TEXT NOT NULL,PRIMARY KEY(workspace,environment,id));
CREATE INDEX IF NOT EXISTS ${target}_order ON ${target}(workspace,environment,sort_time,id);
CREATE INDEX IF NOT EXISTS ${target}_thread ON ${target}(workspace,environment,thread_id,sort_time,id);
CREATE INDEX IF NOT EXISTS ${target}_status ON ${target}(workspace,environment,status,sort_time,id);
CREATE INDEX IF NOT EXISTS ${target}_page ON ${target}(workspace,environment,page,sort_time,id);
CREATE INDEX IF NOT EXISTS ${target}_actor ON ${target}(workspace,environment,actor_id,expires_at);`);
    }
    const insert = db.prepare('INSERT OR IGNORE INTO huddle_meta(key,value) VALUES(?,?)');
    insert.run('schema',schemaVersion); insert.run('dataset',randomUUID()); insert.run('cursor_secret',randomBytes(32).toString('hex')); db.exec('COMMIT');
  } catch (value) {if (db.isTransaction) db.exec('ROLLBACK'); throw value;} finally {db.close();}
}
export class SqliteBackend implements Backend {
  readonly datasetId: string; readonly cursorSecret: string;
  private db: DatabaseSync; private tail: Promise<void> = Promise.resolve(); private closed = false;
  private lifetime = new AbortController(); private readers = new Set<Promise<unknown>>(); private closing?: Promise<void>;
  constructor(readonly path: string) {
    if (path === ':memory:' || !existsSync(path)) throw new Error('Install a durable Huddle SQLite schema explicitly before opening it.');
    this.db = new DatabaseSync(path); configure(this.db);
    try {
      const meta = Object.fromEntries((this.db.prepare('SELECT key,value FROM huddle_meta').all() as {key: string; value: string}[]).map(row => [row.key,row.value]));
      if (meta.schema !== schemaVersion || !meta.dataset || !meta.cursor_secret) throw new Error('Unsupported or incomplete Huddle SQLite schema.');
      if ((this.db.prepare('PRAGMA journal_mode').get() as {journal_mode: string}).journal_mode !== 'wal') throw new Error('Huddle SQLite requires WAL mode.');
      this.datasetId = meta.dataset; this.cursorSecret = meta.cursor_secret;
    } catch (value) {this.db.close(); throw value;}
  }
  private async serialized<T>(signal: AbortSignal,run: () => Promise<T>): Promise<T> {
    signal.throwIfAborted(); if (this.closed) throw new CollaborationError('unavailable','Feedback storage is closed.');
    const previous = this.tail; let release: () => void = () => {}; this.tail = new Promise(resolve => {release = resolve;});
    let abort: () => void = () => {};
    try {
      await Promise.race([previous,new Promise<never>((_,reject) => {abort = () => reject(signal.reason); signal.addEventListener('abort',abort,{once: true}); if (signal.aborted) abort();})]);
      signal.throwIfAborted(); if (this.closed) throw new CollaborationError('unavailable','Feedback storage is closed.'); return await run();
    } finally {signal.removeEventListener('abort',abort); void previous.finally(release);}
  }
  async transaction<T>(scope: Scope,signal: AbortSignal,run: (tx: Transaction) => Promise<T>): Promise<T> {
    signal = AbortSignal.any([signal,this.lifetime.signal]);
    return this.serialized(signal,async () => {
      try {this.db.exec('BEGIN IMMEDIATE'); const result = await abortable(() => run(scopedTransaction(transactionView(this.db,signal),scope)),signal); signal.throwIfAborted(); this.db.exec('COMMIT'); return result;}
      catch (value) {if (this.db.isTransaction) this.db.exec('ROLLBACK'); if (signal.aborted || isCollaborationError(value)) throw value; throw new CollaborationError('unavailable','Feedback storage could not complete this transaction.');}
    });
  }
  async snapshot<T>(signal: AbortSignal,run: (tx: Transaction) => Promise<T>): Promise<T> {
    signal = AbortSignal.any([signal,this.lifetime.signal]);
    signal.throwIfAborted(); if (this.closed) throw new CollaborationError('unavailable','Feedback storage is closed.');
    const work = (async () => {
      const reader = new DatabaseSync(this.path,{readOnly: true}); configure(reader);
      try {reader.exec('BEGIN'); reader.prepare('SELECT value FROM huddle_meta WHERE key=?').get('schema'); return await abortable(() => run(transactionView(reader,signal)),signal);}
      catch (value) {if (signal.aborted || isCollaborationError(value)) throw value; throw new CollaborationError('unavailable','Feedback snapshot could not be read.');}
      finally {if (reader.isTransaction) reader.exec('ROLLBACK'); reader.close();}
    })();
    this.readers.add(work); try {return await work;} finally {this.readers.delete(work);}
  }
  async close() {
    if (this.closing) return this.closing; this.closed = true; this.lifetime.abort(new CollaborationError('unavailable','Feedback storage is closed.'));
    this.closing = (async () => {await this.tail; await Promise.allSettled([...this.readers]); this.db.close();})(); return this.closing;
  }
}
