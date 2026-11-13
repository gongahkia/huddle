# Framework helpers

All helpers use the same framework-independent engine. They are optional subpaths of `@huddle/browser`; installing the core does not install frontend frameworks. A helper uses the framework already installed in your application. Tested versions and browser coverage are in [integration.md](integration.md).

## Install in another project

In the Huddle repository:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --dir packages/browser pack --pack-destination ../../output/packages
```

In the consuming repository, substitute the actual absolute archive path:

```sh
pnpm add /absolute/path/to/huddle/output/packages/huddle-browser-0.1.0.tgz
```

The package remains private and unpublished. No framework-specific package needs publishing. Ordinary bundlers resolve its ESM exports and declarations. If directly serving ESM files, retain the **whole `dist/` directory including shared chunks**. The `embed.js` installer remains a standalone script.

Configure the project's exact reviewed origin and environment in Huddle, sign in to its workspace, and use **Connect Huddle** in the reviewed site. A project ID is public installation metadata; never embed a bearer token or guest invitation secret.

## Public entry points

| Import | API | Framework lifecycle |
| --- | --- | --- |
| `@huddle/browser` | `mount(options)` | Manual `destroy()` |
| `@huddle/browser/react` | `useHuddle(optionsOrNull)` | React effect and cleanup; also used by Next.js |
| `@huddle/browser/preact` | `useHuddle(optionsOrNull)` | Preact effect and cleanup |
| `@huddle/browser/vue` | `useHuddle(optionsRefGetterOrObject)` | Mounted watcher and unmount cleanup; also used by Nuxt |
| `@huddle/browser/svelte` | `huddle` action | `use:huddle={optionsOrNull}`; also used by SvelteKit |
| `@huddle/browser/solid` | `createHuddle(optionsGetter)` | Mounted reactive effect and owner cleanup |
| `@huddle/browser/angular` | `injectHuddle(optionsGetter)` | Injection context, after-next-render effect and DestroyRef |
| `@huddle/browser/astro` | `installHuddle(optionsOrGetterOrNull)` | Initial load, `astro:before-swap` cleanup and `astro:page-load` mount |

Every entry exports `HuddleOptions`. Hooks also expose `HuddleControls`: `open()`, `close()` and a nullable `current` controller. Methods are safe no-ops before mounting. `current` is an imperative snapshot rather than framework-reactive state. The Svelte action exposes its standard update/destroy lifecycle; the Astro installation also exposes `destroy()` to remove its own listeners.

## React and Next.js

```tsx
'use client'; // Next.js client component boundary.
import {useHuddle,type HuddleOptions} from '@huddle/browser/react';

export function Review({options}: {options: HuddleOptions | null}) {
  useHuddle(options);
  return null;
}
```

Render this once in a root layout or persistent application component. Pass public configuration as props; imports and rendering are safe during SSR, and mounting happens in an effect after hydration. React StrictMode effect replay is tested. Preact uses the same shape with `@huddle/browser/preact`.

To use your application's own header button, pass `launcher: 'hidden'` and call the returned controls' `open()` from that button. The default remains a floating launcher. The widget host has `data-huddle-root` while mounted and `data-huddle-open` while the panel or pin picker is open. Hosts can use the latter to suspend automatic route refreshes during review; it disappears on close/destroy. These markers do not expose comments or credentials.

## Vue and Nuxt

```vue
<script setup lang="ts">
import {ref} from 'vue';
import {useHuddle} from '@huddle/browser/vue';
const environment = ref('staging');
useHuddle(() => ({
  serverUrl: 'https://reviews.example.com',
  projectId: 'YOUR_PROJECT_UUID',
  environment: environment.value,
}));
</script>
<template><slot /></template>
```

For Nuxt, use this in `app/app.vue` alongside `<NuxtPage />`. The fixture demonstrates a persistent root helper whose options depend on route and `useState`. Nuxt can mount an incoming page before destroying the outgoing page, so a single root owner avoids competing page-level installations. No client-only import workaround is needed: the helper defers its watcher until mounted.

## Svelte and SvelteKit

```svelte
<script lang="ts">
  import {huddle} from '@huddle/browser/svelte';
  let environment = $state('staging');
  const options = $derived({
    serverUrl: 'https://reviews.example.com',
    projectId: 'YOUR_PROJECT_UUID',
    environment,
  });
</script>
<div use:huddle={options}>Your application content</div>
```

Place the action on a stable application container. For a persistent SvelteKit `+layout.svelte`, place `{@render children()}` inside that container. The action does not run during SSR; Svelte invokes its update/destroy callbacks as parameters or element ownership change. The runnable SvelteKit 3 fixture configures its Node adapter through `sveltekit({adapter: adapter()})` in Vite.

## Solid

```tsx
import {createSignal} from 'solid-js';
import {createHuddle} from '@huddle/browser/solid';
function Review() {
  const [environment] = createSignal('staging');
  createHuddle(() => ({serverUrl: 'https://reviews.example.com',
    projectId: 'YOUR_PROJECT_UUID',environment: environment()}));
  return null;
}
```

Call inside a component/owner; do not create the helper at module scope. It mounts after the component and releases its own widget on cleanup.

## Angular

```ts
import {Component,signal} from '@angular/core';
import {injectHuddle} from '@huddle/browser/angular';

@Component({selector: 'app-review',template: ''})
export class ReviewComponent {
  readonly environment = signal('staging');
  readonly review = injectHuddle(() => ({
    serverUrl: 'https://reviews.example.com',
    projectId: 'YOUR_PROJECT_UUID',
    environment: this.environment(),
  }));
}
```

Call in an injection context, such as a component field initializer or constructor. `afterNextRender` prevents server-side DOM work; `DestroyRef` releases the effect and widget. The fixture tests actual application destruction/bootstrap as well as signal updates. Angular browser rendering is verified; Angular SSR itself has no dedicated fixture.

## Astro

```astro
---
import {ClientRouter} from 'astro:transitions';
---
<html><head><ClientRouter /></head><body><slot /></body></html>
<script>
  import {installHuddle} from '@huddle/browser/astro';
  installHuddle({serverUrl: 'https://reviews.example.com',
    projectId: 'YOUR_PROJECT_UUID',environment: 'staging'});
</script>
```

Install once in a layout's processed browser script, rather than server frontmatter. The helper cleans up before document swaps and mounts after page loads, including history navigation. A getter can read the new page's DOM/location and return null on pages that should have no widget; the fixture uses this pattern. Without ClientRouter, a full browser navigation naturally creates a new installation in the next document.

## Configuration, ownership and cleanup

- `null` disables a helper and releases its widget. Setting options again mounts a new one.
- `environment` and `release` update the current widget in place. An environment change cancels authorization, closes the old stream and requires a fresh review connection. A release change preserves access.
- Other installation settings trigger cleanup and remount. This includes server/project, request deadline, CSP nonce, URL policy and callback identity. Keep callbacks stable across renders when their behavior has not changed.
- Equivalent query-parameter arrays and unchanged values do not remount the helper. A new options object on a normal render is safe.
- Only one integration owns a document. A helper refuses an existing manual installation or another helper, even with identical options. A failed mount/cleanup cannot remove that existing widget. Repeated manual core `mount` calls retain their original identical-settings behavior.
- Let the framework dispose its helper. Prefer changing its options to null over imperatively destroying `current`. The Astro installer can be explicitly destroyed when its application-level listeners are no longer needed.

Use a persistent root owner when pages overlap during transitions. Do not combine the standalone installer, a manual mount and a framework helper in one document. Framework runtimes remain external peers and never enter the core installer/ES-module dependency graph.

The browser engine's [failure recovery](reliability.md), URL privacy policy, CSP requirements and authentication scopes apply equally to every helper.
