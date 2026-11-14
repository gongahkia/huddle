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

Next: replace engine transport/auth coupling and lifecycle binding with the host adapter; then implement actual storage and HTTP integrations. All database conformance, server matrix, portability, new browser acceptance, actual data migration and hosted gates remain pending. The WebKit runtime and Docker access limitations remain separate verification gaps, not reasons to stop independent implementation.
