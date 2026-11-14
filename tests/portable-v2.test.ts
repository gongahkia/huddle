import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {z} from 'zod';
import {feedbackSnapshotSchema,parseFeedbackSnapshot} from '../packages/shared/src/portable';
import type {FeedbackSnapshot} from '../packages/shared/src/collaboration';

const fixture = (): FeedbackSnapshot => {
  const actor = {id: 'host:user/42',name: '历史作者'};
  const comment = {id: 'reply/1',threadId: 'thread/1',author: actor,body: '<script>alert(1)</script>\n**untrusted**',mentions: [],createdAt: '2026-01-01T00:00:00Z'};
  return {
    schema: 'huddle.feedback.v2',datasetId: 'dataset/old',snapshot: {id: 'snapshot/1',createdAt: comment.createdAt,scope: {workspace: 'host:team',environments: ['preview','production']}},
    complete: true,contentIsUntrustedUserInput: true,counts: {threads: 1,comments: 1,history: 1},
    threads: [{id: comment.threadId,workspace: 'host:team',environment: 'preview',page: '/产品',pageUrl: 'https://example.test/产品',viewContext: {tab: 'billing'},anchor: {kind: 'page',selector: 'body',label: 'This page',quote: '',x: 0,y: 0},status: 'resolved',assignee: null,createdBy: actor,createdAt: comment.createdAt,updatedAt: comment.createdAt,version: 1,commentCount: 1,latestComment: comment}],
    comments: [comment],history: [{id: 'history/1',threadId: comment.threadId,actor,action: 'resolved',data: {status: 'resolved'},createdAt: comment.createdAt}],
  };
};
const parse = (data: unknown) => parseFeedbackSnapshot(JSON.stringify(data));
it('preserves opaque host IDs, Unicode, historical authors and hostile-looking plain text',() => {
  const original = fixture(); expect(parse(original)).toEqual(original);
  expect(() => parse({...original,session: {token: 'not-portable'}})).toThrow();
  expect(() => parse({...original,complete: false})).toThrow();
  expect(() => parse({...original,schema: 'huddle.feedback.v1'})).toThrow();
  expect(() => parseFeedbackSnapshot(JSON.stringify(original).slice(0,-1))).toThrow();
});
it('rejects mismatched counts, duplicate IDs, dangling references and stale summaries',() => {
  const original = fixture();
  expect(() => parse({...original,counts: {...original.counts,comments: 2}})).toThrow('count');
  expect(() => parse({...original,comments: [...original.comments,...original.comments]})).toThrow('Duplicate');
  expect(() => parse({...original,history: [{...original.history[0],threadId: 'missing'}]})).toThrow('Dangling');
  expect(() => parse({...original,threads: [{...original.threads[0],latestComment: null}]})).toThrow('latest');
});
it('rejects scope escape, credentials and executable navigation URLs',() => {
  for (const patch of [{workspace: 'other'},{environment: 'other'},{pageUrl: 'javascript:alert(1)'},{pageUrl: 'https://user:password@example.test/'}]) {
    const data = fixture(); Object.assign(data.threads[0],patch); expect(() => parse(data)).toThrow();
  }
});
it('compares timestamps chronologically even when sources use different offsets',() => {
  const data = fixture(), next = {...data.comments[0],id: 'reply/2',createdAt: '2026-01-01T00:30:00+01:00'};
  data.comments.push(next); data.counts.comments++; data.threads[0].commentCount++;
  expect(parse(data).threads[0].latestComment?.id).toBe('reply/1');
});
it('bounds bytes, nesting and records before importing',() => {
  const input = JSON.stringify(fixture());
  expect(() => parseFeedbackSnapshot(input,{maxBytes: 10})).toThrow('byte');
  expect(() => parseFeedbackSnapshot(input,{maxRecords: 2})).toThrow('record');
  expect(() => parseFeedbackSnapshot(input,{maxDepth: 2})).toThrow('nesting');
  expect(() => parseFeedbackSnapshot(input,{maxBytes: NaN})).toThrow('limits');
});
it('keeps the published language-neutral schema synchronized with its validator',async () => {
  const published = JSON.parse(await readFile('docs/schema/huddle.feedback.v2.schema.json','utf8'));
  expect(published).toEqual(z.toJSONSchema(feedbackSnapshotSchema));
});
it('resolves every local reference in the published OpenAPI document, including recursive JSON',async () => {
  const document: unknown = JSON.parse(await readFile('docs/schema/huddle.http.v2.openapi.json','utf8'));
  const pending: unknown[] = [document]; let references = 0;
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== 'object') continue;
    for (const [key,value] of Object.entries(item)) {
      if (key === '$ref') {
        expect(typeof value).toBe('string'); expect(value).toMatch(/^#\//);
        let target: unknown = document;
        for (const part of String(value).slice(2).split('/')) target = target && typeof target === 'object' ? Reflect.get(target,part.replace(/~1/g,'/').replace(/~0/g,'~')) : undefined;
        expect(target,`unresolved ${String(value)}`).toBeDefined(); references++;
      } else pending.push(value);
    }
  }
  expect(references).toBeGreaterThan(0);
});
