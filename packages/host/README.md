# Huddle host storage references

This private server-side package implements the host-backed design. It does not deploy a Huddle service or create Huddle accounts. Your application supplies authorization, existing identities, CSRF protection and API execution. It is separate from the browser package and must never be imported into client code.

Current implementation: SQLite, PostgreSQL and MySQL core collaboration storage. MongoDB, transfer jobs and HTTP framework handlers are still pending; do not advertise them as verified from this package yet. Consult the repository implementation plan and progress record before deployment.

Build the repository and pack this package with `pnpm --dir packages/host pack --pack-destination ../../output/packages`. It requires Node 24.21.0 and includes compiled JavaScript and bundled declarations. Nothing is published to a registry.

```ts
import {ReviewStore} from '@huddle/host';
import {installSqlite,SqliteBackend} from '@huddle/host/sqlite';

// Run this deliberately during installation against your verified destination.
installSqlite('/your/durable/data/feedback.sqlite');

// Reuse one backend per process; opening it does not install or upgrade schema.
const backend = new SqliteBackend('/your/durable/data/feedback.sqlite');
const store = new ReviewStore(backend, async (scope, signal) => {
  // Implement this with the host session and internal-team workspace policy.
  // Denial must throw CollaborationError('unauthenticated'|'forbidden', safeMessage).
  // Never derive authorization from arbitrary request headers or supplied author fields.
  return yourHostAuthorization(scope, signal);
});
```

`ReviewStore` exposes session, scoped list/detail, create/reply/update, change polling and optional directory operations. Every operation accepts an abort signal. The host must apply its own request deadline and invoke authorization for each request. Host identities are opaque ID/name pairs; email addresses and Huddle roles are not required. Optional directory capabilities require a host-approved lookup/list provider; unknown members and unsupported fields fail validation.

SQLite installation uses additive schema version 1 in dedicated `huddle_*` tables. Repeating installation preserves metadata and data. Unknown versions fail rather than guessing an upgrade. Legacy standalone Huddle tables are a different schema; this setup does not migrate them. Future upgrades must be invoked deliberately, after a consistent backup and against an explicitly selected database. Mounting the browser cannot run installation.

Create and protect the parent directory through the host's deployment setup. Newly created database files use mode 0600; existing file permissions are left under host control. Secure backups and exported feedback as private data too.

WAL mode, one writer connection and short immediate transactions protect atomic feedback/audit/change/idempotency writes. Independent read-only connections pin snapshots while writes continue. Busy handling is bounded to one second; lock exhaustion becomes a sanitized unavailable error. Use one backend object per file per process; this is a single-instance local-file deployment. Ephemeral filesystems, network mounts and multiple application replicas are unsuitable. The host owns durable storage, backups, restore testing and retention.

Indexes cover scoped list ordering, status/page filtering, comment/history ordering and request actor/progress lookup. IDs, filters and values are parameterized; identifiers come from a fixed internal collection list. Continuations are authenticated opaque cursors bound to their original scope, filters and collection. Author/timestamps are server-derived. Uncertain unchanged retries reuse their original key and return current authorized thread detail without applying another mutation. Keys are bound to actor/scope/operation and payload hashes; audit and change records commit with the mutation.

`backend.close()` cancels owned work and active snapshots. SQLite closes its owned connection; PostgreSQL/MySQL release checked-out connections and leaves the host pool open. Package removal leaves all tables and feedback intact. Storage deletion is a separate explicit host decision after a complete verified export; no uninstall hook deletes data.

## PostgreSQL

Use `installPostgres(existingPool, options)` from `@huddle/host/postgres` deliberately during installation against the verified destination. It creates additive schema version 1 in a dedicated `huddle` schema, configurable with a simple lowercase schema identifier. Repeating installation preserves existing data and metadata; unknown versions fail. `await PostgresBackend.open(existingPool, options)` reads existing metadata without creating schema. Pass that backend to the same ReviewStore and host authorization callback shown above.

The adapter accepts a node-postgres-compatible pool, never a browser database URL. The host retains its existing TLS, credentials, pool configuration and shutdown ownership. It does not import a PostgreSQL driver or install one into a SQLite/browser consumer. The verified driver is pg 8.20.0, matching Pronto's current dependency; tests have exercised PostgreSQL 18.6. Other provider/server versions are not verified by this result.

Each transaction uses one checked-out client, following the [node-postgres transaction contract](https://node-postgres.com/features/transactions). Per-scope [transaction advisory locks](https://www.postgresql.org/docs/18/explicit-locking.html#ADVISORY-LOCKS) serialize mutations across backend instances. Read-only [repeatable-read snapshots](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-REPEATABLE-READ) keep paginated reads consistent while writers commit. Binary collation orders internal keys deterministically. Scope/page/actor hash indexes retain exact-value checks; JSON text encoding preserves control characters without relying on JSONB's Unicode limitations. External host identities remain opaque strings; reference discussion IDs are generated on the server.

`beforeQuery({text, values, scope})` integrates the host's tenant SQL guard. Every record query supplies its actual raw scope; setup, metadata and transaction-control statements may have no scope. This hook supplements the mandatory ReviewStore authorization callback and scoped predicates; it is not a replacement for them. Pronto must still supply its dedicated internal-feedback policy and tenant boundary. Do not assume a host's existing SQL guard automatically recognizes a new schema.

Timeouts are configurable: default whole write/connection-checkout deadline 15 seconds, snapshot lifetime 120 seconds and lock wait one second. Statement/lock settings are transaction-local and restored when the connection returns to the pool. Cancellation destroys only the checked-out client for that request; a late checkout after cancellation is released. Raw database errors are sanitized. A lost acknowledgement after COMMIT may mean the write persisted: explicitly retry the original request key rather than creating another write.

For a real disposable fixture, run `pnpm fixtures:postgres` to build the checksum-pinned official PostgreSQL 18.6 source into ignored output, then set `HUDDLE_TEST_PG_BIN` to `output/runtime/postgresql-source-18.6/bin` and run `pnpm test:storage:postgres`. Source build prerequisites are make, a C compiler, bison and flex. Alternatively point the variable at an existing server binary directory. The harness always initializes a fresh marked cluster on a private Unix socket with TCP disabled. It does not accept an existing database URL. Its cleanup checks the marker and drops only allocated test schemas before removing the owned cluster. No production data is a fixture.

After `pnpm build`, `pnpm test:package:postgres` installs the actual host archive into a fresh consumer and exercises setup, type declarations, persistence, retry and denial against another owned cluster. CI has an explicit pinned-source PostgreSQL job; remote CI execution must be reported separately from local results. The remaining database/HTTP matrix and transfer tests remain required.

## MySQL

Use `installMysql(existingPool, options)` from `@huddle/host/mysql` deliberately during installation against the verified destination. It creates additive schema version 1 in dedicated `huddle_*` tables; `prefix` accepts a simple lowercase identifier of at most 24 characters. Repeating installation preserves data and metadata. `await MysqlBackend.open(existingPool, options)` verifies the existing tables and metadata without creating schema. Pass that backend to the common ReviewStore authorization seam.

The adapter accepts a mysql2/promise-compatible host pool and does not import or bundle the driver. Verified locally: MySQL 8.4.13 with mysql2 3.24.6. MariaDB and other MySQL versions have not been established by these results. The host retains TLS, credential, connection-limit, shutdown and backup ownership. Supply ordinary unused pool checkouts, never a connection participating in an unrelated host transaction.

All feedback tables must use InnoDB and utf8mb4_bin. Client, connection and result encodings must be utf8mb4, with STRICT_TRANS_TABLES or STRICT_ALL_TABLES enabled; incompatible connections/tables fail visibly. Indexed scope/page/actor hashes retain exact encoded-text comparisons, and binary record keys order paging deterministically. Bound parameters carry data; fixed transaction commands use the ordinary query protocol because MySQL does not prepare START TRANSACTION. JSON text encoding preserves Unicode and control characters.

A transactional scope-clock row serializes writes across backend instances. Read-only repeatable-read transactions use [consistent snapshots](https://dev.mysql.com/doc/refman/8.4/en/commit.html) while other transactions commit. MySQL [DDL implicitly commits](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html): installation is **not** an atomic schema transaction. It holds a dedicated installer lock, creates tables reentrantly, validates their engines/collations, then commits the metadata/version marker last. An interrupted install can leave additive tables and must be explicitly rerun. Unknown schema versions fail; no runtime installation or guessed upgrade occurs.

The same `beforeQuery` hook supplies raw scope on record access and supplements host authorization. Whole-operation defaults are 15 seconds for writes/open and 120 seconds for snapshots. The InnoDB lock-wait default is one second; MySQL's setting rounds configured milliseconds up to whole seconds. The adapter restores the host's session lock timeout and leaves its default isolation unchanged. Cancellation destroys only the owned checkout; a cancelled pool wait releases its late checkout. Closing a backend leaves the host pool usable. After an uncertain COMMIT response, explicitly retry the original request key.

`pnpm fixtures:mysql` downloads checksum-pinned MySQL 8.4.13 Linux x86_64 binaries into ignored `output/runtime/mysql-binary-8.4.13`. A checksum-pinned libaio library stays in that runtime's private library directory; no system library/config changes occur. It needs tar with xz/zstd support and a compatible glibc (the vendor binary targets glibc 2.28). On other systems supply native MySQL 8.4 binaries through `HUDDLE_TEST_MYSQL_BIN`. This command only prepares binaries; the conformance harness initializes a new marked temporary data directory, disables TCP, verifies its nonce and data directory, and deletes only owned prefixes and the owned cluster. It never accepts a database URL or an existing data directory. Insecure initialization is restricted to that private disposable Unix-socket fixture.

Run `pnpm test:storage:mysql` and, after `pnpm build`, `pnpm test:package:mysql`. The latter installs/types/runs the actual host archive in a fresh consumer against a separate owned cluster. CI has an explicit pinned-binary job; remote execution must be reported separately. MongoDB, transfer operations and the twelve HTTP combinations remain separate pending acceptance gates.
