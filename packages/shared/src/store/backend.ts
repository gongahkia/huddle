import {CollaborationError,type Scope} from '../collaboration';
export const collections = ['scopes','threads','comments','history','events','requests','uploads','previews','jobs','provenance'] as const;
export type Collection = typeof collections[number];
export const temporaryCollections = ['uploads','previews','jobs'] as const;
export type TemporaryCollection = typeof temporaryCollections[number];
export type RemovableCollection = TemporaryCollection | 'comments' | 'history';
export type RecordValue<T = unknown> = Scope & {
  id: string; time: string; data: T;
  threadId?: string; status?: string; page?: string; actorId?: string; expiresAt?: number;
};
export type Scan = {
  threadId?: string; status?: string; page?: string; actorId?: string; expiresBefore?: number;
  after?: {time: string; id: string}; before?: {time: string; id: string};
  direction?: 'asc' | 'desc'; limit: number;
};
export interface Transaction {
  remove(collection: RemovableCollection,scope: Scope,id: string): Promise<void>;
  get<T>(collection: Collection,scope: Scope,id: string): Promise<RecordValue<T> | undefined>;
  scan<T>(collection: Collection,scope: Scope,query: Scan): Promise<RecordValue<T>[]>;
  put<T>(collection: Collection,record: RecordValue<T>,insert: boolean): Promise<void>;
}
export interface Backend {
  readonly datasetId: string;
  readonly cursorSecret: string;
  // Write transactions serialize the scope clock before reading mutable records.
  transaction<T>(scope: Scope,signal: AbortSignal,run: (tx: Transaction) => Promise<T>): Promise<T>;
  // Snapshot reads must remain consistent for the entire callback, including all pages.
  // Run the callback once: it may stream output that cannot be replayed after failure.
  snapshot<T>(signal: AbortSignal,run: (tx: Transaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function scopedTransaction(tx: Transaction,expected: Scope): Transaction {
  const check = (scope: Scope) => {if (scope.workspace !== expected.workspace || scope.environment !== expected.environment) throw new CollaborationError('forbidden','A feedback transaction cannot cross its authorized scope.');};
  return {
    remove(collection,scope,id) {check(scope); return tx.remove(collection,scope,id);},
    get<T>(collection: Collection,scope: Scope,id: string) {check(scope); return tx.get<T>(collection,scope,id);},
    scan<T>(collection: Collection,scope: Scope,query: Scan) {check(scope); return tx.scan<T>(collection,scope,query);},
    put(collection,record,insert) {check(record); return tx.put(collection,record,insert);},
  };
}

export async function assertRemovable(tx: Transaction,collection: Collection,scope: Scope,id: string) {
  if((temporaryCollections as readonly string[]).includes(collection)) return;
  if(collection !== 'comments' && collection !== 'history') throw new CollaborationError('validation','Published feedback cannot be removed by transfer cleanup.');
  const row = await tx.get(collection,scope,id); if(!row) return;
  if(row.status !== 'importing' || row.expiresAt === undefined || row.expiresAt > Date.now() || !row.threadId || await tx.get('threads',scope,row.threadId)) throw new CollaborationError('validation','Published feedback cannot be removed by transfer cleanup.');
}
