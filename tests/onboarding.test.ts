// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mount,type Huddle} from '../packages/browser/src/index';
import {CollaborationError} from '../packages/shared/src/collaboration';
import {LocalStore} from '../packages/browser/src/storage';
import {TestAdapter} from './fixtures/adapter';
let widget:Huddle|undefined;
const root=()=>document.querySelector('[data-huddle-root]')!.shadowRoot!;
const click=(text:string)=>{const button=[...root().querySelectorAll('button')].find(button=>button.textContent===text||button.getAttribute('aria-label')===text);expect(button).toBeDefined();button!.click();};
const field=()=>root().querySelector<HTMLInputElement>('#huddle-display-name')!;
const fill=(value:string)=>{field().value=value;field().dispatchEvent(new Event('input'));};
const settle=async()=>{for(let n=0;n<8;n++)await vi.advanceTimersByTimeAsync(0);};
const options=(adapter:TestAdapter,change:(name:string,signal:AbortSignal)=>Promise<void>)=>({adapter,namespace:'onboarding-tests',workspace:'team',environment:'preview',launcher:'hidden' as const,onDisplayNameChange:change});
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('requestAnimationFrame',(run:FrameRequestCallback)=>setTimeout(()=>run(performance.now()),16));vi.stubGlobal('cancelAnimationFrame',clearTimeout);localStorage.clear();history.replaceState(null,'','/');});
afterEach(()=>{widget?.destroy();widget=undefined;vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();document.body.replaceChildren();});
it('shows only a compact name onboarding before loading discussion, then restores the existing draft',async()=>{
 const adapter=new TestAdapter(),list=vi.spyOn(adapter,'list'),changes=vi.spyOn(adapter,'changes'),change=vi.fn(async()=>{});new LocalStore(JSON.stringify(['onboarding-tests','team',adapter.actor.id,'preview']),localStorage).write('draft:/',{body:'Unsent draft',mentions:[],anchor:{kind:'page',selector:'body',label:'This page',quote:'',x:.5,y:.5}});
 widget=mount(options(adapter,change));widget.open();await settle();expect(root().querySelector('.panel.onboarding')).not.toBeNull();expect(root().querySelector('h3')?.textContent).toBe('Welcome to Huddle');expect(field().placeholder).toBe('Alex');expect(root().querySelector('textarea')).toBeNull();expect(root().querySelector('.tools')?.querySelectorAll('button')).toHaveLength(1);expect(root().querySelector('footer')).toBeNull();expect(root().textContent).not.toContain('Workspace:');expect(list).not.toHaveBeenCalled();expect(changes).not.toHaveBeenCalled();
 widget.collapse();widget.open();expect(root().querySelector('h3')?.textContent).toBe('Welcome to Huddle');click('Continue');await settle();expect(change).not.toHaveBeenCalled();expect(list).toHaveBeenCalledOnce();expect(root().querySelector('textarea')?.value).toBe('Unsent draft');expect(root().querySelector('.panel.onboarding')).toBeNull();
});
it('remembers joining across remounts, navigation, environments and the ordinary draft expiry',async()=>{
 const adapter=new TestAdapter(),change=vi.fn(async(name:string)=>{adapter.actor={...adapter.actor,name};}),settings=options(adapter,change);widget=mount(settings);widget.open();await settle();fill('Ada');click('Continue');await settle();expect(adapter.actor.name).toBe('Ada');widget.destroy();vi.setSystemTime(Date.now()+15*86400000);widget=mount(settings);widget.open();await settle();expect(root().querySelector('.panel.onboarding')).toBeNull();history.pushState(null,'','/another-page');await settle();widget.updateContext({environment:'production'});await settle();expect(root().querySelector('.panel.onboarding')).toBeNull();
 click('Review details');expect(field()).toBeNull();click('Edit reviewer name');expect(root().querySelector('h3')?.textContent).toBe('Your name');expect(field().placeholder).toBe('Ada');click('Back to feedback');expect(root().querySelector('.panel.onboarding')).toBeNull();expect(change).toHaveBeenCalledOnce();
});
it('retains the name and onboarding after a failed update and completes only after a successful retry',async()=>{
 const adapter=new TestAdapter(),list=vi.spyOn(adapter,'list'),change=vi.fn(async(name:string)=>{adapter.actor={...adapter.actor,name};}).mockRejectedValueOnce(new CollaborationError('unavailable','Please retry.'));widget=mount(options(adapter,change));widget.open();await settle();fill('Ada');click('Continue');await settle();expect(field().value).toBe('Ada');expect(root().querySelector('[role=alert]')?.textContent).toBe('Please retry.');expect(list).not.toHaveBeenCalled();click('Continue');await settle();expect(change).toHaveBeenCalledTimes(2);expect(root().querySelector('.panel.onboarding')).toBeNull();expect(list).toHaveBeenCalledOnce();
});
it('does not complete onboarding for a different actor after a pending name update resolves',async()=>{
 const adapter=new TestAdapter(),list=vi.spyOn(adapter,'list');let release=()=>{};const change=vi.fn(()=>new Promise<void>(done=>{release=done;}));widget=mount(options(adapter,change));widget.open();await settle();fill('Old pending name');click('Continue');await settle();adapter.actor={id:'other-reviewer',name:'Other Otter'};release();await settle();expect(field().placeholder).toBe('Other Otter');expect(field().value).toBe('');expect(root().querySelector('h3')?.textContent).toBe('Welcome to Huddle');expect(list).not.toHaveBeenCalled();click('Continue');await settle();expect(root().querySelector('.panel.onboarding')).toBeNull();expect(change).toHaveBeenCalledOnce();
});
