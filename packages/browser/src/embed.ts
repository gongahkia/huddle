import {mount} from './index';
const script = document.currentScript as HTMLScriptElement | null;
if (script?.dataset.project) {
  const run = () => {try {mount({serverUrl: script.dataset.server || new URL(script.src).origin,projectId: script.dataset.project!,environment: script.dataset.environment || 'staging',release: script.dataset.release,styleNonce: script.nonce || undefined});} catch (error) {console.warn('Huddle could not start:',error instanceof Error ? error.message : 'Invalid installation.');}};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',run,{once: true}); else run();
}
export {mount};
