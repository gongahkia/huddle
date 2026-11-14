# Migrating to the host-backed browser API

The approved v0.2 design uses the application's existing identity, authorization, API and database. PostgreSQL, MySQL, SQLite and MongoDB reference storage and Next.js, Express and Fastify bindings are implemented. Fresh local acceptance and pending hosted/retirement gates are recorded in [frontend-progress.md](frontend-progress.md); the old standalone service does not implement this protocol.

The private package remains packable. Existing entry points are preserved: core, React, Preact, Vue, Svelte, Solid, Angular and Astro. The new optional `/http` entry supplies the host HTTP binding. It is not imported by the core, and database drivers never belong in a browser bundle.

Replace `serverUrl`, `projectId` and `accessToken` with a stable adapter instance, integration namespace and host workspace:

```ts
import {mount} from '@huddle/browser';
import {createHttpAdapter} from '@huddle/browser/http';

// Supply your application's existing CSRF headers through the headers hook if required.
const adapter = createHttpAdapter({basePath: '/api/huddle/v2'});
const review = mount({
  adapter,
  namespace: 'my-application-review',
  workspace: 'host-workspace-id',
  environment: 'staging',
});
review.open();
review.close();
review.updateContext({environment: 'production',release: 'next-release'});
review.destroy();
```

The host must implement [the contract](collaboration-contract.md) and enforce its existing session, CSRF and workspace policy on every endpoint. Browser-selected scope never grants access. Custom adapters implement the exported CollaborationAdapter interface and may use any host backend; they need not import `/http`.

There is no Huddle login, account, role system or popup fallback. In framework apps, return null options for users whom the host denies, so the launcher is hidden. A general public demo/customer login is not internal-team authorization. Do not leave old feedback endpoints accessible to guests during rollout.

React/Next.js use `useHuddle(options)`; Preact uses the same helper in `/preact`; Vue/Nuxt use `useHuddle(() => options)`; Svelte/SvelteKit use the `huddle` action; Solid uses `createHuddle(() => options)`; Angular uses `injectHuddle(() => options)`; Astro uses `installHuddle(options)` or a route-dependent factory. Keep adapter and hook references stable. Options are created on the client, not passed as functions across an RSC serialization boundary. The React entry retains its use-client directive.

Workspace, environment and release updates preserve the owned overlay and cancel stale work. Other installation changes remount it. Invalid options are rejected before disposing the existing helper. One integration owns one overlay per document; another helper cannot adopt or destroy it. Destroy restores only History API wrappers still owned by that instance.

The panel fetches host session access when opened. Polling runs every ten seconds only while open and visible, with one change poll in flight and bounded recovery backoff. Optional subscriptions accelerate updates and fall back to polling. Writes are never replayed automatically. An explicit unchanged retry uses its original request key; an uncertain write may already have committed. Host access loss clears private rendered content and defers sign-in to the application.

Thread, reply and history navigation replaces bounded page windows instead of accumulating unbounded lists or stranding older records behind the management UI. Unsupported mentions/assignment controls are hidden. Complete JSON/Markdown export, deliberate upload/preview/import/resume and directory paging are available in the embedded panel; see [browser workflows](browser-workflows.md).

Draft storage is scoped by namespace, workspace, actor, environment and page. Choose `persistence: 'memory'` or `'disabled'` for sensitive hosts. Local storage remains bounded and expiring; failed writes fall back to bounded memory. No tokens are stored. Query parameters and hashes remain opt-in. `excludeElement`, `redact` and `viewContext` hooks control captured context; view context is limited to 8 KiB and depth 16. Closed shadow DOM, inaccessible frames and canvas objects remain unsupported anchor targets.

Preserve document CSP nonces with `styleNonce`. The host owns HTTP security policy; remove obsolete Huddle-origin and popup exceptions after its migration. The optional installer uses `data-workspace`, `data-namespace`, `data-environment` and `data-api-path`; old service-backed snippet attributes emit a migration warning and do not connect to the old protocol. For host-specific CSRF hooks use an explicit module integration.

Do not delete the old stores or migration tooling yet. Back up/export actual old feedback consistently, migrate with provenance, compare complete normalized datasets and keep a rollback that preserves post-cutover comments. Removing the browser import and backend routes must leave stored feedback intact. Storage deletion is a separate explicit host decision after a verified complete export.
