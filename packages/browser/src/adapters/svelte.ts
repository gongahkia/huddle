import type {Action} from 'svelte/action';
import {createBinding,type HuddleOptions} from './binding';
export type {HuddleOptions,HuddleControls} from './binding';
/** Svelte action: <div use:huddle={options}>...</div>. */
export const huddle: Action<HTMLElement,HuddleOptions | null> = (_node,options) => {
  const binding = createBinding(); binding.update(options ?? null);
  return {update: binding.update,destroy: binding.dispose};
};
