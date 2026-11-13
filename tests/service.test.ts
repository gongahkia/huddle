import {afterEach, expect, it} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {createApp} from '../apps/server/src/app';
import {bootstrap, createSession} from '../apps/server/src/auth';
import type {Actor, ThreadDetail} from '@huddle/shared';
const origin = 'http://localhost:4310', site = 'http://localhost:4320';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {for (const fn of cleanup.splice(0).reverse()) await fn();});
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(),'huddle-test-'));
  const server = await createApp({dbPath: join(directory,'db.sqlite'),baseUrl: origin,rateLimits: false});
  cleanup.push(async () => {await server.app.close(); rmSync(directory,{recursive: true,force: true});});
  const id = bootstrap(server.db,'admin@example.test','Admin','test-password-long');
  const token = createSession(server.db,id);
  const cookie = `huddle_session=${token}`;
  const request = (method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown, session = cookie, requestOrigin = origin) => server.app.inject({method,url,headers: {origin: requestOrigin,cookie: session},...(body === undefined ? {} : {payload: body as Record<string, unknown>})});
  const response = await request('POST','/api/projects',{name: 'Example',origins: [site],environments: ['staging','production']}); expect(response.statusCode).toBe(200);
  const project = response.json<{id: string}>();
  const base = `/api/projects/${project.id}`;
  const a = (await request('GET','/api/session')).json<{actor: Actor}>().actor;
  const input = () => ({requestId: randomUUID(),environment: 'staging',page: '/example',pageUrl: `${site}/example`,anchor: {kind: 'page',selector: 'body',label: 'This page',quote: '',x: .5,y: .5},body: 'First note',mentions: []});
  return {...server,request,cookie,base,project,a,input,directory};
}
it('requires authentication, same origin and server-derived author identity',async () => {
  const f = await fixture();
  expect((await f.request('GET',f.base + '/threads',undefined,'')).statusCode).toBe(401);
  expect((await f.request('POST',f.base + '/threads',f.input(),f.cookie,'https://evil.test')).statusCode).toBe(403);
  expect((await f.request('POST',f.base + '/threads',{...f.input(),authorId: randomUUID()})).statusCode).toBe(400);
  const created = (await f.request('POST',f.base + '/threads',{...f.input(),body: '<img src=x onerror=alert(1)>',mentions: [f.a.id]})).json<ThreadDetail>();
  expect(created.comments[0].authorId).toBe(f.a.id); expect(created.comments[0].body).toContain('<img'); expect(created.mentionedIds).toEqual([f.a.id]);
  expect((await f.request('POST',f.base + '/threads',{...f.input(),mentions: [randomUUID()]})).statusCode).toBe(400);
});
it('deduplicates concurrent creates/replies, detects changed retries and preserves coordination history',async () => {
  const f = await fixture(), payload = f.input();
  const saves = await Promise.all([f.request('POST',f.base + '/threads',payload),f.request('POST',f.base + '/threads',payload)]);
  expect(saves.map(s => s.statusCode)).toEqual([200,200]); const t = saves[0].json<ThreadDetail>(); expect(saves[1].json().id).toBe(t.id);
  expect(f.db.get<{n: number}>('SELECT COUNT(*) n FROM comments')!.n).toBe(1);
  expect(f.db.get<{response: string}>('SELECT response FROM requests')!.response).toBe(JSON.stringify({threadId: t.id}));
  expect((await f.request('POST',f.base + '/threads',{...payload,body: 'changed'})).statusCode).toBe(409);
  const reply = {requestId: randomUUID(),body: 'Follow up',mentions: [f.a.id]};
  await f.request('POST',`${f.base}/threads/${t.id}/replies`,reply); await f.request('POST',`${f.base}/threads/${t.id}/replies`,reply);
  let detail = (await f.request('GET',`${f.base}/threads/${t.id}`)).json<ThreadDetail>(); expect(detail.comments).toHaveLength(2);
  const patch = {requestId: randomUUID(),expectedVersion: detail.version,status: 'resolved',assigneeId: f.a.id};
  expect((await f.request('PATCH',`${f.base}/threads/${t.id}`,patch)).statusCode).toBe(200);
  expect((await f.request('PATCH',`${f.base}/threads/${t.id}`,{...patch,requestId: randomUUID()})).statusCode).toBe(409);
  detail = (await f.request('PATCH',`${f.base}/threads/${t.id}`,{requestId: randomUUID(),expectedVersion: detail.version + 1,status: 'open',anchor: {...t.anchor,label: 'Reattached'}})).json<ThreadDetail>();
  expect(detail.history.some(h => h.action === 'reattached')).toBe(true); expect(detail.status).toBe('open');
  const filtered = await f.request('GET',`${f.base}/threads?assigneeId=${f.a.id}&mentionedId=${f.a.id}&environment=staging&page=%2Fexample`); expect(filtered.json().items).toHaveLength(1);
});
it('scopes guest links and revokes all access derived from them',async () => {
  const f = await fixture();
  const invite = (await f.request('POST',f.base + '/invitations',{kind: 'guest',expiresInHours: 1})).json<{id: string; url: string}>();
  const accepted = await f.request('POST','/api/auth/accept',{token: invite.url.split('#')[1],name: 'Guest'}); expect(accepted.statusCode).toBe(200);
  const guest = String(accepted.headers['set-cookie']).split(';')[0];
  expect((await f.request('POST',f.base + '/threads',f.input(),guest)).statusCode).toBe(200);
  expect((await f.request('GET',f.base + '/export',undefined,guest)).statusCode).toBe(403);
  expect((await f.request('POST',f.base + '/invitations',{kind: 'guest'},guest)).statusCode).toBe(403);
  const other = (await f.request('POST','/api/projects',{name: 'Other',origins: [site],environments: ['staging']})).json();
  expect((await f.request('GET',`/api/projects/${other.id}/threads`,undefined,guest)).statusCode).toBe(404);
  await f.request('POST',`${f.base}/invitations/${invite.id}/revoke`,{});
  expect((await f.request('GET',f.base + '/threads',undefined,guest)).statusCode).toBe(401);
  const expiring = (await f.request('POST',f.base + '/invitations',{kind: 'guest'})).json(); f.db.run('UPDATE invitations SET expires_at=? WHERE id=?',Date.now() - 1,expiring.id);
  expect((await f.request('POST','/api/auth/accept',{token: expiring.url.split('#')[1],name: 'Late'})).statusCode).toBe(410);
});
it('accepts member invitations once without overwriting an existing account password',async () => {
  const f = await fixture(), invite = (await f.request('POST',f.base + '/invitations',{kind: 'member'})).json();
  const accepted = await f.request('POST','/api/auth/accept',{token: invite.url.split('#')[1],name: 'Designer',email: 'designer@example.test',password: 'designer-password'});
  expect(accepted.statusCode).toBe(200); const member = String(accepted.headers['set-cookie']).split(';')[0];
  expect((await f.request('GET',f.base + '/threads',undefined,member)).statusCode).toBe(200);
  expect((await f.request('POST','/api/projects',{name: 'Forbidden',origins: [site],environments: ['staging']},member)).statusCode).toBe(403);
  expect((await f.request('POST','/api/auth/accept',{token: invite.url.split('#')[1],name: 'Again',email: 'x@example.test',password: 'another-password'})).statusCode).toBe(410);
  const second = (await f.request('POST',f.base + '/invitations',{kind: 'member'})).json();
  expect((await f.request('POST','/api/auth/accept',{token: second.url.split('#')[1],name: 'Imposter',email: 'designer@example.test',password: 'wrong-password'})).statusCode).toBe(401);
});
it('exchanges one-use PKCE codes into origin/project/environment-scoped widget credentials',async () => {
  const f = await fixture(), verifier = 'v'.repeat(43), challenge = createHash('sha256').update(verifier).digest('base64url');
  const code = (await f.request('POST','/api/auth/authorize',{projectId: f.project.id,environment: 'staging',origin: site,challenge})).json<{code: string}>().code;
  expect((await f.request('POST','/api/auth/exchange',{code,verifier: 'x'.repeat(43)},'',site)).statusCode).toBe(403);
  expect((await f.request('POST','/api/auth/exchange',{code,verifier},'','https://evil.test')).statusCode).toBe(403);
  const exchange = await f.request('POST','/api/auth/exchange',{code,verifier},'',site); expect(exchange.statusCode).toBe(200); const {token} = exchange.json<{token: string}>();
  const req = (method: 'GET' | 'POST', url: string, body?: unknown, requestOrigin = site) => f.app.inject({method,url,headers: {origin: requestOrigin,authorization: `Bearer ${token}`},...(body ? {payload: body as Record<string, unknown>} : {})});
  expect((await req('GET',f.base + '/threads')).statusCode).toBe(200);
  expect((await req('GET',f.base + '/threads?environment=production')).statusCode).toBe(403);
  expect((await req('GET',f.base + '/threads',undefined,'https://evil.test')).statusCode).toBe(403);
  expect((await req('POST','/api/projects',{name: 'Forbidden',origins: [site],environments: ['staging']})).statusCode).toBe(403);
  expect((await req('GET',f.base + '/export')).statusCode).toBe(403);
  expect((await f.request('POST','/api/auth/exchange',{code,verifier},'',site)).statusCode).toBe(403);
});
it('persists threads and sessions through an application restart',async () => {
  const f = await fixture(), created = (await f.request('POST',f.base + '/threads',f.input())).json();
  await f.app.close();
  const next = await createApp({dbPath: join(f.directory,'db.sqlite'),baseUrl: origin,rateLimits: false}); cleanup.push(async () => {await next.app.close();});
  const detail = await next.app.inject({method: 'GET',url: `${f.base}/threads/${created.id}`,headers: {cookie: f.cookie,origin}}); expect(detail.statusCode).toBe(200); expect(detail.json().comments[0].body).toBe('First note');
});
it('paginates thread summaries and replies and exposes durable reconnect cursors',async () => {
  const f = await fixture(); let firstId = '';
  for (let i = 0; i < 35; i++) {const t = (await f.request('POST',f.base + '/threads',f.input())).json(); firstId ||= t.id;}
  const page = (await f.request('GET',f.base + '/threads?limit=20')).json(); expect(page.items).toHaveLength(20); expect(page.items[0].comments).toBeUndefined();
  const second = (await f.request('GET',`${f.base}/threads?limit=20&before=${page.nextCursor}`)).json(); expect(second.items).toHaveLength(15);
  const changes = (await f.request('GET',`${f.base}/changes?after=30`)).json(); expect(changes.items.map((c: {seq: number}) => c.seq)).toEqual([31,32,33,34,35]);
  for (let i = 0; i < 55; i++) await f.request('POST',`${f.base}/threads/${firstId}/replies`,{requestId: randomUUID(),body: `Reply ${i}`,mentions: []});
  const detail = (await f.request('GET',`${f.base}/threads/${firstId}`)).json(); expect(detail.comments).toHaveLength(50); expect(detail.commentCount).toBe(56);
  const more = (await f.request('GET',`${f.base}/threads/${firstId}?after=${detail.nextCursor}`)).json(); expect(more.comments).toHaveLength(6);
});
it('allows one winner for concurrent updates and denies a member access to another project and its export',async () => {
 const f = await fixture(); const thread = (await f.request('POST',f.base + '/threads',f.input())).json<ThreadDetail>();
 const updates = await Promise.all(['resolved','open'].map(status => f.request('PATCH',`${f.base}/threads/${thread.id}`,{requestId: randomUUID(),expectedVersion: thread.version,status})));
 expect(updates.map(r => r.statusCode).sort()).toEqual([200,409]);
 const invitation = (await f.request('POST',f.base + '/invitations',{kind: 'member'})).json();
 const accepted = await f.request('POST','/api/auth/accept',{token: invitation.url.split('#')[1],name: 'Member',email: 'member@example.test',password: 'test-member-password'}); const member = String(accepted.headers['set-cookie']).split(';')[0];
 const other = (await f.request('POST','/api/projects',{name: 'Separate',origins: [site],environments: ['staging']})).json();
 for (const suffix of ['/threads','/export','/members','/changes']) expect((await f.request('GET',`/api/projects/${other.id}${suffix}`,undefined,member)).statusCode).toBe(404);
 expect((await f.request('GET',`${f.base}/threads/${thread.id}`,undefined,member)).statusCode).toBe(200);
});
