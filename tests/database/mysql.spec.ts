import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {createPool,type RowDataPacket} from 'mysql2/promise';
import {installMysql,MysqlBackend,type MysqlPool} from '../../packages/host/src/mysql';
import {ReviewStore,CollaborationError} from '../../packages/host/src/store';
import {mysqlCluster} from '../fixtures/mysql-cluster';
import {storageConformance} from '../conformance/storage';
import {exportConformance} from '../conformance/exports';
import {importConformance} from '../conformance/imports';

let cluster: Awaited<ReturnType<typeof mysqlCluster>>;
beforeAll(async () => {cluster = await mysqlCluster(); console.log(`Task-owned MySQL fixture: ${cluster.version}`);}); afterAll(async () => {if(cluster) await cluster.close();});
const freshStorage = async () => {
  const prefix = cluster.allocatePrefix(); await installMysql(cluster.pool,{prefix}); const backend = await MysqlBackend.open(cluster.pool,{prefix});
  return {backend,async cleanup() {await backend.close(); await cluster.dropPrefix(prefix);}};
};
storageConformance('MySQL',freshStorage);
exportConformance('MySQL',freshStorage);
importConformance('MySQL',freshStorage);
const scope = {workspace:'host:team',environment:'preview'}, signal = () => new AbortController().signal;
const auth = async () => ({actor:{id:'host:alex',name:'Alex'},capabilities:{mentions:false,assignment:false,directory:false}});
const input = () => ({idempotencyKey:crypto.randomUUID(),page:'/',pageUrl:'https://example.test/',anchor:{kind:'page' as const,selector:'body',label:'Page',quote:'',x:0,y:0},body:'Persistent'});
it('requires setup, preserves metadata/retry on reopen and keeps the host pool open',async () => {
  const prefix = cluster.allocatePrefix(); let backend: MysqlBackend | undefined;
  try {
    await expect(MysqlBackend.open(cluster.pool,{prefix})).rejects.toMatchObject({code:'unavailable'}); await installMysql(cluster.pool,{prefix}); backend = await MysqlBackend.open(cluster.pool,{prefix});
    const dataset = backend.datasetId, secret = backend.cursorSecret, request = input(), saved = await new ReviewStore(backend,auth).create(scope,request,signal()); await backend.close(); backend = undefined;
    await installMysql(cluster.pool,{prefix}); backend = await MysqlBackend.open(cluster.pool,{prefix}); expect(backend.datasetId).toBe(dataset); expect(backend.cursorSecret).toBe(secret); expect((await new ReviewStore(backend,auth).create(scope,request,signal())).thread.id).toBe(saved.thread.id);
  } finally {await backend?.close(); await cluster.dropPrefix(prefix);}
});
it('serializes writes across separate backend objects sharing an existing host pool',async () => {
  const prefix = cluster.allocatePrefix(); await installMysql(cluster.pool,{prefix}); const a = await MysqlBackend.open(cluster.pool,{prefix}), b = await MysqlBackend.open(cluster.pool,{prefix});
  try {const request = input(), results = await Promise.all([new ReviewStore(a,auth).create(scope,request,signal()),new ReviewStore(b,auth).create(scope,request,signal())]); expect(results[0].thread.id).toBe(results[1].thread.id);}
  finally {await a.close(); await b.close(); await cluster.dropPrefix(prefix);}
});
it('retains lossless Unicode, control characters and long scope/page values',async () => {
  const prefix = cluster.allocatePrefix(); await installMysql(cluster.pool,{prefix}); const backend = await MysqlBackend.open(cluster.pool,{prefix});
  try {const store = new ReviewStore(backend,auth), selected = {workspace:'汉'.repeat(500),environment:'\u0000环境'}, page = '/'+ '界'.repeat(2000), saved = await store.create(selected,{...input(),page,body:'\u0000😀漢字'},signal()); expect((await store.list(selected,{page},signal())).items[0].id).toBe(saved.thread.id); expect((await store.detail(selected,saved.thread.id,{},signal())).comments.items[0].body).toBe('\u0000😀漢字');}
  finally {await backend.close(); await cluster.dropPrefix(prefix);}
});
it('retries a real committed write after lost acknowledgement without applying it again',async () => {
  const prefix = cluster.allocatePrefix(); await installMysql(cluster.pool,{prefix}); let lose = false;
  const pool: MysqlPool = {async getConnection() {const connection = await cluster.pool.getConnection(); return {execute:connection.execute.bind(connection),async query(text) {const result = await connection.query(text); if(text === 'COMMIT' && lose) {lose = false; throw new Error('Lost acknowledgement');} return result;},release:connection.release.bind(connection),destroy:connection.destroy.bind(connection),on:connection.on.bind(connection),removeListener:connection.removeListener.bind(connection)};}};
  const backend = await MysqlBackend.open(pool,{prefix});
  try {const store = new ReviewStore(backend,auth), request = input(); lose = true; await expect(store.create(scope,request,signal())).rejects.toMatchObject({code:'unavailable'}); expect((await store.create(scope,request,signal())).thread.commentCount).toBe(1); expect((await store.list(scope,{},signal())).items).toHaveLength(1);}
  finally {await backend.close(); await cluster.dropPrefix(prefix);}
});
it('rejects nontransactional tables rather than claiming InnoDB guarantees',async () => {
  const prefix = cluster.allocatePrefix(); await installMysql(cluster.pool,{prefix});
  try {await cluster.pool.query(`ALTER TABLE \`${prefix}meta\` ENGINE=MyISAM`); await expect(MysqlBackend.open(cluster.pool,{prefix})).rejects.toMatchObject({code:'unavailable'});}
  finally {await cluster.dropPrefix(prefix);}
});
it('rejects a host connection with an unsafe character set',async () => {
  const prefix = cluster.allocatePrefix(); await installMysql(cluster.pool,{prefix}); const pool = createPool({...cluster.connection,connectionLimit:1,charset:'latin1'});
  try {await expect(MysqlBackend.open(pool,{prefix})).rejects.toMatchObject({code:'unavailable'});}
  finally {await pool.end(); await cluster.dropPrefix(prefix);}
});
it('restores host session settings and preserves its query guard decision',async () => {
  const prefix = cluster.allocatePrefix(); await installMysql(cluster.pool,{prefix}); const pool = createPool({...cluster.connection,connectionLimit:1});
  await pool.execute('SET SESSION innodb_lock_wait_timeout=17'); await pool.query('SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE'); let deny = false;
  const backend = await MysqlBackend.open(pool,{prefix,beforeQuery(query) {if(deny && query.scope) throw new CollaborationError('forbidden','Tenant guard denied.');}});
  try {const store = new ReviewStore(backend,auth); await store.create(scope,input(),signal()); const [settings] = await pool.query<RowDataPacket[]>('SELECT @@session.innodb_lock_wait_timeout value,@@session.transaction_isolation isolation'); expect(Number(settings[0].value)).toBe(17); expect(settings[0].isolation).toBe('SERIALIZABLE'); deny = true; await expect(store.list(scope,{},signal())).rejects.toMatchObject({code:'forbidden'});}
  finally {await backend.close(); await pool.end(); await cluster.dropPrefix(prefix);}
});
it('cancels a saturated host pool waiter and releases the late checkout',async () => {
  const prefix = cluster.allocatePrefix(); await installMysql(cluster.pool,{prefix}); const pool = createPool({...cluster.connection,connectionLimit:1}), backend = await MysqlBackend.open(pool,{prefix}), held = await pool.getConnection();
  try {const controller = new AbortController(), rejected = expect(backend.snapshot(controller.signal,async () => {})).rejects.toMatchObject({name:'AbortError'}); await Promise.resolve(); controller.abort(); await rejected; held.release(); await vi.waitFor(async () => {const [result] = await pool.query<RowDataPacket[]>('SELECT 1 alive'); expect(result[0].alive).toBe(1);});}
  finally {await backend.close(); await pool.end(); await cluster.dropPrefix(prefix);}
});
it('rejects non-strict SQL mode on the host connection',async () => {
  const prefix = cluster.allocatePrefix(); await installMysql(cluster.pool,{prefix}); const pool = createPool({...cluster.connection,connectionLimit:1});
  try {await pool.query("SET SESSION sql_mode=''"); await expect(MysqlBackend.open(pool,{prefix})).rejects.toMatchObject({code:'unavailable'});}
  finally {await pool.end(); await cluster.dropPrefix(prefix);}
});
it('bounds real InnoDB contention, cancels a waiting write and closes an ignored snapshot callback',async () => {
  const prefix = cluster.allocatePrefix(); await installMysql(cluster.pool,{prefix}); const backend = await MysqlBackend.open(cluster.pool,{prefix,lockTimeoutMs:1000});
  let entered: () => void = () => {}, release: () => void = () => {}; const ready = new Promise<void>(resolve => {entered = resolve;}), held = new Promise<void>(resolve => {release = resolve;});
  const first = backend.transaction(scope,signal(),async () => {entered(); await held;});
  try {
    await ready; await expect(backend.transaction(scope,signal(),async () => {})).rejects.toMatchObject({code:'timeout'});
    const controller = new AbortController(), rejected = expect(backend.transaction(scope,controller.signal,async () => {})).rejects.toMatchObject({name:'AbortError'});
    await vi.waitFor(async () => {const [rows] = await cluster.pool.query<RowDataPacket[]>('SELECT COUNT(*) waiting FROM performance_schema.data_lock_waits'); expect(Number(rows[0].waiting)).toBeGreaterThan(0);}); controller.abort(); await rejected; release(); await first;
    const snapshot = expect(backend.snapshot(signal(),async () => new Promise(() => {}))).rejects.toMatchObject({code:'unavailable'}); await backend.close(); await snapshot;
    expect((await cluster.pool.query<RowDataPacket[]>('SELECT 1 alive'))[0][0].alive).toBe(1);
  } finally {release(); await first; await backend.close(); await cluster.dropPrefix(prefix);}
});
it('bounds an ignored snapshot callback with the configured deadline',async () => {
  const prefix = cluster.allocatePrefix(); await installMysql(cluster.pool,{prefix}); const backend = await MysqlBackend.open(cluster.pool,{prefix,snapshotTimeoutMs:50});
  try {await expect(backend.snapshot(signal(),async () => new Promise(() => {}))).rejects.toMatchObject({code:'timeout'});}
  finally {await backend.close(); await cluster.dropPrefix(prefix);}
});
it('sanitizes a real connection termination and leaves the host pool usable',async () => {
  const prefix = cluster.allocatePrefix(); await installMysql(cluster.pool,{prefix}); const backend = await MysqlBackend.open(cluster.pool,{prefix});
  try {
    let entered: () => void = () => {}; const ready = new Promise<void>(resolve => {entered = resolve;});
    const rejected = expect(backend.snapshot(signal(),async tx => {await tx.scan('threads',scope,{limit:1}); entered(); return new Promise(() => {});})).rejects.toMatchObject({code:'unavailable',message:'The feedback database connection ended.'});
    await ready; await cluster.verify(); let id = 0;
    await vi.waitFor(async () => {const [transactions] = await cluster.pool.query<RowDataPacket[]>('SELECT trx_mysql_thread_id id FROM information_schema.innodb_trx WHERE trx_is_read_only=1'); expect(transactions).toHaveLength(1); id = Number(transactions[0].id);});
    if(!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid disposable connection identifier.'); await cluster.pool.query(`KILL CONNECTION ${id}`); await rejected;
    expect((await cluster.pool.query<RowDataPacket[]>('SELECT 1 alive'))[0][0].alive).toBe(1);
  } finally {await backend.close(); await cluster.dropPrefix(prefix);}
});
it('rejects lossy result encoding even when client input uses utf8mb4',async () => {
  const prefix = cluster.allocatePrefix(); await installMysql(cluster.pool,{prefix}); const pool = createPool({...cluster.connection,connectionLimit:1});
  try {await pool.query("SET SESSION character_set_results='latin1'"); await expect(MysqlBackend.open(pool,{prefix})).rejects.toMatchObject({code:'unavailable'});}
  finally {await pool.end(); await cluster.dropPrefix(prefix);}
});
