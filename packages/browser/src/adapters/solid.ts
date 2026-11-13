import {createEffect,onCleanup,onMount,type Accessor} from 'solid-js';
import {createBinding,type HuddleOptions} from './binding';
export type {HuddleOptions,HuddleControls} from './binding';
export function createHuddle(options: Accessor<HuddleOptions | null>) {
  const binding = createBinding();
  onMount(() => {createEffect(() => binding.update(options()));});
  onCleanup(() => binding.dispose());
  return binding.controls;
}
