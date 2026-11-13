import {createBinding,type HuddleOptions} from './binding';
export type {HuddleOptions,HuddleControls} from './binding';
/** Install once in an Astro layout's processed browser script. */
export function installHuddle(options: HuddleOptions | null | (() => HuddleOptions | null)) {
  const binding = createBinding(), lifetime = new AbortController();
  const start = () => binding.update(typeof options === 'function' ? options() : options);
  if (typeof document !== 'undefined') {
    document.addEventListener('astro:before-swap',binding.dispose,{signal: lifetime.signal});
    document.addEventListener('astro:page-load',start,{signal: lifetime.signal});
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once: true,signal: lifetime.signal}); else start();
  }
  return {...binding.controls,get current() {return binding.controls.current;},destroy() {lifetime.abort(); binding.dispose();}};
}
