import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {CollaborationError,type Scope} from '../../packages/shared/src/collaboration';
import {ReviewStore,type Authorize} from '../../packages/host/src/store';
import type {StorageFixture} from './storage';
import {transferContent} from '../fixtures/transfer-content';

import {emptyMapping,finishImport,portableFixture,snapshot,uploadBytes} from '../fixtures/portable';
export {emptyMapping,finishImport,portableFixture,snapshot,uploadBytes} from '../fixtures/portable';
export function importConformance(name:string,fixture:() => Promise<StorageFixture>) {
  describe(`${name} portable import conformance`,() => {
    let f:StorageFixture, store:ReviewStore, allowed:boolean, deniedEnvironment:string | undefined;
    const scope:Scope = {workspace:'destination',environment:'preview'}, actor = {id:'host:alex',name:'Live Alex'}, signal = () => new AbortController().signal;
    const authorize:Authorize = async selected => {if(!allowed || selected.environment === deniedEnvironment) throw new CollaborationError('forbidden','Internal users only.'); return {actor,capabilities:{mentions:false,assignment:false,directory:false}};};
    beforeEach(async () => {f = await fixture(); allowed = true; deniedEnvironment = undefined; store = new ReviewStore(f.backend,authorize,undefined,{batchSize:2});});
    afterEach(async () => {vi.useRealTimers(); await f.cleanup();});
    const prepare = async (data = portableFixture(),mapping = emptyMapping()) => {const upload = await store.stageImport(scope,uploadBytes(data),signal()), preview = await store.previewImport(scope,{...upload,mapping},signal()); return {upload,preview,input:{previewId:preview.id,digest:preview.digest,idempotencyKey:crypto.randomUUID()}};};
    it('previews without discussion writes, publishes bounded batches and preserves complete historical content',async () => {
      const source = portableFixture(), baseline = await store.changes(scope,undefined,signal()), {preview,input} = await prepare(source); expect(preview.counts).toEqual(source.counts); expect(preview.conflicts).toEqual([]); expect(preview.historicalAuthors.map(item => item.name)).toContain('Alex 历史 <script>');
      expect((await store.list(scope,{},signal())).items).toEqual([]); const first = await store.executeImport(scope,input,signal()); expect(first.processed).toEqual({threads:0,comments:2,history:0}); expect(first.state).toBe('running'); expect((await store.list(scope,{},signal())).items).toEqual([]);
      const done = await finishImport(store,scope,input,signal()); expect(done.state).toBe('complete'); expect(done.processed).toEqual(source.counts); expect(await store.importProgress(scope,done.id,signal())).toEqual(done);
      const result = await snapshot(store,scope.workspace,['preview','production'],signal()); expect(result.counts).toEqual(source.counts);
      for(const item of source.comments) {const saved = result.comments.find(value => value.provenance?.recordId === item.id)!; const {id:_id,threadId:_threadId,...content} = item; expect(saved).toMatchObject(content); expect(saved.author.provenance?.identity).toEqual(item.author); expect(saved.provenance).toMatchObject({datasetId:source.datasetId,recordId:item.id});}
      expect(transferContent(result,true).threads.find(item => item.id === source.threads[1].id)).toMatchObject({...source.threads[1],workspace:scope.workspace});
      const changes = await store.changes(scope,baseline.cursor,signal()); expect(changes.items).toHaveLength(2); expect(changes.items.every(item => item.kind === 'imported')).toBe(true);
    });
    it('repeats the same file without duplicating records or overwriting later destination activity',async () => {
      const source = portableFixture(), {input} = await prepare(source); await finishImport(store,scope,input,signal());
      const thread = source.threads[0], savedId = (await snapshot(store,scope.workspace,['preview','production'],signal())).threads.find(item => item.provenance?.recordId === thread.id)!.id; await store.reply(scope,savedId,{body:'Destination activity',idempotencyKey:'later'},signal()); const detail = await store.detail(scope,savedId,{},signal()); await store.update(scope,savedId,{idempotencyKey:'resolve',expectedVersion:detail.thread.version,status:'resolved'},signal());
      const repeated = await prepare(source); expect(repeated.preview.conflicts).toEqual([]); expect((await finishImport(store,scope,repeated.input,signal())).state).toBe('complete'); expect((await store.detail(scope,savedId,{},signal())).thread).toMatchObject({commentCount:thread.commentCount+1,status:'resolved'});
      const result = await snapshot(store,scope.workspace,['preview','production'],signal()); expect(result.counts).toEqual({threads:source.counts.threads,comments:source.counts.comments+1,history:source.counts.history+2});
    });
    it('binds upload, preview, actor, digest and execute keys and rechecks every destination scope',async () => {
      const {upload,preview,input} = await prepare();
      await expect(store.previewImport(scope,{...upload,digest:'0'.repeat(64),mapping:emptyMapping()},signal())).rejects.toMatchObject({code:'conflict'});
      const other = new ReviewStore(f.backend,async () => ({actor:{id:'host:other',name:'Other'},capabilities:{mentions:false,assignment:false,directory:false}}));
      await expect(other.previewImport(scope,{...upload,mapping:emptyMapping()},signal())).rejects.toMatchObject({code:'not_found'});
      await expect(store.executeImport(scope,{...input,digest:'0'.repeat(64)},signal())).rejects.toMatchObject({code:'conflict'});
      const first = await store.executeImport(scope,input,signal()); deniedEnvironment = 'production';
      await expect(store.importProgress(scope,first.id,signal())).rejects.toMatchObject({code:'forbidden'}); await expect(store.executeImport(scope,input,signal())).rejects.toMatchObject({code:'forbidden'}); deniedEnvironment = undefined;
      const changed = await store.previewImport(scope,{...upload,mapping:{...emptyMapping(),originMap:{'https://old.test':'https://new.test'}}},signal());
      await expect(store.executeImport(scope,{...input,previewId:changed.id},signal())).rejects.toMatchObject({code:'conflict'});
      allowed = false; await expect(store.previewImport(scope,{...upload,mapping:emptyMapping()},signal())).rejects.toMatchObject({code:'forbidden'}); expect(preview.scope).toEqual(scope);
    });
    it('rolls back a failed batch, resumes acknowledged progress and tolerates a lost commit response',async () => {
      const {input} = await prepare(), original = f.backend.transaction.bind(f.backend);
      let fail = true; const injected = vi.spyOn(f.backend,'transaction').mockImplementation((selected,signal,run) => original(selected,signal,tx => run({...tx,put:async (collection,row,insert) => {if(collection === 'provenance' && fail) {fail = false; throw new Error('Injected storage fault');} return tx.put(collection,row,insert);}})));
      await expect(store.executeImport(scope,input,signal())).rejects.toMatchObject({code:'unavailable'}); injected.mockRestore();
      const rows = await f.backend.snapshot(signal(),tx => tx.scan('comments',scope,{limit:10})); expect(rows).toEqual([]);
      let lost = true; const committed = vi.spyOn(f.backend,'transaction').mockImplementation(async (selected,signal,run) => {const value = await original(selected,signal,run); if(lost && value === true) {lost = false; throw new CollaborationError('unavailable','Lost response after commit');} return value;});
      await expect(store.executeImport(scope,input,signal())).rejects.toMatchObject({code:'unavailable'}); committed.mockRestore();
      expect((await finishImport(store,scope,input,signal())).state).toBe('complete'); expect((await snapshot(store,scope.workspace,['preview','production'],signal())).counts).toEqual(portableFixture().counts);
    });
    it('reports changed provenance and unrelated ID collisions without overwriting destination records',async () => {
      const source = portableFixture(), prepared = await prepare(source); await finishImport(store,scope,prepared.input,signal());
      source.comments[0].body = 'Changed source'; source.threads[0].latestComment = source.comments[4]; const changed = await prepare(source); expect(changed.preview.conflicts.map(item => item.recordId)).toContain(source.comments[0].id); const failed = await finishImport(store,scope,changed.input,signal()); expect(failed.state).toBe('failed'); expect(failed.rejected[0].recordId).toBe(source.comments[0].id);
      const existingId = (await snapshot(store,scope.workspace,['preview','production'],signal())).comments.find(item => item.provenance?.recordId === source.comments[0].id)!.id; const unrelated = portableFixture(); unrelated.datasetId = 'unrelated'; unrelated.comments[0].id = existingId; const collision = await prepare(unrelated); expect(collision.preview.conflicts.length).toBeGreaterThan(0); expect((await finishImport(store,scope,collision.input,signal())).state).toBe('failed');
      expect((await snapshot(store,scope.workspace,['preview','production'],signal())).comments.find(item => item.id === existingId)!.body).not.toBe('Changed source');
    });
    it('maps explicit origins, environments and host-approved identities while retaining source provenance',async () => {
      const directory = {lookup:async (_scope:Scope,ids:string[]) => ids.includes(actor.id) ? [actor] : [],list:async () => ({items:[actor],nextCursor:null})}; store = new ReviewStore(f.backend,authorize,directory,{batchSize:2});
      const source = portableFixture(), mapping = {...emptyMapping(),originMap:{'https://old.test':'https://destination.test'},environmentMap:{preview:'review',production:'review'},identityMap:{'historical:alex':actor.id}}, {preview,input} = await prepare(source,mapping); expect(preview.conflicts).toEqual([]); expect((await finishImport(store,scope,input,signal())).state).toBe('complete');
      const result = await snapshot(store,scope.workspace,['review'],signal()), thread = result.threads.find(item => item.provenance?.recordId === source.threads[0].id)!;
      expect(thread.createdBy).toMatchObject({...actor,provenance:{identity:source.threads[0].createdBy}}); expect(thread.assignee?.id).toBe('historical:morgan'); expect(thread.pageUrl).toBe('https://destination.test/review?q=%E6%B1%89%E5%AD%97#pin'); expect(thread.page).toBe('https://destination.test/review?q=汉字'); expect(thread.provenance).toMatchObject({scope:{workspace:'source',environment:'preview'},pageUrl:source.threads[0].pageUrl});
      await expect(prepare(source,{...mapping,identityMap:{'historical:alex':'unknown'}})).rejects.toMatchObject({code:'validation'});
      for(const origin of ['javascript:alert(1)','https://destination.test/path','https://user:password@destination.test']) await expect(prepare(source,{...emptyMapping(),originMap:{'https://old.test':origin}})).rejects.toMatchObject({code:'validation'});
    });
    it('rejects incomplete, unsafe, malformed and over-limit uploads before discussion writes',async () => {
      const source = portableFixture(); for(const value of [JSON.stringify(source).slice(0,-1),JSON.stringify({...source,complete:false}),JSON.stringify({...source,counts:{...source.counts,threads:999}}),'{}','{"x":"'+String.fromCharCode(0)+'"}']) await expect(store.stageImport(scope,uploadBytes(value),signal())).rejects.toMatchObject({code:'validation'});
      const limited = new ReviewStore(f.backend,authorize,undefined,{limits:{maxBytes:100}}); await expect(limited.stageImport(scope,uploadBytes(source),signal())).rejects.toMatchObject({code:'validation'});
      source.threads[0].viewContext = {tooManyNodes:Array.from({length:10001},() => 1)}; await expect(store.stageImport(scope,uploadBytes(source),signal())).rejects.toMatchObject({code:'validation'});
      await expect(store.stageImport(scope,(async function*() {yield new Uint8Array([0xff,0xff]);})(),signal())).rejects.toMatchObject({code:'validation'}); expect((await store.list(scope,{},signal())).items).toEqual([]);
    });
    it('expires and cleans staging without deleting published feedback or another actor’s staging',async () => {
      store = new ReviewStore(f.backend,authorize,undefined,{batchSize:2,ttlMs:60000}); const first = await prepare(); await finishImport(store,scope,first.input,signal());
      const second = portableFixture(); second.datasetId = 'unfinished'; for(const item of second.threads) item.id += ':unfinished'; for(const item of [...second.comments,...second.history]) {item.id += ':unfinished'; item.threadId += ':unfinished';} for(const item of second.threads) if(item.latestComment) {item.latestComment = second.comments.find(comment => comment.threadId === item.id && comment.id.startsWith(item.latestComment!.id))!;}
      const partial = await prepare(second); const pending = await store.executeImport(scope,partial.input,signal()); const rows = await f.backend.snapshot(signal(),tx => tx.scan('comments',scope,{status:'importing',limit:50})); expect(rows.length).toBeGreaterThan(2);
      await f.backend.transaction(scope,signal(),tx => tx.put('uploads',{...scope,id:'other-private',time:'',actorId:'other',expiresAt:0,data:'private'},true));
      vi.spyOn(Date,'now').mockReturnValue(Date.now()+120000);
      await expect(store.importProgress(scope,pending.id,signal())).rejects.toMatchObject({code:'not_found'}); let cleaned = 0; for(let index=0;index<100;index++) {const result = await store.cleanupImports(scope,signal(),2); cleaned += result.removed; if(!result.removed && !result.retained) break;} expect(cleaned).toBeGreaterThan(0);
      expect((await snapshot(store,scope.workspace,['preview','production'],signal())).counts).toEqual(portableFixture().counts); expect(await f.backend.snapshot(signal(),tx => tx.get('uploads',scope,'other-private'))).toBeDefined(); expect((await f.backend.snapshot(signal(),tx => tx.scan('comments',scope,{status:'importing',limit:100})))).toEqual([]); vi.restoreAllMocks();
      const retry = await prepare(second); expect((await finishImport(store,scope,retry.input,signal())).state).toBe('complete');
    });
    it('cancels stalled upload iteration and does not seal incomplete staging',async () => {
      const controller = new AbortController(); let returned = false; const chunks:AsyncIterable<Uint8Array> = {[Symbol.asyncIterator]:() => ({next:() => new Promise(() => {}),return:async () => {returned = true; return {done:true,value:undefined};}})};
      const result = expect(store.stageImport(scope,chunks,controller.signal)).rejects.toMatchObject({name:'AbortError'}); await new Promise(resolve => setTimeout(resolve,10)); controller.abort(); await result; expect(returned).toBe(true);
    });
    it('retains validation errors when a custom upload iterator throws during cleanup',async () => {
      const limited = new ReviewStore(f.backend,authorize,undefined,{limits:{maxBytes:1}}), chunks:AsyncIterable<Uint8Array> = {[Symbol.asyncIterator]:() => ({next:async () => ({done:false,value:new Uint8Array(2)}),return:() => {throw new Error('Private fixture iterator failure');}})};
      await expect(limited.stageImport(scope,chunks,signal())).rejects.toMatchObject({code:'validation'});
    });
    it('keeps timestamp offsets and future imported activity ordered during a new live reply',async () => {
      const source = portableFixture(1,2); source.comments[0].createdAt = '2099-01-01T12:00:00+08:00'; source.comments[1].createdAt = '2099-01-01T05:00:00Z'; source.threads[0].latestComment = source.comments[1]; source.threads[0].updatedAt = source.comments[1].createdAt;
      const {input} = await prepare(source); expect((await finishImport(store,scope,input,signal())).state).toBe('complete'); const savedId = (await store.list(scope,{},signal())).items[0].id; const result = await store.reply(scope,savedId,{idempotencyKey:'present-day',body:'Present day'},signal()); expect(result.thread.latestComment?.provenance?.recordId).toBe(source.comments[1].id); expect(result.thread.updatedAt).toBe(source.threads[0].updatedAt); const exported = await snapshot(store,scope.workspace,['preview','production'],signal()); expect(exported.comments.find(item => item.provenance?.recordId === source.comments[0].id)?.createdAt).toBe(source.comments[0].createdAt);
    });
    it('copies a source into two environments with unambiguous destination IDs and complete references',async () => {
      const source = portableFixture(1,2), first = await prepare(source); expect((await finishImport(store,scope,first.input,signal())).state).toBe('complete');
      const second = await prepare(source,{...emptyMapping(),environmentMap:{preview:'production'}}); expect(second.preview.conflicts).toEqual([]); expect((await finishImport(store,scope,second.input,signal())).state).toBe('complete');
      const result = await snapshot(store,scope.workspace,['preview','production'],signal()); expect(result.counts).toEqual({threads:2,comments:4,history:2}); expect(new Set(result.threads.map(item => item.id)).size).toBe(2); expect(result.threads.every(item => item.provenance?.recordId === source.threads[0].id)).toBe(true);
      for(const thread of result.threads) expect(result.comments.filter(item => item.threadId === thread.id)).toHaveLength(2);
    });
    it('recomputes tied latest-comment summaries using actual destination IDs',async () => {
      const source = portableFixture(1,2); source.comments[0].createdAt = source.comments[1].createdAt; const {input} = await prepare(source); expect((await finishImport(store,scope,input,signal())).state).toBe('complete');
      const result = await snapshot(store,scope.workspace,['preview','production'],signal()), expected = result.comments.reduce((a,b) => a.id > b.id ? a : b); expect(result.threads[0].latestComment).toEqual(expected); expect(result.comments.map(item => item.provenance?.recordId).sort()).toEqual(source.comments.map(item => item.id).sort());
    });
  });
}
