# @huddle/browser

Private, framework-independent embedded review library. Huddle uses your application's access policy, backend and database through a collaboration adapter. The host can allow open review without interactive sign-in or require its existing login; Huddle creates no accounts. It does not require a separately deployed Huddle product service.

```ts
import {mount} from '@huddle/browser';
import {createHttpAdapter} from '@huddle/browser/http';

const review = mount({
  adapter: createHttpAdapter({basePath: '/api/huddle/v2',
    headers: () => ({'x-csrf-token': applicationCsrfToken})}),
  namespace: 'my-application', workspace: 'internal-team', environment: 'preview',
});
review.open();
// during application teardown:
review.destroy();
```

`applicationCsrfToken` comes from the host. The server must resolve a stable host-issued reviewer identity (anonymous visitor or signed-in user), authorize each requested scope and derive authorship; client workspace/environment IDs are not authorization. See the included [host HTTP guide](./dist/docs/host-http.md), [host package reference](./dist/docs/host-package.md), [neutral contracts](./dist/docs/collaboration-contract.md), [HTTP specification](./dist/docs/schema/huddle.http.v2.openapi.json) and [transfer guide](./dist/docs/host-transfers.md). The reference host package has Next.js, Express and Fastify integrations plus PostgreSQL, MySQL, SQLite and MongoDB storage implementations. Custom adapters can implement the same contracts without the HTTP helper.

Optional helpers are exported from `/react`, `/preact`, `/vue`, `/svelte`, `/solid`, `/angular` and `/astro`. Framework peers are optional and external to the core. React/Next.js and Preact use `useHuddle(optionsOrNull)`. Vue uses `useHuddle(optionsRefGetterOrObject)`. Svelte/SvelteKit use the `huddle` action: `<div use:huddle={options}>`. Solid uses `createHuddle(optionsGetter)`. Angular uses `injectHuddle(optionsGetter)` in a component field/constructor. Astro uses `installHuddle(optionsOrGetterOrNull)` from a processed layout browser script; it follows ClientRouter lifecycle events and returns `destroy()`.

Imports are SSR-safe. Mount after hydration, using a persistent root owner across page transitions. Helpers mount in browser lifecycle callbacks and clean up their own widgets. Keep callback/adapter references stable across renders. Set helper options to null to disable. A second helper owner is rejected; direct `mount` with identical options returns the existing instance. Conflicting installations throw. Context environment/release updates preserve the widget; environment changes require fresh host authorization. Serve the entire `dist/` directory, including shared chunks, for direct ES module use. The installer script is standalone.

The controller provides `open()`, `collapse()`, `close()`, `updateContext({environment,release})` and `destroy()`. The default starts active and collapsed, with a persistent draggable dock and authorized pins. There is no close icon. Use `launcher: 'hidden'` with your own opening button to retain an initially inactive installation. `open()` starts review or expands its sidebar. `collapse()` hides the sidebar while keeping pins, drafts and authorized live updates active; clicking a pin expands its discussion. `close()` ends review, clears rendered private data and stops updates while retaining the floating dock; `destroy()` removes it. `data-huddle-open` marks active review, including a collapsed sidebar or pin picker, so a host can coordinate refreshes; `data-huddle-collapsed` identifies the collapsed state. Hover or focus a pin for a bounded comment preview; Escape dismisses the preview before collapsing the sidebar. The header uses named icon buttons, and **Review details** in the footer reveals workspace/environment metadata. `styleNonce` supports host CSP. Styling is isolated in Shadow DOM with documented CSS variables.

Only pathname enters the default page identity. Query/hash retention is explicit via `allowedQueryParameters` and `includeHash`; `pageIdentity` receives the sanitized URL. Use `excludeElement`, `redact` and bounded JSON `viewContext` hooks to control captured context. Input values are not captured. Inaccessible frame contents, closed shadow roots and canvas internals are unsupported; stored context does not reconstruct application state.

The embedded panel offers replaceable thread/reply/history pages, host-approved directory lookup and deliberate export/import preview/execute/resume. No management application is needed. `exportEnvironments` suggests selectable environment IDs, which the host still authorizes. `transferLimits` bounds browser upload/download assembly (defaults 32 MiB / 64 MiB; maxima 64 MiB / 1 GiB). Interrupted downloads are not offered as complete JSON. A failed write retains its request key without automatic replay. Authentication expiry clears private rendered state and defers sign-in to the host.

`persistence: 'memory'` or `'disabled'` avoids local draft storage; the default local store is bounded and actor/scope/page isolated, with expiry and memory fallback. It stores drafts and retry descriptors, never tokens or uploaded files. `requestTimeoutMs` defaults to 15 seconds; `onError` can report failures to host diagnostics. See [browser workflows and theme tokens](./dist/docs/browser-workflows.md) for limits, privacy, focus and transfer details.

This package is private and not published. See NOTICE for provenance and licensing status.

UI icons use named imports from [Lucide](https://lucide.dev/guide/lucide) 1.73.0. Selected icons and their SVG renderer are bundled into the SDK, so core consumers need no additional icon package or framework runtime. See [LICENSE-LUCIDE](./LICENSE-LUCIDE) for the included notices.

Type `@` for searchable keyboard-accessible mention suggestions. Optional shared colors require host capability `commentColors`; this browser/host v0.3 DTO extension preserves colors in exports and imports. Upgrade both readers before enabling it or importing colored data. `onDisplayNameChange(name, signal)` optionally delegates an anonymous display-name edit to the host; the host owns the stable reviewer ID, default generated name, validation and session refresh. Huddle supplies no accounts.
