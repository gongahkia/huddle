# Implementation record

## Objective
Build the embedded-first Huddle release specified in the supplied goal, with all fifteen acceptance gates verified. Browser extension delivery is deferred.

## Sequence
1. Establish isolated workspace, provenance and repeatable commands.
2. Extract anchor/draft behavior with unit tests.
3. Implement SQLite persistence, project permissions, invitations and review handshake.
4. Implement incremental collaboration, coordination and portable exports/import.
5. Implement independent widget and management UI, plus HTML/React/Angular examples.
6. Verify browser journeys, authorization, lifecycle and compatibility.
7. Measure bundles, memory and 100-client performance; container persistence.
8. Complete setup/operations documentation and audit every acceptance gate.

## Current evidence
- Source repository clean at initial inspection; snapshot recorded separately.
- Node 24.21.0 and pnpm 10.33.0 available.
- Docker command unavailable in current WSL environment; container verification remains required.
- No source license file found. Do not claim an open-source license for adapted material.

## Decisions
- Node built-in SQLite avoids a native addon and keeps the service single-instance.
- Widget authentication uses a user-initiated popup with single-use authorization-code exchange, scoped to project, environment and exact reviewed origin. Third-party cookies are unnecessary.
- Durable event sequence supports SSE reconnect; bearer credentials travel in headers, never stream query strings.
- Self-hosted management UI uses same-origin HttpOnly cookie sessions; widget credentials stay in memory.

## Service foundations
- Independent anchor/storage package: 10 behavioral tests pass; committed separately.
- SQLite/Fastify service implements scoped sessions, invitations, PKCE review exchange, threads, assignment/status/reattachment history, cursor reads and SSE.
- 17 tests pass, including project isolation, guest revocation/expiry, member invitation reuse, origin/environment-bound credentials, idempotent concurrent saves, stale-version rejection and restart persistence.
- Typecheck and lint pass under pinned Node 24.21.0 / TypeScript 6.0.3.

## Embedded experience
- Framework-independent Shadow DOM widget and React management UI implemented.
- HTML, React and Angular examples build against the same widget and service.
- Five real Chromium journeys pass: cross-site popup authorization and two-reviewer workflow/export; reload draft recovery/reattachment; React; Angular; native dialog and mobile/SPA behavior.
- Current browser asset is approximately 10.8 KiB gzip including styles.
- Export/import, durable SSE reconnect (including >500 event catch-up) and integration suites total 20 passing tests.
- Local Docker tooling installed; isolated verification daemon uses /tmp/huddle-docker.sock and /tmp/huddle-docker-data. First image build passed.
- Required 600-second / 100-client benchmark started; results not yet accepted.

## Coordination and cross-framework acceptance
- All 13 Chromium tests pass, including administrative project setup, private guest links/revocation, slow/offline retry recovery, stale page responses, native popovers, 100 mount/destroy cycles and ten authenticated SSE teardown cycles.
- Packed browser library installs and typechecks in a separate fresh consumer without workspace dependencies.
- Unit/integration suite: 22 tests pass, including consistent streaming snapshots and concurrent coordination updates.
- Required 600-second benchmark passed: 2,000/2,000 writes, 198,000/198,000 peer observations, no errors, p95 write 47.89 ms, p95 visibility 44.42 ms. Separate server RSS peaked at 242,065,408 bytes on the recorded WSL reference host.
- Compose persistence/online backup smoke passed. Clean-checkout and final-revision container checks remain pending.

## Storage and operational hardening
- Focused storage measurement found full retry responses duplicating transcripts: 22,011,904 bytes growth for 2,000 short replies.
- Retry ledger now stores only a request hash and thread reference; matching retries return current authorized detail without applying the write twice. Additive schema migration compacts legacy response records.
- The same focused workload now grows by 2,146,304 bytes, approximately 90% less. Author/feedback records are preserved; migration is covered by a regression test.
- Authenticated rate limits use resolved reviewer identity to support many reviewers sharing one network address.
- 23 unit/integration tests pass. A new full 600-second load acceptance run is in progress for the changed persistence implementation.

## Self-hosted distribution
- Production Docker image and Compose service run as an unprivileged user with a read-only root, persistent SQLite volume, health probe and local-only published port.
- Smoke harness creates its own uniquely named Compose project, bootstraps a unique temporary password, verifies comment/session persistence across restart and exercises online backup, then removes its own volume.
- CI records deterministic unit/browser/package/container checks plus a separate full load job. Workflow has not been run remotely; all acceptance claims are local evidence.
- CSP nonce propagation is supported by both the script installer and TypeScript options and has a focused Chromium acceptance test.

## Container clean-build correction
The final image check caught a missing root NOTICE input after package provenance became part of the build. The builder now explicitly copies NOTICE. Rebuilding and exercising the real Compose service passed again on the compact-retry implementation, including restart persistence and online backup.

## Final acceptance
- Final compact-storage 600-second load run passed: 2,000 writes, 198,000 peer observations, no errors; p95 write 45.92 ms, p95 visibility 42.44 ms, peak service RSS 215,924,736 bytes.
- Clean committed-file archive at 37afbf6 passed all installation/type/lint/unit/build/package/bundle/browser gates: 23 unit/integration and 14 Chromium tests.
- Documented bootstrap/start/backup and starting from the backup preserved a fresh comment and session.
- Production Compose service reverified after all implementation changes. Source preservation comparison passes for all 670 Pronto tracked files and original HEAD/clean status.
- completion-audit.md maps all fifteen acceptance requirements and additional contract constraints to inspected evidence.
- Temporary clean checkout removed after validation. Isolated verification daemon stopped and its task-owned image/container data removed. No application/test services remain intentionally running.
- Final implementation diff against verified revision 37afbf6 is empty; only evidence/documentation changed afterward.

### Local startup correction (14 November)

- Bootstrap now offers a hidden, confirmed password prompt; environment-based automation remains supported. Terminal cancellation restores input mode.
- Startup prints the configured browser origin. Equivalent local HTML visits redirect there while API origin checks stay exact. README explains setup and recovery from a failed bootstrap.
- Typecheck, lint, 29 unit/integration tests, build, bundle checks and all 15 Chromium tests pass. A real terminal/bootstrap and built-service sign-in smoke passed on disposable data; the bundled automation CLI also passed.
- The user's database was inspected read-only for its account count (zero); no credentials or accounts were created there. Pronto was not modified. The earlier load/container evidence remains scoped to its recorded revision.

### Integration and failure recovery (14 November)

- Added API/response-body deadlines, readable proxy failures, transient read recovery, stream watchdog/reconnect jitter, durable retry IDs across reload, environment cancellation and host callback isolation. Live streams now close before graceful server shutdown; Compose restarts exited services.
- Added actual Vue, Svelte, Preact, Solid and production Next.js fixtures, lifecycle/SSR checks and an independent package import check. The browser package still has no framework runtime dependency.
- Passed typecheck, lint, 37 unit/integration tests, production builds, package smoke, bundle limits and 46 Chromium/Firefox browser tests. Two CDP-only Firefox cases are intentionally skipped.
- A 30-second 100-reviewer smoke completed all 100 writes and 9,900 peer updates with zero errors. The original 600-second evidence remains separately scoped. Container dependency-stage install and Compose config passed; full Docker smoke was not rerun.
- Documented integration recipes, supported versions and failure behavior. WebKit cannot launch with this Fedora host's dependencies; CI coverage is configured but not claimed as executed. Nuxt, SvelteKit, Astro and other frameworks without dedicated fixtures remain unverified.
