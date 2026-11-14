import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runInNewContext} from 'node:vm';
import {createHostHandler,type HostApi,type HostHttpOptions} from '../packages/host/src/http';
import {installSqlite,SqliteBackend} from '../packages/host/src/sqlite';
import {ReviewStore,CollaborationError} from '../packages/host/src/store';
import {createHttpAdapter} from '../packages/browser/src/http';
import type {Detail} from '../packages/shared/src/collaboration';
const base = 'http://host.test/api/huddle/v2', scope = {workspace:'team',environment:'preview'}, query = '?workspace=team&environment=preview';
const input = () => ({idempotencyKey:crypto.randomUUID(),page:'/',pageUrl:'https://host.test/',anchor:{kind:'page',selector:'body',label:'Page',quote:'',x:0,y:0},body:'Host feedback'});
let directory: string, nonce: string, backend: SqliteBackend, options: HostHttpOptions, allowed: boolean;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(),'huddle-host-http-')); nonce = crypto.randomUUID(); await writeFile(join(directory,'fixture'),nonce,{mode:0o600}); const path = join(directory,'feedback.sqlite'); installSqlite(path); backend = new SqliteBackend(path); allowed = true;
  options = {api(request) {const session = request.headers.get('Cookie'); return new ReviewStore(backend,async selected => {if(!session) throw new CollaborationError('unauthenticated','Use the host login.'); if(session === 'session=limited') throw new CollaborationError('rate_limited','Try later.',2500); if(!allowed || !['session=alex','session=morgan'].includes(session) || selected.workspace !== 'team' || !['preview','production'].includes(selected.environment)) throw new CollaborationError('forbidden','Internal review access required.'); return {actor:session === 'session=alex' ? {id:'host:alex',name:'Alex'} : {id:'host:morgan',name:'Morgan'},capabilities:{mentions:false,assignment:false,directory:false}};});},verifyMutation(request) {if(request.headers.get('Origin') !== 'http://host.test' || request.headers.get('X-Fixture-CSRF') !== 'fixture') throw new CollaborationError('forbidden','Host CSRF check failed.');}};
});
afterEach(async () => {vi.restoreAllMocks(); await backend.close(); if(await readFile(join(directory,'fixture'),'utf8') !== nonce) throw new Error('Refusing to remove an unowned HTTP fixture.'); await rm(directory,{recursive:true,force:true});});
function request(path: string,method = 'GET',body?: unknown,session: string | null = 'alex',extra: HeadersInit = {}) {return new Request(base+path,{method,headers:{...(session === null ? {} : {Cookie:'session='+session}),Origin:'http://host.test','X-Fixture-CSRF':'fixture',...(body === undefined ? {} : {'Content-Type':'application/json'}),...extra},body:body === undefined ? undefined : JSON.stringify(body)});}
it('requires explicit host API and mutation protection configuration',() => {expect(() => createHostHandler({api:options.api} as HostHttpOptions)).toThrow('protection'); expect(() => createHostHandler({...options,basePath:'//other.test/api'})).toThrow('same-origin');});
it('uses the host session and denies guests, customers, unknown scopes and revoked access',async () => {
  const handler = createHostHandler(options);
  for(const [actor,status] of [[null,401],['guest',403],['customer',403]] as const) expect((await handler(request('/session'+query,'GET',undefined,actor))).status).toBe(status);
  const session = await handler(request('/session'+query,'GET',undefined,'alex',{'X-Actor':'forged'})); expect((await session.json()).actor.id).toBe('host:alex'); expect(session.headers.get('Cache-Control')).toBe('private, no-store'); expect(session.headers.has('Access-Control-Allow-Origin')).toBe(false);
  expect((await handler(request('/threads?workspace=other&environment=preview'))).status).toBe(403); allowed = false; expect((await handler(request('/threads'+query))).status).toBe(403);
});
it('wires create, explicit retry, two authors, version updates, changes and complete detail pages',async () => {
  const handler = createHostHandler(options), initial = await (await handler(request('/changes'+query))).json(), mutation = input();
  const created = await handler(request('/threads'+query,'POST',mutation)); expect(created.status).toBe(201); const saved: Detail = await created.json(); expect(saved.thread.createdBy.id).toBe('host:alex');
  expect((await (await handler(request('/threads'+query,'POST',mutation))).json()).thread.id).toBe(saved.thread.id);
  expect((await handler(request('/threads'+query,'POST',{...mutation,body:'Different'}))).status).toBe(409);
  const replied = await (await handler(request(`/threads/${saved.thread.id}/replies`+query,'POST',{idempotencyKey:'peer',body:'Morgan reply'},'morgan'))).json(); expect(replied.comments.items.at(-1).author.id).toBe('host:morgan');
  const updated = await (await handler(request(`/threads/${saved.thread.id}`+query,'PATCH',{idempotencyKey:'resolve',expectedVersion:2,status:'resolved'}))).json(); expect(updated.thread.status).toBe('resolved');
  expect((await handler(request(`/threads/${saved.thread.id}`+query,'PATCH',{idempotencyKey:'stale',expectedVersion:2,status:'open'}))).status).toBe(409);
  const first = await (await handler(request(`/threads/${saved.thread.id}`+query+'&limit=1'))).json(); expect(first.comments.items).toHaveLength(1); const next = await (await handler(request(`/threads/${saved.thread.id}`+query+'&commentsCursor='+encodeURIComponent(first.comments.nextCursor)))).json(); expect(next.comments.items[0].body).toBe('Morgan reply');
  expect((await (await handler(request('/changes'+query+'&cursor='+encodeURIComponent(initial.cursor)))).json()).items).toHaveLength(3);
  expect((await (await handler(request('/threads'+query+'&status=resolved&limit=1'))).json()).items).toHaveLength(1); expect((await (await handler(request('/threads?workspace=team&environment=production'))).json()).items).toHaveLength(0);
});
it('rejects duplicate/unknown queries, malformed IDs, noninteger limits and client authorship',async () => {
  const handler = createHostHandler(options);
  for(const path of ['/threads'+query+'&limit=1&limit=2','/threads'+query+'&unknown=x','/threads'+query+'&limit=1.2','/threads'+query+'&limit=101','/threads/%EE'+query]) expect((await handler(request(path))).status).toBe(400);
  expect((await handler(request('/threads'+query,'POST',{...input(),author:{id:'forged',name:'Forged'}}))).status).toBe(400);
  expect((await handler(request('/directory'+query))).status).toBe(404);
});
it('applies host mutation protection to every write/transfer route before reading data',async () => {
  const handler = createHostHandler(options);
  for(const [method,path] of [['POST','/threads'],['PATCH','/threads/guessed'],['POST','/threads/guessed/replies'],['POST','/exports'],['POST','/imports/uploads'],['POST','/imports/previews'],['POST','/imports/jobs']]) expect((await handler(request(path+(path === '/exports' ? '' : query),method,{},'alex',{'X-Fixture-CSRF':'wrong'}))).status).toBe(403);
  expect((await handler(request('/threads'+query,'POST',input(),'alex',{'Content-Type':'text/plain'}))).status).toBe(400);
});
it('bounds JSON bytes/depth and rejects invalid UTF-8 without touching discussion',async () => {
  const handler = createHostHandler({...options,bodyLimitBytes:100}); expect((await handler(request('/threads'+query,'POST',input()))).status).toBe(400);
  const invalid = new Request(base+'/threads'+query,{method:'POST',headers:request('/threads'+query,'POST',{}).headers,body:Uint8Array.from([0xff])}); expect((await handler(invalid)).status).toBe(400);
  const deep = new Request(base+'/threads'+query,{method:'POST',headers:invalid.headers,body:'['.repeat(100)+'0'+']'.repeat(100)}); expect((await createHostHandler(options)(deep)).status).toBe(400);
  expect((await (await createHostHandler(options)(request('/threads'+query))).json()).items).toHaveLength(0);
});
it('exposes typed host rate limits and sanitizes unexpected failures',async () => {
  const limited = await createHostHandler(options)(request('/threads'+query,'GET',undefined,'limited')); expect(limited.status).toBe(429); expect(limited.headers.get('Retry-After')).toBe('3'); expect((await limited.json()).error.retryAfterMs).toBe(2500);
  const failed = await createHostHandler({...options,api() {throw new Error('SELECT secret FROM private_database');}})(request('/threads'+query)); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain('SELECT');
});
it('cancels slow host callbacks and request-body readers within the configured deadline',async () => {
  const handler = createHostHandler({...options,timeoutMs:30,api:async () => new Promise(() => {})}); expect((await handler(request('/session'+query))).status).toBe(504);
  let cancelled = false; const body = new ReadableStream<Uint8Array>({pull() {return new Promise(() => {});},cancel() {cancelled = true;}}), init = {method:'POST',headers:request('/threads'+query,'POST',{}).headers,body,duplex:'half'} as RequestInit & {duplex:'half'};
  expect((await createHostHandler({...options,timeoutMs:30})(new Request(base+'/threads'+query,init))).status).toBe(504); await vi.waitFor(() => expect(cancelled).toBe(true));
});
it('connects the real browser HTTP helper to actual SQLite discussion operations',async () => {
  const handler = createHostHandler(options), adapter = createHttpAdapter({fetch:async (url,init) => handler(new Request('http://host.test'+url,{...init,headers:{...Object.fromEntries(new Headers(init?.headers)),Cookie:'session=alex',Origin:'http://host.test','X-Fixture-CSRF':'fixture'}}))}), signal = new AbortController().signal;
  const saved = await adapter.create(scope,{...input(),anchor:{kind:'page',selector:'body',label:'Page',quote:'',x:0,y:0}},signal); expect((await adapter.list(scope,{},signal)).items[0].id).toBe(saved.thread.id); allowed = false; await expect(adapter.detail(scope,saved.thread.id,{},signal)).rejects.toMatchObject({code:'forbidden'});
});
it('bounds upload streaming, requires complete consumption and denies before reading a private upload',async () => {
  const api = options.api; let consumed = 0;
  const handler = createHostHandler({...options,uploadLimitBytes:3,async api(request,signal) {const store = await api(request,signal); return Object.assign(store,{async stageImport(_scope: unknown,chunks: AsyncIterable<Uint8Array>) {for await(const chunk of chunks) consumed += chunk.byteLength; return {uploadId:'fixture',digest:'0'.repeat(64)};}});}});
  expect((await handler(request('/imports/uploads'+query,'POST',{large:true}))).status).toBe(400); expect(consumed).toBe(0);
  const incomplete = createHostHandler({...options,async api(request,signal) {return Object.assign(await api(request,signal),{stageImport:async () => ({uploadId:'partial',digest:'0'.repeat(64)})});}}); expect((await incomplete(request('/imports/uploads'+query,'POST',{}))).status).toBe(503);
  const denied = request('/imports/uploads'+query,'POST',{private:'content'},'guest'); expect((await handler(denied)).status).toBe(403); expect(denied.bodyUsed).toBe(false);
});
it('authorizes every export environment and closes a transfer seam stream on completion or cancellation',async () => {
  const api = options.api; let released = 0;
  const handler = createHostHandler({...options,async api(request,signal) {return Object.assign(await api(request,signal),{async export() {return {filename:'review.json',contentType:'application/json',chunks:(async function*() {try {yield new TextEncoder().encode('{'); yield new TextEncoder().encode('}');} finally {released++;}})()};}} satisfies Partial<HostApi>);}});
  const response = await handler(request('/exports','POST',{scope:{workspace:'team',environments:['preview']},format:'json'})); expect(response.status).toBe(200); expect(await response.text()).toBe('{}'); expect(released).toBe(1);
  const cancelled = await handler(request('/exports','POST',{scope:{workspace:'team',environments:['preview']},format:'json'})); await cancelled.body!.cancel(); expect(released).toBe(2);
  expect((await handler(request('/exports','POST',{scope:{workspace:'team',environments:['preview','denied']},format:'json'}))).status).toBe(403);
});
it('streams genuine cross-realm bytes without accepting another array-buffer view',async () => {
  const api = options.api, foreign = runInNewContext('new Uint8Array([123,125])') as Uint8Array;
  expect(foreign instanceof Uint8Array).toBe(false);
  const handler = (chunk:Uint8Array) => createHostHandler({...options,async api(request,signal) {return Object.assign(await api(request,signal),{async export() {return {filename:'review.json',contentType:'application/json',chunks:(async function*() {yield chunk;})()};}});}});
  const response = await handler(foreign)(request('/exports','POST',{scope:{workspace:'team',environments:['preview']},format:'json'})); expect(response.status).toBe(200); expect(await response.text()).toBe('{}');
  const invalid = await handler(new DataView(new ArrayBuffer(2)) as unknown as Uint8Array)(request('/exports','POST',{scope:{workspace:'team',environments:['preview']},format:'json'})); await expect(invalid.text()).rejects.toBeDefined();
});
it('bounds download prefetch and releases a stream that the caller never reads',async () => {
  const api = options.api; let produced = 0, released = 0;
  const handler = createHostHandler({...options,timeoutMs:40,async api(request,signal) {return Object.assign(await api(request,signal),{async export() {return {filename:'review.json',contentType:'application/json',chunks:(async function*() {try {for(let index=0;index<100;index++) {produced++; yield new TextEncoder().encode('x');}} finally {released++;}})()};}});}});
  const response = await handler(request('/exports','POST',{scope:{workspace:'team',environments:['preview']},format:'json'})); expect(produced).toBe(1); await vi.waitFor(() => expect(released).toBe(1)); expect(produced).toBe(1); await expect(response.text()).rejects.toBeDefined();
});
it('fails a partially emitted download instead of appending a successful error document',async () => {
  const api = options.api; let released = false;
  const handler = createHostHandler({...options,async api(request,signal) {return Object.assign(await api(request,signal),{async export() {return {filename:'review.json',contentType:'application/json',chunks:(async function*() {try {yield new TextEncoder().encode('{"complete":'); throw new Error('private storage failure');} finally {released = true;}})()};}});}});
  const response = await handler(request('/exports','POST',{scope:{workspace:'team',environments:['preview']},format:'json'})); await expect(response.text()).rejects.toBeDefined(); expect(released).toBe(true);
});
