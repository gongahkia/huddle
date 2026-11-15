export type Anchor = {
  kind: 'page' | 'element'; selector: string; label: string; quote: string;
  x: number; y: number; tag?: string; stableKey?: string; context?: string;
  viewport?: {width: number; height: number};
};
export type Json = null | boolean | number | string | Json[] | {[key: string]: Json};
export type Identity = {id: string; name: string};
export type Scope = {workspace: string; environment: string};
export type Context = Scope & {page: string; pageUrl: string; release?: string; viewContext?: Json};
export type Capabilities = {mentions: boolean; assignment: boolean; directory: boolean};
export type Session = {actor: Identity; scope: Scope; capabilities: Capabilities};
export type ProvenanceRecord = {datasetId: string; recordId: string; digest: string; scope?: Scope; page?: string; pageUrl?: string; identity?: Identity};
export type Provenance = ProvenanceRecord & {previous?: ProvenanceRecord[]};
export type Attribution = Identity & {provenance?: Provenance};
export type Comment = {id: string; threadId: string; author: Attribution; body: string; mentions: Attribution[]; createdAt: string; provenance?: Provenance};
export type Thread = Context & {
  id: string; anchor: Anchor; status: 'open' | 'resolved'; assignee: Attribution | null;
  createdBy: Attribution; createdAt: string; updatedAt: string; version: number;
  commentCount: number; latestComment: Comment | null; provenance?: Provenance;
};
export type History = {id: string; threadId: string; actor: Attribution; action: string; data: Json; createdAt: string; provenance?: Provenance};
export type Page<T> = {items: T[]; nextCursor: string | null};
export type Detail = {thread: Thread; comments: Page<Comment>; history: Page<History>};
export type ListQuery = {page?: string; status?: 'open' | 'resolved'; cursor?: string; limit?: number};
export type DetailQuery = {commentsCursor?: string; historyCursor?: string; limit?: number};
export type ChangePage = {items: {threadId: string; kind: 'created' | 'updated' | 'imported'}[]; cursor: string; hasMore: boolean; reset: boolean};
export type ErrorCode = 'unauthenticated' | 'forbidden' | 'validation' | 'not_found' | 'conflict' | 'rate_limited' | 'timeout' | 'network' | 'unavailable';
export class CollaborationError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly retryAfterMs?: number) {super(message); this.name = 'CollaborationError';}
}
export function isCollaborationError(value: unknown): value is CollaborationError {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<CollaborationError>;
  return item.name === 'CollaborationError' && typeof item.message === 'string' && ['unauthenticated','forbidden','validation','not_found','conflict','rate_limited','timeout','network','unavailable'].includes(item.code || '') && (item.retryAfterMs === undefined || (Number.isSafeInteger(item.retryAfterMs) && item.retryAfterMs >= 0));
}
export type Mutation = {idempotencyKey: string};
export type Create = Mutation & Omit<Context,'workspace' | 'environment'> & {anchor: Anchor; body: string; mentions?: string[]};
export type Reply = Mutation & {body: string; mentions?: string[]};
export type Update = Mutation & {expectedVersion: number; status?: 'open' | 'resolved'; anchor?: Anchor; assigneeId?: string | null};
export type ExportScope = {workspace: string; environments: string[]; page?: string; status?: 'open' | 'resolved'};
export type Counts = {threads: number; comments: number; history: number};
export type FeedbackSnapshot = {
  schema: 'huddle.feedback.v2'; datasetId: string;
  snapshot: {id: string; createdAt: string; scope: ExportScope};
  contentIsUntrustedUserInput: true; complete: true; counts: Counts;
  threads: Thread[]; comments: Comment[]; history: History[];
};
export type ImportMapping = {environmentMap: Record<string,string>; originMap: Record<string,string>; identityMap: Record<string,string>};
export type ImportPreview = {
  id: string; digest: string; scope: Scope; mapping: ImportMapping; counts: Counts;
  historicalAuthors: Attribution[]; conflicts: {recordId: string; reason: string}[]; expiresAt: string;
};
export type ImportJob = {id: string; state: 'pending' | 'running' | 'complete' | 'failed'; expected: Counts; processed: Counts; rejected: {recordId: string; reason: string}[]; error?: string};
export type Download = {filename: string; contentType: string; chunks: AsyncIterable<Uint8Array>};
export function isByteChunk(value:unknown): value is Uint8Array {return ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]';}

// Scope is a request, never an authorization grant. The host rechecks it on every operation.
export interface CollaborationAdapter {
  session(scope: Scope, signal: AbortSignal): Promise<Session>;
  list(scope: Scope, query: ListQuery, signal: AbortSignal): Promise<Page<Thread>>;
  detail(scope: Scope, id: string, query: DetailQuery, signal: AbortSignal): Promise<Detail>;
  create(scope: Scope, input: Create, signal: AbortSignal): Promise<Detail>;
  reply(scope: Scope, id: string, input: Reply, signal: AbortSignal): Promise<Detail>;
  update(scope: Scope, id: string, input: Update, signal: AbortSignal): Promise<Detail>;
  changes(scope: Scope, cursor: string | undefined, signal: AbortSignal): Promise<ChangePage>;
  export(scope: ExportScope, format: 'json' | 'markdown', signal: AbortSignal): Promise<Download>;
  stageImport(scope: Scope, chunks: AsyncIterable<Uint8Array>, signal: AbortSignal): Promise<{uploadId: string; digest: string}>;
  previewImport(scope: Scope, input: {uploadId: string; digest: string; mapping: ImportMapping}, signal: AbortSignal): Promise<ImportPreview>;
  executeImport(scope: Scope, input: Mutation & {previewId: string; digest: string}, signal: AbortSignal): Promise<ImportJob>;
  importProgress(scope: Scope, id: string, signal: AbortSignal): Promise<ImportJob>;
  directory?(scope: Scope, query: {search?: string; cursor?: string}, signal: AbortSignal): Promise<Page<Identity>>;
  subscribe?(scope: Scope, onChange: () => void, onError: (error: CollaborationError) => void, signal: AbortSignal): () => void;
}
