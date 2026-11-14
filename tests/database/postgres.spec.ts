import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {installPostgres,PostgresBackend,type PostgresPool} from '../../packages/host/src/postgres';
import {ReviewStore} from '../../packages/host/src/store';
import {CollaborationError} from '../../packages/shared/src/collaboration';
import {Pool} from 'pg';
import {postgresCluster} from '../fixtures/postgres-cluster';
import {storageConformance} from '../conformance/storage';
import {exportConformance} from '../conformance/exports';
import {importConformance} from '../conformance/imports';

let cluster: Awaited<ReturnType<typeof postgresCluster>>;
beforeAll(async () => {cluster = await postgresCluster(); console.log(`Task-owned PostgreSQL fixture: ${cluster.version}`);});
afterAll(async () => {if(cluster) {await cluster.close(); expect(cluster.idleErrors).toEqual([]);}});
const freshStorage = async () => {
  const schema = cluster.allocateSchema(); await installPostgres(cluster.pool,{schema}); const backend = await PostgresBackend.open(cluster.pool,{schema});
  return {backend,async cleanup() {await backend.close(); await cluster.dropSchema(schema);}};
};
storageConformance('PostgreSQL',freshStorage);
exportConformance('PostgreSQL',freshStorage);
importConformance('PostgreSQL',freshStorage);
const scope = {workspace:'host:team',environment:'preview'}, signal = () => new AbortController().signal;
const auth = async () => ({actor:{id:'host:alex',name:'Alex'},capabilities:{mentions:false,assignment:false,directory:false}});
const input = () => ({idempotencyKey:crypto.randomUUID(),page:'/',pageUrl:'https://example.test/',anchor:{kind:'page' as const,selector:'body',label:'Page',quote:'',x:0,y:0},body:'Persistent'});
it('requires explicit setup and preserves retry records and metadata across reopen/setup',async () => {
  const schema = cluster.allocateSchema(); let backend: PostgresBackend | undefined;
  try {
    await expect(PostgresBackend.open(cluster.pool,{schema})).rejects.toMatchObject({code:'unavailable'});
    await installPostgres(cluster.pool,{schema}); backend = await PostgresBackend.open(cluster.pool,{schema}); const dataset = backend.datasetId, secret = backend.cursorSecret, request = input();
    const saved = await new ReviewStore(backend,auth).create(scope,request,signal()); await backend.close(); backend = undefined;
    await installPostgres(cluster.pool,{schema}); backend = await PostgresBackend.open(cluster.pool,{schema}); expect(backend.datasetId).toBe(dataset); expect(backend.cursorSecret).toBe(secret);
    expect((await new ReviewStore(backend,auth).create(scope,request,signal())).thread.id).toBe(saved.thread.id);
    await backend.close(); backend = undefined; expect((await cluster.pool.query('SELECT 1 alive')).rows[0].alive).toBe(1);
  } finally {await backend?.close(); await cluster.dropSchema(schema);}
});
it('serializes mutations across separate backend instances using the same host pool',async () => {
  const schema = cluster.allocateSchema(); await installPostgres(cluster.pool,{schema}); const a = await PostgresBackend.open(cluster.pool,{schema}), b = await PostgresBackend.open(cluster.pool,{schema});
  try {
    const first = new ReviewStore(a,auth), second = new ReviewStore(b,auth), request = input();
    const results = await Promise.all([first.create(scope,request,signal()),second.create(scope,request,signal())]); expect(results[0].thread.id).toBe(results[1].thread.id);
  } finally {await a.close(); await b.close(); await cluster.dropSchema(schema);}
});
it('survives losing acknowledgement after a real COMMIT without duplicating discussion',async () => {
  const schema = cluster.allocateSchema(); await installPostgres(cluster.pool,{schema}); let lose = false;
  const pool: PostgresPool = {async connect() {const client = await cluster.pool.connect(); return {async query(text,values) {const result = await client.query(text,values); if (text === 'COMMIT' && lose) {lose = false; throw new Error('Lost commit acknowledgement');} return result;},release: client.release.bind(client),on:client.on.bind(client),removeListener:client.removeListener.bind(client)};}};
  const backend = await PostgresBackend.open(pool,{schema});
  try {const store = new ReviewStore(backend,auth), request = input(); lose = true; await expect(store.create(scope,request,signal())).rejects.toMatchObject({code:'unavailable'}); const retried = await store.create(scope,request,signal()); expect(retried.thread.commentCount).toBe(1); expect((await store.list(scope,{},signal())).items).toHaveLength(1);}
  finally {await backend.close(); await cluster.dropSchema(schema);}
});
it('preserves long opaque Unicode scopes, control characters and large page filters',async () => {
  const schema = cluster.allocateSchema(); await installPostgres(cluster.pool,{schema}); const backend = await PostgresBackend.open(cluster.pool,{schema});
  try {
    const store = new ReviewStore(backend,auth), selected = {workspace:'汉'.repeat(500),environment:'\u0000环境'}, page = '/'+ '界'.repeat(2000);
    const saved = await store.create(selected,{...input(),page,body:'\u0000preserve this text'},signal());
    expect((await store.list(selected,{page},signal())).items[0].id).toBe(saved.thread.id); expect((await store.detail(selected,saved.thread.id,{},signal())).comments.items[0].body).toBe('\u0000preserve this text');
  } finally {await backend.close(); await cluster.dropSchema(schema);}
});
it('cancels pool waiters, lock waits and open snapshots without ending the host pool',async () => {
  const schema = cluster.allocateSchema(); await installPostgres(cluster.pool,{schema}); const backend = await PostgresBackend.open(cluster.pool,{schema});
  try {
    let entered: () => void = () => {}, release: () => void = () => {}; const ready = new Promise<void>(resolve => {entered = resolve;}), held = new Promise<void>(resolve => {release = resolve;});
    const first = backend.transaction(scope,signal(),async () => {entered(); await held;}); await ready;
    const controller = new AbortController(), rejected = expect(backend.transaction(scope,controller.signal,async () => {})).rejects.toMatchObject({name:'AbortError'}); controller.abort(); await rejected; release(); await first;
    const snapshot = expect(backend.snapshot(signal(),async () => new Promise(() => {}))).rejects.toMatchObject({code:'unavailable'}); await backend.close(); await snapshot;
    expect((await cluster.pool.query('SELECT 1 alive')).rows[0].alive).toBe(1);
  } finally {await backend.close(); await cluster.dropSchema(schema);}
});
it('bounds host lock contention and exposes typed failures without database details',async () => {
  const schema = cluster.allocateSchema(); await installPostgres(cluster.pool,{schema}); const backend = await PostgresBackend.open(cluster.pool,{schema,lockTimeoutMs:30});
  try {
    let entered: () => void = () => {}, release: () => void = () => {}; const ready = new Promise<void>(resolve => {entered = resolve;}), held = new Promise<void>(resolve => {release = resolve;});
    const first = backend.transaction(scope,signal(),async () => {entered(); await held;}); await ready;
    try {await expect(backend.transaction(scope,signal(),async () => {})).rejects.toMatchObject({code:'timeout'});} finally {release(); await first;}
  } finally {await backend.close(); await cluster.dropSchema(schema);}
});
it('invokes the host query guard and preserves its denied decision',async () => {
  const schema = cluster.allocateSchema(); await installPostgres(cluster.pool,{schema}); let deny = false;
  const guard = vi.fn((query: {scope?: typeof scope}) => {if (deny && query.scope) throw new CollaborationError('forbidden','Host tenant guard denied this query.');}); const backend = await PostgresBackend.open(cluster.pool,{schema,beforeQuery:guard});
  try {await new ReviewStore(backend,auth).create(scope,input(),signal()); expect(guard).toHaveBeenCalledWith(expect.objectContaining({scope})); deny = true; await expect(new ReviewStore(backend,auth).list(scope,{},signal())).rejects.toMatchObject({code:'forbidden'});}
  finally {await backend.close(); await cluster.dropSchema(schema);}
});
it('releases a late pool checkout after the waiting request is cancelled',async () => {
  const schema = cluster.allocateSchema(); await installPostgres(cluster.pool,{schema}); const pool = new Pool({...cluster.pool.options,max:1}), backend = await PostgresBackend.open(pool,{schema}); const held = await pool.connect();
  try {
    const controller = new AbortController(), rejected = expect(backend.snapshot(controller.signal,async () => {})).rejects.toMatchObject({name:'AbortError'});
    await vi.waitFor(() => expect(pool.waitingCount).toBe(1)); controller.abort(); await rejected; held.release();
    await vi.waitFor(() => {expect(pool.waitingCount).toBe(0); expect(pool.idleCount).toBe(1);}); expect((await pool.query('SELECT 1 alive')).rows[0].alive).toBe(1);
  } finally {await backend.close(); if (!pool.idleCount && pool.totalCount) held.release(true); await pool.end(); await cluster.dropSchema(schema);}
});
it('cancels a real advisory lock wait and returns the remaining host pool to use',async () => {
  const schema = cluster.allocateSchema(); await installPostgres(cluster.pool,{schema}); const backend = await PostgresBackend.open(cluster.pool,{schema,lockTimeoutMs:5000});
  let release: () => void = () => {}; const held = new Promise<void>(resolve => {release = resolve;});
  try {
    let entered: () => void = () => {}; const ready = new Promise<void>(resolve => {entered = resolve;}); const first = backend.transaction(scope,signal(),async () => {entered(); await held;}); await ready;
    const controller = new AbortController(), rejected = expect(backend.transaction(scope,controller.signal,async () => {})).rejects.toMatchObject({name:'AbortError'});
    await vi.waitFor(async () => {const rows = await cluster.pool.query("SELECT count(*)::int waiting FROM pg_locks WHERE locktype='advisory' AND NOT granted"); expect(rows.rows[0].waiting).toBeGreaterThan(0);}); controller.abort(); await rejected; release(); await first;
    expect((await cluster.pool.query('SELECT 1 alive')).rows[0].alive).toBe(1);
  } finally {release(); await backend.close(); await cluster.dropSchema(schema);}
});
it('sanitizes a real connection termination and leaves the host process and pool usable',async () => {
  const schema = cluster.allocateSchema(); await installPostgres(cluster.pool,{schema}); const backend = await PostgresBackend.open(cluster.pool,{schema});
  try {
    let entered: () => void = () => {}; const ready = new Promise<void>(resolve => {entered = resolve;});
    const rejected = expect(backend.snapshot(signal(),async tx => {await tx.scan('threads',scope,{limit:1}); entered(); return new Promise(() => {});})).rejects.toMatchObject({code:'unavailable',message:'The feedback database connection ended.'});
    await ready; await cluster.verify();
    const clients = await cluster.pool.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction' AND pid<>pg_backend_pid()"); expect(clients.rows).toHaveLength(1);
    await cluster.pool.query('SELECT pg_terminate_backend($1)',[clients.rows[0].pid]); await rejected;
    expect((await cluster.pool.query('SELECT 1 alive')).rows[0].alive).toBe(1);
  } finally {await backend.close(); await cluster.dropSchema(schema);}
});
