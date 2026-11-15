# Huddle

A framework-independent browser library for reviewing working websites using the host application's access policy, backend and database. Hosts can allow open review without interactive login or require their existing authentication; Huddle creates no accounts. Pin an element, leave a page observation, reply and resolve discussion in the embedded panel. Directory lookup, mentions and assignment are optional host capabilities. Complete JSON/Markdown export and deliberate preview/import/resume live in the panel; no separately deployed Huddle product service or management app is required.

The [current acceptance audit](docs/acceptance-current.md) records verified browser/database/framework and hosted Pronto results, recovery evidence and performance limits.

The private `@huddle/browser` package has optional React/Next.js, Preact, Vue/Nuxt, Svelte/SvelteKit, Solid, Angular and Astro helpers. Its core has no framework dependency. The separate server-only `@huddle/host` reference package supplies thin Next.js/Express/Fastify HTTP bindings and PostgreSQL/MySQL/SQLite/MongoDB storage implementations. The host authorizes every operation and derives authorship; importing historical identities grants no access.

Start with the [browser package guide](packages/browser/README.md), [host integration guide](docs/host-http.md), [storage package](packages/host/README.md), [browser workflows/theme tokens](docs/browser-workflows.md) and [complete transfers](docs/host-transfers.md). The [neutral collaboration contract](docs/collaboration-contract.md), [HTTP specification](docs/schema/huddle.http.v2.openapi.json) and [huddle.feedback.v2 schema](docs/schema/huddle.feedback.v2.schema.json) support custom backends. Existing v0.1 integrations need the [migration guide](docs/migration-v0.2.md).

Use Node **24.21.0** and pnpm **10.33.0**:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:package
pnpm check:bundle
pnpm test:browser
```

Browser checks build every maintained framework fixture from an installed private archive, with SSR/hydration/navigation tests and a separate real host/SQLite collaboration fixture. That fixture owns fresh disposable data and named test sessions; it is not production session middleware. Native browser setup and the optional Linux WebKit compatibility runtime are documented in [browser runtime](docs/browser-runtime.md). Real database conformance, all twelve framework/database combinations, sixteen ordered portability pairs and uninstall retention have separate commands in the [server matrix guide](docs/server-matrix.md). They provision only task-owned disposable fixtures, never existing application databases.

Both packages remain private archives. Install them in the host without a sibling-checkout dependency; keep server drivers out of the browser graph. Detaching the library/routes leaves host data intact. Storage removal is a separate explicit host decision after a verified complete export. There is no uninstall hook that deletes feedback.

The [approved implementation plan](docs/implementation-plan.adoc) supersedes the older service architecture. [Current evidence and outstanding gates](docs/frontend-progress.md) distinguish fixture checks from the completed actual Pronto migration and hosted acceptance. Original feedback, backups, credentials and evaluation data are not disposable fixtures. The unused standalone product service and its one-off commands are retired; original stores and private backups remain intact.

## Access and storage

The host selects open UAT review with an anonymous visitor identity or review through its existing login. Huddle creates no accounts and ships no product server. Every operation still uses the host’s allowed scope, stable reviewer identity, mutation protection and backend. A development URL alone does not establish who can reach its data. See [open or authenticated review](packages/host/README.md#open-or-authenticated-review).

The original Pronto feedback has a dedicated guarded migration path in that application. Keep production backups and complete neutral exports outside Git. Retiring the old service code does not delete any SQLite/PostgreSQL database or alter the host’s account records. Rollback after cutover must keep the new store available, using its host-owned read-only gate.

The former service, management app, popup transport, account bootstrap and Pronto-specific service importer have been retired. Their code remains in Git history; old service load/container benchmarks describe that historical architecture. Current browser, storage, framework and performance evidence is documented in [the acceptance audit](docs/acceptance-current.md).

## Examples and testing

A backend-free [local example](examples/local/index.html) uses the installed browser library and IndexedDB. Run `pnpm build && pnpm examples`, then open http://localhost:4320/local/. Feedback stays in that browser; copy/export it to share.

For UI review, run `pnpm examples:playground` and open **http://localhost:4327/playground/**. The expanded [local example playground](docs/ui-playground.md) uses the actual SDK and disposable SQLite data, with seeded discussions, two reviewers, narrow-screen previews, themes, dialogs, anchor changes, paging and failure controls. [ADR 0001](docs/decisions/0001-huddle-ui-dogfooding.md) records the release boundary: dogfood widget UI in Huddle first; use Pronto to validate engineering integration after UI review. The workbench source and its fictional host live under `examples/testing/playground/`; its loopback-only URL is retained so existing fixture feedback keeps its original page identity. This fixture is not part of the library installation or a separate product.
