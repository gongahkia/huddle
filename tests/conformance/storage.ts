import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {CollaborationError,type Create,type Detail,type Identity,type Scope,type Thread} from '../../packages/shared/src/collaboration';
import {ReviewStore,type Authorization,type Authorize} from '../../packages/host/src/store';
import type {Backend} from '../../packages/host/src/backend';

export type StorageFixture = {backend: Backend; cleanup(): Promise<void>};
export function storageConformance(name: string,fixture: () => Promise<StorageFixture>) {
  describe(`${name} core storage conformance`,() => {
    let f: StorageFixture, store: ReviewStore, peer: ReviewStore;
    const scope: Scope = {workspace: 'host:team/一',environment: 'preview'}, other = {...scope,workspace: 'other-team'};
    const alex: Identity = {id: 'host:user/42',name: 'Alex'}, morgan = {id: 'host:user/99',name: 'Morgan'};
    let allowed: boolean, author: Identity;
    const authorize: Authorize = async scope => {if (!allowed) throw new CollaborationError('forbidden','Internal users only.'); if (scope.workspace === 'denied') throw new CollaborationError('forbidden','Wrong workspace.'); return {actor: author,capabilities: {mentions: false,assignment: false,directory: false}};};
    const signal = () => new AbortController().signal;
    const input = (patch: Partial<Create> = {}): Create => ({idempotencyKey: crypto.randomUUID(),page: '/review',pageUrl: 'https://example.test/review',anchor: {kind: 'page',selector: 'body',label: 'This page',quote: '',x: .5,y: .5},body: 'Original 汉字 <script>untrusted</script>',...patch});
    const create = (patch: Partial<Create> = {}) => store.create(scope,input(patch),signal());
    beforeEach(async () => {f = await fixture(); allowed = true; author = alex; store = new ReviewStore(f.backend,authorize); peer = new ReviewStore(f.backend,async () => ({actor: morgan,capabilities: {mentions: false,assignment: false,directory: false}}));});
    afterEach(async () => {vi.useRealTimers(); await f.cleanup();});
    it('derives authorship from the host and isolates workspaces and environments',async () => {
      const saved = await create(); expect(saved.thread.createdBy).toEqual(alex); expect(saved.comments.items[0].author).toEqual(alex);
      expect((await store.list(other,{},signal())).items).toHaveLength(0); expect((await store.list({...scope,environment:'production'},{},signal())).items).toHaveLength(0);
      for (const selected of [other,{...scope,environment:'production'}]) await expect(store.detail(selected,saved.thread.id,{},signal())).rejects.toMatchObject({code:'not_found'});
      await expect(create({author: {id:'forged',name:'Forged'}} as Partial<Create>)).rejects.toMatchObject({code:'validation'});
    });
    it('persists palette choices across authors and rejects unsupported or arbitrary colors',async()=>{
      const colored=new ReviewStore(f.backend,async()=>({actor:author,capabilities:{mentions:false,assignment:false,directory:false,commentColors:true}})),request=input({color:'violet'}),saved=await colored.create(scope,request,signal());
      expect(saved.thread.color).toBe('violet');expect(saved.comments.items[0].color).toBe('violet');author=morgan;await colored.reply(scope,saved.thread.id,{idempotencyKey:'colored-reply',body:'A blue reply',color:'blue'},signal());const fresh=await colored.detail(scope,saved.thread.id,{},signal());expect(fresh.thread.color).toBe('violet');expect(fresh.comments.items.find(item=>item.body==='A blue reply')).toMatchObject({color:'blue',author:morgan});expect(fresh.comments.items.find(item=>item.id===saved.comments.items[0].id)?.color).toBe('violet');
      await expect(store.create(scope,input({color:'green'}),signal())).rejects.toMatchObject({code:'validation'});await expect(colored.create(scope,input({color:'url(https://foreign.test)' as never}),signal())).rejects.toMatchObject({code:'validation'});
      author=alex;await expect(colored.create(scope,{...request,color:'rose'},signal())).rejects.toMatchObject({code:'conflict'});
    });
    it('denies previously authorized reads, mutations and change polling after revocation',async () => {
      const saved = await create(); allowed = false;
      for (const run of [() => store.session(scope,signal()),() => store.list(scope,{},signal()),() => store.detail(scope,saved.thread.id,{},signal()),() => store.reply(scope,saved.thread.id,{idempotencyKey:'reply',body:'Denied'},signal()),() => store.changes(scope,undefined,signal())]) await expect(run()).rejects.toMatchObject({code:'forbidden'});
    });
    it('applies duplicate keys once under concurrency and rejects changed-payload reuse',async () => {
      const original = input(), results = await Promise.all(Array.from({length:12},() => store.create(scope,original,signal())));
      expect(new Set(results.map(result => result.thread.id)).size).toBe(1); expect((await store.list(scope,{},signal())).items).toHaveLength(1);
      await expect(store.create(scope,{...original,body:'Different'},signal())).rejects.toMatchObject({code:'conflict'});
      const detail = await store.detail(scope,results[0].thread.id,{},signal()); expect(detail.comments.items).toHaveLength(1); expect(detail.history.items).toHaveLength(1);
    });
    it('binds idempotency to scope, actor and operation rather than imposing global request IDs',async () => {
      const request = input({idempotencyKey:'shared-key'}), first = await store.create(scope,request,signal()), second = await peer.create(scope,request,signal()), third = await store.create(other,request,signal());
      expect(new Set([first.thread.id,second.thread.id,third.thread.id]).size).toBe(3);
      await store.reply(scope,first.thread.id,{idempotencyKey:'shared-key',body:'Different operation'},signal()); expect((await store.detail(scope,first.thread.id,{},signal())).thread.commentCount).toBe(2);
    });
    it('preserves concurrent independent replies and rejects overlapping coordination versions',async () => {
      const saved = await create();
      await Promise.all([store.reply(scope,saved.thread.id,{idempotencyKey:'alex-reply',body:'Alex reply'},signal()),peer.reply(scope,saved.thread.id,{idempotencyKey:'morgan-reply',body:'Morgan reply'},signal())]);
      const current = await store.detail(scope,saved.thread.id,{},signal()); expect(current.thread.commentCount).toBe(3); expect(new Set(current.comments.items.map(item => item.body))).toContain('Morgan reply');
      const result = await Promise.allSettled([store.update(scope,saved.thread.id,{idempotencyKey:'resolve',expectedVersion:current.thread.version,status:'resolved'},signal()),peer.update(scope,saved.thread.id,{idempotencyKey:'reopen',expectedVersion:current.thread.version,status:'open'},signal())]);
      expect(result.filter(item => item.status === 'fulfilled')).toHaveLength(1); expect(result.filter(item => item.status === 'rejected')).toHaveLength(1);
    });
    it('paginates complete replies and history beyond the old UI caps with bound cursors',async () => {
      const saved = await create();
      for (let index=0;index<260;index++) await store.reply(scope,saved.thread.id,{idempotencyKey:`reply-${index}`,body:`Reply ${index}`},signal());
      const seen = new Set<string>(), history = new Set<string>(); let commentsCursor: string | undefined, historyCursor: string | undefined;
      do {const page = await store.detail(scope,saved.thread.id,{commentsCursor,historyCursor,limit:37},signal()); for (const record of page.comments.items) seen.add(record.id); for (const record of page.history.items) history.add(record.id); commentsCursor = page.comments.nextCursor ?? undefined; historyCursor = page.history.nextCursor ?? undefined;} while (commentsCursor || historyCursor);
      expect(seen.size).toBe(261); expect(history.size).toBe(261);
      const page = await store.detail(scope,saved.thread.id,{limit:1},signal());
      await expect(store.detail(scope,saved.thread.id,{historyCursor:page.comments.nextCursor!},signal())).rejects.toMatchObject({code:'validation'});
    });
    it('uses deterministic list boundaries under timestamp ties and concurrent new discussions',async () => {
      vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const saved: Detail[] = []; for (let index=0;index<105;index++) saved.push(await create({body:`Thread ${index}`}));
      const first = await store.list(scope,{limit:17},signal()), seen = [...first.items]; vi.setSystemTime(new Date('2026-01-02T00:00:00Z')); await create({body:'Newer discussion'});
      let cursor = first.nextCursor;
      while (cursor) {const page = await store.list(scope,{limit:17,cursor},signal()); seen.push(...page.items); cursor = page.nextCursor;}
      expect(new Set(seen.map(item => item.id)).size).toBe(105); expect(new Set(seen.map(item => item.id))).toEqual(new Set(saved.map(item => item.thread.id)));
      await expect(store.list(other,{cursor:first.nextCursor!},signal())).rejects.toMatchObject({code:'validation'});
      await expect(store.list(scope,{cursor:first.nextCursor!,page:'/different'},signal())).rejects.toMatchObject({code:'validation'});
    });
    it('catches up bounded changes without dropping or repeating committed mutations',async () => {
      const baseline = await store.changes(scope,undefined,signal()); const saved = await create();
      for (let index=0;index<105;index++) await store.reply(scope,saved.thread.id,{idempotencyKey:`event-${index}`,body:'Next'},signal());
      const first = await store.changes(scope,baseline.cursor,signal()), second = await store.changes(scope,first.cursor,signal());
      expect(first.items).toHaveLength(100); expect(first.hasMore).toBe(true); expect(second.items).toHaveLength(6); expect(second.hasMore).toBe(false);
      expect((await store.changes(scope,second.cursor,signal())).items).toHaveLength(0);
      await expect(store.changes(other,first.cursor,signal())).rejects.toMatchObject({code:'validation'});
      await expect(store.changes(scope,first.cursor.slice(0,-2)+'XX',signal())).rejects.toMatchObject({code:'validation'});
    });
    it('rolls back feedback, retry ledger, audit and change records together on failure',async () => {
      const original = f.backend.transaction.bind(f.backend), request = input();
      const injected = vi.spyOn(f.backend,'transaction').mockImplementationOnce((scope,signal,run) => original(scope,signal,tx => run({...tx,put: async (collection,record,insert) => {if(collection === 'events') throw new Error('Injected internal failure'); return tx.put(collection,record,insert);}})));
      await expect(store.create(scope,request,signal())).rejects.toMatchObject({code:'unavailable'}); expect((await store.list(scope,{},signal())).items).toHaveLength(0);
      injected.mockRestore(); const saved = await store.create(scope,request,signal()); expect(saved.comments.items).toHaveLength(1); expect(saved.history.items).toHaveLength(1);
    });
    it('holds a consistent snapshot while a separate transaction commits new discussion',async () => {
      const saved = await create();
      await f.backend.snapshot(signal(),async tx => {
        const before = await tx.get<Thread>('threads',scope,saved.thread.id);
        await peer.reply(scope,saved.thread.id,{idempotencyKey:'during-snapshot',body:'Concurrent'},signal());
        const after = await tx.get<Thread>('threads',scope,saved.thread.id); expect(after?.data.commentCount).toBe(before?.data.commentCount);
      });
      expect((await store.detail(scope,saved.thread.id,{},signal())).thread.commentCount).toBe(2);
    });
    it('treats SQL metacharacters as data and rejects unsafe or over-complex mutation inputs',async () => {
      const saved = await create({body:"'; DROP TABLE huddle_threads; --",page:"/x' OR 1=1 --"}); expect(saved.comments.items[0].body).toContain('DROP TABLE');
      expect((await store.list(scope,{page:'/unrelated'},signal())).items).toHaveLength(0);
      await expect(create({pageUrl:'javascript:alert(1)'})).rejects.toMatchObject({code:'validation'});
      await expect(create({mentions:['not-supported']})).rejects.toMatchObject({code:'validation'});
      await expect(create({viewContext:{large:'x'.repeat(9000)}})).rejects.toMatchObject({code:'validation'});
      const cyclic: Record<string,unknown> = {}; cyclic.self = cyclic; await expect(create({viewContext:cyclic} as Partial<Create>)).rejects.toMatchObject({code:'validation'});
    });
    it('uses host-approved directory identities for optional mentions and assignment',async () => {
      const authorizeAll = async (): Promise<Authorization> => ({actor:alex,capabilities:{mentions:true,assignment:true,directory:true}});
      const directory = {lookup: async (_scope: Scope,ids: string[]) => [alex,morgan].filter(item => ids.includes(item.id)),list: async () => ({items:[alex,morgan],nextCursor:null})};
      const supported = new ReviewStore(f.backend,authorizeAll,directory), saved = await supported.create(scope,input({mentions:[morgan.id]}),signal());
      expect(saved.comments.items[0].mentions).toEqual([morgan]);
      const assigned = await supported.update(scope,saved.thread.id,{idempotencyKey:'assign',expectedVersion:1,assigneeId:morgan.id},signal()); expect(assigned.thread.assignee).toEqual(morgan);
      await expect(supported.reply(scope,saved.thread.id,{idempotencyKey:'unknown',body:'Bad',mentions:['unknown']},signal())).rejects.toMatchObject({code:'validation'});
    });
    it('validates live directory pages before exposing extra account fields or stranded results',async () => {
      let items:Identity[] = [alex]; const memberStore = new ReviewStore(f.backend,async () => ({actor:alex,capabilities:{mentions:true,assignment:true,directory:true}}),{lookup:async () => [alex],list:async () => ({items,nextCursor:'x'.repeat(1024)})});
      expect((await memberStore.directory(scope,{},signal())).nextCursor).toHaveLength(1024); items = [{...alex,password:'fixture-secret'} as Identity]; await expect(memberStore.directory(scope,{},signal())).rejects.toMatchObject({code:'validation'}); items = [alex,alex]; await expect(memberStore.directory(scope,{},signal())).rejects.toMatchObject({code:'validation'}); items = Array.from({length:101},(_,index) => ({id:`host:${index}`,name:'Member'})); await expect(memberStore.directory(scope,{},signal())).rejects.toMatchObject({code:'validation'});
    });
    it('aborts pre-cancelled operations without touching feedback storage',async () => {
      const controller = new AbortController(); controller.abort(); await expect(store.create(scope,input(),controller.signal)).rejects.toMatchObject({name:'AbortError'});
      expect((await store.list(scope,{},signal())).items).toHaveLength(0);
    });
    it('rejects cross-scope operations inside a scoped write transaction',async () => {
      await expect(f.backend.transaction(scope,signal(),async tx => tx.get('threads',other,'guessed-id'))).rejects.toMatchObject({code:'forbidden'});
      await expect(f.backend.transaction(scope,signal(),async tx => tx.put('threads',{...other,id:'guessed-id',time:'',data:{}},true))).rejects.toMatchObject({code:'forbidden'});
    });
    it('uses workspace and environment as scope identity when a row carries additional metadata',async () => {
      const saved = await create(), extended = {...scope,id:'extra-id',time:'extra-time',data:{unrelated:true}};
      expect((await f.backend.snapshot(signal(),tx => tx.get<Thread>('threads',extended,saved.thread.id)))?.data.id).toBe(saved.thread.id);
      expect((await f.backend.snapshot(signal(),tx => tx.scan('threads',extended,{limit:10})))).toHaveLength(1);
    });
    it('removes only scoped temporary records and rolls cleanup back with a failed transaction',async () => {
      const saved = await create(), row = {...scope,id:'temporary',time:'',actorId:alex.id,expiresAt:0,data:{private:'fixture'}};
      await f.backend.transaction(scope,signal(),tx => tx.put('uploads',row,true));
      await expect(f.backend.transaction(other,signal(),tx => tx.remove('uploads',scope,row.id))).rejects.toMatchObject({code:'forbidden'});
      await expect(f.backend.transaction(scope,signal(),async tx => {await tx.remove('uploads',scope,row.id); throw new Error('Rollback cleanup');})).rejects.toBeDefined();
      expect(await f.backend.snapshot(signal(),tx => tx.get('uploads',scope,row.id))).toBeDefined();
      await f.backend.transaction(scope,signal(),tx => tx.remove('uploads',scope,row.id)); expect(await f.backend.snapshot(signal(),tx => tx.get('uploads',scope,row.id))).toBeUndefined();
      await expect(f.backend.transaction(scope,signal(),tx => tx.remove('threads' as 'uploads',scope,saved.thread.id))).rejects.toMatchObject({code:'validation'}); expect((await store.detail(scope,saved.thread.id,{},signal())).thread.id).toBe(saved.thread.id);
    });
    it('cancels a host authorization callback that ignores its abort signal',async () => {
      const blocked = new ReviewStore(f.backend,async () => new Promise(() => {})), controller = new AbortController();
      const rejected = expect(blocked.session(scope,controller.signal)).rejects.toMatchObject({name:'AbortError'}); controller.abort(); await rejected;
    });
    it('expires only unpublished import children and filters staging by its deadline',async () => {
      const saved = await create(), expired = {...scope,id:'orphan',time:'',threadId:'unfinished',status:'importing',expiresAt:0,data:{}};
      await f.backend.transaction(scope,signal(),async tx => {
        await tx.put('comments',expired,true);
        await tx.put('comments',{...expired,id:'published',threadId:saved.thread.id},true);
        await tx.put('history',{...expired,id:'future',expiresAt:Date.now()+60000},true);
      });
      expect((await f.backend.snapshot(signal(),tx => tx.scan('comments',scope,{expiresBefore:Date.now(),limit:10}))).map(row => row.id).sort()).toEqual(['orphan','published']);
      await expect(f.backend.transaction(scope,signal(),tx => tx.remove('comments',scope,'published'))).rejects.toMatchObject({code:'validation'});
      await expect(f.backend.transaction(scope,signal(),tx => tx.remove('history',scope,'future'))).rejects.toMatchObject({code:'validation'});
      await f.backend.transaction(scope,signal(),tx => tx.remove('comments',scope,'orphan'));
      expect(await f.backend.snapshot(signal(),tx => tx.get('comments',scope,'orphan'))).toBeUndefined();
    });
  });
}
