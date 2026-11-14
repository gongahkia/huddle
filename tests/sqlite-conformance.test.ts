import {mkdtemp,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {expect,it} from 'vitest';
import {installSqlite,SqliteBackend} from '../packages/host/src/sqlite';
import {ReviewStore} from '../packages/host/src/store';
import {storageConformance} from './conformance/storage';

storageConformance('SQLite',async () => {
  const directory = await mkdtemp(join(tmpdir(),'huddle-sqlite-v2-')), path = join(directory,'feedback.sqlite'); installSqlite(path);
  const backend = new SqliteBackend(path);
  return {backend,async cleanup() {await backend.close(); await rm(directory,{recursive:true,force:true});}};
});
it('requires explicit installation and preserves metadata/discussion across reopen and repeated setup',async () => {
  const directory = await mkdtemp(join(tmpdir(),'huddle-sqlite-install-')), path = join(directory,'feedback.sqlite'); let backend: SqliteBackend | undefined;
  try {
    expect(() => new SqliteBackend(path)).toThrow('explicitly'); installSqlite(path); expect((await stat(path)).mode & 0o777).toBe(0o600); backend = new SqliteBackend(path); const dataset = backend.datasetId, secret = backend.cursorSecret;
    const store = new ReviewStore(backend,async () => ({actor:{id:'host:user',name:'Alex'},capabilities:{mentions:false,assignment:false,directory:false}}));
    const scope = {workspace:'team',environment:'preview'}, signal = new AbortController().signal;
    const saved = await store.create(scope,{idempotencyKey:'persisted',page:'/',pageUrl:'https://example.test/',anchor:{kind:'page',selector:'body',label:'Page',quote:'',x:0,y:0},body:'Persisted'},signal);
    await backend.close(); backend = undefined; installSqlite(path); backend = new SqliteBackend(path); expect(backend.datasetId).toBe(dataset); expect(backend.cursorSecret).toBe(secret);
    const reopened = new ReviewStore(backend,async () => ({actor:{id:'host:user',name:'Alex'},capabilities:{mentions:false,assignment:false,directory:false}})); expect((await reopened.detail(scope,saved.thread.id,{},signal)).comments.items[0].body).toBe('Persisted');
  } finally {await backend?.close(); await rm(directory,{recursive:true,force:true});}
});
it('cancels queued writes and open snapshots and releases task-owned connections',async () => {
  const directory = await mkdtemp(join(tmpdir(),'huddle-sqlite-cancel-')), path = join(directory,'feedback.sqlite'); installSqlite(path); const backend = new SqliteBackend(path), scope = {workspace:'team',environment:'test'};
  try {
    let release: () => void = () => {}; const blocker = new Promise<void>(resolve => {release = resolve;});
    const first = backend.transaction(scope,new AbortController().signal,async () => {await blocker;});
    let ran = false; const controller = new AbortController(), queued = expect(backend.transaction(scope,controller.signal,async () => {ran = true;})).rejects.toMatchObject({name:'AbortError'}); controller.abort(); await queued; release(); await first;
    await backend.transaction(scope,new AbortController().signal,async () => {}); expect(ran).toBe(false);
    const pending = expect(backend.snapshot(new AbortController().signal,async () => new Promise(() => {}))).rejects.toMatchObject({code:'unavailable'}); await backend.close(); await pending; await backend.close();
  } finally {await backend.close(); await rm(directory,{recursive:true,force:true});}
});
