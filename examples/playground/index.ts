const control = (id:string) => document.getElementById(id) as HTMLSelectElement;
const preview = document.getElementById('preview') as HTMLIFrameElement, status = document.getElementById('connection')!;
const params = new URLSearchParams(location.search); let generation = '';
for(const name of ['reviewer','scenario','capabilities','device','theme']) {const value=params.get(name),select=control(name);if(value && [...select.options].some(option=>option.value===value))select.value=value;}
function command(type:string,value:string) {preview.contentWindow?.postMessage({type,value,generation},location.origin);}
function links() {
  const settings = new URLSearchParams({reviewer:control('reviewer').value,scenario:control('scenario').value,capabilities:control('capabilities').value,theme:control('theme').value});
  (document.getElementById('standalone') as HTMLAnchorElement).href='/playground/app/overview?'+settings;
  settings.set('reviewer',control('reviewer').value==='morgan'?'alex':'morgan');settings.set('device',control('device').value);(document.getElementById('peer') as HTMLAnchorElement).href='/playground/?'+settings;
}
function resize() {const device=control('device').value;preview.style.width=device==='mobile'?'390px':device==='narrow'?'320px':'100%';preview.style.height=device==='mobile'?'844px':device==='narrow'?'720px':'calc(100vh - 120px)';links();}
function load() {generation=crypto.randomUUID();control('fault').value='normal';control('fault').disabled=true;status.textContent='Preparing the sample workspace…';const settings=new URLSearchParams({reviewer:control('reviewer').value,scenario:control('scenario').value,capabilities:control('capabilities').value,theme:control('theme').value,generation});preview.src='/playground/app/overview?'+settings;links();}
for(const id of ['reviewer','scenario','capabilities'])control(id).addEventListener('change',load);
control('device').addEventListener('change',resize);
control('theme').addEventListener('change',()=>{document.documentElement.classList.toggle('dark',control('theme').value==='dark');command('playground:theme',control('theme').value);links();});
control('fault').addEventListener('change',()=>command('playground:fault',control('fault').value));
document.getElementById('reload')!.addEventListener('click',load);
window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==preview.contentWindow||event.data?.generation!==generation)return;if(event.data.type==='playground:ready'){control('fault').disabled=false;status.textContent=`${event.data.reviewer} · ${event.data.scenario} · ready`;command('playground:theme',control('theme').value);}else if(event.data.type==='playground:fault-applied')status.textContent=`Service: ${event.data.value}`;else if(event.data.type==='playground:error')status.textContent=String(event.data.message);});
document.documentElement.classList.toggle('dark',control('theme').value==='dark');resize();load();
