import type {HuddleOptions} from '@huddle/browser';
export function reviewOptions(framework: string): HuddleOptions | null {
  const params = new URLSearchParams(location.search), projectId = params.get('project');
  if (!projectId) return null;
  return {serverUrl: params.get('server') || 'http://localhost:4310',projectId,environment: 'staging',release: `${framework}-example-v1`};
}
