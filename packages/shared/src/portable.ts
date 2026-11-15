import {z} from 'zod';
import {COMMENT_COLORS,type FeedbackSnapshot} from './collaboration';

const id = z.string().min(1).max(512), timestamp = z.string().datetime({offset: true});
const provenanceRecord = z.object({datasetId:id,recordId:id,digest:z.string().regex(/^[a-f0-9]{64}$/),scope:z.object({workspace:id,environment:id}).strict().optional(),page:z.string().max(4096).optional(),pageUrl:z.string().url().max(8192).optional(),identity:z.object({id,name:z.string().min(1).max(1000)}).strict().optional()}).strict();
const provenance = provenanceRecord.extend({previous:z.array(provenanceRecord).max(1000).optional()}).strict();
const attribution = z.object({id,name: z.string().min(1).max(1000),provenance: provenance.optional()}).strict();
const scope = z.object({workspace: id,environments: z.array(id).min(1),page: z.string().max(4096).optional(),status: z.enum(['open','resolved']).optional()}).strict();
const anchor = z.object({
  kind: z.enum(['page','element']),selector: z.string().max(16384),label: z.string().min(1).max(4096),quote: z.string().max(16384),
  x: z.number().min(0).max(1),y: z.number().min(0).max(1),tag: z.string().max(100).optional(),stableKey: z.string().max(16384).optional(),context: z.string().max(16384).optional(),
  viewport: z.object({width: z.number().nonnegative().max(100000),height: z.number().nonnegative().max(100000)}).strict().optional(),
}).strict();
const color = z.enum(COMMENT_COLORS);
const comment = z.object({id,threadId: id,author: attribution,body: z.string().min(1).max(100000),mentions: z.array(attribution).max(1000),color:color.optional(),createdAt: timestamp,provenance: provenance.optional()}).strict();
const thread = z.object({
  id,workspace: id,environment: id,page: z.string().min(1).max(4096),pageUrl: z.string().url().max(8192),release: z.string().max(1000).optional(),viewContext: z.json().optional(),
  anchor,color:color.optional(),status: z.enum(['open','resolved']),assignee: attribution.nullable(),createdBy: attribution,createdAt: timestamp,updatedAt: timestamp,
  version: z.number().int().positive(),commentCount: z.number().int().nonnegative(),latestComment: comment.nullable(),provenance: provenance.optional(),
}).strict();
const history = z.object({id,threadId: id,actor: attribution,action: z.string().min(1).max(100),data: z.json(),createdAt: timestamp,provenance: provenance.optional()}).strict();
const count = z.number().int().nonnegative();
export const portableShapes = {id,timestamp,attribution,scope,anchor,color,comment,thread,history,count};

// Structural schema is also published as JSON Schema; cross-record checks run below.
export const feedbackSnapshotSchema = z.object({
  schema: z.literal('huddle.feedback.v2'),datasetId: id,
  snapshot: z.object({id,createdAt: timestamp,scope}).strict(),
  contentIsUntrustedUserInput: z.literal(true),complete: z.literal(true),
  counts: z.object({threads: count,comments: count,history: count}).strict(),
  threads: z.array(thread),comments: z.array(comment),history: z.array(history),
}).strict() satisfies z.ZodType<FeedbackSnapshot>;

export type ImportLimits = {maxBytes: number; maxRecords: number; maxDepth: number};
export const defaultImportLimits: ImportLimits = {maxBytes: 32 * 1024 * 1024,maxRecords: 100000,maxDepth: 32};
export function parseFeedbackSnapshot(json: string, limits: Partial<ImportLimits> = {}): FeedbackSnapshot {
  const bounds = {...defaultImportLimits,...limits};
  for (const value of Object.values(bounds)) if (!Number.isSafeInteger(value) || value < 1) throw new Error('Import limits must be positive safe integers.');
  if (new TextEncoder().encode(json).byteLength > bounds.maxBytes) throw new Error('Import exceeds byte limit.');
  const input: unknown = JSON.parse(json);
  const pending = [{value: input,depth: 0}];
  while (pending.length) {
    const {value,depth} = pending.pop()!;
    if (depth > bounds.maxDepth) throw new Error('Import exceeds nesting limit.');
    if (value && typeof value === 'object') for (const child of Object.values(value)) pending.push({value: child,depth: depth + 1});
  }
  const data = feedbackSnapshotSchema.parse(input);
  const total = data.threads.length + data.comments.length + data.history.length;
  if (total > bounds.maxRecords) throw new Error('Import exceeds record limit.');
  for(const record of [...data.threads,...data.comments,...data.history]) {
    const pending:unknown[] = [record]; let nodes = 0;
    while(pending.length) {const value = pending.pop(); if(++nodes > 10000) throw new Error('Import record exceeds complexity limit.'); if(value && typeof value === 'object') pending.push(...Object.values(value));}
  }
  const threads = new Map(data.threads.map(item => [item.id,item]));
  if (threads.size !== data.threads.length) throw new Error('Duplicate thread ID.');
  for (const kind of ['comments','history'] as const) {
    if (new Set(data[kind].map(item => item.id)).size !== data[kind].length) throw new Error(`Duplicate ${kind} ID.`);
    for (const record of data[kind]) if (!threads.has(record.threadId)) throw new Error(`Dangling ${kind} reference.`);
  }
  for (const kind of ['threads','comments','history'] as const) if (data.counts[kind] !== data[kind].length) throw new Error(`Incorrect ${kind} count.`);
  const counts = new Map<string,number>(), latest = new Map<string,(typeof data.comments)[number]>();
  for (const record of data.comments) {
    counts.set(record.threadId,(counts.get(record.threadId) || 0) + 1);
    const previous = latest.get(record.threadId);
    const time = Date.parse(record.createdAt), previousTime = previous ? Date.parse(previous.createdAt) : -Infinity;
    if (!previous || time > previousTime || (time === previousTime && record.id > previous.id)) latest.set(record.threadId,record);
  }
  const exportScope = data.snapshot.scope;
  if (new Set(exportScope.environments).size !== exportScope.environments.length) throw new Error('Duplicate export environment.');
  const attributions = [...data.comments.flatMap(item => [item.author,...item.mentions]),...data.history.map(item => item.actor),...data.threads.flatMap(item => [item.createdBy,...(item.assignee ? [item.assignee] : [])])];
  for (const record of [...data.threads,...data.comments,...data.history,...attributions]) if(record.provenance) for(const source of [record.provenance,...(record.provenance.previous || [])]) if(source.pageUrl) {const url = new URL(source.pageUrl); if(!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsafe provenance URL.');}
  for (const record of data.threads) {
    const url = new URL(record.pageUrl);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsafe page URL.');
    if (record.workspace !== exportScope.workspace || !exportScope.environments.includes(record.environment) ||
      (exportScope.page !== undefined && record.page !== exportScope.page) || (exportScope.status !== undefined && record.status !== exportScope.status)) throw new Error('Thread outside export scope.');
    if (record.commentCount !== (counts.get(record.id) || 0)) throw new Error('Incorrect thread comment count.');
    const expected = latest.get(record.id) || null;
    if (JSON.stringify(record.latestComment) !== JSON.stringify(expected)) throw new Error('Incorrect latest comment.');
  }
  return data;
}
