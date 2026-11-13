import {z} from 'zod';
import type {Actor} from '@huddle/shared';
import {anchorSchema, contextSchema, identifier, originSchema} from './validation';
import {Database} from './database';
import {HttpError, projectAccess, requireAdmin} from './auth';
const timestamp = z.string().datetime({offset: true});
const comment = z.object({id: z.string().min(1).max(200),author_user_id: z.string().max(200).nullable(),author_name: z.string().min(1).max(120),body: z.string().min(1).max(3000),created_at: timestamp});
const source = z.object({schema: z.literal('pronto.prototype-feedback.v1'),workspaceId: z.string().min(1).max(200),complete: z.literal(true).optional(),threads: z.array(z.object({id: z.string().min(1).max(200),page_path: z.string().min(1).max(1000),anchor: anchorSchema.omit({kind: true}).extend({feedbackId: z.string().optional()}),status: z.enum(['open','resolved']),created_at: timestamp,updated_at: timestamp,comments: z.array(comment),commentsTruncated: z.literal(false).optional()})).max(100000),pagination: z.object({hasMore: z.literal(false)}).optional()}).refine(v => v.complete === true || v.pagination?.hasMore === false,'Provide a complete export, not an incomplete page.');
export function importPronto(db: Database, actor: Actor, input: unknown, options: {projectId: string; environment: string; origin: string}) {
  requireAdmin(actor); identifier.parse(options.projectId); contextSchema.shape.environment.parse(options.environment); originSchema.parse(options.origin);
  const project = projectAccess(db,actor,options.projectId,options.environment);
  if (!project.origins.includes(options.origin)) throw new HttpError(400,'Import origin must be allowed for this project.');
  const data = source.parse(input); let threadsAdded = 0, commentsAdded = 0;
  db.transaction(() => {
    for (const t of data.threads) {
      const prior = db.get<{id: string}>('SELECT id FROM threads WHERE project_id=? AND source_id=?',options.projectId,t.id);
      const id = prior?.id || db.id();
      if (!prior) {
        const {feedbackId: _feedbackId,...oldAnchor} = t.anchor;
        const anchor = {...oldAnchor,kind: t.anchor.label === 'This page' ? 'page' : 'element'};
        const url = new URL(t.page_path,options.origin); if (url.origin !== options.origin) throw new HttpError(400,'Import pages must remain on the configured origin.'); url.search = ''; url.hash = '';
        db.run('INSERT INTO threads(id,project_id,environment,page,page_url,anchor,status,created_at,updated_at,source_id) VALUES(?,?,?,?,?,?,?,?,?,?)',id,options.projectId,options.environment,t.page_path,url.href,JSON.stringify(anchor),t.status,t.created_at,t.updated_at,t.id);
        db.run('INSERT INTO history(thread_id,actor_name,action,data,created_at) VALUES(?,?,?,?,?)',id,actor.name,'imported',JSON.stringify({schema: data.schema,workspaceId: data.workspaceId,threadId: t.id}),new Date().toISOString()); threadsAdded++;
      }
      let added = 0;
      for (const c of t.comments) {
        added += Number(db.run('INSERT OR IGNORE INTO comments(id,thread_id,author_name,body,mentions,created_at,source_id,source_author_id) VALUES(?,?,?,?,?,?,?,?)',db.id(),id,c.author_name,c.body,'[]',c.created_at,c.id,c.author_user_id).changes);
      }
      if (!prior || added) {
        const seq = db.run('INSERT INTO events(project_id,environment,thread_id,type,created_at) VALUES(?,?,?,?,?)',options.projectId,options.environment,id,'imported',new Date().toISOString()).lastInsertRowid;
        db.run('UPDATE threads SET updated_seq=?,version=version+? WHERE id=?',seq,prior ? 1 : 0,id);
      }
      commentsAdded += added;
    }
  }); return {threadsAdded,commentsAdded};
}
