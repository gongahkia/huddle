import type {HuddleOptions} from '@huddle/browser';
import {createHttpAdapter} from '@huddle/browser/http';
const adapter = createHttpAdapter();
export function reviewOptions(framework: string): HuddleOptions | null {
  const workspace = new URLSearchParams(location.search).get('workspace');
  return workspace ? {adapter,namespace: 'huddle-examples',workspace,environment: 'staging',release: `${framework}-example-v2`} : null;
}
