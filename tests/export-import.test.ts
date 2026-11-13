import {expect, it} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Database} from '../apps/server/src/database';
import {bootstrap} from '../apps/server/src/auth';
import {importPronto} from '../apps/server/src/import';
import {exportProject} from '../apps/server/src/export';
import type {Actor} from '@huddle/shared';
const setup = () => {
 const dir = mkdtempSync(join(tmpdir(),'huddle-export-')), path = join(dir,'db.sqlite'), db = new Database(path);
 const actor: Actor = {id: bootstrap(db,'admin@example.test','Admin','test-password-long'),name: 'Admin',role: 'administrator',sessionId: 'cli'};
 const projectId = randomUUID(); db.run('INSERT INTO projects VALUES(?,?,?,?,?)',projectId,'Test','["http://localhost:4320"]','["staging"]',new Date().toISOString());
 return {db,path,actor,projectId,close: () => {db.close(); rmSync(dir,{recursive: true,force: true});}};
};
it('imports portable Pronto JSON idempotently with original identifiers and author attribution',async () => {
 const f = setup(); try {
  const original = {schema: 'pronto.prototype-feedback.v1',workspaceId: randomUUID(),complete: true,threads: [{id: randomUUID(),page_path: '/client/inbox',anchor: {selector: 'main',label: 'This page',quote: '',x: .5,y: .5},status: 'resolved',created_at: '2026-01-01T00:00:00Z',updated_at: '2026-01-02T00:00:00Z',commentsTruncated: false,comments: [{id: randomUUID(),author_user_id: randomUUID(),author_name: 'Original author',body: 'Preserve me',created_at: '2026-01-01T00:00:00Z'}]}]};
  const options = {projectId: f.projectId,environment: 'staging',origin: 'http://localhost:4320'};
  expect(importPronto(f.db,f.actor,original,options)).toEqual({threadsAdded: 1,commentsAdded: 1}); expect(importPronto(f.db,f.actor,original,options)).toEqual({threadsAdded: 0,commentsAdded: 0});
  let text = ''; for await (const part of exportProject(f.path,f.projectId,'json')) text += part;
  const exported = JSON.parse(text); expect(exported.threads[0].sourceId).toBe(original.threads[0].id); expect(exported.threads[0].comments[0]).toMatchObject({sourceId: original.threads[0].comments[0].id,sourceAuthorId: original.threads[0].comments[0].author_user_id,authorName: 'Original author',body: 'Preserve me'});
  expect(() => importPronto(f.db,f.actor,{...original,complete: false},options)).toThrow();
  expect(() => importPronto(f.db,f.actor,{...original,threads: [{...original.threads[0],commentsTruncated: true}]},options)).toThrow();
 } finally {f.close();}
});
it('streams complete JSON and Markdown beyond the original 2000-thread cap and 100-comment cap',async () => {
 const f = setup(); try {
  f.db.transaction(() => {for (let i = 0; i < 2005; i++) {
   const id = randomUUID(), time = new Date().toISOString();
   f.db.run('INSERT INTO threads(id,project_id,environment,page,page_url,anchor,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',id,f.projectId,'staging',`/page${i}`,'http://localhost:4320','{}',time,time);
   for (let j = 0; j < (i === 0 ? 105 : 1); j++) f.db.run('INSERT INTO comments(id,thread_id,author_name,body,created_at) VALUES(?,?,?,?,?)',randomUUID(),id,'QA',`record-${i}-${j}`,time);
  }});
  let json = ''; for await (const part of exportProject(f.path,f.projectId,'json')) json += part;
  const data = JSON.parse(json); expect(data.complete).toBe(true); expect(data.threads).toHaveLength(2005); expect(data.threads.reduce((n: number,t: {comments: unknown[]}) => n + t.comments.length,0)).toBe(2109);
  let markdown = ''; for await (const part of exportProject(f.path,f.projectId,'markdown')) markdown += part;
  expect(markdown).toContain('2005 threads'); expect(markdown).toContain('record\\-2004\\-0'); expect(markdown).toContain('record\\-0\\-104');
 } finally {f.close();}
});
it('keeps an export snapshot consistent while later comments are written',async () => {
 const f = setup(); try {
  const id = randomUUID(), now = new Date().toISOString(); f.db.run('INSERT INTO threads(id,project_id,environment,page,page_url,anchor,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',id,f.projectId,'staging','/','http://localhost:4320','{}',now,now);
  f.db.run('INSERT INTO comments(id,thread_id,author_name,body,created_at) VALUES(?,?,?,?,?)',randomUUID(),id,'First','Included',now);
  const iterator = exportProject(f.path,f.projectId,'json'); const first = await iterator.next(); let text = first.value || '';
  f.db.run('INSERT INTO comments(id,thread_id,author_name,body,created_at) VALUES(?,?,?,?,?)',randomUUID(),id,'Second','Written after snapshot',now);
  for await (const part of iterator) text += part;
  const exported = JSON.parse(text); expect(exported.threads[0].comments).toHaveLength(1); expect(exported.threads[0].comments[0].body).toBe('Included');
 } finally {f.close();}
});
