// Draft and save semantics adapted from Pronto. See NOTICE.
export const STORAGE_LIMIT = 2 * 1024 * 1024;
const PREFIX = 'huddle:v1:';
const AGE = 14 * 86400000;
type Entry<T> = {at: number; value: T};
export class LocalStore {
  constructor(private scope: string, private storage: Storage | null = (() => {try {return globalThis.localStorage;} catch {return null;}})()) {}
  private key(key: string) {return PREFIX + JSON.stringify([this.scope, key]);}
  read<T>(key: string): T | null {
    try {const raw = this.storage?.getItem(this.key(key)); if (!raw) return null;
      const entry = JSON.parse(raw) as Entry<T>;
      if (typeof entry.at !== 'number' || Date.now() - entry.at > AGE) {this.remove(key); return null;} return entry.value;
    } catch {return null;}
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
    } catch { /* In-memory draft remains usable if persistence is unavailable. */ }
  }
  remove(key: string, expected?: unknown) {
    try {if (expected !== undefined && JSON.stringify(this.read(key)) !== JSON.stringify(expected)) return; this.storage?.removeItem(this.key(key));} catch { /* blocked storage */ }
  }
}
export const remainderAfterSave = (current: string, sent: string) => current.startsWith(sent) ? current.slice(sent.length).trimStart() : current;
export function requestTracker() {
  let current: {payload: string; id: string} | undefined;
  return {idFor(payload: unknown) {const value = JSON.stringify(payload); if (current?.payload !== value) current = {payload: value, id: crypto.randomUUID()}; return current.id;}, clear() {current = undefined;}};
}
