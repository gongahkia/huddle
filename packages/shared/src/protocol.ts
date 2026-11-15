import * as z from "zod/mini";
import { feedbackSnapshotSchema, portableShapes as s } from './portable';
const capabilities = z.strictObject({ mentions: z.boolean(), assignment: z.boolean(), directory: z.boolean(), commentColors: z.optional(z.boolean()) });
const identity = z.strictObject({ id: s.id, name: z.string().check(z.minLength(1)).check(z.maxLength(1000)) });
const scope = z.strictObject({ workspace: s.id, environment: s.id });
const page = <T extends z.ZodMiniType>(item: T) => z.strictObject({ items: z.array(item), nextCursor: z.nullable(z.string().check(z.minLength(1)).check(z.maxLength(2048))) });
const counts = z.strictObject({ threads: s.count, comments: s.count, history: s.count });
const mapping = z.strictObject({ environmentMap: z.record(z.string(), s.id), originMap: z.record(z.string(), z.url()), identityMap: z.record(z.string(), s.id) });
const rejected = z.array(z.strictObject({ recordId: s.id, reason: z.string() }));
const mutation = { idempotencyKey: s.id };
const errors = z.enum(['unauthenticated', 'forbidden', 'validation', 'not_found', 'conflict', 'rate_limited', 'timeout', 'network', 'unavailable']);
export const httpSchemas = {
    FeedbackSnapshot: feedbackSnapshotSchema,
    Session: z.strictObject({ actor: identity, scope, capabilities }),
    ThreadPage: page(s.thread),
    Detail: z.strictObject({ thread: s.thread, comments: page(s.comment), history: page(s.history) }),
    Create: z.strictObject({ ...mutation, page: z.string().check(z.minLength(1)).check(z.maxLength(4096)), pageUrl: z.url().check(z.maxLength(8192)), release: z.optional(z.string().check(z.maxLength(1000))), viewContext: z.optional(z.json()), anchor: s.anchor, body: z.string().check(z.minLength(1)).check(z.maxLength(100000)), color: z.optional(s.color), mentions: z.optional(z.array(s.id).check(z.maxLength(1000))) }),
    Reply: z.strictObject({ ...mutation, body: z.string().check(z.minLength(1)).check(z.maxLength(100000)), color: z.optional(s.color), mentions: z.optional(z.array(s.id).check(z.maxLength(1000))) }),
    Update: z.strictObject({ ...mutation, expectedVersion: z.int().check(z.gt(0)), status: z.optional(z.enum(['open', 'resolved'])), anchor: z.optional(s.anchor), assigneeId: z.optional(z.nullable(s.id)) }),
    ChangePage: z.strictObject({ items: z.array(z.strictObject({ threadId: s.id, kind: z.enum(['created', 'updated', 'imported']) })).check(z.maxLength(100)), cursor: s.id, hasMore: z.boolean(), reset: z.boolean() }),
    Directory: page(identity),
    Export: z.strictObject({ scope: s.scope, format: z.enum(['json', 'markdown']) }),
    Upload: z.strictObject({ uploadId: s.id, digest: z.string().check(z.regex(/^[a-f0-9]{64}$/)) }),
    PreviewRequest: z.strictObject({ uploadId: s.id, digest: z.string().check(z.regex(/^[a-f0-9]{64}$/)), mapping }),
    ImportPreview: z.strictObject({ id: s.id, digest: z.string().check(z.regex(/^[a-f0-9]{64}$/)), scope, mapping, counts, historicalAuthors: z.array(s.attribution), conflicts: rejected, expiresAt: s.timestamp }),
    Execute: z.strictObject({ ...mutation, previewId: s.id, digest: z.string().check(z.regex(/^[a-f0-9]{64}$/)) }),
    ImportJob: z.strictObject({ id: s.id, state: z.enum(['pending', 'running', 'complete', 'failed']), expected: counts, processed: counts, rejected, error: z.optional(z.string()) }),
    Error: z.strictObject({ error: z.strictObject({ code: errors, message: z.string(), retryAfterMs: z.optional(z.int().check(z.gte(0))) }) }),
};
