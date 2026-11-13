# Verification evidence

Acceptance work completed locally on 13–14 November 2026 (Asia/Singapore). This file records measured scope and limits, not a hosted deployment or an assertion of browser/production environments that were not tested.

## Commands and behavior

- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm check:bundle` and `pnpm test:package` pass at the integration checkpoint.
- 23 unit/integration tests cover anchor uncertainty, draft limits/isolation, authenticated writes, author forgery rejection, project/role/origin/environment isolation, expired/revoked invitations, one-use authorization codes, duplicate retries, optimistic update races, restart persistence, bounded reads, durable SSE catch-up, complete exports, snapshot consistency, compact-retry migration and idempotent Pronto import with provenance.
- 14 Chromium tests cover two reviewers, mentions/assignment/status/export, guest onboarding/revocation, administrator project creation, HTML/React/Angular examples, draft reload/offline/slow-response behavior, stale page responses, native modal/popover behavior, responsive/SPA behavior, 100 mount/destroy/navigation cycles and ten authenticated connection teardown cycles.
- Package smoke packs the actual browser artifact, installs it in an isolated external consumer and typechecks the published interface without repository aliases.
- A separate browser resource sample preloads the engine, then measures a static unauthenticated widget: approximately 24 KiB incremental mounted heap in that run, zero requests and zero layouts during a three-second idle window, and zero remaining listener delta after teardown. These measurements include browser/automation/JIT effects and are not universal per-tab memory promises. Full raw values are in the accompanying evidence JSON.
- Current complete installer asset is approximately 10.6 KiB gzip including styles (75 KiB limit); `pnpm check:bundle` checks both installer and ES module automatically.

## 100-client load acceptance

The final accepted **600-second** run on the compact-retry implementation preloaded **1,000 threads and 20,000 comments**, connected **100 authenticated SSE review clients**, and issued one mutation per client every 30 seconds. Writers were staggered over each interval. Each change was checked at all 99 peer clients. Final database counts independently verify committed writes and retry-ledger entries.

| Measurement | Result |
| --- | --- |
| Successful writes / expected | 2,000 / 2,000 |
| Peer observations / expected | 198,000 / 198,000 |
| Final comment count | 22,000 |
| Final idempotency records | 2,000 |
| Final durable event count (including seed) | 3,000 |
| Errors | 0 |
| p95 mutation latency | 45.92 ms, below 500 ms |
| p95 peer update visibility | 42.44 ms, below 2,000 ms |
| Peak server RSS | 215,924,736 bytes (205.92 MiB) |
| Peak generator RSS | 230,424,576 bytes, measured separately |
| Peak database plus WAL | 15,171,544 bytes |

Reference host: Intel Core i7-1355U, 12 exposed logical CPUs, approximately 4.80 GiB exposed RAM, Fedora/WSL kernel `6.18.33.2-microsoft-standard-WSL2`, Node 24.21.0. Server and generator ran as separate local processes with no cgroup CPU/memory cap. Other builds/browser/container checks were active during parts of this run. Traffic used loopback and this result is not an Internet latency guarantee or proof of a 2-CPU deployment's maximum capacity.

Reproduce with `pnpm bench:load`. The default is the accepted ten-minute workload. Shortened runs are explicitly iteration-only. The script owns a newly created temporary fixture database, validates final counts and exits nonzero for latency, completeness or write failures. It removes its temporary database after the run. Sanitized complete results are in [evidence/load-100-clients.json](evidence/load-100-clients.json).

## Containers and persistence

The production multi-stage image builds with Node 24 and production-only dependencies. The actual Compose service was bootstrapped without a default password, then tested through authenticated HTTP operations. A comment and session survived a container restart, and SQLite's online backup API produced a backup file. The test removes only its own uniquely named Compose project and volume.

This WSL environment initially lacked a running Docker daemon. Verification installed local container tooling and used a separate daemon socket/data directory. Its default bridge was intentionally disabled, so the smoke harness used an **output-only build override** selecting host networking for builder commands. Runtime used the real Compose service/network/volume definition. Normal installations with a standard Docker daemon do not need that override.

The smoke harness is `pnpm test:docker`; optional `DOCKER_HOST`, `HUDDLE_SMOKE_PORT` and `HUDDLE_BUILD_NETWORK=host` support isolated local verification. No paid host, remote repository, package publication or public deployment was created.

## Exports and compatibility

A 2,005-thread fixture with 2,109 comments (105 in one thread) exports all records as JSON and Markdown; no original display/export cap silently truncates it. Snapshot testing writes a new comment after export starts and verifies the export remains consistent. Pronto conversion uses a local synthetic JSON fixture, preserves author/source attribution and rejects incomplete input. No Pronto runtime modules, private environment files or databases are used.

Browser acceptance is Chromium only. Framework compatibility does not imply Firefox/Safari acceptance. Anchors can require manual reattachment after redesigns; non-rendered/iframe/shadow-internal/canvas targets remain unsupported. Screenshots and other recordings are outside this release; verification screenshots under output are test artifacts, not product recording functionality.

## Final acceptance audit

The [completion audit](completion-audit.md) maps all fifteen goal gates to authoritative files, commands and outcomes. A clean committed-file archive at revision 37afbf6 passed install, typecheck, lint, 23 unit/integration tests, build, both bundle limits, an external package consumer, and all 14 browser tests. The documented bootstrap/start/backup commands also passed with a new database; starting from the resulting backup preserved its comment and session. Container persistence was rechecked at that implementation checkpoint. Pronto’s 670 tracked files, commit and clean Git state matched the initial snapshot. Later startup fixes are recorded below.

## Local startup follow-up

The first interactive setup exposed two gaps: bootstrap required an environment password that was easy to miss, and startup printed the bound `127.0.0.1` address although the default canonical origin was `localhost`. Bootstrap now prompts twice with input hidden, preserves environment-based automation, and cancels cleanly on interrupt/EOF. Startup prints the configured browser URL. Local HTML navigation through an equivalent loopback hostname and port redirects to that URL, preserving connection parameters and invitation fragments. API requests still require the exact configured origin; arbitrary hosts and different ports do not redirect.

After this fix, typecheck, lint, all 29 unit/integration tests, production build, both bundle checks and all 15 Chromium tests passed. An actual terminal bootstrap with disposable data showed no password echo; that account signed in through the built service. The bundled CLI also successfully bootstrapped a separate disposable database using an environment password. No user account/password was created in the user's database, and no Pronto files were changed. These startup changes do not rerun or replace the original load and Docker evidence.

## Storage growth follow-up

A focused 1,000-thread / 20,000-comment fixture measured 2,000 additional replies through the real store. Keeping whole response snapshots in the retry ledger grew the checkpointed database by 22,011,904 bytes. The final compact thread-reference ledger grew it by 2,146,304 bytes (about 90% less in this fixture), ending at 10,743,808 bytes. This is a separate storage experiment, not a substitution for the full network load run. Both measurements are preserved under evidence; `pnpm bench:storage` reproduces the current version. An additive migration converts legacy retry rows without deleting feedback.
