import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {MongoClient,type ClientSession} from 'mongodb';
import {installMongodb,MongodbBackend} from '../../packages/host/src/mongodb';
import {ReviewStore,CollaborationError} from '../../packages/host/src/store';
import {mongodbCluster} from '../fixtures/mongodb-cluster';
import {storageConformance} from '../conformance/storage';
let cluster: Awaited<ReturnType<typeof mongodbCluster>>;
beforeAll(async () => {cluster = await mongodbCluster(); console.log(`Task-owned MongoDB replica set: ${cluster.version}`);}); afterAll(async () => {if(cluster) await cluster.close();});
storageConformance('MongoDB',async () => {const prefix = cluster.allocatePrefix(); await installMongodb(cluster.client,cluster.database,{prefix}); const backend = await MongodbBackend.open(cluster.client,cluster.database,{prefix}); return {backend,async cleanup() {await backend.close(); await cluster.dropPrefix(prefix);}};});
const scope = {workspace:'host:team',environment:'preview'}, signal = () => new AbortController().signal;
const auth = async () => ({actor:{id:'host:alex',name:'Alex'},capabilities:{mentions:false,assignment:false,directory:false}});
const input = () => ({idempotencyKey:crypto.randomUUID(),page:'/',pageUrl:'https://example.test/',anchor:{kind:'page' as const,selector:'body',label:'Page',quote:'',x:0,y:0},body:'Persistent'});
it('requires setup and preserves metadata, data and retry records after reopen/reinstall',async () => {
  const prefix = cluster.allocatePrefix(); let backend: MongodbBackend | undefined;
  try {await expect(MongodbBackend.open(cluster.client,cluster.database,{prefix})).rejects.toMatchObject({code:'unavailable'}); await installMongodb(cluster.client,cluster.database,{prefix}); backend = await MongodbBackend.open(cluster.client,cluster.database,{prefix}); const dataset = backend.datasetId, secret = backend.cursorSecret, request = input(), saved = await new ReviewStore(backend,auth).create(scope,request,signal()); await backend.close(); backend = undefined; await installMongodb(cluster.client,cluster.database,{prefix}); backend = await MongodbBackend.open(cluster.client,cluster.database,{prefix}); expect(backend.datasetId).toBe(dataset); expect(backend.cursorSecret).toBe(secret); expect((await new ReviewStore(backend,auth).create(scope,request,signal())).thread.id).toBe(saved.thread.id);}
  finally {await backend?.close(); await cluster.dropPrefix(prefix);}
});
it('coordinates concurrent mutations across separate backend instances',async () => {
  const prefix = cluster.allocatePrefix(); await installMongodb(cluster.client,cluster.database,{prefix}); const a = await MongodbBackend.open(cluster.client,cluster.database,{prefix}), b = await MongodbBackend.open(cluster.client,cluster.database,{prefix});
  try {const request = input(), results = await Promise.all([new ReviewStore(a,auth).create(scope,request,signal()),new ReviewStore(b,auth).create(scope,request,signal())]); expect(results[0].thread.id).toBe(results[1].thread.id);}
  finally {await a.close(); await b.close(); await cluster.dropPrefix(prefix);}
});
it('retains Unicode, NULs and large scopes/page filters without Mongo operator interpretation',async () => {
  const prefix = cluster.allocatePrefix(); await installMongodb(cluster.client,cluster.database,{prefix}); const backend = await MongodbBackend.open(cluster.client,cluster.database,{prefix});
  try {const store = new ReviewStore(backend,auth), selected = {workspace:'汉'.repeat(500),environment:'\u0000环境'}, page = '/'+ '界'.repeat(2000), saved = await store.create(selected,{...input(),page,body:'\u0000😀 {"$ne":null}'},signal()); expect((await store.list(selected,{page},signal())).items[0].id).toBe(saved.thread.id); expect((await store.detail(selected,saved.thread.id,{},signal())).comments.items[0].body).toBe('\u0000😀 {"$ne":null}');}
  finally {await backend.close(); await cluster.dropPrefix(prefix);}
});
it('sanitizes lost acknowledgement after an actual commit and reuses the original request',async () => {
  const prefix = cluster.allocatePrefix(); await installMongodb(cluster.client,cluster.database,{prefix}); const backend = await MongodbBackend.open(cluster.client,cluster.database,{prefix}), original = cluster.client.startSession.bind(cluster.client); let lose = true;
  const injected = vi.spyOn(cluster.client,'startSession').mockImplementation(options => {const session = original(options), commit = session.commitTransaction.bind(session); session.commitTransaction = async () => {await commit(); if(lose) {lose = false; throw new Error('Lost commit acknowledgement');}}; return session;});
  try {const store = new ReviewStore(backend,auth), request = input(); await expect(store.create(scope,request,signal())).rejects.toMatchObject({code:'unavailable'}); expect((await store.create(scope,request,signal())).thread.commentCount).toBe(1); expect((await store.list(scope,{},signal())).items).toHaveLength(1);}
  finally {injected.mockRestore(); await backend.close(); await cluster.dropPrefix(prefix);}
});
it('rejects a standalone MongoDB process for both install and open',async () => {
  const standalone = await mongodbCluster(false);
  try {for(const run of [() => installMongodb(standalone.client,standalone.database),() => MongodbBackend.open(standalone.client,standalone.database)]) await expect(run()).rejects.toMatchObject({code:'unavailable',message:expect.stringContaining('replica set')});}
  finally {await standalone.close();}
});
it('does not open storage with a missing required index',async () => {
  const prefix = cluster.allocatePrefix(); await installMongodb(cluster.client,cluster.database,{prefix});
  try {await cluster.database.collection(prefix+'comments').dropIndex('scope_thread'); await expect(MongodbBackend.open(cluster.client,cluster.database,{prefix})).rejects.toMatchObject({code:'unavailable'});}
  finally {await cluster.dropPrefix(prefix);}
});
it('preserves host query-guard denial and closes owned sessions without closing the client',async () => {
  const prefix = cluster.allocatePrefix(); await installMongodb(cluster.client,cluster.database,{prefix}); let deny = false;
  const backend = await MongodbBackend.open(cluster.client,cluster.database,{prefix,beforeOperation(query) {if(deny && query.scope) throw new CollaborationError('forbidden','Host denied.');}});
  try {const store = new ReviewStore(backend,auth); await store.create(scope,input(),signal()); deny = true; await expect(store.list(scope,{},signal())).rejects.toMatchObject({code:'forbidden'}); const rejected = expect(backend.snapshot(signal(),async () => new Promise(() => {}))).rejects.toMatchObject({code:'unavailable'}); await backend.close(); await rejected; expect((await cluster.database.command({ping:1})).ok).toBe(1);}
  finally {await backend.close(); await cluster.dropPrefix(prefix);}
});
it('bounds a snapshot callback that ignores cancellation',async () => {
  const prefix = cluster.allocatePrefix(); await installMongodb(cluster.client,cluster.database,{prefix}); const backend = await MongodbBackend.open(cluster.client,cluster.database,{prefix,snapshotTimeoutMs:50});
  try {await expect(backend.snapshot(signal(),async () => new Promise(() => {}))).rejects.toMatchObject({code:'timeout'});}
  finally {await backend.close(); await cluster.dropPrefix(prefix);}
});
it('rejects mismatched clients and unbounded host network settings before starting work',async () => {
  const unbounded = new MongoClient(cluster.uri);
  try {await expect(MongodbBackend.open(unbounded,cluster.database)).rejects.toMatchObject({code:'validation'}); await expect(MongodbBackend.open(unbounded,unbounded.db('huddle_fixture'))).rejects.toMatchObject({code:'unavailable',message:expect.stringContaining('timeouts')});}
  finally {await unbounded.close();}
});
it('rejects a required unique index weakened by a partial filter',async () => {
  const prefix = cluster.allocatePrefix(); await installMongodb(cluster.client,cluster.database,{prefix});
  try {const collection = cluster.database.collection(prefix+'requests'); await collection.dropIndex('scope_id'); await collection.createIndex({scopeKey:1,id:1},{name:'scope_id',unique:true,partialFilterExpression:{status:'open'}}); await expect(MongodbBackend.open(cluster.client,cluster.database,{prefix})).rejects.toMatchObject({code:'unavailable'});}
  finally {await cluster.dropPrefix(prefix);}
});
it('cancels a partially staged write, ends its session and prevents a late host hook from committing',async () => {
  const prefix = cluster.allocatePrefix(); await installMongodb(cluster.client,cluster.database,{prefix}); let entered: () => void = () => {}, release: () => void = () => {};
  const ready = new Promise<void>(resolve => {entered = resolve;}), held = new Promise<void>(resolve => {release = resolve;}), sessions: ClientSession[] = [], start = cluster.client.startSession.bind(cluster.client);
  const tracked = vi.spyOn(cluster.client,'startSession').mockImplementation(options => {const session = start(options); sessions.push(session); return session;});
  const backend = await MongodbBackend.open(cluster.client,cluster.database,{prefix,beforeOperation(operation) {if(operation.operation === 'insert' && operation.collection === prefix+'comments') {entered(); return held;}}});
  try {const controller = new AbortController(), rejected = expect(new ReviewStore(backend,auth).create(scope,input(),controller.signal)).rejects.toMatchObject({name:'AbortError'}); await ready; controller.abort(); await rejected; await backend.close(); expect(sessions.length).toBeGreaterThan(0); expect(sessions.every(session => session.hasEnded)).toBe(true); release(); const check = await MongodbBackend.open(cluster.client,cluster.database,{prefix}); try {expect((await new ReviewStore(check,auth).list(scope,{},signal())).items).toHaveLength(0);} finally {await check.close();}}
  finally {release(); tracked.mockRestore(); await backend.close(); await cluster.dropPrefix(prefix);}
});
it('sanitizes a real server outage and releases owned sessions while keeping the host client open',async () => {
  const isolated = await mongodbCluster(), prefix = isolated.allocatePrefix(), closed = vi.spyOn(isolated.client,'close'); let backend: MongodbBackend | undefined;
  try {await installMongodb(isolated.client,isolated.database,{prefix}); backend = await MongodbBackend.open(isolated.client,isolated.database,{prefix}); const store = new ReviewStore(backend,auth); await store.create(scope,input(),signal()); await isolated.stop(); await expect(store.list(scope,{},signal())).rejects.toMatchObject({code:'unavailable',message:'Feedback MongoDB storage could not complete this operation.'}); await backend.close(); expect(closed).not.toHaveBeenCalled();}
  finally {await backend?.close(); closed.mockRestore(); await isolated.close();}
});
it('cancels an actual blocked insert without committing its partially written transaction',async () => {
  const prefix = cluster.allocatePrefix(); await installMongodb(cluster.client,cluster.database,{prefix}); const backend = await MongodbBackend.open(cluster.client,cluster.database,{prefix}), controller = new AbortController(), admin = cluster.client.db('admin');
  try {
    await cluster.verify(); const configured = await admin.command({configureFailPoint:'failCommand',mode:{times:1},data:{failCommands:['insert'],blockConnection:true,blockTimeMS:500}});
    const store = new ReviewStore(backend,auth), request = input(), rejected = expect(store.create(scope,request,controller.signal)).rejects.toMatchObject({name:'AbortError'});
    await admin.command({waitForFailPoint:'failCommand',timesEntered:Number(configured.count)+1,maxTimeMS:2000}); controller.abort(); await rejected; await backend.close();
    const check = await MongodbBackend.open(cluster.client,cluster.database,{prefix});
    try {const fresh = new ReviewStore(check,auth); expect((await fresh.list(scope,{},signal())).items).toHaveLength(0); expect((await fresh.create(scope,request,signal())).thread.commentCount).toBe(1);}
    finally {await check.close();}
  } finally {controller.abort(); await admin.command({configureFailPoint:'failCommand',mode:'off'}); await backend.close(); await cluster.dropPrefix(prefix);}
});
it('fails a snapshot once on a real transient read error instead of replaying streamed output',async () => {
  const prefix = cluster.allocatePrefix(); await installMongodb(cluster.client,cluster.database,{prefix}); const backend = await MongodbBackend.open(cluster.client,cluster.database,{prefix}), admin = cluster.client.db('admin'); let called = 0;
  try {await cluster.verify(); await admin.command({configureFailPoint:'failCommand',mode:{times:1},data:{failCommands:['find'],errorCode:112,errorLabels:['TransientTransactionError']}}); await expect(backend.snapshot(signal(),async tx => {called++; return tx.scan('threads',scope,{limit:1});})).rejects.toMatchObject({code:'conflict'}); expect(called).toBe(1);}
  finally {await admin.command({configureFailPoint:'failCommand',mode:'off'}); await backend.close(); await cluster.dropPrefix(prefix);}
});
