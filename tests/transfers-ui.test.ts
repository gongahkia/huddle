// @vitest-environment jsdom
import {Blob as NodeBlob,File as NodeFile} from 'node:buffer';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mount,type Huddle} from '../packages/browser/src/index';
import {CollaborationError,type ImportJob,type ImportPreview} from '../packages/shared/src/collaboration';
import {TestAdapter} from './fixtures/adapter';
import {portableFixture} from './fixtures/portable';
const scope = {workspace:'destination',environment:'preview'}, data = portableFixture(2,3), digest = 'a'.repeat(64);
let widget:Huddle | undefined;
const root = () => document.querySelector('[data-huddle-root]')!.shadowRoot!;
const text = () => root().textContent || '';
const click = (name:string) => {const target = [...root().querySelectorAll('button')].find(button => button.textContent === name); expect(target,`Missing ${name}`).toBeDefined(); target!.click();};
const settle = async () => {for(let index=0;index<8;index++) await vi.advanceTimersByTimeAsync(0);};
beforeEach(() => {vi.useFakeTimers(); vi.stubGlobal('Blob',NodeBlob); vi.stubGlobal('requestAnimationFrame',(run:FrameRequestCallback) => setTimeout(() => run(performance.now()),16)); vi.stubGlobal('cancelAnimationFrame',clearTimeout); localStorage.clear(); history.replaceState(null,'','/');});
afterEach(() => {widget?.destroy(); widget = undefined; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren();});
function adapterFixture() {
  const adapter = new TestAdapter(), staged = vi.spyOn(adapter,'stageImport').mockImplementation(async (_scope,chunks,signal) => {let json = ''; for await(const chunk of chunks) {signal.throwIfAborted(); json += new TextDecoder().decode(chunk);} expect(JSON.parse(json)).toEqual(data); return {uploadId:'upload',digest};});
  const previewed = vi.spyOn(adapter,'previewImport').mockImplementation(async (selected,input):Promise<ImportPreview> => ({id:'preview',digest:input.digest,scope:selected,mapping:input.mapping,counts:data.counts,historicalAuthors:[data.comments[0].author],conflicts:[],expiresAt:new Date(Date.now()+86400000).toISOString()}));
  const complete:ImportJob = {id:'job',state:'complete',expected:data.counts,processed:data.counts,rejected:[]};
  const executed = vi.spyOn(adapter,'executeImport').mockResolvedValue(complete), progress = vi.spyOn(adapter,'importProgress').mockResolvedValue(complete);
  return {adapter,staged,previewed,executed,progress,complete};
}
async function open(adapter:TestAdapter,onError?:(value:Error) => void) {widget = mount({adapter,namespace:'transfer-tests',...scope,exportEnvironments:['preview','production'],onError}); widget.open(); await settle(); click('Transfer feedback'); await settle();}
function chooseFile() {const field = root().querySelector<HTMLInputElement>('#huddle-import-file')!; Object.defineProperty(field,'files',{value:[new NodeFile([JSON.stringify(data)],'feedback.json')],configurable:true}); field.dispatchEvent(new Event('change'));}
it('previews deliberately, invalidates edited mappings and executes with exact progress without persisting file contents',async () => {
  const f = adapterFixture(); await open(f.adapter); chooseFile(); click('Upload and preview'); await settle(); expect(text()).toContain('Preview ready.'); expect(f.executed).not.toHaveBeenCalled();
  const field = root().querySelector<HTMLInputElement>('#huddle-map-originMap-0')!; expect(field.disabled).toBe(false); expect(field.closest('fieldset')!.disabled).toBe(false); field.focus(); expect(root().activeElement).toBe(field); field.value = 'https://new.test'; field.setSelectionRange(8,8); field.dispatchEvent(new Event('input')); expect(root().activeElement?.id).toBe(field.id); expect((root().activeElement as HTMLInputElement).selectionStart).toBe(8); expect([...root().querySelectorAll('button')].some(item => item.textContent === 'Import feedback')).toBe(false);
  click('Preview mappings'); await settle(); expect(f.staged).toHaveBeenCalledOnce(); expect(f.previewed.mock.calls.at(-1)![1].mapping.originMap).toEqual({'https://old.test':'https://new.test'});
  click('Import feedback'); await settle(); expect(f.executed).toHaveBeenCalledOnce(); expect(text()).toContain('Import complete.'); expect(text()).toContain('2/2 threads'); const stored = Object.values(localStorage).join(''); expect(stored).not.toContain(data.comments[0].body); expect(stored).not.toContain('feedback.json'); expect(stored).toContain('preview');
});
it('stops uncertain execution and resumes only after an explicit action with the original key',async () => {
  const f = adapterFixture(); f.executed.mockRejectedValueOnce(new CollaborationError('unavailable','Acknowledgement was lost.')); await open(f.adapter); chooseFile(); click('Upload and preview'); await settle(); click('Import feedback'); await settle(); expect(text()).toContain('Acknowledgement was lost.');
  const key = f.executed.mock.calls[0][1].idempotencyKey; await vi.advanceTimersByTimeAsync(30000); expect(f.executed).toHaveBeenCalledOnce(); click('Resume import'); await settle(); expect(f.executed.mock.calls[1][1].idempotencyKey).toBe(key); expect(text()).toContain('Import complete.');
});
it('resumes after acknowledged batches without sending cached job metadata as mutation fields',async () => {
  const f = adapterFixture(); f.executed.mockResolvedValueOnce({...f.complete,state:'running',processed:{threads:0,comments:1,history:0}}).mockRejectedValueOnce(new CollaborationError('unavailable','Lost later batch.')); await open(f.adapter); chooseFile(); click('Upload and preview'); await settle(); click('Import feedback'); await settle(); expect(text()).toContain('Lost later batch.'); expect(f.executed).toHaveBeenCalledTimes(2); click('Resume import'); await settle(); expect(f.executed.mock.calls[2][1]).toEqual(f.executed.mock.calls[0][1]); expect(Object.keys(f.executed.mock.calls[2][1]).sort()).toEqual(['digest','idempotencyKey','previewId']); expect(text()).toContain('Import complete.');
});
it('pauses repeated acknowledged responses that report no progress',async () => {
  const f = adapterFixture(); f.executed.mockResolvedValue({...f.complete,state:'running',processed:{threads:0,comments:0,history:0}}); await open(f.adapter); chooseFile(); click('Upload and preview'); await settle(); click('Import feedback'); await settle(); expect(f.executed).toHaveBeenCalledTimes(4); expect(text()).toContain('no new record progress'); await vi.advanceTimersByTimeAsync(30000); expect(f.executed).toHaveBeenCalledTimes(4);
});
it('reopens a stored job through read-only progress and never automatically executes it',async () => {
  const f = adapterFixture(); await open(f.adapter); chooseFile(); click('Upload and preview'); await settle(); click('Import feedback'); await settle(); widget!.close(); widget!.open(); await settle(); click('Transfer feedback'); await settle(); expect(f.progress).toHaveBeenCalledOnce(); expect(f.executed).toHaveBeenCalledOnce(); expect(text()).toContain('Import complete.');
});
it('does not label an inconsistent completed job successful and clears transfer state on revocation',async () => {
  const f = adapterFixture(); f.executed.mockResolvedValue({...f.complete,processed:{...data.counts,threads:0}}); await open(f.adapter); chooseFile(); click('Upload and preview'); await settle(); click('Import feedback'); await settle(); expect(text()).toContain('inconsistent import progress'); expect(text()).not.toContain('Import complete.');
  f.adapter.allowed = false; await vi.advanceTimersByTimeAsync(10000); expect(text()).not.toContain('feedback.json'); expect(root().querySelector('#huddle-import-file')).toBeNull(); expect(text()).toContain('Sign in through this application');
});
it('downloads only complete bounded exports and keeps configured environment IDs intact',async () => {
  const f = adapterFixture(), originalURL = URL, create = vi.fn(() => 'blob:disposable'), revoke = vi.fn(); vi.stubGlobal('URL',Object.assign(class extends originalURL {},{createObjectURL:create,revokeObjectURL:revoke})); vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(() => {});
  const exported = vi.spyOn(f.adapter,'export').mockImplementation(async () => ({filename:'feedback.json',contentType:'application/json',chunks:(async function*() {yield new TextEncoder().encode(JSON.stringify(data));})()}));
  const errors:Error[] = []; await open(f.adapter,value => errors.push(value)); click('Download JSON'); await settle(); expect(errors.map(item => item.message)).toEqual([]); expect(exported.mock.calls[0][0]).toEqual({workspace:scope.workspace,environments:['preview','production']}); expect(create).toHaveBeenCalledOnce(); expect(text()).toContain('Complete JSON export downloaded');
  exported.mockResolvedValue({filename:'broken.json',contentType:'application/json',chunks:(async function*() {yield new TextEncoder().encode('{"complete":true');})()}); click('Download JSON'); await settle(); expect(create).toHaveBeenCalledOnce(); expect(text()).not.toContain('Complete JSON export downloaded'); widget!.destroy(); expect(revoke).toHaveBeenCalledOnce();
});
it('restores focus to an opening control inside an accessible host shadow root',async () => {
  const holder = document.createElement('div'); document.body.append(holder); const shadow = holder.attachShadow({mode:'open'}), opener = document.createElement('button'); shadow.append(opener); opener.focus(); const f = adapterFixture(); widget = mount({adapter:f.adapter,namespace:'transfer-tests',...scope,launcher:'hidden'}); widget.open(); await settle(); widget.close(); expect(shadow.activeElement).toBe(opener);
});
it('disables paging controls while a page read is still pending',async () => {
  const f = adapterFixture(); await f.adapter.create(scope,{idempotencyKey:'fixture',page:'/',pageUrl:'http://localhost/',anchor:{kind:'page',selector:'body',label:'Paged thread',quote:'',x:0,y:0},body:'First'},new AbortController().signal); const record = f.adapter.records[0], first = record.comments.items[0]; record.comments.items = Array.from({length:51},(_,index) => ({...first,id:`comment:${index}`,body:`Comment ${index}`}));
  await open(f.adapter); click('Back to feedback'); root().querySelector<HTMLButtonElement>('.thread')!.click(); await settle(); vi.spyOn(f.adapter,'detail').mockImplementationOnce(async () => new Promise(() => {})); click('Next replies'); expect([...root().querySelectorAll('button')].find(item => item.textContent === 'Next replies')!.disabled).toBe(true);
});
it('reaches later directory pages while preserving selected mentions and exposes complete history pages',async () => {
  const adapter = new TestAdapter(), users = Array.from({length:251},(_,index) => ({id:`member:${index}`,name:`Member ${index}`})); adapter.capabilities = {mentions:true,assignment:true,directory:true};
  const directory = vi.fn<NonNullable<import('../packages/shared/src/collaboration').CollaborationAdapter['directory']>>(async (_scope,query) => {const offset = Number(query.cursor || 0), matches = users.filter(user => !query.search || user.name.includes(query.search)); return {items:matches.slice(offset,offset+50),nextCursor:offset+50 < matches.length ? String(offset+50) : null};});
  const create = vi.spyOn(adapter,'create'); await open(Object.assign(adapter,{directory})); click('Back to feedback'); click('Page comment'); const body = root().querySelector<HTMLTextAreaElement>('#huddle-body')!; body.value = 'Directory paging'; body.dispatchEvent(new Event('input')); const first = root().querySelector<HTMLInputElement>('#huddle-mention-0')!; first.click();
  for(let index=0;index<5;index++) {click('Next members'); await settle();} expect(text()).toContain('Member 250'); root().querySelector<HTMLInputElement>('#huddle-mention-0')!.click(); root().querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true})); await settle(); expect(create.mock.calls[0][1].mentions).toEqual(['member:0','member:250']);
  const record = adapter.records[0]; record.history.items = Array.from({length:121},(_,index) => ({id:`history:${index}`,threadId:record.thread.id,actor:adapter.actor,action:`Action ${index}`,data:{exact:index},createdAt:new Date().toISOString()}));
  click('Back to comments'); root().querySelector<HTMLButtonElement>('.thread')!.click(); await settle(); const history = root().querySelector<HTMLElement>('#huddle-history')!.parentElement as HTMLDetailsElement; history.open = true; history.dispatchEvent(new Event('toggle')); click('Next history'); await settle(); expect((root().querySelector('#huddle-history')!.parentElement as HTMLDetailsElement).open).toBe(true); expect(text()).toContain('Action 50'); click('Next history'); await settle(); expect(text()).toContain('Action 120');
  const entry = root().getElementById('huddle-history-history%3A120')!.parentElement as HTMLDetailsElement; entry.open = true; entry.dispatchEvent(new Event('toggle')); expect(text()).toContain('"exact": 120');
});
it('states the mention limit and keeps the saved selection consistent across directory renders',async () => {
  const adapter = new TestAdapter(); adapter.capabilities = {mentions:true,assignment:false,directory:true}; const users = Array.from({length:31},(_,index) => ({id:`member:${index}`,name:`Member ${index}`})); const create = vi.spyOn(adapter,'create');
  await open(Object.assign(adapter,{directory:async () => ({items:users,nextCursor:null})})); click('Back to feedback'); click('Page comment'); expect(text()).toContain('maximum 30');
  for(let index=0;index<30;index++) root().querySelector<HTMLInputElement>(`#huddle-mention-${index}`)!.click(); expect(root().querySelector<HTMLInputElement>('#huddle-mention-30')!.disabled).toBe(true); expect(root().querySelector<HTMLInputElement>('#huddle-mention-30')!.checked).toBe(false);
  root().querySelector<HTMLInputElement>('#huddle-mention-0')!.click(); expect(root().querySelector<HTMLInputElement>('#huddle-mention-30')!.disabled).toBe(false); root().querySelector<HTMLInputElement>('#huddle-mention-30')!.click(); const body = root().querySelector<HTMLTextAreaElement>('#huddle-body')!; body.value = 'Exact mentioned members'; body.dispatchEvent(new Event('input')); root().querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true})); await settle(); expect(create.mock.calls[0][1].mentions).toEqual(users.slice(1).map(user => user.id));
});
