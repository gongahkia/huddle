import * as z from "zod/mini";
import { COMMENT_COLORS, type FeedbackSnapshot } from './collaboration';
const id = z.string().check(z.minLength(1)).check(z.maxLength(512)), timestamp = z.iso.datetime({ offset: true });
const provenanceRecord = z.strictObject({ datasetId: id, recordId: id, digest: z.string().check(z.regex(/^[a-f0-9]{64}$/)), scope: z.optional(z.strictObject({ workspace: id, environment: id })), page: z.optional(z.string().check(z.maxLength(4096))), pageUrl: z.optional(z.url().check(z.maxLength(8192))), identity: z.optional(z.strictObject({ id, name: z.string().check(z.minLength(1)).check(z.maxLength(1000)) })) });
const provenance = z.extend(provenanceRecord, { previous: z.optional(z.array(provenanceRecord).check(z.maxLength(1000))) });
const attribution = z.strictObject({ id, name: z.string().check(z.minLength(1)).check(z.maxLength(1000)), provenance: z.optional(provenance) });
const scope = z.strictObject({ workspace: id, environments: z.array(id).check(z.minLength(1)), page: z.optional(z.string().check(z.maxLength(4096))), status: z.optional(z.enum(['open', 'resolved'])) });
const anchor = z.strictObject({
    kind: z.enum(['page', 'element']), selector: z.string().check(z.maxLength(16384)), label: z.string().check(z.minLength(1)).check(z.maxLength(4096)), quote: z.string().check(z.maxLength(16384)),
    x: z.number().check(z.gte(0)).check(z.lte(1)), y: z.number().check(z.gte(0)).check(z.lte(1)), tag: z.optional(z.string().check(z.maxLength(100))), stableKey: z.optional(z.string().check(z.maxLength(16384))), context: z.optional(z.string().check(z.maxLength(16384))),
    viewport: z.optional(z.strictObject({ width: z.number().check(z.gte(0)).check(z.lte(100000)), height: z.number().check(z.gte(0)).check(z.lte(100000)) })),
});
const color = z.enum(COMMENT_COLORS);
const comment = z.strictObject({ id, threadId: id, author: attribution, body: z.string().check(z.minLength(1)).check(z.maxLength(100000)), mentions: z.array(attribution).check(z.maxLength(1000)), color: z.optional(color), createdAt: timestamp, provenance: z.optional(provenance) });
const thread = z.strictObject({
    id, workspace: id, environment: id, page: z.string().check(z.minLength(1)).check(z.maxLength(4096)), pageUrl: z.url().check(z.maxLength(8192)), release: z.optional(z.string().check(z.maxLength(1000))), viewContext: z.optional(z.json()),
    anchor, color: z.optional(color), status: z.enum(['open', 'resolved']), assignee: z.nullable(attribution), createdBy: attribution, createdAt: timestamp, updatedAt: timestamp,
    version: z.int().check(z.gt(0)), commentCount: z.int().check(z.gte(0)), latestComment: z.nullable(comment), provenance: z.optional(provenance),
});
const history = z.strictObject({ id, threadId: id, actor: attribution, action: z.string().check(z.minLength(1)).check(z.maxLength(100)), data: z.json(), createdAt: timestamp, provenance: z.optional(provenance) });
const count = z.int().check(z.gte(0));
export const portableShapes = { id, timestamp, attribution, scope, anchor, color, comment, thread, history, count };
// Structural schema is also published as JSON Schema; cross-record checks run below.
export const feedbackSnapshotSchema = z.strictObject({
    schema: z.literal('huddle.feedback.v2'), datasetId: id,
    snapshot: z.strictObject({ id, createdAt: timestamp, scope }),
    contentIsUntrustedUserInput: z.literal(true), complete: z.literal(true),
    counts: z.strictObject({ threads: count, comments: count, history: count }),
    threads: z.array(thread), comments: z.array(comment), history: z.array(history),
}) satisfies z.ZodMiniType<FeedbackSnapshot>;
export type ImportLimits = {
    maxBytes: number;
    maxRecords: number;
    maxDepth: number;
};
export const defaultImportLimits: ImportLimits = { maxBytes: 32 * 1024 * 1024, maxRecords: 100000, maxDepth: 32 };
export function parseFeedbackSnapshot(json: string, limits: Partial<ImportLimits> = {}): FeedbackSnapshot {
    const bounds = { ...defaultImportLimits, ...limits };
    for (const value of Object.values(bounds))
        if (!Number.isSafeInteger(value) || value < 1)
            throw new Error('Import limits must be positive safe integers.');
    if (new TextEncoder().encode(json).byteLength > bounds.maxBytes)
        throw new Error('Import exceeds byte limit.');
    const input: unknown = JSON.parse(json);
    const pending = [{ value: input, depth: 0 }];
    while (pending.length) {
        const { value, depth } = pending.pop()!;
        if (depth > bounds.maxDepth)
            throw new Error('Import exceeds nesting limit.');
        if (value && typeof value === 'object')
            for (const child of Object.values(value))
                pending.push({ value: child, depth: depth + 1 });
    }
    const data = feedbackSnapshotSchema.parse(input);
    const total = data.threads.length + data.comments.length + data.history.length;
    if (total > bounds.maxRecords)
        throw new Error('Import exceeds record limit.');
    for (const record of [...data.threads, ...data.comments, ...data.history]) {
        const pending: unknown[] = [record];
        let nodes = 0;
        while (pending.length) {
            const value = pending.pop();
            if (++nodes > 10000)
                throw new Error('Import record exceeds complexity limit.');
            if (value && typeof value === 'object')
                pending.push(...Object.values(value));
        }
    }
    const threads = new Map(data.threads.map(item => [item.id, item]));
    if (threads.size !== data.threads.length)
        throw new Error('Duplicate thread ID.');
    for (const kind of ['comments', 'history'] as const) {
        if (new Set(data[kind].map(item => item.id)).size !== data[kind].length)
            throw new Error(`Duplicate ${kind} ID.`);
        for (const record of data[kind])
            if (!threads.has(record.threadId))
                throw new Error(`Dangling ${kind} reference.`);
    }
    for (const kind of ['threads', 'comments', 'history'] as const)
        if (data.counts[kind] !== data[kind].length)
            throw new Error(`Incorrect ${kind} count.`);
    const counts = new Map<string, number>(), latest = new Map<string, (typeof data.comments)[number]>();
    for (const record of data.comments) {
        counts.set(record.threadId, (counts.get(record.threadId) || 0) + 1);
        const previous = latest.get(record.threadId);
        const time = Date.parse(record.createdAt), previousTime = previous ? Date.parse(previous.createdAt) : -Infinity;
        if (!previous || time > previousTime || (time === previousTime && record.id > previous.id))
            latest.set(record.threadId, record);
    }
    const exportScope = data.snapshot.scope;
    if (new Set(exportScope.environments).size !== exportScope.environments.length)
        throw new Error('Duplicate export environment.');
    const attributions = [...data.comments.flatMap(item => [item.author, ...item.mentions]), ...data.history.map(item => item.actor), ...data.threads.flatMap(item => [item.createdBy, ...(item.assignee ? [item.assignee] : [])])];
    for (const record of [...data.threads, ...data.comments, ...data.history, ...attributions])
        if (record.provenance)
            for (const source of [record.provenance, ...(record.provenance.previous || [])])
                if (source.pageUrl) {
                    const url = new URL(source.pageUrl);
                    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
                        throw new Error('Unsafe provenance URL.');
                }
    for (const record of data.threads) {
        const url = new URL(record.pageUrl);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
            throw new Error('Unsafe page URL.');
        if (record.workspace !== exportScope.workspace || !exportScope.environments.includes(record.environment) ||
            (exportScope.page !== undefined && record.page !== exportScope.page) || (exportScope.status !== undefined && record.status !== exportScope.status))
            throw new Error('Thread outside export scope.');
        if (record.commentCount !== (counts.get(record.id) || 0))
            throw new Error('Incorrect thread comment count.');
        const expected = latest.get(record.id) || null;
        if (JSON.stringify(record.latestComment) !== JSON.stringify(expected))
            throw new Error('Incorrect latest comment.');
    }
    return data;
}
