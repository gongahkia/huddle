# Huddle release completion audit

Audited 14 November 2026 (Asia/Singapore) against the complete objective in GOAL.md. Implementation revision **37afbf6** is the original goal-completion baseline. A subsequent local bootstrap/origin fix is recorded in [verification](verification.md#local-startup-follow-up). The source project is preserved.

## Required acceptance gates

| # | Requirement | Authoritative evidence and result |
| --- | --- | --- |
| 1 | Fresh checkout installs, builds, initializes and starts | Clean tracked-file archive of 37afbf6: frozen install, production build, documented `pnpm bootstrap` and `pnpm start`, authenticated project/comment creation; all passed. `evidence/clean-checkout.json` records commands and startup/restore results. |
| 2 | Docker persistence across restart | Actual production Docker build and Compose service passed HTTP create → container restart → read of original comment and original session. Online SQLite backup succeeded. `evidence/docker-persistence.json`. |
| 3 | HTML, React and Angular share package/backend | Real framework examples build with the same module; Chromium review creation succeeds in all three. No framework wrapper around Pronto's React UI. |
| 4 | Complete two-reviewer coordination/export | Chromium test exercises pin → second reviewer → reply → mention → assignment → resolve/reopen → JSON export, including hostile text escaping. |
| 5 | Expiry/revocation/authorization/isolation/forgery | Service tests cover missing access, expiry/revocation, forbidden capabilities, two-project member/guest isolation, origin/environment binding, forged author fields and hostile text; browser guest revocation removes the live discussion UI. |
| 6 | Retry, reconnect, concurrency, staleness, drafts | Unit/service/browser tests cover duplicate concurrent creates/replies, conflicting retries, concurrent stale versions, durable reconnect beyond 500 events, delayed older page responses, reload recovery, offline failures and text typed during successful/failed slow saves. |
| 7 | Anchoring and host compatibility | Anchor tests cover moved, hidden, missing, changed and ambiguous targets. Browser tests cover reattachment/history, scroll/responsive behavior, SPA routes, native dialogs and popovers. |
| 8 | Lifecycle cleanup | Chromium checks 100 mount/destroy/navigation cycles against DOM/listener/heap metrics and ten authenticated cycles with no remaining SSE requests. Backend stream tests verify listener release. Duplicate mount returns the existing instance. |
| 9 | Complete large JSON/Markdown exports | 2,005 threads and 2,109 comments, including 105 comments in one thread, are exported completely in both formats. Separate snapshot test verifies concurrent writes do not alter the export snapshot. |
| 10 | Independent idempotent Pronto conversion | Local synthetic `pronto.prototype-feedback.v1` fixture imports twice without duplication, preserves source IDs/author IDs/names/timestamps and rejects incomplete input. No Pronto runtime/database is accessed. |
| 11 | All engineering checks | Clean archive: typecheck, lint, 23 unit/integration tests, production build, package smoke and all 14 Chromium tests pass. CI workflow defines these checks; remote CI itself was not run. |
| 12 | Full 100-client, ten-minute load gate | Final run: 600 seconds, 100 live review clients, 1,000 threads/20,000 comments preloaded, 2,000 audited writes, 198,000 audited peer observations, zero errors; p95 writes 45.92 ms and visibility 42.44 ms. Server/generator resources measured separately. `evidence/load-100-clients.json`. |
| 13 | Automatic complete widget budget | Clean build: installer 10,895 bytes gzip; ES module 10,541 bytes gzip, each including embedded styles and under the 76,800-byte budget. `pnpm check:bundle` is wired into CI and the Docker build. |
| 14 | Complete operation/setup documentation | Root README includes local/container startup, embedding and lifecycle, invitations, roles, persistence, JSON/Markdown export, import, online backup and stopped-service restore, limits and troubleshooting. Architecture documents protocol and data flow. Fresh startup/backup/restore commands were exercised. |
| 15 | Atomic commits and clean final tree | Extraction, service/access, widget, exports/import, workspace/examples, performance, Docker/CI, build correction and documentation were committed separately. Concurrent user commits were preserved. Final Git status is checked after this evidence commit. |

## Additional contract checks

- Separate standalone repository and main branch: verified. No Pronto files, Git state, databases, services or budget artifacts were modified. SHA-256 comparison of all 670 tracked source files and the original HEAD/status passes; see `evidence/pronto-preservation.json` and the baseline manifest.
- Source provenance and absent license status are recorded in NOTICE and the packaged browser NOTICE. No public redistribution license was invented. Dependencies retain their own licenses.
- No default administrator password, provider/model dependency, Redis, SMTP requirement, external identity provider, paid hosting, public deployment, package publication or agent-created remote repository/push.
- Administrator/member/guest roles, scoped expiring guest links, member invitations, exact-origin review authorization, one-use PKCE, server-derived authors, bounded payloads, project authorization on reads/mutations/exports/live events, and reviewer-based rate limits are implemented and covered by the recorded tests.
- Thread/page context, selected quote, normalized pin coordinates, viewport/release context, target uncertainty and manual reattachment are retained. Matching retry IDs apply a mutation once; compact references avoid transcript duplication in the ledger.
- Draft/read persistence is namespaced, capped at 2 MiB per origin, expires after 14 days and evicts oldest entries. Browser caches and comment pages are bounded. Idle measurements, heap/lifecycle observations, service RSS and database growth are recorded separately.
- Script and TypeScript installations expose mount/open/close/context update/destroy. Native dialogs/popovers and nonce-based styles are tested. CSP installer coverage uses the actual built IIFE.
- Framework independence does not assert support for every target/browser. Frame/shadow-root internals, canvas/WebGL objects, application-state reconstruction and non-Chromium browser acceptance are documented limitations. Extension delivery, recording and hosted operation are explicitly deferred by the objective.

## Evidence scope and remaining limitations

All required gates are satisfied by the recorded local evidence. The 100-client benchmark uses a documented WSL reference host and loopback clients, with server resources measured in a separate process; it is not a public-network or fixed-2-CPU capacity guarantee. The focused storage sample uses a separate disposable fixture. Raw output is ignored; sanitized evidence summaries are committed. Docker verification uses the actual Compose runtime with a build-network override required by the isolated local verification daemon. Local tests and temporary services use only Huddle-owned data.
