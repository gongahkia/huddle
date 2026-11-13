# Integration and compatibility

Huddle attaches to rendered browser DOM. JavaScript, TypeScript, JSX/TSX, HTML and CSS frontends use the same client, without a framework dependency. A backend's language does not determine compatibility with the HTML it serves. Huddle does not inspect source code or native app views.

## Coverage matrix

These are pinned fixture versions, not acceptance of every framework version. See [verification](verification.md#integration-hardening) for actual browser results.

| Frontend | Version | Automated fixture |
| --- | --- | --- |
| HTML + JavaScript | Browser DOM | Script/ES module, SPA navigation, CSP nonce, dialogs/popovers, drafts and teardown |
| TypeScript / JSX / TSX | 6.0.3 | Example typecheck and independently installed package consumer |
| React | 19.3.1 | Real React host interactions and persisted feedback |
| Angular | 22.2.6 | Real Angular host interactions and persisted feedback; browser rendering only |
| Vue | 3.5.45 | Real runtime, persisted feedback, component removal/remount |
| Svelte | 5.57.3 | Compiled components, persisted feedback, component removal/remount |
| Preact | 11.2.0 | Real hooks, persisted feedback, component removal/remount |
| Solid | 1.9.19 | Compiled components, persisted feedback, component removal/remount |
| Next.js App Router | 16.4.6 | Production prerender/hydration, feedback, client navigation cleanup and back navigation |
| Nuxt, SvelteKit, Astro, React Router/Remix | Pending | Shared DOM client is the intended integration; no dedicated SSR/navigation acceptance yet |
| jQuery, htmx, Alpine, WordPress, server templates, Blazor DOM | Pending | Script installation is the intended integration; no dedicated framework fixtures yet |
| Native React Native, canvas/WebGL controls, iframe interiors, shadow-root interiors | Unsupported targets | A containing page can be discussed; internal controls cannot be targeted |

We do **not** cover every popular frontend. The [2026 Stack Overflow survey](https://survey.stackoverflow.co/2026/technology/data) includes Next.js, jQuery, Vue, Angular, Svelte, Astro, SvelteKit, htmx and Nuxt among commonly used web technologies. This matrix distinguishes verified integrations from that broader ecosystem.

## Use from another repository

Build Huddle, then pack the browser module:

```sh
pnpm build
pnpm --dir packages/browser pack --pack-destination ../../output/packages
```

Install the resulting `huddle-browser-0.1.0.tgz` by its actual path in the consuming project. This private package is not published to a registry. Its ES module and declarations contain no unresolved workspace imports or framework dependency. `pnpm test:package` installs it in a separate consumer, typechecks and imports it without browser globals.

For a site without a bundler, use the script snippet from Project setup. Install Huddle once per document. Do not combine a component adapter and the installer script on one page.

## Lifecycle

Importing during SSR is safe. Call `mount` in the browser **after hydration** and `destroy` from its owning component's cleanup. A persistent root integration can stay mounted across SPA navigation. React/Next and Preact use effect cleanup; Vue uses `onMounted`/`onUnmounted`; Svelte uses `onMount`'s cleanup; Solid uses `onMount`/`onCleanup`. Runnable fixtures are under `examples/`.

```tsx
'use client'; // Next.js client boundary; ordinary React does not need this.
import {useEffect} from 'react';
import {mount} from '@huddle/browser';

export function HuddleReview({serverUrl,projectId,environment}: {
  serverUrl: string; projectId: string; environment: string;
}) {
  useEffect(() => {
    const review = mount({serverUrl,projectId,environment});
    return () => review.destroy();
  },[serverUrl,projectId,environment]);
  return null;
}
```

Repeated `mount` with identical settings returns the existing installation. Conflicting settings throw before another overlay is created; destroy first. `updateContext({release})` updates release metadata. An environment change requires new authorization and cancels an outstanding connection attempt.

`serverUrl` must be an HTTP(S) origin without a path, query or credentials. Allow the reviewed site's exact origin and environment in Project setup. Remote review requires HTTPS, popup access and a top-level Huddle sign-in; a public project ID grants no access.

`requestTimeoutMs` changes the default 15-second API deadline (100–120,000 ms). Optional `onError(error)` reports widget errors to host diagnostics. Exceptions from diagnostics or a custom `pageIdentity` cannot break host navigation. A failing identity callback falls back to the sanitized URL path. URL query/hash inclusion remains opt-in.

Use `styleNonce` for nonce-based CSP, or put the nonce on the installer script. Permit the service in `connect-src` and its script in `script-src`. Shadow DOM isolates widget styling; it does not grant access through iframe, shadow-root or sandbox boundaries.

## Reproduce verification

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm build:next`, `pnpm check:bundle` and `pnpm test:package`. Install browser dependencies using `pnpm exec playwright install --with-deps chromium firefox webkit`, then run `pnpm exec playwright test`.

This Fedora/WSL machine can run Chromium and Firefox. Playwright's Ubuntu WebKit build lacks required system ABI dependencies here; its local run is unverified. CI installs all three engines on Ubuntu, but configuring CI is not evidence that remote CI passed. Select locally executable browsers with `--project=chromium --project=firefox`. Heap/listener measurements use Chromium's DevTools protocol.

Official lifecycle references: [Vue](https://vuejs.org/api/composition-api-lifecycle), [Svelte](https://svelte.dev/docs/svelte/lifecycle-hooks), [Solid](https://docs.solidjs.com/reference/lifecycle/on-cleanup), [Next.js](https://nextjs.org/docs/app/api-reference/directives/use-client), [Nuxt](https://nuxt.com/docs/4.x/api/components/client-only), [Astro scripts](https://docs.astro.build/en/guides/client-side-scripts/).
