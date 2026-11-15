import type {BrowserContext,Page} from '@playwright/test';
import {CollaborationError,type Detail,type Identity,type Create,type Reply,type Update} from '../../packages/shared/src/collaboration';
import {TestAdapter} from '../fixtures/adapter';

// HTTP interception exercises the browser seam only. Actual database/host matrix tests are separate gates.
export function hostFixture() {
  const records: Detail[] = [], requests: {method: string; path: string; input: unknown}[] = [];
  const ledger = new Map<string,{hash: string; result: Detail}>();
  let revision = 0;
  return {
    records,requests,
    async attach(context: BrowserContext,actor: Identity = {id: 'host:alex',name: 'Alex'}) {
      const adapter = new TestAdapter(); adapter.records = records; adapter.actor = actor;
      const control = {allowed: true,loseNextSave: false};
      await context.route('**/api/huddle/v2/**',async route => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname.slice('/api/huddle/v2'.length), method = request.method();
        const scope = {workspace: url.searchParams.get('workspace') || '',environment: url.searchParams.get('environment') || ''}, signal = new AbortController().signal;
        adapter.allowed = control.allowed; adapter.events = revision;
        const input = request.postData() ? request.postDataJSON() : undefined;
        requests.push({method,path,input});
        try {
          await adapter.session(scope,signal);
          let result: unknown;
          if (method === 'GET' && path === '/session') result = await adapter.session(scope,signal);
          else if (method === 'GET' && path === '/changes') result = await adapter.changes(scope,url.searchParams.get('cursor') || undefined,signal);
          else if (method === 'GET' && path === '/threads') result = await adapter.list(scope,{...Object.fromEntries(url.searchParams),limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined},signal);
          else if (method === 'GET' && path.startsWith('/threads/')) result = await adapter.detail(scope,decodeURIComponent(path.slice('/threads/'.length)),{...Object.fromEntries(url.searchParams),limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined},signal);
          else {
            const key = JSON.stringify([scope,actor.id,method,path,input.idempotencyKey]), hash = JSON.stringify(input), previous = ledger.get(key);
            if (previous) {if (previous.hash !== hash) throw new CollaborationError('conflict','Request key reused.'); result = previous.result;}
            else {
              if (method === 'POST' && path === '/threads') result = await adapter.create(scope,input as Create,signal);
              else if (method === 'POST' && path.endsWith('/replies')) result = await adapter.reply(scope,decodeURIComponent(path.split('/')[2]),input as Reply,signal);
              else if (method === 'PATCH') result = await adapter.update(scope,decodeURIComponent(path.split('/')[2]),input as Update,signal);
              else throw new CollaborationError('not_found','Unknown fixture route.');
              ledger.set(key,{hash,result: result as Detail}); revision++;
            }
            if (control.loseNextSave) {control.loseNextSave = false; await route.fulfill({status: 503,json: {error: {code: 'unavailable',message: 'Committed acknowledgement was lost.'}}}); return;}
          }
          await route.fulfill({status: method === 'POST' && path === '/threads' ? 201 : 200,json: result});
        } catch (value) {const code = value instanceof CollaborationError ? value.code : 'unavailable', statuses: Record<string,number> = {forbidden: 403,not_found: 404,conflict: 409}; await route.fulfill({status: statuses[code] || 503,json: {error: {code,message: value instanceof CollaborationError ? value.message : 'Fixture failed.'}}});}
      });
      return control;
    },
  };
}
export async function openReview(page: Page) {await page.getByRole('button',{name: 'Expand feedback',exact: true}).click(); await page.getByRole('button',{name: 'Page comment',exact: true}).waitFor();}
export async function comment(page: Page,body: string) {await page.getByRole('button',{name: 'Page comment',exact: true}).click(); await page.getByLabel('Your comment',{exact: true}).fill(body); await page.getByRole('button',{name: 'Post comment',exact: true}).click(); await page.getByText('Comment saved.',{exact: true}).waitFor();}
