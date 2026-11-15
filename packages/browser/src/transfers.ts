import {CollaborationError,isCollaborationError,type Attribution,type CollaborationAdapter,type Counts,type ImportJob,type ImportMapping,type ImportPreview,type Scope} from '../../shared/src/collaboration';
import {operation} from './operations';
import {ByteCollector} from './bytes';
import type {LocalStore} from './storage';
import {icon} from './ui';
type Execution = {previewId:string;digest:string;idempotencyKey:string;id?:string;expected:Counts};
export type TransferHost = {
  adapter:CollaborationAdapter; scope():Scope; parentSignal():AbortSignal; authorized():Promise<boolean>;
  storage():LocalStore | undefined; render():void; error(value:unknown):void; report(value:unknown):void; updated():void;
  directory(parent:HTMLElement):void; canMapMembers():boolean; members():{id:string;name:string}[];
  environments?:string[]; uploadBytes?:number; downloadBytes?:number; timeoutMs?:number;
};
const emptyMapping = ():ImportMapping => ({environmentMap:{},originMap:{},identityMap:{}});
const node = <K extends keyof HTMLElementTagNameMap>(tag:K,text?:string) => {const value = document.createElement(tag); if(text !== undefined) value.textContent = text; return value;};
const bounded = (value:unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512;
const countsValid = (value:Counts | undefined): value is Counts => !!value && (['threads','comments','history'] as const).every(kind => Number.isSafeInteger(value[kind]) && value[kind] >= 0);
function checkedJob(value:ImportJob,expected:Counts): ImportJob {if(!value || !bounded(value.id) || !['pending','running','complete','failed'].includes(value.state) || !Array.isArray(value.rejected) || !(['threads','comments','history'] as const).every(kind => Number.isSafeInteger(value.expected?.[kind]) && value.expected[kind] === expected[kind] && Number.isSafeInteger(value.processed?.[kind]) && value.processed[kind] >= 0 && value.processed[kind] <= value.expected[kind] && (value.state !== 'complete' || value.processed[kind] === value.expected[kind])) || value.state === 'complete' && value.rejected.length) throw new CollaborationError('unavailable','The host returned inconsistent import progress. Check progress before resuming.'); return value;}
export function createTransfers(host:TransferHost) {
  const maxUpload = host.uploadBytes ?? 32*1024*1024, maxDownload = host.downloadBytes ?? 64*1024*1024;
  let mode:'export'|'import'='export',exportFormat:'json'|'markdown'='json';
  let opened = false, busy = false, revision = 0, life = new AbortController(), error = '', message = '';
  let file:File | undefined, upload:{uploadId:string;digest:string} | undefined, preview:ImportPreview | undefined, job:ImportJob | undefined, execution:Execution | undefined;
  let mapping = emptyMapping(), sourceEnvironments:string[] = [], sourceOrigins:string[] = [], authors:Attribution[] = [], environmentPage = 0, originPage = 0, authorPage = 0, rejectedPage = 0, exportPage = 0;
  let environments:string[] = [], choices:string[] = [], addedEnvironment = '', currentPageOnly = false, page = '', status:''|'open'|'resolved' = '';
  const expanded=new Set<string>();
  const urls = new Set<string>(), timers = new Set<ReturnType<typeof setTimeout>>();
  const call = <T>(run:(signal:AbortSignal) => Promise<T>,signal:AbortSignal) => operation(run,signal,host.timeoutMs);
  const button = (text:string,action:() => void,disabled = busy) => {const value = node('button',text); value.type = 'button'; value.id = 'huddle-transfer-'+text.toLowerCase().replace(/[^a-z0-9]+/g,'-'); value.disabled = disabled; value.addEventListener('click',action); return value;};
  function cancel() {life.abort(); life = new AbortController(); revision++; busy = false;}
  function reset() {cancel();mode='export';exportFormat='json';expanded.clear(); opened = false; file = undefined; upload = undefined; preview = undefined; job = undefined; execution = undefined; mapping = emptyMapping(); sourceEnvironments = []; sourceOrigins = []; authors = []; environments = []; choices = []; addedEnvironment = ''; currentPageOnly = false; page = ''; status = ''; environmentPage = originPage = authorPage = rejectedPage = exportPage = 0; error = message = ''; for(const url of urls) URL.revokeObjectURL(url); urls.clear(); for(const timer of timers) clearTimeout(timer); timers.clear();}
  async function run(action:(signal:AbortSignal,stamp:number) => Promise<void>) {
    if(busy) return; busy = true; error = ''; message = ''; const stamp = revision, signal = AbortSignal.any([host.parentSignal(),life.signal]); host.render();
    try {if(!await host.authorized() || stamp !== revision) return; await action(signal,stamp);}
    catch(value) {if(stamp === revision && !signal.aborted) {if(isCollaborationError(value) && ['forbidden','unauthenticated'].includes(value.code)) host.error(value); else {host.report(value); error = isCollaborationError(value) ? value.message : 'The transfer could not finish. Check progress before resuming an import.';}}}
    finally {if(stamp === revision) {busy = false; host.render();}}
  }
  function saveExecution() {if(execution) host.storage()?.write('transfer-job',execution);}
  async function* bytes(selected:File,signal:AbortSignal) {
    const reader = selected.stream().getReader(), cancel = () => {void reader.cancel().catch(() => {});}; signal.addEventListener('abort',cancel,{once:true});
    try {while(true) {const next = await call(() => reader.read(),signal); if(next.done) return; yield next.value;}}
    finally {signal.removeEventListener('abort',cancel); cancel(); reader.releaseLock();}
  }
  async function describe(selected:File,signal:AbortSignal) {
    const data = JSON.parse(await call(() => selected.text(),signal));
    if(data?.schema !== 'huddle.feedback.v2' || !Array.isArray(data.snapshot?.scope?.environments) || !Array.isArray(data.threads)) throw new CollaborationError('validation','Choose a neutral Huddle JSON export.');
    const envs = data.snapshot.scope.environments.filter(bounded), origins = new Set<string>();
    for(const thread of data.threads) if(typeof thread?.pageUrl === 'string') {const url = new URL(thread.pageUrl); if(['http:','https:'].includes(url.protocol) && !url.username && !url.password) origins.add(url.origin);}
    return {environments:envs as string[],origins:[...origins]};
  }
  function prepare() {void run(async (signal,stamp) => {
    const selected = file; if(!selected) throw new CollaborationError('validation','Choose a JSON export first.'); if(selected.size > maxUpload) throw new CollaborationError('validation',`Import exceeds the ${maxUpload} byte upload limit.`);
    const staged = upload || await call(inner => host.adapter.stageImport(host.scope(),bytes(selected,inner),inner),signal), description = await describe(selected,signal);
    const result = await call(inner => host.adapter.previewImport(host.scope(),{...staged,mapping},inner),signal); if(stamp !== revision) return;
    if(!bounded(result.id) || !countsValid(result.counts) || !Array.isArray(result.historicalAuthors) || !Array.isArray(result.conflicts) || result.digest !== staged.digest || result.scope.workspace !== host.scope().workspace || result.scope.environment !== host.scope().environment || !(['environmentMap','originMap','identityMap'] as const).every(kind => result.mapping?.[kind] && Object.keys(result.mapping[kind]).length === Object.keys(mapping[kind]).length && Object.entries(mapping[kind]).every(([key,value]) => result.mapping[kind][key] === value))) throw new CollaborationError('unavailable','The host preview does not match this upload, mapping and destination.');
    upload = staged; sourceEnvironments = description.environments; sourceOrigins = description.origins; authors = result.historicalAuthors; preview = result; authorPage = rejectedPage = 0; message = 'Preview ready. Review the destination, mappings and conflicts before importing.';
  });}
  function checkProgress() {if(!execution?.id) return; const {id,expected} = execution; void run(async (signal,stamp) => {const result = checkedJob(await call(inner => host.adapter.importProgress(host.scope(),id,inner),signal),expected); if(stamp !== revision) return; job = result; message = result.state === 'complete' ? 'Import complete.' : 'Progress checked. Resume explicitly to continue an unfinished import.';});}
  function execute() {
    if(!execution) {if(!preview || preview.conflicts.length) return; execution = {previewId:preview.id,digest:preview.digest,idempotencyKey:crypto.randomUUID(),expected:preview.counts}; saveExecution();}
    const descriptor = {...execution}, input = {previewId:descriptor.previewId,digest:descriptor.digest,idempotencyKey:descriptor.idempotencyKey}; void run(async (signal,stamp) => {
      let previous = '', unchanged = 0;
      while(stamp === revision) {
        const result = checkedJob(await call(inner => host.adapter.executeImport(host.scope(),input,inner),signal),descriptor.expected); if(stamp !== revision) return;
        job = result; execution = {...descriptor,id:result.id}; saveExecution(); host.render();
        if(result.state === 'complete') {message = 'Import complete. Destination discussion is available.'; host.updated(); return;}
        if(result.state === 'failed') {error = result.error || 'Import stopped at conflicting records. Review the reported failures.'; return;}
        const progress = JSON.stringify(result.processed); unchanged = progress === previous ? unchanged+1 : 0; previous = progress; if(unchanged >= 3) {message = 'Import paused because no new record progress was reported. Check progress before resuming.'; return;}
      }
    });
  }
  function download(format:'json'|'markdown') {void run(async (signal,stamp) => {
    const selected = [...environments]; if(!selected.length || selected.some(value => !bounded(value))) throw new CollaborationError('validation','Choose the environments to export.');
    const result = await call(inner => host.adapter.export({workspace:host.scope().workspace,environments:selected,...(currentPageOnly ? {page} : {}),...(status ? {status} : {})},format,inner),signal), iterator = result.chunks[Symbol.asyncIterator]();
    const bytes = new ByteCollector(maxDownload,'download');
    try {while(true) {const next = await call(() => iterator.next(),signal); if(next.done) break; bytes.add(next.value);}} finally {if(iterator.return) void Promise.resolve().then(() => iterator.return!()).catch(() => {});}
    const blob = bytes.blob(format === 'json' ? 'application/json' : 'text/markdown');
    if(format === 'json') {const value = JSON.parse(await call(() => blob.text(),signal)); if(value?.schema !== 'huddle.feedback.v2' || value.complete !== true || !['threads','comments','history'].every(kind => Array.isArray(value[kind]) && value.counts?.[kind] === value[kind].length)) throw new CollaborationError('unavailable','The host export is incomplete or inconsistent. No download was created.');}
    if(stamp !== revision) return; const url = URL.createObjectURL(blob), link = node('a'); urls.add(url); link.href = url; link.download = 'huddle-feedback.'+(format === 'json' ? 'json' : 'md'); link.hidden = true; document.body.append(link); link.click(); link.remove();
    const timer = setTimeout(() => {URL.revokeObjectURL(url); urls.delete(url); timers.delete(timer);},1000); timers.add(timer); message = `Complete ${format === 'json' ? 'JSON' : 'Markdown'} export downloaded for ${selected.join(', ')}.`;
  });}
  function input(label:string,value:string,change:(value:string) => void,id:string) {const container = node('label',label), field = node('input'); field.id = id; field.value = value; field.disabled = busy; field.addEventListener('input',() => change(field.value)); container.htmlFor = id; container.append(field); return container;}
  function mapField(parent:HTMLElement,kind:keyof ImportMapping,from:string,label:string) {
    parent.append(input(label,mapping[kind][from] || '',value => {mapping = {...mapping,[kind]:Object.fromEntries([...Object.entries(mapping[kind]).filter(([key]) => key !== from),...(value ? [[from,value]] : [])])}; preview = undefined; execution = undefined; job = undefined; message = 'Mappings changed. Preview again before importing.'; host.render();},`huddle-map-${kind}-${(kind === 'environmentMap' ? sourceEnvironments : sourceOrigins).indexOf(from)}`));
  }
  function paged<T>(parent:HTMLElement,items:T[],offset:number,set:(value:number) => void,render:(item:T,index:number) => void,label:string) {
    items.slice(offset,offset+20).forEach((item,index) => render(item,offset+index));
    if(items.length > 20) {parent.append(node('p',`${offset+1}–${Math.min(items.length,offset+20)} of ${items.length} ${label}`)); if(offset) parent.append(button(`Previous ${label}`,() => {set(Math.max(0,offset-20)); host.render();})); if(offset+20 < items.length) parent.append(button(`Next ${label}`,() => {set(offset+20); host.render();}));}
  }
  function render(parent:HTMLElement,currentPage:string) {
    if(!opened)return;page=currentPage;parent.setAttribute('aria-busy',String(busy));
    const back=button('Back to feedback',()=>{cancel();opened=false;host.render();},false);back.className='action quiet';back.prepend(icon('back'));parent.append(back);
    const heading=node('div');heading.className='transfer-heading';heading.append(node('h3','Transfer feedback'),node('p','Download a copy, or bring an existing discussion here.'));parent.append(heading);
    const tabs=node('div');tabs.className='transfer-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Feedback transfer');
    for(const value of ['export','import'] as const){const label=value==='export'?'Export':'Import',tab=button(label,()=>{mode=value;host.render();},busy);tab.id='huddle-transfer-tab-'+value;tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(mode===value));tab.setAttribute('aria-controls','huddle-transfer-panel');tab.tabIndex=mode===value?0:-1;tab.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();mode=event.key==='Home'?'export':event.key==='End'?'import':mode==='export'?'import':'export';const root=parent.getRootNode() as Document|ShadowRoot;host.render();root.getElementById('huddle-transfer-tab-'+mode)?.focus();});tabs.append(tab);}parent.append(tabs);
    if(error){const text=node('p',error);text.className='notice error';text.setAttribute('role','alert');parent.append(text);}if(message){const text=node('p',message);text.className='notice';text.setAttribute('role','status');parent.append(text);}
    const panel=node('section');panel.className='transfer-panel';panel.id='huddle-transfer-panel';panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby','huddle-transfer-tab-'+mode);parent.append(panel);
    const primary=(text:string,run:()=>void,name:'download'|'upload',disabled=busy)=>{const action=button(text,run,disabled);action.className='primary transfer-primary';action.prepend(icon(name));return action;};
    const advanced=(title:string)=>{const details=node('details');details.className='transfer-advanced';details.open=expanded.has(title);details.addEventListener('toggle',()=>{if(details.isConnected){if(details.open)expanded.add(title);else expanded.delete(title);}});details.append(node('summary',title));return details;};
    if(mode==='export'){
      panel.append(node('h3','Download a copy'),node('p',`All pages and open/resolved comments in ${environments.join(', ') || 'your selected environments'}.`));
      const formats=node('fieldset');formats.className='format-options';formats.disabled=busy;formats.append(node('legend','File format'));
      for(const [value,title,description] of [['json','JSON','Move feedback to another workspace'],['markdown','Markdown','Read or share a written record']] as const){const label=node('label'),radio=node('input'),copy=node('span');radio.type='radio';radio.name='huddle-export-format';radio.value=value;radio.checked=exportFormat===value;radio.setAttribute('aria-label',title);radio.addEventListener('change',()=>{exportFormat=value;host.render();});copy.append(node('strong',title),node('small',description));label.append(radio,copy);formats.append(label);}panel.append(formats);
      const filters=advanced('Choose what to include'),envs=node('fieldset');envs.disabled=busy;envs.append(node('legend','Export environments'));
      paged(envs,choices,exportPage,value=>{exportPage=value;},(value,index)=>{const label=node('label'),check=node('input');check.type='checkbox';check.id='huddle-export-environment-'+index;check.checked=environments.includes(value);check.addEventListener('change',()=>{environments=check.checked?[...new Set([...environments,value])]:environments.filter(item=>item!==value);});label.append(check,document.createTextNode(value));envs.append(label);},'export environments');
      const add=advanced('Add another environment');add.append(input('Add an environment',addedEnvironment,value=>{addedEnvironment=value;},'huddle-add-environment'),button('Add environment',()=>{if(!bounded(addedEnvironment)){error='Enter an environment ID of at most 512 characters.';host.render();return;}choices=[...new Set([...choices,addedEnvironment])];environments=[...new Set([...environments,addedEnvironment])];addedEnvironment='';host.render();}));envs.append(add);filters.append(envs);
      const narrow=node('label'),check=node('input');check.type='checkbox';check.checked=currentPageOnly;check.disabled=busy;check.addEventListener('change',()=>{currentPageOnly=check.checked;});narrow.append(check,document.createTextNode('Current page only'));filters.append(narrow);
      const statuses=node('label','Thread status'),select=node('select');select.id='huddle-export-status';select.setAttribute('aria-label','Thread status');statuses.htmlFor=select.id;for(const [value,text] of [['','Open and resolved'],['open','Open'],['resolved','Resolved']])select.append(new Option(text,value));select.value=status;select.disabled=busy;select.addEventListener('change',()=>{status=select.value as typeof status;});statuses.append(select);filters.append(statuses);panel.append(filters,primary(exportFormat==='json'?'Download JSON':'Download Markdown',()=>download(exportFormat),'download',busy||!environments.length));
    }else{
      const steps=node('ol');steps.className='import-steps';steps.setAttribute('aria-label','Import steps');for(const [index,title] of ['Choose file','Review','Import'].entries()){const step=node('li',title),current=execution?2:upload?1:0;if(index===current)step.setAttribute('aria-current','step');steps.append(step);}panel.append(steps);
      panel.append(node('h3',job?.state==='complete'?'Feedback imported':upload?'Review before importing':'Bring feedback here'),node('p',upload?'Check the destination and preview before adding any records.':'Choose a Huddle JSON export. Your existing discussion stays in place.'));
      const destination=node('div');destination.className='import-destination';destination.append(node('strong','Destination'),node('p',host.scope().workspace+' · '+host.scope().environment));panel.append(destination);
      if(!execution){const fileLabel=node('label','JSON export file'),choose=node('input');fileLabel.className='transfer-file';choose.type='file';choose.accept='.json,application/json';choose.id='huddle-import-file';choose.disabled=busy;fileLabel.htmlFor=choose.id;choose.addEventListener('change',()=>{file=choose.files?.[0];upload=undefined;preview=undefined;execution=undefined;job=undefined;mapping=emptyMapping();sourceEnvironments=[];sourceOrigins=[];authors=[];error=message='';host.render();});fileLabel.append(choose);if(file)fileLabel.append(node('small',`${file.name} · ${Math.ceil(file.size/1024)} KB`));panel.append(fileLabel);}
      if(upload&&!execution){
        const fields=advanced('Remap environments and links'),maps=node('fieldset');maps.disabled=busy;maps.append(node('legend','Destination mappings'),node('p','Leave blank to keep the original environments and links.'));paged(maps,sourceEnvironments,environmentPage,value=>{environmentPage=value;},value=>mapField(maps,'environmentMap',value,`Environment: ${value}`),'environments');paged(maps,sourceOrigins,originPage,value=>{originPage=value;},value=>mapField(maps,'originMap',value,`Origin: ${value}`),'origins');fields.append(maps);panel.append(fields);
        const people=advanced('Historical authors'),identities=node('fieldset');identities.disabled=busy;identities.append(node('legend','Author attribution'),node('p','Original names stay historical. Mapping a name does not give anyone access.'));if(host.canMapMembers())host.directory(identities);
        paged(identities,authors,authorPage,value=>{authorPage=value;},(author,index)=>{if(!host.canMapMembers()){identities.append(node('p',`${author.name} · historical attribution`));return;}const title=`Historical author: ${author.name} (${author.id})`,label=node('label',title),select=node('select');select.id='huddle-map-identity-'+index;select.setAttribute('aria-label',title);label.htmlFor=select.id;select.append(new Option('Keep historical attribution',''));for(const member of host.members())select.append(new Option(member.name,member.id));const mapped=mapping.identityMap[author.id];if(mapped&&!host.members().some(item=>item.id===mapped))select.append(new Option(mapped,mapped));select.value=mapped||'';select.addEventListener('change',()=>{mapping={...mapping,identityMap:Object.fromEntries([...Object.entries(mapping.identityMap).filter(([key])=>key!==author.id),...(select.value?[[author.id,select.value]]:[])])};preview=undefined;execution=undefined;job=undefined;message='Mappings changed. Preview again before importing.';host.render();});label.append(select);identities.append(label);},'historical authors');people.append(identities);panel.append(people);
      }
      if(preview&&!execution){const counts=node('div');counts.className='import-counts';for(const [kind,title] of [['threads','Threads'],['comments','Comments'],['history','History']] as const){const count=node('div');count.append(node('strong',String(preview.counts[kind])),node('small',title));counts.append(count);}panel.append(counts,node('p',`Preview valid until ${new Date(preview.expiresAt).toLocaleString()}.`));if(preview.conflicts.length){const warning=node('p',`${preview.conflicts.length} conflicts. Resolve these before importing.`);warning.className='notice error';warning.setAttribute('role','alert');panel.append(warning);paged(panel,preview.conflicts,rejectedPage,value=>{rejectedPage=value;},item=>panel.append(node('p',`${item.recordId}: ${item.reason}`)),'conflicts');}panel.append(primary('Import feedback',execute,'upload',busy||!!preview.conflicts.length));}
      else if(!execution){const prepareButton=primary(upload?'Preview mappings':'Upload and preview',prepare,'upload',busy||!file);prepareButton.id='huddle-prepare-import';panel.append(prepareButton);}
      if(execution){if(job){const value=node('progress');value.max=job.expected.threads+job.expected.comments+job.expected.history||1;value.value=job.processed.threads+job.processed.comments+job.processed.history;value.setAttribute('aria-label','Records imported');panel.append(value);const progress=node('p',`${job.state}: ${job.processed.threads}/${job.expected.threads} threads, ${job.processed.comments}/${job.expected.comments} comments, ${job.processed.history}/${job.expected.history} history records.`);progress.setAttribute('role','status');panel.append(progress);if(job.rejected.length)paged(panel,job.rejected,rejectedPage,value=>{rejectedPage=value;},item=>panel.append(node('p',`${item.recordId}: ${item.reason}`)),'rejected records');}
        if(job?.state!=='complete')panel.append(node('p','If a response was interrupted, check progress before resuming. Your original request is retained.'));const actions=node('div');actions.className='transfer-actions';if(execution.id)actions.append(button('Check progress',checkProgress));if(job?.state!=='complete'&&job?.state!=='failed')actions.append(button('Resume import',execute));panel.append(actions);
      }
    }
    if(busy)panel.append(button('Pause transfer',()=>{cancel();message='Transfer paused. Check import progress before resuming.';host.render();},false));
  }
  return {render,reset,cancel,active:() => opened,open() {opened = true; if(!choices.length) {choices = [...new Set([host.scope().environment,...(host.environments || [])])]; environments = [...choices];} const saved = host.storage()?.read<Execution>('transfer-job'); if(execution)mode='import';if(!file && !execution && saved && bounded(saved.previewId) && bounded(saved.idempotencyKey) && /^[a-f0-9]{64}$/.test(saved.digest) && countsValid(saved.expected)) {execution = saved;mode='import'; if(saved.id) checkProgress();} host.render();}};
}
