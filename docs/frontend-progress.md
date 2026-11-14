# Frontend-only implementation progress

The active scope is [implementation-plan.adoc](implementation-plan.adoc), authorized by the user's implementation goal. Older self-hosting goals, architecture notes and measurements are historical evidence, not acceptance of this architecture.

## Starting state

- Huddle: clean main at 996e10f; Pronto: clean main at ac588e6. Both include the existing service-backed integration.
- Installed Node 24.21.0 and pnpm 10.33.0 using mise. Commands run with `mise exec node@24.21.0 pnpm@10.33.0 -- …`; no global desktop settings changed.
- Both frozen installs passed without lockfile changes.
- Existing `.data` and ignored `output` directories are present. Their databases and feedback have not been modified or declared disposable. Actual dataset provenance, authorized backups and production access remain to be verified.
- Docker executable exists, but daemon access is denied for this user. PostgreSQL client and Chromium executable exist; no PostgreSQL/MySQL/MongoDB server executable was found on PATH. Only Chromium was cached initially. CI/Render access has not been verified.

## Fresh baseline

Huddle: typecheck, lint, 42 tests, build, package smoke and bundle checks passed. Complete core graph: 11,865 bytes gzip; installer: 12,177 bytes gzip, each below 76,800 bytes. Initial browser run failed because cached binaries did not match Playwright 1.65.0. Installed matching binaries and reran: Chromium 34 passed; Firefox 32 passed / two CDP-only checks skipped. All 34 WebKit cases failed at launch because required ICU/XML libraries are absent. This is an incomplete full-browser gate, not a passing WebKit result.

Pronto: typecheck, lint, build passed. Vitest: 140 files passed / 21 skipped; 933 tests passed / 135 skipped. Its existing safety setup blocks real database access and external fetches. These skipped database tests are not database acceptance.

Raw local logs are ignored under `output/frontend-v2/baseline` in Huddle and `output/huddle-v2/baseline` in Pronto. These results apply to the starting architecture, not the upcoming adapter implementation.

## Stage 1

Added neutral collaboration types, a versioned HTTP binding, a portable JSON Schema and bounded semantic snapshot validation. Legacy engine/types remain temporarily so integration milestones can remain buildable. New contracts contain host identities and opaque cursors, without Huddle roles, sessions or grants. The browser has not been switched to these contracts yet.

The neutral types and CollaborationError are exported from the browser package. `pnpm generate:schemas` generates both the portable schema and OpenAPI 3.1 document. New tests cover incomplete downloads, count/reference/summary consistency, scope escape, unsafe navigation, Unicode/plain-text preservation and import bounds. Private environment files and the old evaluation budget file are absent from the expected paths in these clones; no production access or actual migration is inferred from repository availability.

Stage 1 verification: schema generation, typecheck, lint and all 49 tests pass. Production build, all eight isolated packed consumers and bundle checks pass; current core is 11,963 bytes gzip and installer 12,175 bytes gzip. Chromium/Firefox emitted ownership tests pass against the new build (two tests). Review found and corrected recursive JSON references when embedding schemas in OpenAPI; a regression test resolves every published local reference.

This established the contract baseline for the engine change recorded below. Real database conformance, server matrix, portability, actual data migration and hosted gates remain pending. The WebKit runtime and Docker access limitations remain separate verification gaps, not reasons to stop independent implementation.

## Stage 2

The private SDK is now version 0.2.0. The browser engine uses a supplied host collaboration adapter, namespace and workspace. Old server URL/project/token options fail with an explicit migration error. The core no longer imports popup auth, bearer transport, roles, SSE or management navigation. Legacy server/manage code and its unit tests remain temporarily for migration; they are not the new product backend.

The optional `/http` entry implements the same-origin host protocol, existing-session credentials, configurable host CSRF headers, safe errors, deadlines, cancellation, bounded upload staging and streamed download consumption. It is separate from the core graph. Framework helpers validate before replacing an owned overlay; scope/release updates cancel stale operations while preserving ownership. SSR imports remain safe.

The panel uses replaceable thread/reply/history page windows. Ten-second polling runs only while open and visible, with bounded recovery, session rechecks, cancellation and optional-subscription fallback. Denial and identity changes clear private state. Explicit uncertain-write retries retain their original keys and captured view context, including after reload. Privacy hooks cover anchor/context strings, exclusions and bounded JSON view context. Draft storage supports local, bounded memory and disabled modes; quota fallback retains newer in-memory drafts. Host-launcher focus and History wrapper cleanup remain supported.

Browser fixtures now exercise the host-adapter seam, with named fixture identities and intercepted HTTP. They no longer start a Huddle product service or use its popup authentication. These fixtures **do not establish** real database conformance, production host authorization or durable persistence. Legacy service guest/invitation workflows were removed from the active browser suite because they are not part of the new API. The original tests remain in Git history; equivalent host authorization/fault acceptance belongs to subsequent storage, HTTP and Pronto gates.

All six CSR examples, Next.js, and packed production Nuxt/SvelteKit/Astro fixtures use adapter configuration. Current Next/CSR runtime examples consume the workspace build/source; their actual-tarball runtime gate is still pending. Isolated packed-consumer checks cover all nine entry points including `/http`.

Read [migration-v0.2.md](migration-v0.2.md) for the new API. Export/import UI, complete directory navigation, remaining accessibility/theme work, long-lived performance evidence and expanded actual-backend browser acceptance remain pending. Real PostgreSQL/MySQL/SQLite/MongoDB conformance, all twelve server/database combinations, portability, Pronto migration/integration and hosted acceptance have not been completed.

Stage 2 verification: typecheck, lint, all 70 unit/integration tests, all production builds, all nine isolated packed consumers and bundle checks pass. Chromium 18 passed; Firefox 17 passed / one CDP-only performance check skipped. No failures or retries in the final supported-browser run. Core import graph: 12,651 bytes gzip; optional HTTP graph: 2,321 bytes gzip; standalone installer: 13,953 bytes gzip. All remain below 76,800 bytes. The frozen install still passes without lockfile changes. Pronto remains unchanged at ac588e6.

Local raw logs are ignored under `output/frontend-v2/stage2-*`. The first browser run caught a missing initial top-layer call. Fault checks also caught cross-bundle typed-error recognition and a recovery case where a failed list needed refetching even without a new change cursor. Both have regression coverage. A test clock ordering error and a helper incorrectly expecting a list instead of the restored composer were corrected without weakening the intended assertions. WebKit was not rerun in Stage 2 because the independently verified missing ICU/XML prerequisites remain; its new-API acceptance is unverified.

Next: Stage 3, shared storage interface and actual SQLite/PostgreSQL/MySQL/MongoDB implementations with real conformance fixtures, followed by thin authenticated host handlers and the twelve-combination matrix. Do not substitute the intercepted browser fixture for those gates.
