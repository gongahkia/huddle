import {CollaborationError,type CollaborationAdapter,type Create,type Detail,type DetailQuery,type Identity,type ListQuery,type Reply,type Scope,type Session,type Thread,type Update} from '../../packages/shared/src/collaboration';

// Browser/lifecycle seam fixture only; this is not database conformance evidence.
export class TestAdapter implements CollaborationAdapter {
  actor: Identity = {id: 'host:alex',name: 'Alex'};
  allowed = true;
  records: Detail[] = [];
  events = 0;
  capabilities = {mentions: false,assignment: false,directory: false};
  private check(signal: AbortSignal) {signal.throwIfAborted(); if (!this.allowed) throw new CollaborationError('forbidden','Internal review access required.');}
  async session(scope: Scope,signal: AbortSignal): Promise<Session> {this.check(signal); return {actor: this.actor,scope,capabilities: this.capabilities};}
  async list(scope: Scope,query: ListQuery,signal: AbortSignal) {
    this.check(signal); const offset = Number(query.cursor || 0), limit = query.limit || 50;
    const items = this.records.map(item => item.thread).filter(item => item.workspace === scope.workspace && item.environment === scope.environment && (!query.page || item.page === query.page) && (!query.status || item.status === query.status));
    return {items: structuredClone(items.slice(offset,offset + limit)),nextCursor: items.length > offset + limit ? String(offset + limit) : null};
  }
  async detail(scope: Scope,id: string,query: DetailQuery,signal: AbortSignal) {
    this.check(signal); const result = this.records.find(item => item.thread.id === id && item.thread.workspace === scope.workspace && item.thread.environment === scope.environment);
    if (!result) throw new CollaborationError('not_found','Thread unavailable.');
    const page = <T>(items: T[],cursor?: string) => {const start = Number(cursor || 0), limit = query.limit || 50; return {items: structuredClone(items.slice(start,start + limit)),nextCursor: items.length > start + limit ? String(start + limit) : null};};
    return {thread: structuredClone(result.thread),comments: page(result.comments.items,query.commentsCursor),history: page(result.history.items,query.historyCursor)};
  }
  async create(scope: Scope,input: Create,signal: AbortSignal) {
    this.check(signal); const now = new Date().toISOString(), id = crypto.randomUUID();
    const comment = {id: crypto.randomUUID(),threadId: id,author: this.actor,body: input.body,mentions: [],createdAt: now};
    const thread: Thread = {...scope,page: input.page,pageUrl: input.pageUrl,release: input.release,viewContext: input.viewContext,id,anchor: input.anchor,status: 'open',assignee: null,createdBy: this.actor,createdAt: now,updatedAt: now,version: 1,commentCount: 1,latestComment: comment};
    const result: Detail = {thread,comments: {items: [comment],nextCursor: null},history: {items: [],nextCursor: null}};
    this.records.unshift(result); this.events++; return structuredClone(result);
  }
  async reply(scope: Scope,id: string,input: Reply,signal: AbortSignal) {
    await this.detail(scope,id,{},signal); const record = this.records.find(item => item.thread.id === id)!;
    const comment = {id: crypto.randomUUID(),threadId: id,author: this.actor,body: input.body,mentions: [],createdAt: new Date().toISOString()};
    record.comments.items.push(comment); record.thread.commentCount++; record.thread.latestComment = comment; record.thread.version++; this.events++;
    return this.detail(scope,id,{},signal);
  }
  async update(scope: Scope,id: string,input: Update,signal: AbortSignal) {
    await this.detail(scope,id,{},signal); const record = this.records.find(item => item.thread.id === id)!;
    if (record.thread.version !== input.expectedVersion) throw new CollaborationError('conflict','Thread changed.');
    if (input.status) record.thread.status = input.status; if (input.anchor) record.thread.anchor = input.anchor; record.thread.version++; this.events++; return this.detail(scope,id,{},signal);
  }
  async changes(scope: Scope,cursor: string | undefined,signal: AbortSignal) {this.check(signal); return {items: cursor !== undefined && cursor !== String(this.events) ? this.records.filter(item => item.thread.workspace === scope.workspace && item.thread.environment === scope.environment).map(item => ({threadId: item.thread.id,kind: 'updated' as const})) : [],cursor: String(this.events),hasMore: false,reset: false};}
  async export(): ReturnType<CollaborationAdapter['export']> {throw new Error('Transfer fixture not implemented.');}
  async stageImport(): ReturnType<CollaborationAdapter['stageImport']> {throw new Error('Transfer fixture not implemented.');}
  async previewImport(): ReturnType<CollaborationAdapter['previewImport']> {throw new Error('Transfer fixture not implemented.');}
  async executeImport(): ReturnType<CollaborationAdapter['executeImport']> {throw new Error('Transfer fixture not implemented.');}
  async importProgress(): ReturnType<CollaborationAdapter['importProgress']> {throw new Error('Transfer fixture not implemented.');}
}
