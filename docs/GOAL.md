Build and verify a complete, usable first release of Huddle in a new standalone Git repository at /home/gongahkia/coding/projects/huddle. Extract and generalize the useful shared-commenting foundations from /home/gongahkia/coding/projects/pronto-prod without modifying that repository. Continue through implementation, testing, performance validation, documentation and atomic Git commits until the completion criteria below are satisfied.

PRODUCT INTENT

Huddle is a lightweight, self-hosted collaboration layer for product teams reviewing working websites.

Designers, developers and invited testers should be able to open a website, pin feedback to an element, discuss it, assign ownership, resolve it and export the complete discussion with useful context.

Agreed product decisions:
- First audience: product teams reviewing their own applications.
- Self-hosted first.
- Embedded JavaScript script / TypeScript package is the primary installation.
- Members plus scoped, expiring guest review links.
- Lightweight coordination: comments, replies, mentions, one optional assignee, open/resolved status.
- Validate an initial target of 100 concurrent reviewers.
- Framework-independent browser engine supporting plain HTML, React and Angular.
- A browser extension is a subsequent milestone. Make the engine reusable by an extension, but do not implement or publish an extension in this goal.
- Keep the browser footprint, storage and idle activity small.

REPOSITORY AND EXECUTION BOUNDARIES

1. Inspect applicable AGENTS.md instructions in the source and destination ancestry.
2. Inspect the destination before creating it. If unrelated files already exist, preserve them and resolve the conflict rather than overwriting.
3. Create the sibling huddle directory and initialize its own Git repository with a main branch.
4. Treat pronto-prod as read-only reference material. Preserve its files, Git state, databases, services and evaluation artifacts.
5. Do not copy .git, node_modules, .env files, credentials, customer data, generated reports or the whole Pronto application.
6. Use new, isolated Huddle development and test data. Never reuse Pronto database connections or fixtures.
7. Local dependency installation, development servers, disposable test resources and local Git commits are authorized.
8. Do not provision paid services, make paid model calls, deploy publicly, publish packages, create a remote repository or push commits.
9. Inspect source licensing and retain applicable notices. Record provenance for adapted code; do not invent permission to relicense it.
10. Work autonomously on routine implementation decisions. Ask only about genuinely blocking requirements or authorization issues. Do not stop after scaffolding or a plan.

SOURCE DISCOVERY

Read the existing implementation and its tests before extracting code:

- src/components/demo-feedback.tsx
- src/components/use-draft-editor.ts
- src/components/auto-refresh.tsx
- src/lib/feedback/*
- src/app/api/demo/feedback/route.ts
- src/app/api/demo/feedback/export/route.ts
- db/migrations/051_demo_feedback.sql
- db/migrations/055_demo_feedback_request_ids.sql
- tests/unit/*feedback*
- tests/integration/demo-feedback-db.test.ts
- docs/ops/prototype-feedback.md

Preserve useful behavior:
- Page comments and element pins.
- Target labels, selected text and relative element coordinates.
- Moved/changed/missing/hidden target reporting.
- Shared threads and replies.
- Resolve/reopen.
- Retry deduplication.
- Draft recovery, including edits made during an in-flight save.
- Unread indicators.
- Versioned exports with explicit completeness information.

Remove Pronto-specific dependencies:
- Demo workspace constants and route restrictions.
- Pronto identities, authentication and permission assumptions.
- Next.js navigation and components.
- Application-wide Tailwind classes and theme variables.
- Fixed API locations and deployment assumptions.

Do not simply wrap the existing React component and call it framework-independent.

IMPLEMENTATION DEFAULTS

Use these defaults to keep the project small and finishable:
- TypeScript, Node 24 and pnpm.
- A workspace with a browser package, collaboration service, management UI and integration examples.
- Framework-independent browser runtime and self-contained styles.
- Fastify for the service.
- SQLite in WAL mode for a single-instance self-hosted deployment.
- React with Vite for the management UI, isolated from the browser widget bundle.
- HTTP mutations and cursor-based reads, with SSE for incremental updates.
- Vitest for unit/integration tests and Playwright for browser acceptance.
- A Docker image with persistent storage and a documented Compose quick start.
- No Redis, external identity provider, SMTP or AI dependency for the first release.

Check current official documentation when implementing unfamiliar or version-sensitive APIs. Pin dependencies and commit the lockfile.

REQUIRED USER JOURNEYS

A. Setup and project management
- Bootstrap an administrator without a checked-in default password.
- Create a project and configure its allowed website origins.
- Create member invitations without requiring email infrastructure.
- Provide an installation snippet and TypeScript usage example.
- Create, revoke and expire guest review links.
- Distinguish application environments so staging and production feedback are not accidentally combined.

B. Website review
- Open the commenting interface without disrupting normal browsing.
- Leave a page comment or deliberately enter pin-selection mode.
- Pin a specific element and optionally quote selected text.
- Cancel selection with Escape.
- Read and reply to threads.
- Mention project members, assign a member, resolve and reopen.
- Preserve drafts through reloads and temporary connectivity failures.
- Show useful errors and recover without duplicate comments.
- Let a second browser session see updates.

C. Team coordination
- Provide a project-wide feedback inbox.
- Filter by page, environment, status, assignee and mentions.
- Link from a thread back to its reviewed page and target.
- Include in-app unread/mention indicators.
- Keep discussion history available after a thread is resolved.

D. Export
- Export complete project feedback as versioned JSON and readable Markdown.
- Include stable IDs, authors, timestamps, replies, status, assignee, mentions, page/environment context and anchor information.
- Stream or paginate large exports with explicit completeness.
- Treat comment text as untrusted data in exports intended for coding agents.
- Provide a local import/conversion command for Pronto’s existing feedback JSON format. Never access its live database. Make repeated imports idempotent and preserve source identifiers and author attribution.

ANCHORING AND HOST COMPATIBILITY

- Operate on browser DOM APIs without depending on React, Angular or framework internals.
- Use multiple clues for anchors: stable identifiers, selector, tag, text and nearby context.
- Store relative coordinates, viewport information and optional release metadata.
- Report uncertainty when a target changes; do not silently attach to an ambiguous replacement.
- Support manual reattachment with recorded history.
- Handle SPA navigation, scrolling, resizing, layout changes and target removal.
- Provide configurable page identity for meaningful query/hash routes without retaining sensitive URL parameters by default.
- Isolate widget styles, preferably using Shadow DOM.
- Handle common modal/popover and stacking scenarios deliberately; an enormous z-index is not a complete solution.
- Document unsupported cases such as inaccessible frame contents, closed shadow roots and canvas-internal objects.
- Provide mount, open, close, context-update and destroy capabilities.
- Destroy must remove listeners, observers, connections and injected UI.
- Mounting twice must not create duplicate widgets.
- Preserve normal page interactions outside explicit pin selection and widget controls.
- Use keyboard-accessible controls and sensible focus behavior.

IDENTITY AND ACCESS

- Enforce project permissions on the server for every read, mutation, export and live-update subscription.
- Use administrator/member/guest roles with documented capabilities.
- Members coordinate and resolve work; guests can read the invited project’s review discussions, create comments and reply, but cannot administer membership or exports.
- Guest links must be scoped, expiring and revocable; revocation must invalidate derived access.
- A project ID or installation key must never grant access to private comments.
- Derive author identity from authenticated sessions, never client-supplied author fields.
- Make cross-origin embedding work without assuming third-party cookies are available.
- Use an explicit authenticated handshake for widget review access, with exact origin validation and narrowly scoped credentials.
- Avoid retaining invitation secrets in reviewed-page URLs, exports or logs.
- Escape user content, validate requests, bound payload sizes and rate-limit authentication and mutations.
- Verify isolation between at least two projects and multiple users.

LIGHTWEIGHT OPERATION

- Lazy-load the interface where practical.
- Fetch thread summaries first and load replies on demand.
- Use incremental updates instead of repeatedly downloading all workspace comments.
- Bound browser caches and namespace local drafts/read state by user, project and page.
- Cap Huddle-managed browser persistence at 2 MiB with documented eviction behavior.
- Avoid periodic full-document scans. Batch geometry work and scope observation to relevant changes.
- Pause unnecessary work in hidden tabs.
- Keep screenshots, video, session replay, click recording and network/console capture outside this release.
- Target at most 75 KiB gzip for the complete browser widget JavaScript and CSS, excluding the separate management UI.
- Measure bundle size, browser heap behavior, idle activity, server memory and database growth. Report actual results rather than claiming “lightweight” from source-code size.

VERIFICATION AND ACCEPTANCE

The goal is complete only when:

1. A fresh checkout can install dependencies, build, initialize a new database and start using documented commands.
2. The Docker deployment persists comments across service restarts.
3. Plain HTML, React and Angular examples use the same browser package and backend.
4. Browser tests exercise create → second reviewer reply → mention → assign → resolve/reopen → export.
5. Tests cover guest expiry/revocation, authorization failures, project isolation, forged author fields and hostile comment content.
6. Tests cover duplicate/retried writes, reconnect catch-up, concurrent updates, stale responses and draft recovery.
7. Tests cover moved/removed/ambiguous targets, reattachment, SPA navigation, scrolling, responsive layout and common dialogs.
8. Mount/destroy and navigation cycles show no accumulating listeners, connections or retained widget instances.
9. JSON and Markdown exports include all records from a dataset exceeding Pronto’s old display/export limits.
10. The Pronto import fixture works without depending on Pronto runtime code or databases.
11. Type checking, lint, unit/integration tests, browser tests and production builds pass.
12. A reproducible 10-minute load test uses 100 concurrent review clients, a preloaded dataset of 1,000 threads and 20,000 comments, and one mutation per client every 30 seconds. Verify no lost/duplicate writes, p95 mutation latency below 500 ms and p95 update visibility below 2 seconds on a documented reference environment. Measure server resources separately from load-generator resources. Report constraints honestly if the environment cannot run this test; do not substitute a claim of success.
13. The browser bundle budget is checked automatically.
14. The README documents setup, embedding, invitations, permissions, persistence, backup/restore, exports, limitations and troubleshooting.
15. All intended changes are committed and the Huddle working tree is clean.

Keep benchmark artifacts reproducible and summarize their evidence in the repository. Use only disposable Huddle fixtures for destructive tests.

GIT DISCIPLINE

Make frequent, meaningful, atomic Git commits throughout implementation.

- Commit each coherent, reviewable change with its relevant tests.
- Examples of boundaries: project setup; extracted anchor engine; persistence/authentication; widget integration; team workflow; exports/import; browser compatibility; performance; documentation.
- Keep refactors separate from unrelated behavior changes where practical.
- Run relevant checks before each commit and the complete suite before finishing.
- Inspect staged diffs. Never commit secrets, databases, node_modules, build output or unrelated files.
- Do not accumulate the whole project into one giant final commit.
- Do not create empty or artificial commits to hit a count.
- Do not rewrite completed history merely for presentation.

WORKING METHOD AND HANDOFF

Start by recording a concise implementation sequence and source-extraction notes in the new repository, then execute it. Maintain a short progress record so another session can resume after interruption.

Use the agreed product decisions and defaults above. Resolve minor choices autonomously and document important decisions. Do not expand into billing, a full project-management platform, recording analytics or extension distribution.

Continue fixing failures and validating the result until the completion criteria are met. If a genuine external blocker prevents completion, finish independent work, preserve reproducible evidence, identify the exact blocker and do not mark the goal complete.

Finish with:
- Repository location and exact startup commands.
- What users can do.
- Test and benchmark results.
- Known limitations and any unmet acceptance criteria.
- A concise summary of the atomic commits.
- Confirmation that pronto-prod was preserved.