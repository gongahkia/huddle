import type {Huddle} from '@huddle/browser';
const params = new URLSearchParams(location.search), generation=params.get('generation');
const selected = (name:string,allowed:string[],fallback:string) => allowed.includes(params.get(name)||'')?params.get(name)!:fallback;
const reviewer=selected('reviewer',['alex','morgan','guest'],'alex'),scenario=selected('scenario',['populated','empty','busy'],'populated'),capabilities=selected('capabilities',['full','basic'],'full');
let review:Huddle|undefined, token='',csrf='';
function report(type:string,extra:Record<string,unknown>={}) {if(parent!==window)parent.postMessage({type,generation,...extra},location.origin);}
function theme(value:string) {document.documentElement.classList.toggle('dark',value==='dark');}
theme(params.get('theme')||'light');
async function json(path:string,body?:object) {const response=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-Playground-CSRF':csrf,'X-Playground-Session':token}:{},body:body?JSON.stringify(body):undefined});if(!response.ok)throw new Error('The local playground could not complete this action.');return response.json();}
async function fault(value:string) {try{await json('/playground/control',{fault:value});report('playground:fault-applied',{value});}catch(value){report('playground:error',{message:value instanceof Error?value.message:'The control failed.'});}}
window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==parent||event.data?.generation!==generation)return;if(event.data.type==='playground:theme')theme(event.data.value);if(event.data.type==='playground:fault')void fault(event.data.value);});
function route() {for(const section of document.querySelectorAll<HTMLElement>('[data-page]'))section.hidden=section.dataset.page!==(location.pathname.endsWith('/settings')?'settings':'overview');}
for(const link of document.querySelectorAll<HTMLAnchorElement>('a[data-nav]')) {const url=new URL(link.href);url.search=location.search;link.href=url.href;link.addEventListener('click',event=>{if(event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();history.pushState(null,'',link.href);route();window.scrollTo(0,0);});}
window.addEventListener('popstate',route);route();
let tasks=18;document.getElementById('complete-task')!.addEventListener('click',()=>{document.getElementById('task-status')!.textContent=`${++tasks} tasks complete`;});
document.getElementById('settings-form')!.addEventListener('submit',event=>{event.preventDefault();document.getElementById('settings-status')!.textContent='Settings saved in this example.';});
const dialog=document.getElementById('preferences') as HTMLDialogElement;document.getElementById('preferences-open')!.addEventListener('click',()=>dialog.showModal());document.getElementById('preferences-close')!.addEventListener('click',()=>dialog.close());
const changing=document.getElementById('changing-target')!, holder=changing.parentElement!;
document.getElementById('rename-target')!.addEventListener('click',()=>{changing.textContent='Updated delivery notes';});
document.getElementById('hide-target')!.addEventListener('click',()=>{changing.hidden=true;});
document.getElementById('remove-target')!.addEventListener('click',()=>changing.remove());
document.getElementById('restore-target')!.addEventListener('click',()=>{changing.textContent='Delivery notes';changing.hidden=false;if(!changing.isConnected)holder.append(changing);});
const activity=document.getElementById('activity')!;for(let n=1;n<=16;n++){const row=document.createElement('li');row.dataset.huddleId=`activity-${n}`;row.textContent=`Sample update ${n} · ${n%2?'Alex added a release note':'Morgan reviewed a change'}`;activity.append(row);}
for(const launcher of document.querySelectorAll('[data-open-feedback]'))launcher.addEventListener('click',()=>review?.open());
try {
  csrf=(await json('/playground/config')).csrf;const session=await json('/playground/session',{reviewer,scenario,capabilities});token=session.token;
  const {mount}=await import(new URL('/sdk/huddle.js',location.href).href) as typeof import('@huddle/browser'),{createHttpAdapter}=await import(new URL('/sdk/http.js',location.href).href) as typeof import('@huddle/browser/http');
  review=mount({adapter:createHttpAdapter({basePath:'/api/playground/v2',headers:()=>({'X-Playground-Session':token,'X-Playground-CSRF':csrf})}),namespace:'huddle-ui-playground',workspace:session.workspace,environment:'preview',release:'local-example',styleNonce:document.querySelector<HTMLMetaElement>('meta[name=huddle-style-nonce]')!.content,launcher:'hidden',excludeElement:element=>!!element.closest('[data-private],[data-huddle-exclude]'),viewContext:()=>({sampleApplication:'Atlas',fictional:true})});
  report('playground:ready',{reviewer:session.actor.name,scenario});review.open();window.addEventListener('pagehide',()=>review?.destroy(),{once:true});
} catch(value) {const message=value instanceof Error?value.message:'Could not prepare the local example.';report('playground:error',{message});const error=document.createElement('p');error.setAttribute('role','alert');error.textContent=message;document.querySelector('main')!.prepend(error);}
