import type {Actor, Anchor, Change, Comment, Thread, ThreadDetail} from '@huddle/shared';
import type {SQLInputValue} from 'node:sqlite';
import {Database} from './database';
import {hash, HttpError, projectAccess, requireMember} from './auth';
import {createSchema, listSchema, patchSchema, replySchema} from './validation';
import type {z} from 'zod';

type Row = {id: string; project_id: string; environment: string; page: string; page_url: string; release: string | null; anchor: string; status: 'open' | 'resolved'; assignee_id: string | null; version: number; created_at: string; updated_at: string; updated_seq: number; source_id: string | null};
type CommentRow = {seq: number; id: string; author_id: string | null; author_name: string; body: string; mentions: string; created_at: string; source_id: string | null; source_author_id: string | null};
export const commentValue = (r: CommentRow): Comment => ({id: r.id,authorId: r.author_id,authorName: r.author_name,body: r.body,mentions: JSON.parse(r.mentions),createdAt: r.created_at,...(r.source_id ? {sourceId: r.source_id, sourceAuthorId: r.source_author_id} : {})});
export class Store {
  listeners = new Set<(change: Change & {projectId: string}) => void>();
  constructor(readonly db: Database) {}
  cursor(projectId: string) {return this.db.get<{seq: number}>('SELECT COALESCE(MAX(seq),0) seq FROM events WHERE project_id=?',projectId)!.seq;}
  summary(row: Row): Thread {
    const latest = this.db.get<CommentRow>('SELECT * FROM comments WHERE thread_id=? ORDER BY seq DESC LIMIT 1',row.id);
    const mentions = this.db.all<{value: string}>('SELECT DISTINCT j.value FROM comments c,json_each(c.mentions) j WHERE c.thread_id=? LIMIT 100',row.id).map(r => r.value);
    return {id: row.id,projectId: row.project_id,environment: row.environment,page: row.page,pageUrl: row.page_url,release: row.release || undefined,anchor: JSON.parse(row.anchor),status: row.status,assigneeId: row.assignee_id,version: row.version,createdAt: row.created_at,updatedAt: row.updated_at,commentCount: this.db.get<{n: number}>('SELECT COUNT(*) n FROM comments WHERE thread_id=?',row.id)!.n,latestComment: latest ? commentValue(latest) : null,mentionedIds: mentions,...(row.source_id ? {sourceId: row.source_id} : {})};
  }
  row(actor: Actor, projectId: string, id: string) {
    projectAccess(this.db,actor,projectId);
    const row = this.db.get<Row>('SELECT * FROM threads WHERE id=? AND project_id=?',id,projectId);
    if (!row) throw new HttpError(404,'Thread not found.');
    projectAccess(this.db,actor,projectId,row.environment); return row;
  }
  detail(actor: Actor, projectId: string, id: string, after = 0): ThreadDetail {
    const row = this.row(actor,projectId,id);
    const comments = this.db.all<CommentRow>('SELECT * FROM comments WHERE thread_id=? AND seq>? ORDER BY seq LIMIT 51',id,after);
    return {...this.summary(row),comments: comments.slice(0,50).map(commentValue),nextCursor: comments.length > 50 ? comments[49].seq : null,
      history: this.db.all<{id: number; action: string; actor_name: string; created_at: string; data: string}>('SELECT * FROM history WHERE thread_id=? ORDER BY id DESC LIMIT 100',id).map(h => ({id: h.id,action: h.action,actorName: h.actor_name,createdAt: h.created_at,data: JSON.parse(h.data)}))};
  }
  list(actor: Actor, projectId: string, input: z.infer<typeof listSchema>) {
    projectAccess(this.db,actor,projectId,input.environment);
    const clauses = ['project_id=?'], args: SQLInputValue[] = [projectId];
    const env = actor.environment || input.environment;
    for (const [column,value] of [['environment',env],['page',input.page],['status',input.status],['assignee_id',input.assigneeId]] as const) if (value) {clauses.push(`${column}=?`); args.push(value);}
    if (input.before) {clauses.push('updated_seq<?'); args.push(input.before);}
    if (input.mentionedId) {clauses.push('EXISTS(SELECT 1 FROM comments c,json_each(c.mentions) j WHERE c.thread_id=threads.id AND j.value=?)'); args.push(input.mentionedId);}
    const rows = this.db.all<Row>(`SELECT * FROM threads WHERE ${clauses.join(' AND ')} ORDER BY updated_seq DESC LIMIT ?`,...args,input.limit + 1);
    return {items: rows.slice(0,input.limit).map(r => this.summary(r)),nextCursor: rows.length > input.limit ? rows[input.limit - 1].updated_seq : null,cursor: this.cursor(projectId)};
  }
  members(actor: Actor, projectId: string) {
    projectAccess(this.db,actor,projectId);
    return this.db.all<{id: string; name: string; email: string; role: string}>(`SELECT u.id,u.name,CASE WHEN ?='guest' THEN '' ELSE COALESCE(u.email,'') END email,u.role FROM users u WHERE u.role='administrator' OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.project_id=?) ORDER BY u.name`,actor.role,projectId);
  }
  validateMembers(actor: Actor, projectId: string, ids: string[]) {
    const allowed = new Set(this.members(actor,projectId).map(m => m.id));
    if (ids.some(id => !allowed.has(id))) throw new HttpError(400,'Choose members of this project.');
  }
  private history(id: string, actor: Actor, action: string, data: unknown) {this.db.run('INSERT INTO history(thread_id,actor_name,action,data,created_at) VALUES(?,?,?,?,?)',id,actor.name,action,JSON.stringify(data),new Date().toISOString());}
  private change(projectId: string, environment: string, threadId: string, type: string) {
    const seq = Number(this.db.run('INSERT INTO events(project_id,environment,thread_id,type,created_at) VALUES(?,?,?,?,?)',projectId,environment,threadId,type,new Date().toISOString()).lastInsertRowid);
    this.db.run('UPDATE threads SET updated_seq=? WHERE id=?',seq,threadId); return {seq,projectId,environment,threadId,type};
  }
  private mutation(actor: Actor, projectId: string, requestId: string, payload: unknown, execute: () => {value: ThreadDetail; change: Change & {projectId: string}}): ThreadDetail {
    const payloadHash = hash(JSON.stringify(payload)); let event: (Change & {projectId: string}) | undefined;
    const result = this.db.transaction(() => {
      const prior = this.db.get<{payload_hash: string; response: string}>('SELECT * FROM requests WHERE actor_id=? AND project_id=? AND request_id=?',actor.id,projectId,requestId);
      if (prior) {if (prior.payload_hash !== payloadHash) throw new HttpError(409,'This request ID was already used for another change.'); const saved = JSON.parse(prior.response) as {threadId?: string; id?: string}; return this.detail(actor,projectId,saved.threadId || saved.id!);}
      const output = execute(); event = output.change;
      this.db.run('INSERT INTO requests VALUES(?,?,?,?,?,?)',actor.id,projectId,requestId,payloadHash,JSON.stringify({threadId: output.value.id}),new Date().toISOString()); return output.value;
    });
    if (event) for (const listener of this.listeners) listener(event); return result;
  }
  create(actor: Actor, projectId: string, input: z.infer<typeof createSchema>) {
    const project = projectAccess(this.db,actor,projectId,input.environment);
    const url = new URL(input.pageUrl);
    if (!project.origins.includes(url.origin) || (actor.origin && url.origin !== actor.origin) || url.username || url.password) throw new HttpError(400,'The reviewed URL must belong to an allowed website.');
    this.validateMembers(actor,projectId,input.mentions);
    return this.mutation(actor,projectId,input.requestId,{action: 'create',...input},() => {
      const id = this.db.id(), now = new Date().toISOString();
      this.db.run('INSERT INTO threads(id,project_id,environment,page,page_url,release,anchor,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',id,projectId,input.environment,input.page,input.pageUrl,input.release || null,JSON.stringify(input.anchor),now,now);
      this.addComment(id,actor,input.body,input.mentions); this.history(id,actor,'created',{});
      const change = this.change(projectId,input.environment,id,'created'); return {value: this.detail(actor,projectId,id),change};
    });
  }
  private addComment(id: string, actor: Actor, body: string, mentions: string[]) {this.db.run('INSERT INTO comments(id,thread_id,author_id,author_name,body,mentions,created_at) VALUES(?,?,?,?,?,?,?)',this.db.id(),id,actor.id,actor.name,body,JSON.stringify([...new Set(mentions)]),new Date().toISOString());}
  reply(actor: Actor, projectId: string, id: string, input: z.infer<typeof replySchema>) {
    const row = this.row(actor,projectId,id); this.validateMembers(actor,projectId,input.mentions);
    return this.mutation(actor,projectId,input.requestId,{action: 'reply',id,...input},() => {
      this.addComment(id,actor,input.body,input.mentions); this.db.run('UPDATE threads SET version=version+1,updated_at=? WHERE id=?',new Date().toISOString(),id);
      this.history(id,actor,'replied',{}); const change = this.change(projectId,row.environment,id,'replied'); return {value: this.detail(actor,projectId,id),change};
    });
  }
  patch(actor: Actor, projectId: string, id: string, input: z.infer<typeof patchSchema>) {
    const row = this.row(actor,projectId,id); requireMember(actor);
    if (input.assigneeId) this.validateMembers(actor,projectId,[input.assigneeId]);
    return this.mutation(actor,projectId,input.requestId,{action: 'patch',id,...input},() => {
      const current = this.row(actor,projectId,id);
      if (current.version !== input.expectedVersion) throw new HttpError(409,'This thread changed. Refresh and try again.');
      if (input.anchor) this.history(id,actor,'reattached',{previous: JSON.parse(current.anchor) as Anchor,anchor: input.anchor});
      if (input.status) this.history(id,actor,input.status,{});
      if (input.assigneeId !== undefined) this.history(id,actor,'assigned',{assigneeId: input.assigneeId});
      this.db.run('UPDATE threads SET status=?,assignee_id=?,anchor=?,version=version+1,updated_at=? WHERE id=?',input.status || current.status,input.assigneeId === undefined ? current.assignee_id : input.assigneeId,JSON.stringify(input.anchor || JSON.parse(current.anchor)),new Date().toISOString(),id);
      const change = this.change(projectId,row.environment,id,'updated'); return {value: this.detail(actor,projectId,id),change};
    });
  }
  changes(actor: Actor, projectId: string, after: number, limit = 200) {
    projectAccess(this.db,actor,projectId);
    return this.db.all<{seq: number; thread_id: string; type: string; environment: string}>(`SELECT seq,thread_id,type,environment FROM events WHERE project_id=? AND seq>? ${actor.environment ? 'AND environment=?' : ''} ORDER BY seq LIMIT ?`,...[projectId,after,...(actor.environment ? [actor.environment] : []),limit]).map(r => ({seq: r.seq,threadId: r.thread_id,type: r.type,environment: r.environment}));
  }
}
