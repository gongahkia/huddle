import {afterNextRender,DestroyRef,effect,inject,Injector,type EffectRef} from '@angular/core';
import {createBinding,type HuddleOptions} from './binding';
export type {HuddleOptions,HuddleControls} from './binding';
/** Call in an Angular injection context (constructor or field initializer). */
export function injectHuddle(options: () => HuddleOptions | null) {
  const binding = createBinding(), destroyRef = inject(DestroyRef), injector = inject(Injector); let watcher: EffectRef | undefined;
  const render = afterNextRender(() => {watcher = effect(() => binding.update(options()),{injector});});
  destroyRef.onDestroy(() => {render.destroy(); watcher?.destroy(); binding.dispose();});
  return binding.controls;
}
