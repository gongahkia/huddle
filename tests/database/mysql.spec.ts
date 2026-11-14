import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {createPool,type RowDataPacket} from 'mysql2/promise';
import {installMysql,MysqlBackend,type MysqlPool} from '../../packages/host/src/mysql';
import {ReviewStore,CollaborationError} from '../../packages/host/src/store';
import {mysqlCluster} from '../fixtures/mysql-cluster';
import {storageConformance} from '../conformance/storage';

let cluster: Awaited<ReturnType<typeof mysqlCluster>>;
beforeAll(async () => {cluster = await mysqlCluster(); console.log(`Task-owned MySQL fixture: ${cluster.version}`);}); afterAll(async () => {if(cluster) await cluster.close();});
storageConformance('MySQL',async () => {
  const prefix = cluster.allocatePrefix(); await installMysql(cluster.pool,{prefix}); const backend = await MysqlBackend.open(cluster.pool,{prefix});
  return {backend,async cleanup() {await backend.close(); await cluster.dropPrefix(prefix);}};
});
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
  const pool: MysqlPool = {async getConnection() {const connection = await cluster.pool.getConnection(); return {async execute(text,values) {const result = await connection.execute(text,values); if(text === 'COMMIT' && lose) {lose = false; throw new Error('Lost acknowledgement');} return result;},release:connection.release.bind(connection),destroy:connection.destroy.bind(connection),on:connection.on.bind(connection),removeListener:connection.removeListener.bind(connection)};}};
  const backend = await MysqlBackend.open(pool,{prefix});
  try {const store = new ReviewStore(backend,auth), request = input(); lose = true; await expect(store.create(scope,request,signal())).rejects.toMatchObject({code:'unavailable'}); expect((await store.create(scope,request,signal())).thread.commentCount).toBe(1); expect((await store.list(scope,{},signal())).items).toHaveLength(1);}
  finally {await backend.close(); await cluster.dropPrefix(prefix);}
});
it('rejects nontransactional tables rather than claiming InnoDB guarantees',async () => {
  const prefix = cluster.allocatePrefix(); await installMysql(cluster.pool,{prefix});
  try {await cluster.pool.query(`ALTER TABLE \`${prefix}threads\` ENGINE=MyISAM`); await expect(MysqlBackend.open(cluster.pool,{prefix})).rejects.toMatchObject({code:'unavailable'});}
  finally {await cluster.dropPrefix(prefix);}
});
it('rejects a host connection with unsafe character set or non-strict mode',async () => {
  const prefix = cluster.allocatePrefix(); await installMysql(cluster.pool,{prefix}); const pool = createPool({...cluster.connection,connectionLimit:1,charset:'latin1'});
  try {await expect(MysqlBackend.open(pool,{prefix})).rejects.toMatchObject({code:'unavailable'});}
  finally {await pool.end(); await cluster.dropPrefix(prefix);}
});
it('restores host session settings and preserves its query guard decision',async () => {
  const prefix = cluster.allocatePrefix(); await installMysql(cluster.pool,{prefix}); const pool = createPool({...cluster.connection,connectionLimit:1});
  await pool.execute('SET SESSION innodb_lock_wait_timeout=17'); await pool.execute('SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE'); let deny = false;
  const backend = await MysqlBackend.open(pool,{prefix,beforeQuery(query) {if(deny && query.scope) throw new CollaborationError('forbidden','Tenant guard denied.');}});
  try {const store = new ReviewStore(backend,auth); await store.create(scope,input(),signal()); const [settings] = await pool.query<RowDataPacket[]>('SELECT @@session.innodb_lock_wait_timeout value,@@session.transaction_isolation isolation'); expect(Number(settings[0].value)).toBe(17); expect(settings[0].isolation).toBe('SERIALIZABLE'); deny = true; await expect(store.list(scope,{},signal())).rejects.toMatchObject({code:'forbidden'});}
  finally {await backend.close(); await pool.end(); await cluster.dropPrefix(prefix);}
});
it('cancels a saturated host pool waiter and releases the late checkout',async () => {
  const prefix = cluster.allocatePrefix(); await installMysql(cluster.pool,{prefix}); const pool = createPool({...cluster.connection,connectionLimit:1}), backend = await MysqlBackend.open(pool,{prefix}), held = await pool.getConnection();
  try {const controller = new AbortController(), rejected = expect(backend.snapshot(controller.signal,async () => {})).rejects.toMatchObject({name:'AbortError'}); await Promise.resolve(); controller.abort(); await rejected; held.release(); await vi.waitFor(async () => {const [result] = await pool.query<RowDataPacket[]>('SELECT 1 alive'); expect(result[0].alive).toBe(1);});}
  finally {await backend.close(); await pool.end(); await cluster.dropPrefix(prefix);}
});
