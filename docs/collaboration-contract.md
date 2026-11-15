# Host collaboration contract v2

This is the contract for the approved frontend-only design in [implementation-plan.adoc](implementation-plan.adoc). Implementation and acceptance are tracked in [frontend-progress.md](frontend-progress.md). The transitional v0.1 service does not implement this protocol. The new browser API will ship privately as v0.2.0.

The normative TypeScript interface is `packages/shared/src/collaboration.ts`. Public IDs and cursors are opaque case-sensitive strings, not UUIDs or sequence numbers. JSON timestamps are ISO 8601 with an explicit timezone. All async adapter methods accept an AbortSignal. An aborted request does not prove that a write was rolled back. Only explicit retry of the unchanged payload with the original idempotency key resolves an uncertain write.

## HTTP binding

The optional browser HTTP helper defaults to same-origin `/api/huddle/v2`, configurable by the host. It sends host session cookies, never Huddle bearer credentials. The host supplies its existing CSRF integration; every mutation must pass it, including staging and exports that create jobs. Cross-origin deployments require an explicit host policy. Database drivers and HTTP handlers stay outside the browser package.

All requests carry the requested `workspace` and `environment` as query parameters, except export, which carries its scope in the JSON body. Query values are percent-encoded. They request scope; they do not establish access. Host authorization checks identity, workspace and environment on **every** operation, including job progress and download. Unknown body/query properties are rejected. Responses containing private data use `Cache-Control: private, no-store`.

Success responses are direct JSON DTOs, without a wrapping envelope, except export downloads. All record IDs appearing in route segments are percent-encoded exactly once. The endpoint table names types in the TypeScript contract; cursors belong to their original scope, filters and collection, and cannot be interchanged.

| Method and relative path | Request | Success |
| --- | --- | --- |
| GET `/session` | Scope query | 200 Session with a host-approved reviewer; denied access is an error |
| GET `/threads` | Scope + ListQuery | 200 Page<Thread> |
| GET `/threads/{id}` | Scope + DetailQuery | 200 Detail |
| POST `/threads` | Create JSON | 201 Detail |
| POST `/threads/{id}/replies` | Reply JSON | 200 Detail |
| PATCH `/threads/{id}` | Update JSON | 200 Detail |
| GET `/changes` | Scope + optional cursor | 200 ChangePage |
| GET `/directory` | Scope + optional search/cursor | 200 Page<Identity>; absent when unsupported |
| POST `/exports` | `{scope: ExportScope, format: 'json'|'markdown'}` | 200 streamed download |
| POST `/imports/uploads` | Scope; application/json byte stream | 201 `{uploadId,digest}` after bounded staging |
| POST `/imports/previews` | `{uploadId,digest,mapping: ImportMapping}` | 200 ImportPreview |
| POST `/imports/jobs` | `{previewId,digest,idempotencyKey}` | 202 ImportJob |
| GET `/imports/jobs/{id}` | Scope | 200 ImportJob |

`session` capabilities are host features, not roles. Unsupported mentions/assignment values produce a validation error rather than being dropped. Directory is available only when declared. The host selects internal authenticated review or explicitly open review. An approved anonymous identity is a reviewer, not an authentication bypass. Within a permitted integration scope, reviewers have the same declared capabilities; Huddle adds no account roles. The host derives mutation author and timestamps; create/reply bodies cannot provide them.

Default list/detail page size is 50, maximum 100. Lists order by update instant descending then ID descending using binary string ordering. Comments/history order by creation instant ascending then ID ascending. Cursors must preserve a continuation boundary even when records are concurrently updated. Hosts must document that active threads can move to a newer list position; clients deduplicate refreshed records. Detail independently pages comments and history, with null indicating exhaustion. Every record remains reachable, without display caps or a separate management UI.

Changes are bounded to 100 records per request. A missing cursor establishes a current authorized baseline; clients fetch initial lists separately. `hasMore` requests immediate continuation. `reset` means the cursor expired and clients must replace cached pages before accepting the returned baseline cursor. The cursor advances only after the corresponding invalidation reads have succeeded. A cursor must not disclose events from another scope. Optional subscriptions only accelerate invalidation; polling remains the fallback.

Mutation keys are bound to authenticated scope, actor and operation (including target ID), plus a canonical payload hash. Reusing a key for a different payload fails with conflict. Mutation, idempotency result and audit/change record commit atomically. Updates require expectedVersion and at least one changed field. Independent replies append without an expected version; concurrent replies must both persist. A stale coordination version returns conflict, prompting refetch and explicit user resolution.

Default polling is ten seconds while review is active and the tab is visible (including a collapsed sidebar), with one operation in flight, bounded backoff/jitter and catch-up on reconnect/open/visibility return. No automatic write replay. Revocation clears private UI, aborts operations and ends subscriptions; the host owns sign-in.

## Error binding

All errors return `{error: {code, message, retryAfterMs?}}`. Messages are safe for display and never contain SQL, credentials, raw upstream bodies or stack traces. HTTP mapping:

| Status | code |
| --- | --- |
| 401 | unauthenticated |
| 403 | forbidden |
| 400 / 413 / 422 | validation |
| 404 | not_found |
| 409 | conflict |
| 429 | rate_limited |
| 408 / 504 | timeout |
| 500 / 502 / 503 | unavailable |

Client network failures map to network, deadline expiry to timeout, and caller cancellation retains AbortError rather than showing an unrelated failure. `retryAfterMs`, when present, is a nonnegative integer; adapters respect it for read recovery, not automatic mutation replay.

## Portable data and transfers

The structural format is [huddle.feedback.v2.schema.json](schema/huddle.feedback.v2.schema.json), generated from `packages/shared/src/portable.ts` using `pnpm exec tsx scripts/feedback-schema.ts`. Regeneration must produce no diff. The parser additionally checks actual counts, duplicate IDs, references, scope membership, thread summaries, HTTP(S) navigation URLs and absence of URL credentials. JSON is the lossless format; Markdown escapes untrusted text and is not an import format.

The machine-readable HTTP schema is [huddle.http.v2.openapi.json](schema/huddle.http.v2.openapi.json), generated with `pnpm exec tsx scripts/http-schema.ts`. Its structural schemas supplement the authorization, at-least-one-update-field, cursor and transactional rules above. Host-specific session/CSRF mechanisms cannot be replaced with a generic client-supplied identity header.

Page continuation cursors are nonempty opaque strings of at most 2,048 characters. The optional member directory returns at most 100 unique `{id,name}` entries per replaceable page and `nextCursor: string | null`. Map host account rows explicitly: extra account fields are rejected rather than serialized into review responses. Member names/IDs do not establish authorization or account provisioning.

Snapshots use separate thread/comment/history arrays, source dataset identity, explicit scope and a final `complete: true` marker. Latest comments use creation instant and binary ID ordering. Export authorization covers **all** selected environments. Workspace export includes open and resolved threads unless explicitly narrowed. The host must capture a consistent database snapshot, stream with backpressure and release it on cancellation. Truncated downloads fail parsing. Request-limited hosts may implement snapshot jobs behind their custom adapter; no mandatory worker service is introduced.

Staging validates the complete JSON before writing discussion data. The default parser limits are 32 MiB, 100,000 combined records and nesting depth 32; hosts may configure them deliberately and must bound uploads while receiving bytes. Staging is scoped to the actor and destination, expires with documented cleanup and does not fetch source URLs. Digests are lowercase SHA-256 of exact staged bytes. Preview binds digest, destination scope, mappings and expiry. Execution rechecks that binding and authorization, and requires a deliberate user action after preview.

Imports use bounded host-backed batches, durable job progress and per-record provenance `(source dataset, source record, content digest)`. Same provenance is retryable; differing content or unrelated ID collisions are conflicts. Destination IDs may differ. Provenance may include original scope/page/URL or historical identity and a flat previous-source chain; these fields are attribution, never access grants. Repeated/resumed imports must not overwrite later destination discussion. Import failures report exact rejected records; complete requires every validated record to be accounted for. All job reads recheck scope and identity. No imported author, mention or assignment creates accounts or grants access. Live identity mapping is explicit and host-approved; otherwise retain historical attribution. Environment and URL-origin mappings must be shown before execution.

The reference implementation advances one bounded batch per acknowledged POST with the same execute key; GET progress never writes. See [host transfers](host-transfers.md) for limits, expiry, cleanup and identity/URL mapping behavior.

Uninstall detaches browser imports and host routes while preserving data. Storage removal is a separate explicit host decision after a verified complete export. Migration-specific Pronto conversion belongs in Pronto, not the permanent SDK.

## Shared comment colors

Hosts may opt in with the optional `session.capabilities.commentColors` flag. Create/reply then accept an optional `color` chosen from `green`, `blue`, `violet`, `amber`, `rose` or `slate`. The server validates this capability and palette; arbitrary CSS is rejected. A new thread retains its initial color for its pin, and each reply retains its own color. JSON/Markdown transfers preserve these fields. Existing records without a color use the theme default. The v2 DTO/schema additions are optional for new readers; old strict readers cannot read colored exports. Upgrade the host and browser together before enabling the flag; older hosts without it receive ordinary uncolored writes. Display names and stable reviewer IDs are issued by the host, including for anonymous public review. A generated or self-chosen display name grants no access.
