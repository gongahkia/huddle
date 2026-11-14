import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ReviewStore,CollaborationError} from '../../packages/host/src/store';
import {parseFeedbackSnapshot} from '../../packages/shared/src/portable';
import type {Create,Download,Thread} from '../../packages/shared/src/collaboration';
import type {StorageFixture} from './storage';
export async function downloadText(download: Download) {let text = ''; const decoder = new TextDecoder(); for await(const chunk of download.chunks) text += decoder.decode(chunk,{stream:true}); return text+decoder.decode();}
export function exportConformance(name: string,fixture: () => Promise<StorageFixture>) {
  describe(name+' snapshot exports',() => {
    let f: StorageFixture, store: ReviewStore, allowed: boolean;
    const scope = {workspace:'team',environment:'preview'}, production = {...scope,environment:'production'}, signal = () => new AbortController().signal;
    const input = (patch: Partial<Create> = {}): Create => ({idempotencyKey:crypto.randomUUID(),page:'/review',pageUrl:'https://example.test/review',release:'release-1',viewContext:{tab:'details'},anchor:{kind:'page',selector:'body',label:'Page <unsafe>',quote:'',x:0,y:0},body:'Original <script>plain text</script> 汉字 &copy;',...patch});
    beforeEach(async () => {f = await fixture(); allowed = true; store = new ReviewStore(f.backend,async selected => {if(!allowed || selected.workspace !== 'team' || !['preview','production'].includes(selected.environment)) throw new CollaborationError('forbidden','Denied'); return {actor:{id:'host:alex',name:'Alex'},capabilities:{mentions:false,assignment:false,directory:false}};});});
    afterEach(async () => {vi.restoreAllMocks(); await f.cleanup();});
    it('exports complete JSON/Markdown beyond display limits across environments, including resolved threads',async () => {
      const saved = await store.create(scope,input(),signal());
      for(let index=0;index<105;index++) await store.create(scope,input({body:'Thread '+index,page:index % 2 ? '/other' : '/review'}),signal());
      for(let index=0;index<105;index++) await store.reply(scope,saved.thread.id,{idempotencyKey:'reply-'+index,body:'Reply '+index},signal());
      await store.update(scope,saved.thread.id,{idempotencyKey:'resolve',expectedVersion:106,status:'resolved'},signal()); await store.create(production,input({body:'Production'}),signal());
      const selection = {workspace:'team',environments:['preview','production']}, json = await downloadText(await store.export(selection,'json',signal())), parsed = parseFeedbackSnapshot(json);
      expect(parsed.counts).toEqual({threads:107,comments:212,history:213}); expect(parsed.threads.find(item => item.id === saved.thread.id)).toMatchObject({status:'resolved',release:'release-1',viewContext:{tab:'details'},commentCount:106}); expect(json).not.toContain('cursor_secret'); expect(json.trim()).toMatch(/"complete":true\}$/);
      const markdown = await downloadText(await store.export(selection,'markdown',signal())); expect(markdown).toContain('107 threads'); expect(markdown).toContain('Reply 104'); expect(markdown).toContain('\\<script\\>'); expect(markdown).toContain('\\&copy;'); expect(markdown).toContain('release\\-1');
      const filtered = parseFeedbackSnapshot(await downloadText(await store.export({workspace:'team',environments:['preview'],page:'/review',status:'resolved'},'json',signal()))); expect(filtered.counts.threads).toBe(1); expect(filtered.threads[0].id).toBe(saved.thread.id);
    });
    it('holds one snapshot through concurrent writes and closes it after complete delivery',async () => {
      const saved = await store.create(scope,input(),signal()), iterator = (await store.export({workspace:'team',environments:['preview']},'json',signal())).chunks[Symbol.asyncIterator]();
      const first = await iterator.next(); expect(first.done).toBe(false); await store.reply(scope,saved.thread.id,{idempotencyKey:'concurrent',body:'Later'},signal());
      let json = new TextDecoder().decode(first.value); for(let part=await iterator.next();!part.done;part=await iterator.next()) json += new TextDecoder().decode(part.value);
      const exported = parseFeedbackSnapshot(json); expect(exported.counts.comments).toBe(1); expect((await store.detail(scope,saved.thread.id,{},signal())).thread.commentCount).toBe(2);
    });
    it('denies any unauthorized environment before starting and ends a revoked live export',async () => {
      await store.create(scope,input(),signal()); await expect(store.export({workspace:'team',environments:['preview','denied']},'json',signal())).rejects.toMatchObject({code:'forbidden'});
      const iterator = (await store.export({workspace:'team',environments:['preview']},'json',signal())).chunks[Symbol.asyncIterator](); const first = await iterator.next(); allowed = false; await expect(iterator.next()).rejects.toMatchObject({code:'forbidden'}); expect(() => parseFeedbackSnapshot(new TextDecoder().decode(first.value))).toThrow();
    });
    it('cancels/returns unfinished exports and never emits completeness when the snapshot fails',async () => {
      await store.create(scope,input(),signal()); const controller = new AbortController(), iterator = (await store.export({workspace:'team',environments:['preview']},'json',controller.signal)).chunks[Symbol.asyncIterator](); const first = await iterator.next(); controller.abort(); await expect(iterator.next()).rejects.toMatchObject({name:'AbortError'}); expect(() => parseFeedbackSnapshot(new TextDecoder().decode(first.value))).toThrow();
      const original = f.backend.snapshot.bind(f.backend); vi.spyOn(f.backend,'snapshot').mockImplementationOnce((signal,run) => original(signal,async tx => {await run(tx); throw new Error('Failed snapshot completion');})); let partial = '';
      await expect((async () => {for await(const chunk of (await store.export({workspace:'team',environments:['preview']},'json',signal())).chunks) partial += new TextDecoder().decode(chunk);})()).rejects.toMatchObject({code:'unavailable'}); expect(partial).not.toContain('"complete":true'); expect(() => parseFeedbackSnapshot(partial)).toThrow();
      const returned = (await store.export({workspace:'team',environments:['preview']},'json',signal())).chunks[Symbol.asyncIterator](); await returned.next(); await returned.return?.(); await f.backend.close();
    });
    it('rejects corrupt thread summaries instead of labelling a partial dataset complete',async () => {
      const saved = await store.create(scope,input(),signal()); await f.backend.transaction(scope,signal(),async tx => {const row = await tx.get<Thread>('threads',scope,saved.thread.id); await tx.put('threads',{...row!,data:{...row!.data,commentCount:99}},false);});
      await expect(downloadText(await store.export({workspace:'team',environments:['preview']},'json',signal()))).rejects.toMatchObject({code:'unavailable'});
    });
    it('rejects ambiguous cross-environment IDs before emitting a complete snapshot',async () => {
      const saved = await store.create(scope,input(),signal()); await f.backend.transaction(production,signal(),tx => tx.put('threads',{...production,id:saved.thread.id,time:saved.thread.updatedAt,data:{...saved.thread,...production}},true));
      await expect(downloadText(await store.export({workspace:'team',environments:['preview','production']},'json',signal()))).rejects.toMatchObject({code:'unavailable'});
    });
  });
}
