// Draft and save semantics adapted from Pronto. See NOTICE.
export const STORAGE_LIMIT = 2 * 1024 * 1024;
const PREFIX = 'huddle:v1:';
const AGE = 14 * 86400000;
type Entry<T> = {at: number; value: T};
export class MemoryStorage implements Storage {
  private values = new Map<string,string>();
  get length() {return this.values.size;}
  clear() {this.values.clear();}
  key(index: number) {return [...this.values.keys()][index] ?? null;}
  getItem(key: string) {return this.values.get(key) ?? null;}
  setItem(key: string,value: string) {this.values.set(key,value);}
  removeItem(key: string) {this.values.delete(key);}
}
export class LocalStore {
  constructor(private scope: string, private storage: Storage | null = (() => {try {return globalThis.localStorage;} catch {return null;}})(), private fallback?: Storage) {}
  private key(key: string) {return PREFIX + JSON.stringify([this.scope, key]);}
  read<T>(key: string,maxAge = AGE): T | null {
    try {const raw = this.storage?.getItem(this.key(key)), backup = this.fallback?.getItem(this.key(key)); if (!raw && !backup) return null;
      let entry = JSON.parse(raw || backup!) as Entry<T>;
      if (backup) {const saved = JSON.parse(backup) as Entry<T>; if (saved.at >= entry.at) entry = saved;}
      if (typeof entry.at !== 'number' || Date.now() - entry.at > maxAge) {this.remove(key); return null;} return entry.value;
    } catch {return this.fallback ? new LocalStore(this.scope,this.fallback).read<T>(key,maxAge) : null;}
  }
  write(key: string, value: unknown) {
    if (!this.storage) return;
    try {
      const k = this.key(key), data = JSON.stringify({at: Date.now(), value});
      if ((k.length + data.length) * 2 > STORAGE_LIMIT) return;
      const entries: {key: string; bytes: number; at: number}[] = [];
      for (let i = 0; i < this.storage.length; i++) {const ek = this.storage.key(i); if (!ek?.startsWith(PREFIX) || ek === k) continue;
        const val = this.storage.getItem(ek) || ''; let at = 0; try {at = JSON.parse(val).at || 0;} catch { /* evict corrupt */ }
        entries.push({key: ek, bytes: (ek.length + val.length) * 2, at});}
      let total = entries.reduce((n, e) => n + e.bytes, (k.length + data.length) * 2);
      entries.sort((a, b) => a.at - b.at);
      for (const entry of entries) {if (total <= STORAGE_LIMIT) break; this.storage.removeItem(entry.key); total -= entry.bytes;}
      this.storage.setItem(k, data);
      if (this.fallback !== this.storage) this.fallback?.removeItem(k);
    } catch {if (this.fallback) {this.storage = this.fallback; this.fallback = undefined; this.write(key,value);}}
  }
  remove(key: string, expected?: unknown) {
    if (expected !== undefined && JSON.stringify(this.read(key)) !== JSON.stringify(expected)) return;
    try {this.storage?.removeItem(this.key(key));} catch { /* blocked storage */ }
    this.fallback?.removeItem(this.key(key));
  }
}
export const remainderAfterSave = (current: string, sent: string) => current.startsWith(sent) ? current.slice(sent.length).trimStart() : current;
export function requestTracker(persistence?: () => {store: LocalStore; key: string} | undefined) {
  type Record = {payload: string; id: string};
  let current: {record: Record; location?: {store: LocalStore; key: string}} | undefined;
  return {
    idFor(payload: unknown) {
      const value = JSON.stringify(payload), location = persistence?.(), saved = location?.store.read<Record>(location.key);
      const previous = saved && typeof saved.id === 'string' && /^[0-9a-f-]{36}$/i.test(saved.id) ? saved : current?.record;
      const record = previous?.payload === value ? previous : {payload: value,id: crypto.randomUUID()};
      current = {record,location}; location?.store.write(location.key,record); return record.id;
    },
    clear() {if (current) current.location?.store.remove(current.location.key,current.record); current = undefined;},
    forget() {current = undefined;},
  };
}
