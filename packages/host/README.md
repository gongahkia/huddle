# Huddle host storage references

This private server-side package implements the host-backed design. It does not deploy a Huddle service or create Huddle accounts. Your application supplies authorization, existing identities, CSRF protection and API execution. It is separate from the browser package and must never be imported into client code.

Current implementation: SQLite core collaboration storage. PostgreSQL, MySQL, MongoDB, transfer jobs and HTTP framework handlers are still pending; do not advertise them as verified from this package yet. Consult the repository implementation plan and progress record before deployment.

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

`backend.close()` cancels queued work and active snapshots, waits for owned resources, then closes its connection. Package removal leaves all tables and feedback intact. Storage deletion is a separate explicit host decision after a complete verified export; no uninstall hook deletes data.
