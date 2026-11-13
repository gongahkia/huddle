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
