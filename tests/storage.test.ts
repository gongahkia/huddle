// @vitest-environment jsdom
import {beforeEach, expect, it, vi} from 'vitest';
import {LocalStore, MemoryStorage, remainderAfterSave, requestTracker, STORAGE_LIMIT} from '../packages/browser/src/storage';
beforeEach(() => localStorage.clear());
it('keeps a newer memory draft after quota failure across store instances',() => {
 const memory = new MemoryStorage(), base = new MemoryStorage(); new LocalStore('scope',base,memory).write('draft','old');
 const storage = {get length() {return base.length;},key: base.key.bind(base),getItem: base.getItem.bind(base),removeItem: base.removeItem.bind(base),clear: base.clear.bind(base),setItem() {throw new Error('Quota');}};
 new LocalStore('scope',storage,memory).write('draft','new');
 expect(new LocalStore('scope',storage,memory).read('draft')).toBe('new');
});
it('forgets in-memory retry content without deleting the persisted uncertain-write key',() => {
 const store = new LocalStore('retry'), tracker = requestTracker(() => ({store,key:'request'})), id = tracker.idFor({body:'pending'}); tracker.forget();
 expect(requestTracker(() => ({store,key:'request'})).idFor({body:'pending'})).toBe(id);
});
it('isolates users/projects/pages and preserves a newer draft', () => {const a = new LocalStore('user:project:page'), b = new LocalStore('other:project:page'); a.write('draft', 'hello'); expect(b.read('draft')).toBeNull(); a.write('draft', 'newer'); a.remove('draft', 'hello'); expect(a.read('draft')).toBe('newer'); a.remove('draft', 'newer'); expect(a.read('draft')).toBeNull();});
it('expires and tolerates invalid storage', () => {const store = new LocalStore('x'); store.write('draft', 'hello'); vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 15 * 86400000); expect(store.read('draft')).toBeNull(); vi.restoreAllMocks(); expect(new LocalStore('x', null).read('draft')).toBeNull();});
it('bounds total owned persistence without deleting host data', () => {localStorage.setItem('host', 'keep'); const a = new LocalStore('a'), b = new LocalStore('b'); for (let i = 0; i < 30; i++) (i % 2 ? a : b).write(`draft${i}`, 'x'.repeat(50000)); let bytes = 0; for (let i = 0; i < localStorage.length; i++) {const key = localStorage.key(i)!; if (key.startsWith('huddle:')) bytes += (key.length + localStorage.getItem(key)!.length) * 2;} expect(bytes).toBeLessThanOrEqual(STORAGE_LIMIT); expect(localStorage.getItem('host')).toBe('keep');});
it('reuses request IDs across identical retries and keeps edits made during a save', () => {const r = requestTracker(); const id = r.idFor({body: 'hello'}); expect(r.idFor({body: 'hello'})).toBe(id); expect(r.idFor({body: 'changed'})).not.toBe(id); r.clear(); expect(r.idFor({body: 'hello'})).not.toBe(id); expect(remainderAfterSave('hello world', 'hello')).toBe('world'); expect(remainderAfterSave('edited', 'hello')).toBe('edited');});
it('keeps ambiguous-save retry IDs across reloads without erasing another tab\'s newer request',() => {
 const store = new LocalStore('retry-user-project'), persist = () => ({store,key: 'pending'});
 const first = requestTracker(persist), id = first.idFor({body: 'Original'});
 const reload = requestTracker(persist); expect(reload.idFor({body: 'Original'})).toBe(id);
 const changedId = reload.idFor({body: 'Edited'}); expect(changedId).not.toBe(id);
 first.clear(); expect(requestTracker(persist).idFor({body: 'Edited'})).toBe(changedId);
 reload.clear(); expect(store.read('pending')).toBeNull();
 expect(requestTracker(persist).idFor({body: 'Edited'})).not.toBe(changedId);
});
