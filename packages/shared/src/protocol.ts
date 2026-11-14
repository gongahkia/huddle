import {z} from 'zod';
import {feedbackSnapshotSchema,portableShapes as s} from './portable';

const capabilities = z.object({mentions: z.boolean(),assignment: z.boolean(),directory: z.boolean()}).strict();
const identity = z.object({id: s.id,name: z.string().min(1).max(1000)}).strict();
const scope = z.object({workspace: s.id,environment: s.id}).strict();
const page = <T extends z.ZodType>(item: T) => z.object({items: z.array(item),nextCursor: z.string().min(1).max(2048).nullable()}).strict();
const counts = z.object({threads: s.count,comments: s.count,history: s.count}).strict();
const mapping = z.object({environmentMap: z.record(z.string(),s.id),originMap: z.record(z.string(),z.string().url()),identityMap: z.record(z.string(),s.id)}).strict();
const rejected = z.array(z.object({recordId: s.id,reason: z.string()}).strict());
const mutation = {idempotencyKey: s.id};
const errors = z.enum(['unauthenticated','forbidden','validation','not_found','conflict','rate_limited','timeout','network','unavailable']);
export const httpSchemas = {
  FeedbackSnapshot: feedbackSnapshotSchema,
  Session: z.object({actor: identity,scope,capabilities}).strict(),
  ThreadPage: page(s.thread),
  Detail: z.object({thread: s.thread,comments: page(s.comment),history: page(s.history)}).strict(),
  Create: z.object({...mutation,page: z.string().min(1).max(4096),pageUrl: z.string().url().max(8192),release: z.string().max(1000).optional(),viewContext: z.json().optional(),anchor: s.anchor,body: z.string().min(1).max(100000),mentions: z.array(s.id).max(1000).optional()}).strict(),
  Reply: z.object({...mutation,body: z.string().min(1).max(100000),mentions: z.array(s.id).max(1000).optional()}).strict(),
  Update: z.object({...mutation,expectedVersion: z.number().int().positive(),status: z.enum(['open','resolved']).optional(),anchor: s.anchor.optional(),assigneeId: s.id.nullable().optional()}).strict(),
  ChangePage: z.object({items: z.array(z.object({threadId: s.id,kind: z.enum(['created','updated','imported'])}).strict()).max(100),cursor: s.id,hasMore: z.boolean(),reset: z.boolean()}).strict(),
  Directory: page(identity),
  Export: z.object({scope: s.scope,format: z.enum(['json','markdown'])}).strict(),
  Upload: z.object({uploadId: s.id,digest: z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  PreviewRequest: z.object({uploadId: s.id,digest: z.string().regex(/^[a-f0-9]{64}$/),mapping}).strict(),
  ImportPreview: z.object({id: s.id,digest: z.string().regex(/^[a-f0-9]{64}$/),scope,mapping,counts,historicalAuthors: z.array(s.attribution),conflicts: rejected,expiresAt: s.timestamp}).strict(),
  Execute: z.object({...mutation,previewId: s.id,digest: z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  ImportJob: z.object({id: s.id,state: z.enum(['pending','running','complete','failed']),expected: counts,processed: counts,rejected,error: z.string().optional()}).strict(),
  Error: z.object({error: z.object({code: errors,message: z.string(),retryAfterMs: z.number().int().nonnegative().optional()}).strict()}).strict(),
};
