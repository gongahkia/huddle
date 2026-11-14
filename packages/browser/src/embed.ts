import {mount} from './index';
import {createHttpAdapter} from './http';
const script = document.currentScript as HTMLScriptElement | null;
if (script?.dataset.project || script?.dataset.server) console.warn('Huddle v0.2 requires host authentication and API routes. Replace the old service-backed snippet; see the migration guide.');
else if (script?.dataset.workspace) {
  const run = () => {try {mount({adapter: createHttpAdapter({basePath: script.dataset.apiPath}),namespace: script.dataset.namespace || 'huddle',workspace: script.dataset.workspace!,environment: script.dataset.environment || 'staging',release: script.dataset.release,styleNonce: script.nonce || undefined});} catch (error) {console.warn('Huddle could not start:',error instanceof Error ? error.message : 'Invalid installation.');}};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',run,{once: true}); else run();
}
export {mount,createHttpAdapter};
