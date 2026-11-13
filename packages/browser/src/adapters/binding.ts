import {mountForOwner,type Huddle,type HuddleOptions} from '../engine';
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
    const url = new URL(options.serverUrl);
    if (!['http:','https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Use an HTTP(S) Huddle server origin without a path, query or credentials.');
    const next = {...options,serverUrl: url.origin,allowedQueryParameters: options.allowedQueryParameters ? [...options.allowedQueryParameters] : undefined};
    // Context changes preserve drafts and the current connection where possible.
    if (current && previous && equal({...previous,environment: next.environment,release: next.release},next)) {
      if (previous.environment !== next.environment || previous.release !== next.release) current.updateContext({environment: next.environment,release: next.release});
      previous = next; return;
    }
    if (current) dispose();
    // Validate the original URL through the core; do not silently accept paths.
    current = mountForOwner(options,owner); previous = next;
  }
  return {controls,update,dispose};
}
