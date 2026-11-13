import {mount} from '@huddle/browser';
export function startReview(framework: string) {
  const params = new URLSearchParams(location.search), projectId = params.get('project');
  if (!projectId) return;
  return mount({serverUrl: params.get('server') || 'http://localhost:4310',projectId,environment: 'staging',release: `${framework}-example-v1`});
}
