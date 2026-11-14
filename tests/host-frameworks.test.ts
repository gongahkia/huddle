import {expect,it} from 'vitest';
import {createServer,type Server} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import express from 'express';
import Fastify,{type FastifyInstance} from 'fastify';
import {createExpressMiddleware} from '../packages/host/src/express';
import {createFastifyPlugin} from '../packages/host/src/fastify';
import {installSqlite,SqliteBackend} from '../packages/host/src/sqlite';
import {ReviewStore,CollaborationError} from '../packages/host/src/store';
import {createHttpAdapter} from '../packages/browser/src/http';
import type {HostHttpOptions} from '../packages/host/src/http';

it.each(['express','fastify'])('uses real %s HTTP wiring with host auth and durable SQLite',async framework => {
  const directory = await mkdtemp(join(tmpdir(),'huddle-http-runtime-')), nonce = crypto.randomUUID(), path = join(directory,'feedback.sqlite'); await writeFile(join(directory,'fixture'),nonce,{mode:0o600}); installSqlite(path); const backend = new SqliteBackend(path);
  const contexts = new WeakSet<object>();
  const origin = 'http://host.test', options: HostHttpOptions & {origin: string} = {origin,api(request,_signal,native?: object) {if(!native || !contexts.has(native)) throw new Error('Missing native host middleware context.'); return new ReviewStore(backend,async scope => {const session = request.headers.get('Cookie'); if(!session) throw new CollaborationError('unauthenticated','Use the host login.'); if(!['actor=alex','actor=morgan'].includes(session) || scope.workspace !== 'team') throw new CollaborationError('forbidden','Internal only.'); return {actor:{id:session,name:session},capabilities:{mentions:false,assignment:false,directory:false}};});},verifyMutation(request) {if(request.headers.get('Origin') !== origin || request.headers.get('X-CSRF') !== 'fixture') throw new CollaborationError('forbidden','Host CSRF check failed.');}};
  const removeFixture = async () => {if(await readFile(join(directory,'fixture'),'utf8') !== nonce) throw new Error('Refusing unowned runtime fixture cleanup.'); await rm(directory,{recursive:true,force:true});};
  let server: Server | undefined, fastify: FastifyInstance | undefined;
  try {
    let address: string;
    if(framework === 'express') {const app = express(); app.use((_request,response,next) => {contexts.add(_request); response.setHeader('X-Host-Policy','retained'); next();}); app.use(createExpressMiddleware(options)); app.use(express.json()); app.get('/business',(_request,response) => response.send('Business still works')); server = createServer({maxHeaderSize:131072},app); server.listen(0,'127.0.0.1'); await once(server,'listening'); const socket = server.address(); if(!socket || typeof socket === 'string') throw new Error('No owned Express port.'); address = 'http://127.0.0.1:'+socket.port;}
    else {fastify = Fastify({http:{maxHeaderSize:131072},routerOptions:{maxParamLength:4096}}); fastify.addHook('preHandler',async request => {contexts.add(request);}); fastify.addHook('onSend',async (_request,reply,payload) => {reply.header('X-Host-Policy','retained'); return payload;}); fastify.get('/business',async () => 'Business still works'); await fastify.register(createFastifyPlugin(options)); address = await fastify.listen({port:0,host:'127.0.0.1'});}
    const actor = (id: string) => createHttpAdapter({fetch:async (path,init) => fetch(address+path,{...init,headers:{...Object.fromEntries(new Headers(init?.headers)),Cookie:'actor='+id,Origin:origin,'X-CSRF':'fixture'}})}), alex = actor('alex'), morgan = actor('morgan'), guest = actor('guest'), scope = {workspace:'team',environment:'preview'}, signal = new AbortController().signal;
    const input = {idempotencyKey:'real-http-retry',page:'/',pageUrl:origin+'/',anchor:{kind:'page' as const,selector:'body',label:'Page',quote:'',x:0,y:0},body:'From real HTTP'};
    const saved = await alex.create(scope,input,signal); expect((await alex.create(scope,input,signal)).thread.id).toBe(saved.thread.id); expect((await morgan.reply(scope,saved.thread.id,{idempotencyKey:'peer',body:'Peer reply'},signal)).comments.items).toHaveLength(2);
    await expect(guest.list(scope,{},signal)).rejects.toMatchObject({code:'forbidden'}); await expect(alex.list({...scope,workspace:'other'}, {},signal)).rejects.toMatchObject({code:'forbidden'});
    const denied = await fetch(address+'/api/huddle/v2/threads?workspace=team&environment=preview',{method:'POST',headers:{Cookie:'actor=alex',Origin:'http://wrong.test','X-CSRF':'fixture','Content-Type':'application/json'},body:JSON.stringify(input)}); expect(denied.status).toBe(403); expect((await denied.json()).error.code).toBe('forbidden');
    const invalid = await fetch(address+'/api/huddle/v2/threads?workspace=team&environment=preview&limit=1&limit=2',{headers:{Cookie:'actor=alex'}}); expect(invalid.status).toBe(400); expect((await invalid.json()).error.code).toBe('validation');
    const policy = await fetch(address+'/api/huddle/v2/session?workspace=team&environment=preview',{headers:{Cookie:'actor=alex'}}); expect(policy.headers.get('X-Host-Policy')).toBe('retained'); await policy.arrayBuffer();
    expect(await (await fetch(address+'/business')).text()).toBe('Business still works');
    const fresh = new SqliteBackend(path); try {expect((await new ReviewStore(fresh,async () => ({actor:{id:'host:read',name:'Reader'},capabilities:{mentions:false,assignment:false,directory:false}})).detail(scope,saved.thread.id,{},signal)).comments.items).toHaveLength(2);} finally {await fresh.close();}
  } finally {if(server) {server.closeAllConnections(); await new Promise<void>((done,reject) => server!.close(error => error ? reject(error) : done()));} await fastify?.close(); await backend.close(); await removeFixture();}
});
