import {mountForOwner,type Huddle,type HuddleOptions} from '../engine';
import {validateOptions} from '../options';
export type {HuddleOptions} from '../engine';
/** Controls for the helper's own widget. Before mounting, these are safe no-ops. */
export type HuddleControls = {readonly current: Huddle | null; open(): void; close(): void};
const equal = (a: HuddleOptions,b: HuddleOptions) => (Object.keys({...a,...b}) as (keyof HuddleOptions)[]).every(key => key === 'allowedQueryParameters' ? JSON.stringify(a[key] || []) === JSON.stringify(b[key] || []) : a[key] === b[key]);
export function createBinding() {
  const owner = Symbol('huddle-helper'); let current: Huddle | null = null, previous: HuddleOptions | null = null;
  const controls: HuddleControls = {get current() {return current;},open() {current?.open();},close() {current?.close();}};
  function dispose() {current?.destroy(); current = null; previous = null;}
  function update(options: HuddleOptions | null) {
    if (!options) {dispose(); return;}
    validateOptions(options);
    const next = {...options,allowedQueryParameters: options.allowedQueryParameters ? [...options.allowedQueryParameters] : undefined};
    // Context changes preserve drafts and the current connection where possible.
    if (current && previous && equal({...previous,workspace: next.workspace,environment: next.environment,release: next.release},next)) {
      if (previous.workspace !== next.workspace || previous.environment !== next.environment || previous.release !== next.release) current.updateContext({workspace: next.workspace,environment: next.environment,release: next.release});
      previous = next; return;
    }
    if (current) dispose();
    current = mountForOwner(options,owner); previous = next;
  }
  return {controls,update,dispose};
}
