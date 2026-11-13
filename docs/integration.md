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
| Nuxt | 4.6.4 | Installed tarball, request-time SSR, Vue helper, reactive configuration and client history cleanup |
| SvelteKit | 3.2.0 | Installed tarball, Node adapter SSR, Svelte action, reactive configuration and client history cleanup |
| Astro | 7.4.11 / Node adapter 11.1.12 | Installed tarball, request-time Node SSR and ClientRouter lifecycle cleanup |
| React Router/Remix | Pending | Shared DOM client is the intended integration; no dedicated fixture yet |
| jQuery, htmx, Alpine, WordPress, server templates, Blazor DOM | Pending | Script installation is the intended integration; no dedicated framework fixtures yet |
| Native React Native, canvas/WebGL controls, iframe interiors, shadow-root interiors | Unsupported targets | A containing page can be discussed; internal controls cannot be targeted |

We do **not** cover every popular frontend. The [2026 Stack Overflow survey](https://survey.stackoverflow.co/2026/technology/data) includes Next.js, jQuery, Vue, Angular, Svelte, Astro, SvelteKit, htmx and Nuxt among commonly used web technologies. This matrix distinguishes verified integrations from that broader ecosystem.

## Use from another repository

Build Huddle, then pack the browser module:

```sh
pnpm build
pnpm --dir packages/browser pack --pack-destination ../../output/packages
```

Install the resulting `huddle-browser-0.1.0.tgz` by its actual path in the consuming project. This private package is not published to a registry. Its ES module and declarations contain no unresolved workspace imports or required framework dependency. `pnpm test:package` installs all eight entry points in separate consumers, verifies positive/negative types, SSR imports and browser bundling, and checks that unrelated frameworks are neither installed nor bundled. The [helper cookbook](framework-helpers.md) has exact installation and framework examples. Direct ESM serving must retain shared chunks alongside the entry file.

For a site without a bundler, use the script snippet from Project setup. Install Huddle once per document. Do not combine a component adapter and the installer script on one page.

## Lifecycle

Importing during SSR is safe. The optional helpers mount after hydration and own their cleanup. A persistent root integration can stay mounted across SPA navigation. Manual core `mount` remains supported with explicit browser lifecycle cleanup. Runnable fixtures are under `examples/`; see [framework-helpers.md](framework-helpers.md) for all APIs and ownership rules.

```tsx
'use client'; // Next.js client boundary; ordinary React does not need this.
import {useHuddle} from '@huddle/browser/react';

export function HuddleReview({serverUrl,projectId,environment}: {
  serverUrl: string; projectId: string; environment: string;
}) {
  useHuddle({serverUrl,projectId,environment});
  return null;
}
```

Repeated manual `mount` with identical settings returns the existing manual installation. Helpers have exclusive ownership and reject another installation, including a manual mount. A losing helper's cleanup cannot remove the existing owner. Helper options update environment/release in place and remount for other installation changes. An environment change requires new authorization and cancels an outstanding connection attempt.

`serverUrl` must be an HTTP(S) origin without a path, query or credentials. Allow the reviewed site's exact origin and environment in Project setup. Remote review requires HTTPS, popup access and a top-level Huddle sign-in; a public project ID grants no access.

`requestTimeoutMs` changes the default 15-second API deadline (100–120,000 ms). Optional `onError(error)` reports widget errors to host diagnostics. Exceptions from diagnostics or a custom `pageIdentity` cannot break host navigation. A failing identity callback falls back to the sanitized URL path. URL query/hash inclusion remains opt-in.

Use `styleNonce` for nonce-based CSP, or put the nonce on the installer script. Permit the service in `connect-src` and its script in `script-src`. Shadow DOM isolates widget styling; it does not grant access through iframe, shadow-root or sandbox boundaries.

## Reproduce verification

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm build:next`, `pnpm build:frameworks`, `pnpm check:bundle` and `pnpm test:package`. `build:frameworks` installs the packed artifact into isolated Nuxt/SvelteKit/Astro projects and builds their production servers under ignored `output/frameworks`. Start them separately with `pnpm examples:nuxt`, `pnpm examples:sveltekit` or `pnpm examples:astro`, then allow origins on ports 4323/4324/4325 in your project. Install browser dependencies using `pnpm exec playwright install --with-deps chromium firefox webkit`, then run `pnpm exec playwright test`.

This Fedora/WSL machine can run Chromium and Firefox. Playwright's Ubuntu WebKit build lacks required system ABI dependencies here; its local run is unverified. CI installs all three engines on Ubuntu, but configuring CI is not evidence that remote CI passed. Select locally executable browsers with `--project=chromium --project=firefox`. Heap/listener measurements use Chromium's DevTools protocol.

Official lifecycle references: [Vue](https://vuejs.org/api/composition-api-lifecycle), [Svelte](https://svelte.dev/docs/svelte/lifecycle-hooks), [Solid](https://docs.solidjs.com/reference/lifecycle/on-cleanup), [Next.js](https://nextjs.org/docs/app/api-reference/directives/use-client), [Nuxt](https://nuxt.com/docs/4.x/api/components/client-only), [Astro scripts](https://docs.astro.build/en/guides/client-side-scripts/).
