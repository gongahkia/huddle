# @huddle/browser

Framework-independent embedded Huddle client. Requires a self-hosted Huddle service.

Optional helpers are exported from `/react`, `/preact`, `/vue`, `/svelte`, `/solid`, `/angular` and `/astro`. Import only the helper your application uses; framework peers are optional and external to the core engine.

```tsx
import {useHuddle} from '@huddle/browser/react';
function Review() {
  useHuddle({serverUrl: 'https://reviews.example.com',
    projectId: 'your-project-uuid',environment: 'staging'});
  return null;
}
```

React/Preact use `useHuddle(optionsOrNull)`. Vue uses `useHuddle(optionsRefGetterOrObject)`. Svelte/SvelteKit use the `huddle` action: `<div use:huddle={options}>`. Solid uses `createHuddle(optionsGetter)`. Angular uses `injectHuddle(optionsGetter)` in a component field/constructor. Astro uses `installHuddle(optionsOrGetterOrNull)` from a processed layout browser script; it follows ClientRouter lifecycle events and returns an explicit `destroy()`.

Helpers mount only in browser lifecycle callbacks, clean up their own widgets, and reject another installation even when options match. Use a persistent root owner across page transitions. Set options to null to disable. Environment/release updates preserve the widget; an environment change requires reconnection. Other installation changes remount. Keep callback references stable across renders.

For Next.js, call the React hook inside a client component. Nuxt uses the Vue helper in `app.vue`. Imports are SSR-safe. Serve/copy the entire `dist/` directory, including shared chunks, when directly serving the ES module; the installer script remains standalone.

```ts
import { mount } from '@huddle/browser';
const huddle = mount({
  serverUrl: 'http://localhost:4310',
  projectId: 'your-project-uuid',
  environment: 'staging',
  release: 'release-identifier',
});
huddle.open();
huddle.close();
huddle.updateContext({ release: 'next-release' });
huddle.destroy();
```

Calling `mount` twice with identical settings returns the existing document instance. Conflicting settings throw; destroy before changing the installation.
`updateContext` changes environment/release; changing environment requires new review authorization.
Use lifecycle cleanup in your frontend framework. No framework runtime or app stylesheet is required.
Imports are SSR-safe; mount only in a browser lifecycle hook after hydration.
The optional `requestTimeoutMs` changes the 15-second API deadline; `onError` reports failures to host diagnostics.
Use `launcher: 'hidden'` with `open()` for your own header button. The host's `data-huddle-open` attribute marks an open panel or active pin picker, allowing hosts to pause automatic route refreshes during review.
Failed saves preserve retry IDs across reloads when local storage is available. No automatic write replay occurs.

The default page identity retains only pathname. `allowedQueryParameters: ['view']`, `includeHash: true`, and
`pageIdentity: sanitizedUrl => ...` are explicit opt-ins. Never allow parameters/fragments that hold secrets.
The sanitized page URL is saved in comments and exports. The widget reads labels/text around selected targets;
reviewers should avoid pinning sensitive content.

Review access is established through a user-initiated, origin-checked popup and a one-use PKCE exchange.
`accessToken` is an optional integration seam for an already-authorized, origin/project/environment-scoped
review credential. It is not an installation key; do not put credentials in script attributes or source files.

Styles use Shadow DOM and a manual popover with native dialog handling. Standard DOM elements are supported.
Cross-origin frames, closed shadow roots and canvas internals are not supported. Pins can require reattachment
after major changes. See the root README for authentication, deployment and the full compatibility contract.

This package is private and not published. See NOTICE for provenance and licensing status.
