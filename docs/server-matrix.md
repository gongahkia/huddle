# Verified host runtime matrix

The twelve **core HTTP and positive transfer** combinations below passed locally on Node 24.21.0 / pnpm 10.33.0. They use actual private host/browser archives, real server processes and new disposable databases. Sixteen ordered database portability pairs pass separately. Browser/resource and Pronto local results have separate evidence in [the current audit](acceptance-current.md); hosted acceptance remains open.

| Database | Next.js 16.4.6 | Express 5.3.0 | Fastify 5.12.8 |
| --- | --- | --- | --- |
| SQLite 3.53.4 | Core/transfers passed | Core/transfers passed | Core/transfers passed |
| PostgreSQL 18.6 / pg 8.20.0 | Core/transfers passed | Core/transfers passed | Core/transfers passed |
| MySQL 8.4.13 / mysql2 3.24.6 | Core/transfers passed | Core/transfers passed | Core/transfers passed |
| MongoDB 8.0.38 replica set / driver 7.9.0 | Core/transfers passed | Core/transfers passed | Core/transfers passed |

The checked-in runnable applications are under `examples/hosts`: Express and Fastify entry points, a real Next App Router application and a shared **disposable-fixture-only** loader. The loader requires a private marked configuration produced by the harness. It opens installed schemas; it never installs schema on a request. The application session seam uses generated fixture cookies and CSRF tokens. For production, replace that loader with the host's existing session/internal-user policy and pool, retaining the public bridge callbacks. The fixture identity map is not a Huddle account system or a deployment authentication example.

From the Huddle source repository, prepare the pinned runtimes, then run:

```sh
pnpm fixtures:postgres
pnpm fixtures:mysql
pnpm fixtures:mongodb
HUDDLE_TEST_PG_BIN="$PWD/output/runtime/postgresql-source-18.6/bin" pnpm test:matrix
```

Use the platform guidance in the host storage guide for native runtime overrides. The matrix command builds the SDK, packs both archives, creates an isolated npm consumer, typechecks with library checking enabled, builds Next for production and starts all three applications on allocated loopback ports. Next's installed types require the ES2024 library definitions supported by Node 24. Direct dependency versions are pinned and checked against the installed packages; SDK/package directories must not be workspace symlinks. The consumer has no dependency on a sibling source checkout.

Every framework gets its own SQLite file, PostgreSQL schema, MySQL prefix and MongoDB prefix. Setup uses fresh marked clusters with nonce/data-path checks; no existing database URL or data directory is accepted. The SQL fixtures use private Unix sockets, MongoDB binds loopback only, and cleanup acts only on the task-owned resources. Neither Pronto's database nor old feedback/evaluation data is used.

Each combination checks two internal authors, anonymous/guest denial, workspace/environment authorization, host CSRF/origin checks, server authorship, unchanged-key retries, payload conflicts, concurrent replies, optimistic versions, resolve/reopen/reattach, comments/history/list paging, long Unicode page filters, changes, strict query/body limits, denied transfer endpoints, complete JSON/Markdown export, upload/preview/execute/progress, actor-bound staging/jobs, repeat import after destination replies, same-dataset environment copying, transfer revocation, sanitized failures, recovery and persisted data. The browser HTTP helper is loaded from the packed archive, not the workspace source. Host headers/session middleware remain in the framework request path.

The harness then restarts all hosts and reads saved discussion using a fresh client. It removes both SDK packages, their integration modules and routes, rebuilds/typechecks Next and the host entries, starts the host business routes again, verifies review endpoints are gone, and compares every fixture logical collection plus dataset/cursor metadata before/after removal. The comparison covers both fixture environments and includes transfer records. Complete neutral port-out is checked before removal. This proves package removal/data retention for these fixtures.

Ignored evidence is under `output/server-matrix/<run-id>`. Successful records include source revision, working-diff/orchestrator/fixture hashes, actual installed versions, archive checksums, per-combination checks, restart/uninstall outcomes and confirmed cleanup. `latest.json` identifies the latest run; a green record is written only after successful checks and teardown. Failed runs remain separate rather than overwriting an older success. CI contains a dedicated pinned-runtime job; remote CI execution has not yet been claimed.
