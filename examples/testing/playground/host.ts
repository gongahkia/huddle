import express,{type Express} from 'express';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {ReviewStore,createAnonymousIdentity,CollaborationError,type Backend,type Identity,type Scope} from '../../../packages/host/src/store';
import {createExpressMiddleware} from '../../../packages/host/src/express';

// this fictional host shares only the browser fixture's explicitly disposable backend.
export async function addPlayground(app:Express,backend:Backend,origin:string) {
  const csrf = randomUUID(), full = {directory:true,mentions:true,assignment:true,commentColors:true}, basic = {directory:false,mentions:false,assignment:false,commentColors:true};
  const actors = {alex:{id:'playground:alex',name:'Alex Rivera'},morgan:{id:'playground:morgan',name:'Morgan Chen'},guest:{id:'playground:guest',name:'Guest'}};
  const members:Identity[] = [actors.alex,actors.morgan,...Array.from({length:62},(_,n) => ({id:`playground:member:${n}`,name:`Sample teammate ${n+1}`}))];
  type Fault = 'normal'|'slow'|'unavailable'|'writes'|'expired';
  type Session = {actor:Identity;guest:boolean;workspace:string;capabilities:typeof full;fault:Fault;anonymous?:boolean;placeholderName?:string};
  const sessions = new Map<string,Session>();
  const directoryMembers=()=>[...new Map([...members,...[...sessions.values()].filter(value=>value.anonymous).map(value=>value.actor)].map(member=>[member.id,member])).values()];
  const directory = {async lookup(_scope:Scope,ids:string[]) {return directoryMembers().filter(member => ids.includes(member.id));},async list(_scope:Scope,query:{search?:string;cursor?:string}) {const offset = Number(query.cursor || 0); if(!Number.isSafeInteger(offset)||offset<0) throw new CollaborationError('validation','Invalid member cursor.');const found = directoryMembers().filter(member => !query.search || member.name.toLowerCase().includes(query.search.toLowerCase()));return {items:found.slice(offset,offset+50),nextCursor:offset+50<found.length?String(offset+50):null};}};
  const seed = new ReviewStore(backend,async () => ({actor:actors.alex,capabilities:full}),directory), signal = new AbortController().signal;
  for(const workspace of ['playground','playground-busy']) {
    const scope = {workspace,environment:'preview'}, page = '/playground/app/overview';
    const add = (key:string,label:string,body:string,extra:Partial<Parameters<ReviewStore['create']>[1]>={}) => seed.create(scope,{idempotencyKey:`${workspace}:${key}`,page,pageUrl:origin+page,anchor:{kind:'element',selector:`[data-huddle-id="${key}"]`,stableKey:`[data-huddle-id="${key}"]`,tag:key==='settings-target'?'h1':'h2',label,quote:'',x:.5,y:.5},body,...extra},signal);
    for(let n=0;n<3;n++) await add('shared-target','Launch checklist', ['Can we make this heading easier to scan?','Three discussions share this exact target. Each badge should remain reachable.','Keyboard check: focus this pin, read its preview, then open the discussion.'][n],{idempotencyKey:`${workspace}:shared:${n}`});
    const long = await add('summary-copy','A calmer release week','A long discussion for checking replies, history, mentions, wrapping and pagination. Keep the original feedback visible when you resize the page.');
    const peer = new ReviewStore(backend,async () => ({actor:actors.morgan,capabilities:full}),directory);
    for(let n=0;n<64;n++) await peer.reply(scope,long.thread.id,{idempotencyKey:`${workspace}:reply:${n}`,body:n===63?'Latest reply: thanks Alex — let’s try the narrower layout. 👋':'Review note '+(n+1)+': readable spacing, clear actions and predictable keyboard focus.',mentions:n===0?[actors.alex.id]:[]},signal);
    await seed.update(scope,long.thread.id,{idempotencyKey:`${workspace}:assign`,expectedVersion:long.thread.version+64,assigneeId:actors.morgan.id},signal);
    const resolved = await add('completed-target','Ready for review','This resolved discussion should appear when Show resolved is enabled.'); await seed.update(scope,resolved.thread.id,{idempotencyKey:`${workspace}:resolve`,expectedVersion:resolved.thread.version,status:'resolved'},signal);
    await add('changing-target','Delivery notes','Try renaming, hiding or removing this heading using the example controls. Locate and reattach must stay useful.');
    await add('dialog-target','Notification preferences','This pin belongs inside a native dialog. Open Preferences to inspect it.');
    await add('settings-target','Workspace defaults','A discussion on the Settings page.',{page:'/playground/app/settings',pageUrl:origin+'/playground/app/settings'});
    if(workspace==='playground-busy') for(let n=0;n<65;n++) await add('shared-target','Launch checklist',`Busy workspace note ${n+1}: thread paging and dense shared anchors.`,{idempotencyKey:`${workspace}:busy:${n}`});
  }
  function session(request:Request):Session {const record = sessions.get(request.headers.get('X-Playground-Session') || ''); if(!record) throw new CollaborationError('unauthenticated','Choose a playground reviewer.');return record;}
  function protect(request:{get(name:string):string|undefined}) {return request.get('Origin')===origin && request.get('X-Playground-CSRF')===csrf;}
  app.get('/playground/config',(_request,response) => response.json({csrf,disposable:true}));
  app.post('/playground/session',express.json({limit:'4kb'}),(request,response) => {
    if(!protect(request)) {response.sendStatus(403);return;}
    const {reviewer,scenario,capabilities} = request.body || {};
    if((!Object.hasOwn(actors,reviewer)&&reviewer!=='anonymous') || !['populated','empty','busy'].includes(scenario) || !['full','basic'].includes(capabilities)) {response.sendStatus(400);return;}
    const prior=sessions.get(request.get('X-Playground-Session')||''),anonymous=reviewer==='anonymous',actor=anonymous?(prior?.anonymous?prior.actor:createAnonymousIdentity()):actors[reviewer as keyof typeof actors],placeholderName=anonymous?(prior?.placeholderName||actor.name):undefined;
    const token = randomUUID(), workspace = scenario==='empty'?'playground-empty':scenario==='busy'?'playground-busy':'playground';
    if(sessions.size>=256) sessions.delete(sessions.keys().next().value!);
    sessions.set(token,{actor,workspace,guest:reviewer==='guest',capabilities:capabilities==='full'?full:basic,fault:'normal',anonymous,placeholderName});response.json({token,actor,workspace,anonymous});
  });
  app.post('/playground/name',express.json({limit:'4kb'}),(request,response)=>{
    if(!protect(request)){response.sendStatus(403);return;}const record=sessions.get(request.get('X-Playground-Session')||''),name=request.body?.name;if(!record?.anonymous){response.sendStatus(403);return;}if(typeof name!=='string'||name.trim().length>80||[...name].some(character=>character.charCodeAt(0)<32||character.charCodeAt(0)===127)){response.sendStatus(400);return;}record.actor.name=name.trim()||record.placeholderName!;response.json({actor:record.actor});
  });
  app.post('/playground/control',express.json({limit:'4kb'}),(request,response) => {
    if(!protect(request)) {response.sendStatus(403);return;} const record = sessions.get(request.get('X-Playground-Session') || ''), fault = request.body?.fault;
    if(!record || !['normal','slow','unavailable','writes','expired'].includes(fault)) {response.sendStatus(400);return;}record.fault=fault;response.json({fault});
  });
  app.use(createExpressMiddleware({basePath:'/api/playground/v2',origin,async api(request,requestSignal) {
    const record = session(request);
    if(record.fault==='slow') await new Promise<void>((done,reject) => {const abort=()=>{clearTimeout(timer);reject(requestSignal.reason);},timer=setTimeout(()=>{requestSignal.removeEventListener('abort',abort);done();},1200);if(requestSignal.aborted) abort();else requestSignal.addEventListener('abort',abort,{once:true});});
    if(record.fault==='unavailable') throw new CollaborationError('unavailable','Playground: the sample service is unavailable. Switch Service back to Normal.');
    if(record.fault==='expired') throw new CollaborationError('unauthenticated','Playground: this review session has expired. Switch Service back to Normal and check access again.');
    return new ReviewStore(backend,async scope => {if(record.guest) throw new CollaborationError('forbidden','Playground: guests can browse the example but cannot review.');if(scope.workspace!==record.workspace||scope.environment!=='preview') throw new CollaborationError('forbidden','This playground scope is unavailable.');return {actor:record.actor,capabilities:record.capabilities};},directory);
  },async verifyMutation(request) {const record=session(request);if(request.headers.get('Origin')!==origin||request.headers.get('X-Playground-CSRF')!==csrf) throw new CollaborationError('forbidden','Playground mutation protection failed.');if(record.fault==='writes' && new URL(request.url).pathname!=='/api/playground/v2/exports') throw new CollaborationError('unavailable','Playground: this write failed. Your draft is kept. Switch Service back to Normal to retry.');}}));
  const root = resolve('dist/examples/testing/playground');
  const html = (file:string) => async (_request:express.Request,response:express.Response) => {
    const nonce=randomUUID();response.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'self'; style-src 'self' 'nonce-${nonce}'; connect-src 'self'; frame-src 'self' blob:; frame-ancestors 'self'; img-src 'self'; base-uri 'none'; form-action 'self'`);response.type('html').send((await readFile(resolve(root,file),'utf8')).replaceAll('__HUDDLE_NONCE__',nonce));
  };
  app.get(['/playground','/playground/'],html('index.html'));
  app.get(['/playground/app/overview','/playground/app/settings'],html('app.html'));
  app.use('/playground',express.static(root,{index:false}));
}
