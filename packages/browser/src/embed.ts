import {mount} from './index';
const script = document.currentScript as HTMLScriptElement | null;
if (script?.dataset.project) {
  const run = () => mount({serverUrl: script.dataset.server || new URL(script.src).origin,projectId: script.dataset.project!,environment: script.dataset.environment || 'staging',release: script.dataset.release});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',run,{once: true}); else run();
}
export {mount};
