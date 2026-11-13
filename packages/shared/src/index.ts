export type Role = 'administrator' | 'member' | 'guest';
export type Anchor = {
  kind: 'page' | 'element'; selector: string; label: string; quote: string;
  x: number; y: number; tag?: string; stableKey?: string; context?: string;
  viewport?: {width: number; height: number};
};
export type ReviewContext = {environment: string; page: string; pageUrl: string; release?: string};
export type Actor = {id: string; name: string; role: Role; projectId?: string; environment?: string; origin?: string; grantId?: string; sessionId: string};
export type Member = {id: string; name: string; email: string; role: Role};
export type Comment = {id: string; authorId: string | null; authorName: string; body: string; mentions: string[]; createdAt: string; sourceId?: string};
export type Thread = ReviewContext & {id: string; projectId: string; anchor: Anchor; status: 'open' | 'resolved'; assigneeId: string | null; createdAt: string; updatedAt: string; version: number; commentCount: number; latestComment: Comment | null; mentionedIds: string[]; sourceId?: string};
export type ThreadDetail = Thread & {comments: Comment[]; nextCursor: number | null; history: {id: number; action: string; actorName: string; createdAt: string; data: unknown}[]};
export type Change = {seq: number; threadId: string; type: string; environment: string};
export type Page<T> = {items: T[]; nextCursor: number | null; cursor: number};
export const API_VERSION = 'huddle.feedback.v1';
