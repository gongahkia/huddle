import express from 'express';
import {randomUUID} from 'node:crypto';
import {lstat,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {ReviewStore,CollaborationError,type Identity,type Scope} from '../packages/host/src/store';
import {installSqlite,SqliteBackend} from '../packages/host/src/sqlite';
import {createExpressMiddleware} from '../packages/host/src/express';
import {addPlayground} from './playground-host';

// A loopback-only disposable host for browser acceptance, never a deployment/auth example.
if(process.version !== 'v24.21.0') throw new Error('Run the disposable browser host on Node 24.21.0.');
const manual = process.argv.includes('--playground'), port = Number(process.env.HUDDLE_BROWSER_FIXTURE_PORT || (manual?4327:4326)); if(!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Use a valid fixture loopback port.');
const origin = `http://localhost:${port}`, nonce = randomUUID(), directory = await mkdtemp(join(tmpdir(),'huddle-browser-host-')), marker = join(directory,'owner.json'), output = resolve(manual?'output/playground':'output/browser-host'), active = join(output,'active.json');
await writeFile(marker,JSON.stringify({kind:'huddle-browser-host',nonce,directory}),{mode:0o600});
const sessions = {alex:randomUUID(),morgan:randomUUID(),guest:randomUUID()}, ownerToken = randomUUID(), csrf = randomUUID(), revoked = new Set<string>(); let loseImport = false, published = false;
const alex = {id:'host:alex',name:'Alex'}, morgan = {id:'host:morgan',name:'Morgan'}, members:Identity[] = [alex,morgan,...Array.from({length:251},(_,index) => ({id:`host:member:${index}`,name:`Fixture member ${index}`}))];
const users = new Map<string,Identity & {internal:boolean}>([[sessions.alex,{...alex,internal:true}],[sessions.morgan,{...morgan,internal:true}],[sessions.guest,{id:'host:guest',name:'Guest',internal:false}]]);
const path = join(directory,'disposable.sqlite'); installSqlite(path); const backend = new SqliteBackend(path), app = express(); let server:ReturnType<typeof app.listen> | undefined, closing:Promise<void> | undefined;
const capabilities = {mentions:true,assignment:true,directory:true,commentColors:true};
const allowedScope = (scope:Scope) => {if(scope.workspace !== 'team' || !['preview','production'].includes(scope.environment)) throw new CollaborationError('forbidden','This scope is not available to the fixture user.');};
const directoryApi = {async lookup(_scope:Scope,ids:string[]) {return members.filter(item => ids.includes(item.id));},async list(_scope:Scope,query:{search?:string;cursor?:string}) {const offset = Number(query.cursor || 0); if(!Number.isSafeInteger(offset) || offset < 0) throw new CollaborationError('validation','Invalid directory cursor.'); const found = members.filter(item => !query.search || item.name.toLowerCase().includes(query.search.toLowerCase())); return {items:found.slice(offset,offset+50),nextCursor:offset+50 < found.length ? String(offset+50) : null};}};
function internal(request:{headers:{get(name:string):string | null}}) {
  const token = (request.headers.get('Cookie') || '').split(';').map(item => item.trim()).find(item => item.startsWith('fixture_review_session='))?.slice('fixture_review_session='.length), user = token ? users.get(token) : undefined;
  if(!user) throw new CollaborationError('unauthenticated','Use the fixture host login.'); if(!user.internal || revoked.has(user.id)) throw new CollaborationError('forbidden','Internal host reviewers only.'); return user;
}
async function cleanup() {
  if(closing) return closing; closing = (async () => {
    if(server?.listening) {server.closeAllConnections(); await new Promise<void>((done,reject) => server!.close(error => error ? reject(error) : done()));}
    await backend.close(); const saved = JSON.parse(await readFile(marker,'utf8')); if((await lstat(directory)).isSymbolicLink() || saved.kind !== 'huddle-browser-host' || saved.nonce !== nonce || saved.directory !== directory) throw new Error('Refusing cleanup of an unverified browser fixture.');
    if(published) {const record = JSON.parse(await readFile(active,'utf8')); if(record.nonce !== nonce || record.directory !== directory) throw new Error('Refusing to remove another browser fixture record.'); await rm(active);}
    await rm(directory,{recursive:true});
  })(); return closing;
}
try {
  const seed = new ReviewStore(backend,async scope => {allowedScope(scope); return {actor:alex,capabilities};},directoryApi), signal = new AbortController().signal; let seedThreadId = '';
  for(let index=0;index<(manual?0:108);index++) {const scope = {workspace:'team',environment:'preview'}, record = await seed.create(scope,{idempotencyKey:`seed-${index}`,page:'/',pageUrl:origin+'/',anchor:{kind:'page',selector:'body',label:`Seed ${index}`,quote:'',x:.5,y:.5},body:`Seed thread ${index}`},signal); if(!index) {seedThreadId = record.thread.id; for(let reply=1;reply<=260;reply++) await seed.reply(scope,record.thread.id,{idempotencyKey:`seed-reply-${reply}`,body:`Seed reply ${reply}`},signal);} if(index % 2) await seed.update(scope,record.thread.id,{idempotencyKey:`seed-resolve-${index}`,expectedVersion:record.thread.version,status:'resolved'},signal);}
  await seed.create({workspace:'team',environment:'production'},{idempotencyKey:'production',page:'/',pageUrl:origin+'/',anchor:{kind:'page',selector:'body',label:'Production seed',quote:'',x:.5,y:.5},body:'Production seed'},signal);
  app.use((request,response,next) => {response.setHeader('Cache-Control','private, no-store'); response.setHeader('X-Content-Type-Options','nosniff'); next();});
  app.get('/healthz',(_request,response) => response.json({fixture:'ready'}));
  app.use(createExpressMiddleware({origin,async api(request) {internal(request); const store = new ReviewStore(backend,async scope => {allowedScope(scope); const user = internal(request); return {actor:{id:user.id,name:user.name},capabilities};},directoryApi), execute = store.executeImport.bind(store); store.executeImport = async (...args) => {const result = await execute(...args); if(loseImport) {loseImport = false; throw new CollaborationError('unavailable','Fixture acknowledgement lost after committed import batch.');} return result;}; return store;},async verifyMutation(request) {internal(request); if(request.headers.get('Origin') !== origin || request.headers.get('X-Fixture-CSRF') !== csrf) throw new CollaborationError('forbidden','The host CSRF check failed.');}}));
  app.post('/fixture/fault',express.json({limit:'8kb'}),(request,response) => {if(request.get('X-Fixture-Owner') !== ownerToken) {response.sendStatus(403); return;} if(request.body.kind === 'lose-import') loseImport = true; else if(request.body.kind === 'revoke' && ['host:alex','host:morgan'].includes(request.body.actor)) revoked.add(request.body.actor); else if(request.body.kind === 'restore') revoked.clear(); else {response.sendStatus(400); return;} response.json({fixture:'updated'});});
  await addPlayground(app,backend,origin);
  app.use('/sdk',express.static(resolve('packages/browser/dist')));
  app.use(express.static(resolve('dist/examples'),{index:false}));
  app.get('/fixture.css',(_request,response) => response.type('css').send('body{font:16px system-ui;padding:24px;min-height:100vh;color:#1b2932;background:#fafafa}button,a{margin:8px}dialog{padding:20px} :root.dark{--huddle-color-scheme:dark;--huddle-background:#14202a;--huddle-surface:#1b2932;--huddle-text:#f4f7fa;--huddle-muted:#c3d0db;--huddle-border:#8095a6;--huddle-hover:#2c414e;--huddle-accent:#9be6cb;--huddle-accent-text:#14202a;--huddle-link:#9be6cb;--huddle-target-background:#1b2932;--huddle-notice-background:#1b2932;--huddle-badge-background:#253e35;--huddle-focus:#ffcd7a}'));
  app.get('/fixture-client.js',(_request,response) => response.type('js').send(`import {mount} from '/sdk/huddle.js';import {createHttpAdapter} from '/sdk/http.js';
const internal=document.body.dataset.internal==='1',nonce=document.querySelector('meta[name=fixture-nonce]').content;
let review;const options={adapter:createHttpAdapter({headers:()=>({'X-Fixture-CSRF':document.querySelector('meta[name=fixture-csrf]').content})}),namespace:'real-browser-host',workspace:'team',environment:'preview',exportEnvironments:['preview','production'],styleNonce:nonce,allowedQueryParameters:['tab'],excludeElement:el=>el.hasAttribute('data-private'),redact:text=>text.replaceAll('sensitive-token','[redacted]'),viewContext:()=>({tab:'details',trace:'sensitive-token'}),onError:error=>console.info('Fixture review error:',error.message)};
function install(){if(internal){review=mount(options);window.fixtureReview=review;}}install();window.fixtureMount=install;window.fixtureDestroy=()=>{review?.destroy();review=undefined;delete window.fixtureReview;};
document.querySelector('#counter').onclick=()=>document.querySelector('#count').textContent=String(Number(document.querySelector('#count').textContent)+1);
document.querySelector('#theme').onclick=()=>document.documentElement.classList.toggle('dark');
if(internal){const opener=document.querySelector('#host-shadow').attachShadow({mode:'open'}),button=document.createElement('button');button.textContent='Host review launcher';opener.append(button);button.onclick=()=>review?.open();}
document.querySelector('#dialog-open').onclick=()=>document.querySelector('dialog').showModal();document.querySelector('#dialog-close').onclick=()=>document.querySelector('dialog').close();`));
  app.get('/{*path}',(request,response) => {const nonce = randomUUID(); let admitted = false; try {internal({headers:new Headers({Cookie:request.get('Cookie') || ''})}); admitted = true;} catch { /* public business page remains usable */ } response.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'self'; style-src 'self' 'nonce-${nonce}'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; form-action 'self'`); response.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Disposable review host</title><meta name="fixture-nonce" content="${nonce}"><meta name="fixture-csrf" content="${csrf}"><link rel="stylesheet" href="/fixture.css"><script type="module" src="/fixture-client.js"></script></head><body data-internal="${admitted ? '1' : '0'}"><h1>Host business page</h1><button id="counter">Add update</button><p>Updates: <span id="count">0</span></p><a href="/next">Public demo navigation</a><button id="theme">Toggle host theme</button><div id="host-shadow"></div><button id="target" data-huddle-id="target">Review target</button><button id="private" data-private>Private sensitive-token</button><input aria-label="Host input" value="never-capture-input-value"><p id="excluded-text" data-private>excluded-selection-value</p><button id="dialog-open">Open host dialog</button><dialog><p>Host dialog</p><button id="dialog-close">Close host dialog</button></dialog></body></html>`);});
  await mkdir(output,{recursive:true}); if((await lstat(output)).isSymbolicLink()) throw new Error('Refusing an unverified browser fixture output path.');
  await writeFile(active,JSON.stringify({schema:'huddle.browser.fixture.v2',nonce,directory,origin,sessions,ownerToken,csrf,seedThreadId,datasetId:backend.datasetId}),{flag:'wx',mode:0o600}); published = true;
  server = app.listen(port,'127.0.0.1'); await new Promise<void>((done,reject) => {server!.once('listening',done); server!.once('error',reject);});
  console.log(manual ? 'Huddle UI playground: '+origin+'/playground/ (fictional data; resets when stopped)' : 'Disposable browser host ready at '+origin); for(const event of ['SIGTERM','SIGINT'] as const) process.once(event,() => {void cleanup().catch(() => {console.error('Browser fixture cleanup failed; owned data retained.'); process.exitCode = 1;});});
} catch(value) {await cleanup(); throw value;}
