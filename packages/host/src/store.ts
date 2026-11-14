import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {CollaborationError,type Capabilities,type ChangePage,type Comment,type Create,type Detail,type DetailQuery,type History,type Identity,type ListQuery,type Page,type Reply,type Scope,type Session,type Thread,type Update} from '../../shared/src/collaboration';
import {httpSchemas} from '../../shared/src/protocol';
import type {Backend,Collection,RecordValue,Transaction} from './backend';
import {decodeCursor,digest,encodeCursor,identitySchema,listSchema,detailSchema,scopeSchema,validate} from './validation';
import {abortable} from './cancellation';
export type {Backend,Collection,RecordValue,Scan,Transaction} from './backend';
export {CollaborationError,isCollaborationError} from '../../shared/src/collaboration';
export type {Identity,Scope,Capabilities} from '../../shared/src/collaboration';

export type Authorization = {actor: Identity; capabilities: Capabilities};
export type Authorize = (scope: Scope,signal: AbortSignal) => Promise<Authorization>;
export type Directory = {lookup(scope: Scope,ids: string[],signal: AbortSignal): Promise<Identity[]>; list(scope: Scope,query: {search?: string; cursor?: string},signal: AbortSignal): Promise<Page<Identity>>};
type Access = Authorization & {scope: Scope};
type RequestRecord = {hash: string; threadId: string};
const edgeSchema = z.object({time: z.string().max(100),id: z.string().min(1).max(512)}).strict();
const sequenceSchema = z.string().regex(/^\d{1,20}$/);
const timestamp = () => new Date().toISOString();
const threadRow = (thread: Thread): RecordValue<Thread> => ({...thread,time: thread.updatedAt,data: thread});
export class ReviewStore {
  constructor(readonly backend: Backend,private authorize: Authorize,private members?: Directory) {}
  async access(scope: Scope,signal: AbortSignal): Promise<Access> {
    signal.throwIfAborted(); validate(scopeSchema,scope);
    const result = await abortable(() => this.authorize(scope,signal),signal); signal.throwIfAborted();
    validate(identitySchema,result.actor);
    validate(z.object({mentions: z.boolean(),assignment: z.boolean(),directory: z.boolean()}).strict(),result.capabilities);
    if ((result.capabilities.mentions || result.capabilities.assignment || result.capabilities.directory) && !this.members) throw new CollaborationError('unavailable','The host directory is not configured.');
    return {...result,scope};
  }
  async session(scope: Scope,signal: AbortSignal): Promise<Session> {const access = await this.access(scope,signal); return {actor: access.actor,scope,capabilities: access.capabilities};}
  private async identities(access: Access,ids: string[],signal: AbortSignal): Promise<Identity[]> {
    if (!ids.length) return [];
    const unique = [...new Set(ids)], found = await abortable(() => this.members!.lookup(access.scope,unique,signal),signal);
    if (found.length !== unique.length || new Set(found.map(item => item.id)).size !== unique.length || found.some(item => !unique.includes(item.id))) throw new CollaborationError('validation','Choose existing workspace members.');
    for (const item of found) validate(identitySchema,item); return found;
  }
  async directory(scope: Scope,query: {search?: string; cursor?: string},signal: AbortSignal) {
    const access = await this.access(scope,signal); if (!access.capabilities.directory || !this.members) throw new CollaborationError('not_found','Member directory is unavailable.');
    validate(z.object({search: z.string().max(1000).optional(),cursor: z.string().max(2048).optional()}).strict(),query);
    return abortable(() => this.members!.list(scope,query,signal),signal);
  }
  private async getThread(tx: Transaction,scope: Scope,id: string) {
    const row = await tx.get<Thread>('threads',scope,id); if (!row) throw new CollaborationError('not_found','Feedback thread is unavailable.'); return row;
  }
  private binding(scope: Scope,kind: string,query: unknown) {return {scope,kind,query};}
  async list(scope: Scope,input: ListQuery,signal: AbortSignal): Promise<Page<Thread>> {
    await this.access(scope,signal); const query = validate(listSchema,input), limit = query.limit ?? 50, binding = this.binding(scope,'threads',{page: query.page,status: query.status});
    const before = query.cursor ? decodeCursor(this.backend.cursorSecret,binding,query.cursor,edgeSchema) : undefined;
    return this.backend.snapshot(signal,async tx => {
      const rows = await tx.scan<Thread>('threads',scope,{page: query.page,status: query.status,before,direction: 'desc',limit: limit + 1}), items = rows.slice(0,limit);
      const last = items.at(-1); return {items: items.map(item => item.data),nextCursor: rows.length > limit && last ? encodeCursor(this.backend.cursorSecret,binding,{time: last.time,id: last.id}) : null};
    });
  }
  private async detailIn(tx: Transaction,scope: Scope,id: string,query: DetailQuery): Promise<Detail> {
    const thread = await this.getThread(tx,scope,id), limit = query.limit ?? 50;
    const page = async <T>(collection: Collection,cursor?: string): Promise<Page<T>> => {
      const binding = this.binding(scope,collection,{threadId: id}), after = cursor ? decodeCursor(this.backend.cursorSecret,binding,cursor,edgeSchema) : undefined;
      const rows = await tx.scan<T>(collection,scope,{threadId: id,after,limit: limit + 1}), items = rows.slice(0,limit), last = items.at(-1);
      return {items: items.map(item => item.data),nextCursor: rows.length > limit && last ? encodeCursor(this.backend.cursorSecret,binding,{time: last.time,id: last.id}) : null};
    };
    return {thread: thread.data,comments: await page<Comment>('comments',query.commentsCursor),history: await page<History>('history',query.historyCursor)};
  }
  async detail(scope: Scope,id: string,input: DetailQuery,signal: AbortSignal) {
    await this.access(scope,signal); validate(z.string().min(1).max(512),id); const query = validate(detailSchema,input);
    return this.backend.snapshot(signal,tx => this.detailIn(tx,scope,id,query));
  }
  private async event(tx: Transaction,scope: Scope,threadId: string,kind: 'created' | 'updated' | 'imported') {
    const previous = await tx.get<{value: string}>('scopes',scope,'clock'), value = BigInt(previous?.data.value ?? '0') + 1n;
    if (value > 18446744073709551615n) throw new CollaborationError('unavailable','The feedback change cursor is exhausted.');
    await tx.put('scopes',{...scope,id: 'clock',time: '',data: {value: String(value)}},!previous);
    const id = String(value).padStart(20,'0'); await tx.put('events',{...scope,id,time: id,threadId,data: {threadId,kind}},true);
  }
  private async audit(tx: Transaction,access: Access,id: string,action: string,data: History['data']) {
    const history: History = {id: randomUUID(),threadId: id,actor: access.actor,action,data,createdAt: timestamp()};
    await tx.put('history',{...access.scope,id: history.id,time: history.createdAt,threadId: id,data: history},true);
  }
  private async mutate(access: Access,operation: string,idempotencyKey: string,payload: unknown,signal: AbortSignal,run: (tx: Transaction) => Promise<Thread>): Promise<Detail> {
    const key = digest({actor: access.actor.id,operation,idempotencyKey}), hash = digest(payload);
    return this.backend.transaction(access.scope,signal,async tx => {
      const previous = await tx.get<RequestRecord>('requests',access.scope,key);
      if (previous) {if (previous.data.hash !== hash) throw new CollaborationError('conflict','This request key was already used with different content.'); return this.detailIn(tx,access.scope,previous.data.threadId,{});}
      const result = await run(tx);
      await tx.put('requests',{...access.scope,id: key,time: timestamp(),actorId: access.actor.id,data: {hash,threadId: result.id}},true);
      return this.detailIn(tx,access.scope,result.id,{});
    });
  }
  private validateContent(body: string,mentions: string[],access: Access) {
    if (!body.trim()) throw new CollaborationError('validation','Add a nonempty feedback comment.');
    if (mentions.length && !access.capabilities.mentions) throw new CollaborationError('validation','Mentions are not supported by this host.');
  }
  async create(scope: Scope,input: Create,signal: AbortSignal): Promise<Detail> {
    const access = await this.access(scope,signal), parsed = validate(httpSchemas.Create,input), mentions = parsed.mentions ?? [];
    if (parsed.viewContext !== undefined) {validate(z.json(),parsed.viewContext,16); if (Buffer.byteLength(JSON.stringify(parsed.viewContext)) > 8192) throw new CollaborationError('validation','View context exceeds 8 KiB.');}
    this.validateContent(parsed.body,mentions,access); const identities = await this.identities(access,mentions,signal);
    const url = new URL(parsed.pageUrl); if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new CollaborationError('validation','Choose a safe HTTP(S) page URL.');
    return this.mutate(access,'create',parsed.idempotencyKey,parsed,signal,async tx => {
      const now = timestamp(), id = randomUUID(), comment: Comment = {id: randomUUID(),threadId: id,author: access.actor,body: parsed.body,mentions: identities,createdAt: now};
      const thread: Thread = {...scope,id,page: parsed.page,pageUrl: url.href,release: parsed.release,viewContext: parsed.viewContext,anchor: parsed.anchor,status: 'open',assignee: null,createdBy: access.actor,createdAt: now,updatedAt: now,version: 1,commentCount: 1,latestComment: comment};
      await tx.put('threads',threadRow(thread),true); await tx.put('comments',{...scope,id: comment.id,time: now,threadId: id,data: comment},true);
      await this.audit(tx,access,id,'created',{}); await this.event(tx,scope,id,'created'); return thread;
    });
  }
  async reply(scope: Scope,id: string,input: Reply,signal: AbortSignal): Promise<Detail> {
    const access = await this.access(scope,signal), parsed = validate(httpSchemas.Reply,input), mentions = parsed.mentions ?? [];
    validate(z.string().min(1).max(512),id); this.validateContent(parsed.body,mentions,access); const identities = await this.identities(access,mentions,signal);
    return this.mutate(access,`reply:${id}`,parsed.idempotencyKey,parsed,signal,async tx => {
      const row = await this.getThread(tx,scope,id), now = timestamp(), comment: Comment = {id: randomUUID(),threadId: id,author: access.actor,body: parsed.body,mentions: identities,createdAt: now};
      const previous = row.data.latestComment, latest = !previous || now > previous.createdAt || (now === previous.createdAt && comment.id > previous.id) ? comment : previous;
      const thread = {...row.data,version: row.data.version + 1,updatedAt: now,commentCount: row.data.commentCount + 1,latestComment: latest};
      await tx.put('comments',{...scope,id: comment.id,time: now,threadId: id,data: comment},true); await tx.put('threads',threadRow(thread),false);
      await this.audit(tx,access,id,'replied',{commentId: comment.id}); await this.event(tx,scope,id,'updated'); return thread;
    });
  }
  async update(scope: Scope,id: string,input: Update,signal: AbortSignal): Promise<Detail> {
    const access = await this.access(scope,signal), parsed = validate(httpSchemas.Update,input); validate(z.string().min(1).max(512),id);
    if (parsed.status === undefined && parsed.anchor === undefined && parsed.assigneeId === undefined) throw new CollaborationError('validation','Choose a feedback change.');
    if (parsed.assigneeId !== undefined && !access.capabilities.assignment) throw new CollaborationError('validation','Assignment is not supported by this host.');
    const assignee = parsed.assigneeId ? (await this.identities(access,[parsed.assigneeId],signal))[0] : null;
    return this.mutate(access,`update:${id}`,parsed.idempotencyKey,parsed,signal,async tx => {
      const row = await this.getThread(tx,scope,id); if (row.data.version !== parsed.expectedVersion) throw new CollaborationError('conflict','The feedback thread changed. Refetch before updating it.');
      const thread: Thread = {...row.data,status: parsed.status ?? row.data.status,anchor: parsed.anchor ?? row.data.anchor,assignee: parsed.assigneeId === undefined ? row.data.assignee : assignee,version: row.data.version + 1,updatedAt: timestamp()};
      await tx.put('threads',threadRow(thread),false); await this.audit(tx,access,id,'updated',{before: {status: row.data.status,anchor: row.data.anchor,assignee: row.data.assignee},after: {status: thread.status,anchor: thread.anchor,assignee: thread.assignee}}); await this.event(tx,scope,id,'updated'); return thread;
    });
  }
  async changes(scope: Scope,cursor: string | undefined,signal: AbortSignal): Promise<ChangePage> {
    await this.access(scope,signal); const binding = this.binding(scope,'changes',{}), after = cursor ? decodeCursor(this.backend.cursorSecret,binding,cursor,sequenceSchema) : undefined;
    return this.backend.snapshot(signal,async tx => {
      const clock = await tx.get<{value: string}>('scopes',scope,'clock'), current = clock?.data.value ?? '0';
      if (after === undefined) return {items: [],cursor: encodeCursor(this.backend.cursorSecret,binding,current),hasMore: false,reset: false};
      if (BigInt(after) > BigInt(current)) throw new CollaborationError('validation','Feedback cursor is ahead of this scope.');
      const boundary = after.padStart(20,'0'), rows = await tx.scan<ChangePage['items'][number]>('events',scope,{after: {time: boundary,id: boundary},limit: 101}), items = rows.slice(0,100), last = items.at(-1);
      return {items: items.map(row => row.data),cursor: encodeCursor(this.backend.cursorSecret,binding,last ? String(BigInt(last.time)) : current),hasMore: rows.length > 100,reset: false};
    });
  }
}
