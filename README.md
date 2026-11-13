# Huddle

A small, self-hosted layer for discussing working websites. Pin an element, leave a page observation, reply, mention a teammate, assign ownership and resolve the discussion. Export complete feedback as JSON or Markdown.

Huddle's embedded browser client has real HTML, React, Angular, Vue, Svelte, Preact, Solid and Next.js integration fixtures. A separate management workspace brings project feedback together. No external identity service, email provider, model API, Redis or paid service is required. See the [integration matrix and lifecycle guide](docs/integration.md) and [failure handling contract](docs/reliability.md) for tested scope and limitations.

This is an embedded-first release. The browser extension, screenshots, recording, click analytics and external issue-tracker integrations are future work.

## Run locally

Requirements: Node **24.21.0** and pnpm **10.33.0**. The repository pins the Node version for pnpm commands.

```sh
pnpm install --frozen-lockfile
pnpm build
```

Create the first administrator. Bootstrap prompts for a unique password of at least 12 characters and asks you to confirm it; typing is hidden:

```sh
pnpm bootstrap you@example.com "Your name"
pnpm start
```

Open **http://localhost:4310** and sign in with those credentials. There is no default password. Bootstrap refuses a database that already contains users.

For noninteractive setup (including Docker), provide `HUDDLE_BOOTSTRAP_PASSWORD` through your environment or secret manager, then unset it after bootstrap. Never put a real password in source files. A failed bootstrap creates no account; rerun it successfully before signing in.

Use the URL printed at startup. `HUDDLE_BASE_URL` defaults to `http://localhost:4310`; if you change the service URL or port, set it to that exact browser origin before starting. Local HTML visits through an equivalent loopback hostname redirect there. API origin checks remain exact. If you see **A same-origin request is required**, open the configured URL rather than changing the browser's security settings.

In **Project setup**, create a project with its exact allowed website origins and environments. An origin includes scheme and port, for example `http://localhost:4320`; paths and wildcards are not accepted. Create member invitations or guest review links and copy them to your teammates yourself. Huddle sends no email.

For the included integration examples:

```sh
pnpm examples
```

Open `http://localhost:4320/html/?project=YOUR_PROJECT_ID`. The React, Angular, Vue, Svelte, Preact and Solid examples are at `/react/`, `/angular/`, `/vue/`, `/svelte/`, `/preact/` and `/solid/`, with the same `project` parameter. Add `server=http://localhost:4310` when using a different service URL. Allow the example origin in the project first. For the production Next.js example, run `pnpm build:next` then `pnpm examples:next` and allow its origin `http://localhost:4322`.

`pnpm dev` watches the service. Re-run `pnpm build` to rebuild the UI/widget/examples. SQLite data defaults to `.data/huddle.sqlite`; starting the app does not reset it.

## Embed Huddle

Copy the snippet from Project setup:

```html
<script defer src="http://localhost:4310/embed.js"
  data-project="YOUR_PROJECT_ID"
  data-environment="staging"
  data-release="your-release"></script>
```

This installation identifies a project; it does **not** expose its discussions. Each reviewer chooses **Connect Huddle** and approves access in a Huddle popup. Sign in or accept the invitation in the Huddle service first. Popup authorization uses a one-use PKCE exchange bound to the exact reviewed origin, project and environment. Review credentials stay in memory and embedding does not require third-party cookies.

For TypeScript, use the locally built package or its ES module:

```ts
import { mount } from '@huddle/browser';
const review = mount({
  serverUrl: 'http://localhost:4310',
  projectId: 'YOUR_PROJECT_ID',
  environment: 'staging',
  release: 'release-2026-11-13',
});
review.open();
review.close();
review.updateContext({ release: 'next-release' });
// Call from your component/application teardown:
review.destroy();
```

Build first, then `pnpm --dir packages/browser pack --pack-destination ../../output/packages` produces a local tarball for another repository. Nothing is published. The package contains bundled declarations and has no framework runtime dependency. `pnpm test:package` verifies a fresh consumer installation.

Calling `mount` twice with identical settings returns the existing document instance. Conflicting settings fail clearly; destroy before changing the installation. Changing environment with `updateContext` requires a new review connection. The optional `accessToken` is for an already-authorized scoped review credential, such as a future extension integration; never put one in an installation snippet or checked-in source.

The default page identity and saved link retain pathname only. Explicitly opt in to query parameters with `allowedQueryParameters: ['view']`, fragments with `includeHash: true`, or derive identity through `pageIdentity(sanitizedUrl)`. Keep credentials, invitation tokens and personal information out of allowed URL fields. `release` records the version when feedback was created; it does not prevent later releases from seeing earlier feedback.

Widget styles use Shadow DOM. For a host application with a nonce-based Content Security Policy, pass `styleNonce` to `mount`; the script installation reuses its script element's `nonce`. Permit the Huddle script origin in `script-src` and service origin in `connect-src`. Reviewers need permission to open the authorization popup.

## Review and coordinate

- Browse normally. Pin selection intercepts a click only while explicitly active; Escape cancels it.
- Pin a control or text block, optionally selecting quoted text first. Page comments work without an element target.
- Replies, member mentions, an optional assignee and open/resolved status stay together in a thread.
- Pins report moved, changed, hidden, missing or ambiguous targets. Members can **Reattach pin**; the old and new anchors are recorded in thread history.
- The management inbox filters by environment, exact page identity, status, assignee and mentions. Updates arrive through SSE and reconnect from durable cursors.
- Browser drafts recover after reloads and failed saves when local storage is available. Text entered during a slow save is preserved. Identical retries reuse a request ID to avoid duplicate comments.
- Drafts/read markers are isolated by reviewer, project and page, expire after 14 days, and share a **2 MiB per-origin Huddle storage budget**. Oldest entries are evicted first; host application storage is untouched. Blocking/clearing browser storage removes device recovery and unread history.
- The widget bounds displayed thread/reply caches; use workspace paging or complete exports for large histories.

## Access model

| Role | Capabilities |
| --- | --- |
| Administrator | Create/configure projects, issue/revoke invitations, coordinate feedback, export; access all projects on this Huddle instance. |
| Member | Read and comment in joined projects, mention/assign members, resolve/reopen, reattach and export. |
| Guest | Read discussions, comment and reply within the invited project. No coordination, membership administration or export. |

Member invitations are single-use; existing accounts must authenticate with their existing password. Guest links can be used by multiple invited testers until expiry/revocation and create separately attributed guest identities. Display names are not independently verified identities. Revocation invalidates guest sessions and widget credentials derived from the invitation. Standard member sessions last seven days; scoped widget credentials last one hour and remain subject to grant expiry/revocation.

Allowed origins govern where review access can be granted, not whether a caller is authorized. Authors come from server sessions. Every read, mutation, export and live subscription checks project access. Browser-origin credentials cannot administer the instance or export the entire project; use the authenticated workspace for exports. Comment content is displayed as text, never executed.

## Data and exports

SQLite runs in WAL mode on a **single service instance**. It stores projects, members, invitations, sessions, threads, comments, history, deduplication records and durable event cursors. Do not run multiple application instances against a network-mounted SQLite file.

Export JSON or Markdown from the workspace. JSON uses `huddle.feedback.v1`, includes `contentIsUntrustedUserInput: true`, and streams a consistent read snapshot with all comments/history and `complete: true`. Markdown escapes comment content and includes IDs, context, mentions and thread history. Neither export truncates at Pronto's old 100/2,000-thread limits. Treat exported comments as reviewer data when feeding them into coding agents.

Import an existing **complete** Pronto feedback JSON file locally:

```sh
pnpm import:pronto /path/to/pronto-feedback.json PROJECT_ID staging http://localhost:4320
```

The importer reads that file and the selected Huddle database only. It preserves source thread/comment IDs, source author IDs, author names and timestamps. Repeated imports are idempotent and do not overwrite subsequent Huddle coordination changes. Partial/truncated exports are rejected. Imports are limited to 64 MiB and should run during a maintenance window; take a backup first.

The HTTP contract and embedding lifecycle are described in [docs/architecture.md](docs/architecture.md). Source adaptations and rights status are recorded in [NOTICE](NOTICE); no public open-source license has been asserted for the author-supplied Pronto material.

## Docker

```sh
docker compose build
# Set HUDDLE_BOOTSTRAP_PASSWORD to your unique password in this terminal first:
docker compose run --rm -e HUDDLE_BOOTSTRAP_PASSWORD huddle \
  node dist/cli.js bootstrap you@example.com "Your name"
unset HUDDLE_BOOTSTRAP_PASSWORD
docker compose up -d
```

The default URL is `http://localhost:4310`. The Compose service publishes to loopback, uses a persistent named volume, runs as an unprivileged user with a read-only root filesystem and has a 1 GiB / 2 CPU limit. Use `HUDDLE_PORT` for a different host port and set `HUDDLE_BASE_URL` to the actual browser-visible service origin.

For remote team access, place this service behind your own HTTPS reverse proxy and configure that HTTPS origin as `HUDDLE_BASE_URL`. Forward SSE without buffering and with an idle timeout above the 15-second heartbeat. Keep review application origins configured separately. No public deployment is created by these instructions or the verification scripts.

`docker compose down` preserves the named volume. `docker compose down --volumes` deletes Huddle data; use the latter only for a verified disposable instance.

## Backup and restore

A consistent online backup uses SQLite's backup API:

```sh
pnpm backup /absolute/path/huddle-backup.sqlite
# Or, inside the container volume:
docker compose exec huddle node dist/cli.js backup /data/huddle-backup.sqlite
docker compose cp huddle:/data/huddle-backup.sqlite ./huddle-backup.sqlite
```

Copying the live `.sqlite` file without its WAL is not a consistent backup. Store backups outside the container volume and protect them like the original database: they contain discussions and session/grant records.

To restore a local instance, stop Huddle, move the existing database plus its `-wal`/`-shm` files aside, place the backup at `HUDDLE_DATABASE` with the service user's ownership, and restart. Never mix old WAL sidecars with a restored database. Check `/api/health`, sign in and inspect known feedback afterward.

For Docker, stop the service and use a one-off container to replace the volume's database, clearing stale sidecars while the service is stopped. For example, with the default volume path and a local `huddle-backup.sqlite`:

```sh
docker compose stop huddle
docker compose run --rm --no-deps --user root --entrypoint sh \
  -v "$PWD/huddle-backup.sqlite:/restore.sqlite:ro" huddle \
  -c 'rm -f /data/huddle.sqlite-wal /data/huddle.sqlite-shm; cp /restore.sqlite /data/huddle.sqlite; chown node:node /data/huddle.sqlite'
docker compose up -d
```

## Checks and measured limits

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm check:bundle
pnpm test:package
pnpm exec playwright install chromium
pnpm test:browser
pnpm test:docker
pnpm bench:load
pnpm bench:browser
```

Browser and service tests create isolated disposable Huddle data; they do not access Pronto's database or environment. Test server credentials in test fixtures are public local fixtures, never production defaults. Browser tests use ports 4311/4321/4322; the Docker smoke test uses 4312 by default.

The load benchmark defaults to the required 600 seconds, with 100 live clients, 1,000 seeded threads, 20,000 seeded comments and one write per client every 30 seconds. A shorter `HUDDLE_LOAD_SECONDS` is for iteration and does not satisfy the acceptance gate. Raw evidence goes under ignored `output/`; checked summaries and reference hardware are in [docs/verification.md](docs/verification.md).

## Compatibility and troubleshooting

- Integration fixtures cover HTML, React, Angular, Vue, Svelte, Preact, Solid and production Next.js on Chromium and Firefox. WebKit acceptance remains pending because of local system dependencies. See the [coverage matrix](docs/integration.md) for versions, SSR scope and unverified frameworks.
- Cross-origin frame contents, closed shadow roots, canvas/WebGL internals and browser-internal pages cannot be pinned by this release. Open shadow-root internals are not a supported anchor boundary either.
- Native dialogs and basic popovers are tested; complex fullscreen/custom overlay applications can require integration work. Shadow DOM isolates styles, not access to sensitive page data.
- A pin cannot reconstruct a removed page, an authenticated application state, a virtualized row that is not rendered, or another user's private data. Open the original view or reattach it.
- If Connect fails, check popup permission, project membership, grant expiry, exact allowed origin, service origin, CSP and mixed-content restrictions. Localhost and 127.0.0.1 are different origins.
- If updates stop, check proxy buffering/timeouts and network access. Hidden tabs suspend widget streams and catch up on visibility return. Exporting a large snapshot can keep a SQLite WAL reader open until the download completes.
- Login is rate limited. Authorized API traffic is limited per authenticated reviewer so a shared office address does not become a shared review quota.
- Attachments, outbound email/desktop notifications, SSO, an extension and hosted operation are intentionally absent.
