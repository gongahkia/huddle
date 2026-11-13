import {onMounted,onUnmounted,toValue,watchEffect,type MaybeRefOrGetter} from 'vue';
import {createBinding,type HuddleOptions} from './binding';
export type {HuddleOptions,HuddleControls} from './binding';
export function useHuddle(options: MaybeRefOrGetter<HuddleOptions | null>) {
  const binding = createBinding(); let stop: (() => void) | undefined;
  onMounted(() => {stop = watchEffect(() => binding.update(toValue(options)));});
  onUnmounted(() => {stop?.(); binding.dispose();});
  return binding.controls;
}
