# Architecture and interfaces

## Components

The TypeScript workspace contains a DOM-based browser package, a Fastify/Node service, a separate React management UI and real HTML/React/Angular/Vue/Svelte/Preact/Solid examples, plus production Next.js/Nuxt/SvelteKit/Astro fixtures. Optional framework entry points share one emitted engine through ESM chunks; framework runtimes are external optional peers. The core has no framework runtime dependency. Builds produce a standalone installer IIFE, ESM entry points/shared chunks and bundled TypeScript declarations. Vite bundles management/example assets; these are excluded from the widget budget. Budget checks include the complete core import graph.

The Node service uses built-in SQLite, WAL mode, parameterized queries and foreign keys. It is a single-process/single-instance deployment. Schema initialization and additive source-author and compact-retry-record migrations run on startup. Each discussion mutation, history change, durable event and idempotency result is committed in one immediate transaction. SSE notification happens only after commit.

A version number provides optimistic concurrency for coordination changes. Matching retries follow the saved thread reference and return its current authorized detail; reusing a request ID with a different payload returns 409. Requests and events remain durable for retry/reconnect behavior. Feedback data is retained until the instance owner manages its database; no automatic discussion deletion or distributed replica mode is implemented.

## Review access

1. A reviewer signs in to the service or accepts an invitation on its top-level origin. Management uses an HttpOnly SameSite=Lax cookie; Secure is set for HTTPS deployments.
2. The widget opens a popup with public project/environment/origin context, a random state value and a PKCE challenge. No credential is in that URL.
3. The reviewer explicitly approves. The service verifies membership, project origins and environment and issues a 60-second one-use code.
4. The popup posts that code to the exact reviewed origin. The parent checks the message origin, popup source and state.
5. The widget exchanges the code and verifier. The service verifies the request Origin and consumes the code atomically.
6. The returned credential is held in memory and scoped to origin/project/environment. Every operation checks that scope and the current grant state.

Guest-link secrets are stored as hashes in the database. Accepting a guest link creates an attributed guest identity and project-scoped session. Revocation invalidates all derived guest access and closes connected streams. Member invitations are single-use and do not overwrite an existing account password. Administrators are instance-wide administrators, including visibility of all projects. Widget credentials cannot perform instance administration or project-wide export.

The shared DOM and host page remain within the trust boundary of the embedded widget: Shadow DOM is style encapsulation, not a secure enclave. The service must be installed only on reviewed origins the project intends to trust.

## HTTP contract

All mutations are JSON, limited to 16 KiB. Comments are bounded to 3,000 characters. Validation rejects unknown mutation fields, including client-supplied author identity. Routes return 400 for invalid requests, 401 for missing/expired access, 403 for forbidden capabilities/origins, 404 for inaccessible projects/threads, 409 for stale versions or conflicting retry IDs, and 410 for unusable invitations.

Cookie mutations require the configured service Origin. Widget calls use an Authorization bearer header and their exact reviewed Origin. Credentials never appear in SSE query strings. Authenticated API requests are rate limited by resolved reviewer identity, with IP fallback for unauthenticated calls and stricter login/invitation limits.

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Database-backed liveness; no private content. |
| `POST /api/auth/login`, `/logout` | Management sign-in/out. |
| `GET /api/session` | Authenticated actor and scope. |
| `POST /api/auth/invitation`, `/accept` | Inspect/accept a link secret supplied in the request body. |
| `POST /api/auth/authorize`, `/exchange` | Popup authorization and single-use PKCE exchange. |
| `GET/POST /api/projects` | List accessible projects / administrator creates a project with name, exact origins and environment slugs. |
| `GET /api/projects/:projectId/members` | Assignable/mentionable members; guest responses omit email addresses. |
| `GET/POST /api/projects/:projectId/invitations` | Administrator invitation listing/creation; new link shown once. |
| `POST .../invitations/:id/revoke` | Revoke guest/member invitation. |
| `GET/POST /api/projects/:projectId/threads` | Cursor-filtered summaries / create a discussion. |
| `GET .../threads/:id?after=...` | Detail with a page of 50 comments and up to 100 recent history entries. |
| `POST .../threads/:id/replies` | Add an attributed reply and optional member mentions. |
| `PATCH .../threads/:id` | Member-only status, assignee or anchor change with expected version. |
| `GET .../changes?after=...` | Durable incremental event cursor. |
| `GET .../events?after=...` | Authenticated SSE stream; supports Last-Event-ID reconnect. |
| `GET .../export?format=json|markdown` | Member-only complete snapshot; use a management session. |

Thread creation accepts `requestId`, `environment`, `page`, `pageUrl`, optional `release`, `anchor`, `body` and `mentions`. Reply accepts `requestId`, `body` and `mentions`. Coordination accepts `requestId`, `expectedVersion` and any of `status`, nullable `assigneeId` or `anchor`. Mentions/assignments must refer to actual members of the project.

Thread summaries contain stable IDs, context, anchor, status, assignee, version, counts, latest comment and mentioned member IDs. They do not carry the entire reply history. Thread listing filters are `environment`, `page`, `status`, `assigneeId`, `mentionedId`, `before` and `limit` (up to 50). Replies have an independent continuation cursor. Full history is available in exports.

SSE events contain only sequence, thread ID, environment and change type. The client batches invalidation reads; hidden widget tabs abort their connection and resume from the last processed sequence on return. History stays in SQLite; slow stream consumers are disconnected at a bounded output-buffer size. Single-instance listeners require no broker.

Exports use a separate WAL reader transaction for one consistent snapshot while ordinary writes continue. An async generator honors response backpressure and does not accumulate the whole project. Long downloads can delay WAL checkpointing. Imported comments retain original source IDs/author IDs without granting those source identities Huddle permissions.

## Browser lifecycle and limits

`mount(options)` returns `open`, `close`, `updateContext` and `destroy`. One document has one active widget. The installer supports project/environment/release attributes and derives the service origin from the script URL unless explicitly configured.

Optional helpers acquire an exclusive owner in the same engine registry. They cannot adopt or destroy another helper/manual installation. Manual identical-settings mount behavior is preserved. A reusable binding supports development effect replay: null/disposal releases only its own current controller; subsequent mounting acquires a fresh one. Context options update in place; installation options trigger remounting. The Svelte helper is an action, Angular uses after-next-render/DestroyRef, and Astro follows document-swap/page-load events. See [framework-helpers.md](framework-helpers.md).

Targeting uses stable attributes, selectors, tag/text and nearby context. Ambiguous matches are flagged rather than guessed. Manual reattachment records previous/new anchors. Resolution occurs on relevant DOM changes and is batched with animation frames; scroll only remeasures cached targets. Pointer selection is enabled only on request and consumes that deliberate click. Native dialog and popover handling uses the browser top layer and moves the overlay into an active modal to avoid native inertness.

Destroy aborts fetch/stream/popup work, removes listeners/observers/frames, restores owned History API wrappers and removes injected UI. Wrappers added by other tools are preserved. Dynamic viewport positioning uses element-relative coordinates. No framework component tree is read or modified.

Drafts and read state use bounded, namespaced local storage with 14-day expiry. Total Huddle-managed persistence across namespaces is at most 2 MiB in UTF-16 accounting; oldest entries are evicted first. The widget holds at most 150 summary records and 250 loaded replies; its members picker shows up to 100 members and each comment can mention up to 30. Workspace paging/exports provide access to larger histories.

Standard light-DOM targets are supported. Frame contents, shadow-root-internal targeting, canvas objects and reconstructed app state are outside this release. See the [integration matrix](integration.md) for measured browser/framework coverage and [failure handling](reliability.md) for recovery behavior.

## Operations

Use one persistent local volume. Container root filesystem is read-only; the database volume is writable. SQLite's backup API is exposed through the local/compiled CLI. Restore while the service is stopped, keep old WAL/SHM files separate and preserve file ownership. Root README contains exact startup, backup and restore commands.

The full load benchmark measures a separate server process and generator process on the same host. It is a reproducible reference test, not an external-network or production-capacity guarantee. Raw measurements live under ignored output; sanitized evidence and limitations are recorded in verification.md.
