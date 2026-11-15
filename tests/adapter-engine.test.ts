// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mount,type Huddle} from '../packages/browser/src/index';
import {CollaborationError,type Detail} from '../packages/shared/src/collaboration';
import {TestAdapter} from './fixtures/adapter';

let widget: Huddle | undefined;
const scope = {workspace: 'team',environment: 'preview'};
const options = (adapter: TestAdapter) => ({adapter,namespace: 'engine-tests',...scope});
const root = () => document.querySelector('[data-huddle-root]')!.shadowRoot!;
const text = () => root().textContent || '';
const click = (label: string) => {const button = [...root().querySelectorAll('button')].find(item => item.textContent === label); expect(button,`missing ${label}`).toBeDefined(); button!.click();};
const settle = () => vi.advanceTimersByTimeAsync(0);
function type(body: string) {const input = root().querySelector('textarea')!; input.value = body; input.dispatchEvent(new Event('input'));}
function submit() {root().querySelector('form')!.dispatchEvent(new Event('submit',{cancelable: true}));}
beforeEach(() => {vi.useFakeTimers(); vi.stubGlobal('requestAnimationFrame',(run: FrameRequestCallback) => setTimeout(() => run(performance.now()),16)); vi.stubGlobal('cancelAnimationFrame',clearTimeout); localStorage.clear(); history.replaceState(null,'','/');});
afterEach(() => {widget?.destroy(); widget = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren();});
it('uses host identity without popup or role UI and restores focus to a host launcher',async () => {
  const adapter = new TestAdapter(), popup = vi.spyOn(window,'open'), launcher = document.createElement('button'); document.body.append(launcher); launcher.focus();
  widget = mount({...options(adapter),launcher: 'hidden'}); expect(popup).not.toHaveBeenCalled(); widget.open(); await settle();
  click('Page comment'); type('Shared by the host'); submit(); await settle();
  expect(adapter.records[0].thread.createdBy.id).toBe(adapter.actor.id); expect(text()).toContain('Shared by the host');
  expect(text()).not.toContain('Connect Huddle'); expect(text()).not.toContain('Mention members'); expect(root().querySelector('select')).toBeNull();
  widget.close(); expect(document.activeElement).toBe(launcher); expect(text()).not.toContain('Shared by the host');
});
it('polls only while open and stops on close/destroy without accumulating requests',async () => {
  const adapter = new TestAdapter(), changes = vi.spyOn(adapter,'changes'); widget = mount({...options(adapter),launcher:'hidden'}); await vi.advanceTimersByTimeAsync(30000); expect(changes).not.toHaveBeenCalled();
  widget.open(); await settle(); expect(changes).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(10000); expect(changes).toHaveBeenCalledTimes(2);
  widget.close(); await vi.advanceTimersByTimeAsync(30000); expect(changes).toHaveBeenCalledTimes(2);
  widget.open(); await settle(); expect(changes).toHaveBeenCalledTimes(3); widget.destroy(); await vi.advanceTimersByTimeAsync(30000); expect(changes).toHaveBeenCalledTimes(3);
});
it('retries a failed list read even when the host change cursor has not advanced',async () => {
  const adapter = new TestAdapter(); await adapter.create(scope,{page:'/',pageUrl:'http://localhost/',anchor:{kind:'page',selector:'body',label:'Existing discussion',quote:'',x:0,y:0},body:'Read me',idempotencyKey:'fixture'},new AbortController().signal);
  const original = adapter.list.bind(adapter); vi.spyOn(adapter,'list').mockRejectedValueOnce(new CollaborationError('unavailable','Temporary failure.')).mockImplementation(original);
  widget = mount(options(adapter)); widget.open(); await settle(); expect(text()).toContain('Temporary failure.');
  await vi.advanceTimersByTimeAsync(2000); expect(text()).toContain('Existing discussion'); expect(text()).toContain('Read me'); expect(text()).not.toContain('Temporary failure.');
});
it('clears private content and stops live reads when host access is revoked',async () => {
  const adapter = new TestAdapter(); widget = mount(options(adapter)); widget.open(); await settle(); click('Page comment'); type('Private draft');
  adapter.allowed = false; await vi.advanceTimersByTimeAsync(10000);
  expect(root().querySelector('textarea')).toBeNull(); expect(text()).toContain('Sign in through this application');
  const session = vi.spyOn(adapter,'session'); await vi.advanceTimersByTimeAsync(30000); expect(session).not.toHaveBeenCalled();
});
it('recognizes a typed denial from another adapter bundle without relying on class identity',async () => {
  const adapter = new TestAdapter(); widget = mount(options(adapter)); widget.open(); await settle(); click('Page comment'); type('Private draft');
  vi.spyOn(adapter,'session').mockRejectedValue(Object.assign(new Error('Host access denied.'),{name:'CollaborationError',code:'forbidden'})); await vi.advanceTimersByTimeAsync(10000);
  expect(root().querySelector('textarea')).toBeNull(); expect(text()).toContain('Host access denied.');
});
it('cleans up a synchronous subscription denial and never starts a login retry loop',async () => {
  const adapter = new TestAdapter(), cleanup = vi.fn(), session = vi.spyOn(adapter,'session');
  const subscribe = vi.fn<NonNullable<import('../packages/shared/src/collaboration').CollaborationAdapter['subscribe']>>((_scope,_change,onError) => {onError(new CollaborationError('forbidden','Access revoked.')); return cleanup;});
  widget = mount({...options(adapter),adapter: Object.assign(adapter,{subscribe})}); widget.open(); await settle(); expect(cleanup).toHaveBeenCalledTimes(1); const count = session.mock.calls.length;
  await vi.advanceTimersByTimeAsync(30000); expect(session).toHaveBeenCalledTimes(count); expect(text()).toContain('Access revoked.');
});
it('does not submit an earlier actor’s draft after the host session changes',async () => {
  const adapter = new TestAdapter(), create = vi.spyOn(adapter,'create'); widget = mount(options(adapter)); widget.open(); await settle(); click('Page comment'); type('Old actor draft');
  adapter.actor = {id: 'host:new-user',name: 'New user'}; submit(); await settle();
  expect(create).not.toHaveBeenCalled(); expect(text()).not.toContain('Old actor draft');
  expect(root().querySelector('textarea')).toBeNull(); expect(localStorage.length).toBeGreaterThan(0);
});
it('aborts previous scope reads and ignores an adapter that resolves them late',async () => {
  const adapter = new TestAdapter(), original = adapter.list.bind(adapter); let release: (value: Awaited<ReturnType<TestAdapter['list']>>) => void = () => {};
  let oldSignal: AbortSignal | undefined;
  vi.spyOn(adapter,'list').mockImplementationOnce((_scope,_query,signal) => {oldSignal = signal; return new Promise(resolve => {release = resolve;});}).mockImplementation(original);
  widget = mount(options(adapter)); widget.open(); await settle(); widget.updateContext({workspace: 'other'}); await settle();
  expect(oldSignal?.aborted).toBe(true); release({items: [{id: 'stale',anchor: {label: 'STALE PRIVATE RECORD'}} as Detail['thread']],nextCursor: null}); await settle();
  expect(text()).not.toContain('STALE PRIVATE RECORD'); click('Review details'); expect(text()).toContain('Workspace: other');
});
it('collapses without stopping live reads or losing the draft, and closes review completely',async () => {
  const adapter = new TestAdapter(), changes = vi.spyOn(adapter,'changes'); widget = mount(options(adapter)); widget.open(); await settle(); click('Page comment'); type('Keep my draft while browsing');
  widget.collapse(); expect(root().querySelector('.panel')).toBeNull(); expect(document.querySelector('[data-huddle-open][data-huddle-collapsed]')).not.toBeNull();
  expect(root().activeElement?.getAttribute('aria-label')).toBe('Expand feedback');
  await vi.advanceTimersByTimeAsync(10000); expect(changes).toHaveBeenCalledTimes(2);
  widget.open(); expect(root().querySelector('textarea')!.value).toBe('Keep my draft while browsing'); expect(document.querySelector('[data-huddle-collapsed]')).toBeNull();
  widget.collapse(); widget.close(); const count = changes.mock.calls.length; await vi.advanceTimersByTimeAsync(30000); expect(changes).toHaveBeenCalledTimes(count); expect(root().querySelector('.review-dock')).not.toBeNull();expect(root().querySelector('[aria-label=Close]')).toBeNull();expect(document.querySelector('[data-huddle-open]')).toBeNull();
});
it('keeps picker cancellation available while a background list refresh is pending',async () => {
  const adapter = new TestAdapter(); widget = mount(options(adapter)); widget.open(); await settle(); click('Pin a comment');
  let release: (value: Awaited<ReturnType<TestAdapter['list']>>) => void = () => {};
  const list = vi.spyOn(adapter,'list').mockImplementationOnce(() => new Promise(resolve => {release = resolve;}));
  vi.spyOn(adapter,'changes').mockResolvedValueOnce({items:[],cursor:'1',hasMore:false,reset:true}); await vi.advanceTimersByTimeAsync(10000);
  expect(list).toHaveBeenCalledOnce(); const cancel = root().getElementById('huddle-action-cancel') as HTMLButtonElement; expect(cancel.disabled).toBe(false); cancel.click();
  expect(root().querySelector('.pick-note')).toBeNull(); expect(root().querySelector('.panel')).not.toBeNull(); release({items:[],nextCursor:null}); await settle();
});
it('clears rendered private data and preview state when access is revoked during collapsed review',async () => {
  const adapter = new TestAdapter(); widget = mount(options(adapter)); widget.open(); await settle(); click('Page comment'); type('Private draft'); widget.collapse();
  adapter.allowed = false; await vi.advanceTimersByTimeAsync(10000); expect(root().querySelector('.pin-preview')!.hasAttribute('hidden')).toBe(true); expect(root().querySelector('.pin')).toBeNull();
  widget.open(); expect(root().querySelector('textarea')).toBeNull(); expect(text()).toContain('Review access is unavailable.'); expect(text()).not.toContain('Private draft');
});
it('preserves the request key after a timeout and never automatically replays writes',async () => {
  const adapter = new TestAdapter(), original = adapter.create.bind(adapter); const keys: string[] = [];
  const create = vi.spyOn(adapter,'create').mockImplementationOnce(async (scope,input,signal) => {keys.push(input.idempotencyKey); await original(scope,input,signal); throw new CollaborationError('timeout','Acknowledgement lost.');}).mockImplementation(async (scope,input,signal) => {keys.push(input.idempotencyKey); return adapter.detail(scope,adapter.records[0].thread.id,{},signal);});
  widget = mount(options(adapter)); widget.open(); await settle(); click('Page comment'); type('Uncertain save'); submit(); await settle();
  await vi.advanceTimersByTimeAsync(10000); expect(create).toHaveBeenCalledTimes(1); expect(root().querySelector('textarea')!.value).toBe('Uncertain save');
  submit(); await settle(); expect(keys[0]).toBe(keys[1]); expect(adapter.records).toHaveLength(1);
});
it('retains the original captured view across an uncertain save and explicit retry',async () => {
  const adapter = new TestAdapter(), capture = vi.fn(() => ({record: crypto.randomUUID()})), original = adapter.create.bind(adapter), inputs: unknown[] = [];
  vi.spyOn(adapter,'create').mockImplementationOnce(async (_scope,input) => {inputs.push(input); throw new CollaborationError('timeout','Unknown result.');}).mockImplementation(async (scope,input,signal) => {inputs.push(input); return original(scope,input,signal);});
  widget = mount({...options(adapter),viewContext: capture}); widget.open(); await settle(); click('Page comment'); type('Review this record'); submit(); await settle(); submit(); await settle();
  expect(capture).toHaveBeenCalledTimes(1); expect(inputs[0]).toEqual(inputs[1]);
});
it('redacts all captured anchor/context strings and excludes sensitive targets before storing',async () => {
  const adapter = new TestAdapter(); document.body.innerHTML = '<section data-huddle-id="secret-section"><button id="target" data-testid="secret-target">secret target</button><button id="private" data-private>Private</button></section>';
  widget = mount({...options(adapter),viewContext: () => ({secretKey: 'secret value'}),redact: value => value.replaceAll('secret','redacted'),excludeElement: element => element.hasAttribute('data-private')});
  widget.open(); await settle(); click('Pin a comment'); document.getElementById('private')!.click(); expect(root().querySelector('textarea')).toBeNull(); document.getElementById('target')!.click(); type('Review'); submit(); await settle();
  expect(JSON.stringify(adapter.records[0].thread.anchor)).not.toContain('secret'); expect(adapter.records[0].thread.viewContext).toEqual({redactedKey: 'redacted value'});
});
it('rejects invalid view context without capturing or sending a draft',async () => {
  const adapter = new TestAdapter(), create = vi.spyOn(adapter,'create'), onError = vi.fn(); widget = mount({...options(adapter),viewContext: () => ({value: Infinity}),onError}); widget.open(); await settle(); click('Page comment');
  expect(root().querySelector('textarea')).toBeNull(); expect(create).not.toHaveBeenCalled(); expect(onError).toHaveBeenCalledWith(expect.objectContaining({message: 'View context numbers must be finite.'}));
});
it('rejects old service configuration before acquiring or discarding an overlay',() => {
  const adapter = new TestAdapter(); widget = mount(options(adapter));
  expect(() => mount({...options(adapter),serverUrl: 'https://old.test'} as Parameters<typeof mount>[0])).toThrow('host collaboration adapter');
  expect(document.querySelectorAll('[data-huddle-root]')).toHaveLength(1);
});
