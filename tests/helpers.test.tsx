// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {StrictMode,act} from 'react';
import {createRoot} from 'react-dom/client';
import {createBinding} from '../packages/browser/src/adapters/binding';
import {useHuddle} from '../packages/browser/src/adapters/react';
import {mount,type HuddleOptions} from '../packages/browser/src/index';
const options: HuddleOptions = {serverUrl: 'https://huddle.test',projectId: '11111111-1111-4111-8111-111111111111',environment: 'staging'};
const dispose: (() => void)[] = [];
beforeEach(() => {
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 vi.stubGlobal('requestAnimationFrame',(callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()),0));
 vi.stubGlobal('cancelAnimationFrame',clearTimeout);
});
afterEach(() => {for (const cleanup of dispose.splice(0).reverse()) cleanup(); document.body.replaceChildren(); vi.unstubAllGlobals();});
it('never takes ownership of or destroys another helper\'s widget',() => {
 const a = createBinding(), b = createBinding(); dispose.push(a.dispose,b.dispose);
 a.update(options); const first = document.querySelector('[data-huddle-root]');
 expect(() => b.update(options)).toThrow('owned by another integration'); b.dispose();
 expect(document.querySelector('[data-huddle-root]')).toBe(first);
 expect(() => mount(options)).toThrow('owned by another integration');
 a.dispose(); b.update(options); expect(document.querySelector('[data-huddle-root]')).not.toBe(first);
});
it('preserves imperative duplicate mount behavior and leaves manual installations alone',() => {
 const manual = mount(options); dispose.push(() => manual.destroy()); expect(mount(options)).toBe(manual);
 const binding = createBinding(); dispose.push(binding.dispose); expect(() => binding.update(options)).toThrow('owned by another integration');
 binding.dispose(); expect(document.querySelectorAll('[data-huddle-root]')).toHaveLength(1);
});
it('updates context in place, remounts installation changes and validates before discarding the widget',() => {
 const binding = createBinding(); dispose.push(binding.dispose); binding.update(options);
 const first = document.querySelector('[data-huddle-root]'); binding.update({...options,release: 'v2',environment: 'production'});
 expect(document.querySelector('[data-huddle-root]')).toBe(first);
 binding.controls.open(); expect(first!.shadowRoot!.textContent).toContain('production');
 expect(() => binding.update({...options,serverUrl: 'https://huddle.test/unsupported'})).toThrow('origin');
 expect(document.querySelector('[data-huddle-root]')).toBe(first);
 binding.update({...options,styleNonce: 'replacement'}); expect(document.querySelector('[data-huddle-root]')).not.toBe(first);
 binding.update(null); expect(binding.controls.current).toBeNull(); expect(document.querySelector('[data-huddle-root]')).toBeNull();
 const manual = mount(options); dispose.push(() => manual.destroy()); binding.dispose(); expect(document.querySelector('[data-huddle-root]')).not.toBeNull();
});
it('handles actual React StrictMode effect replay, prop updates and unmount cleanup',async () => {
 const host = document.createElement('div'); document.body.append(host); const root = createRoot(host), push = history.pushState;
 function Review({config}: {config: HuddleOptions | null}) {useHuddle(config); return <p>Host remains interactive</p>;}
 await act(async () => root.render(<StrictMode><Review config={options}/></StrictMode>)); expect(document.querySelectorAll('[data-huddle-root]')).toHaveLength(1);
 const first = document.querySelector('[data-huddle-root]');
 await act(async () => root.render(<StrictMode><Review config={{...options,release: 'new'}}/></StrictMode>)); expect(document.querySelector('[data-huddle-root]')).toBe(first);
 await act(async () => root.render(<StrictMode><Review config={null}/></StrictMode>)); expect(document.querySelector('[data-huddle-root]')).toBeNull();
 await act(async () => root.render(<StrictMode><Review config={options}/></StrictMode>)); expect(document.querySelectorAll('[data-huddle-root]')).toHaveLength(1);
 await act(async () => root.unmount()); expect(document.querySelector('[data-huddle-root]')).toBeNull(); expect(history.pushState).toBe(push);
});
