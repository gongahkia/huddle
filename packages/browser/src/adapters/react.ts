'use client';
import {useEffect,useMemo} from 'react';
import {createBinding,type HuddleOptions} from './binding';
export type {HuddleOptions,HuddleControls} from './binding';
export function useHuddle(options: HuddleOptions | null) {
  const binding = useMemo(createBinding,[]);
  useEffect(() => {binding.update(options);});
  useEffect(() => () => binding.dispose(),[binding]);
  return binding.controls;
}
