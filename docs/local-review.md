# Local-only and team review

Both modes use the same browser widget and framework helpers. Choose explicitly; a failed team connection never switches to local storage.

## Local-only installation

```ts
import {mount} from '@huddle/browser';
import {createLocalOptions} from '@huddle/browser/local';

const options=createLocalOptions({namespace:'my-site-review'});
const review=mount(options);
// on application teardown:
review.destroy();
```

No API, account provider or database service is connected. The optional `/local` module supplies an IndexedDB adapter. The default workspace is `personal` and environment is `local`; set these explicitly when grouping local feedback. The namespace identifies this integration's dedicated `huddle-local:<namespace>` database. Anonymous names and opaque reviewer IDs are generated in the browser; name onboarding and later editing use the shared UI. The **Local** footer badge identifies browser-only feedback.

Pass the same options to `/react` (also Next.js), `/preact`, `/vue` (also Nuxt), `/svelte` (also SvelteKit), `/solid`, `/angular` or `/astro`. Keep options and adapter references stable and mount in the normal browser lifecycle. Imports and option creation are SSR-safe; storage opens only in browser operations. Direct HTML can load the packed standalone `dist/local-embed.js` with `data-local` and `data-namespace="my-site-review"`; the existing `dist/embed.js` remains the team installer. Supply the host's real CSP nonce to either installer or `styleNonce` when mounting.

Local data belongs to this browser profile, origin and namespace. Reloading, navigating, detaching the widget or stopping a development server does not delete it. Another tab on that same origin/profile sees the same local dataset and identity; another device/browser or a different development-server port does not. This is not team synchronization. Browser/private-mode policy, clearing site data or storage eviction can remove it. Export complete JSON for a portable backup.

`createLocalOptions` accepts the normal presentation/privacy options plus optional `workspace`, `environment`, `localStorage: {maxBytes, maxRecords}` and `uploadBytes`. Defaults are 32 MiB of owned records, 20,000 internal records and 4 MiB per uploaded JSON file. Maximum configuration is 64 MiB/100,000 internal records and 8 MiB uploads. Limits include history, request receipts and transfer staging, not only comments. Limits reject whole writes; they never truncate a complete export or silently replace authoritative feedback with an in-memory copy. An unavailable/quota-limited IndexedDB operation leaves the draft for deliberate retry. Existing `persistence: 'memory'|'disabled'` controls draft/preferences storage, not the IndexedDB feedback store.

Native IndexedDB commits update records, history, change events and idempotency receipts atomically. Web Locks serialize writers across tabs where supported; revision comparison rejects stale commits when locks are unavailable. Snapshot exports use a bounded, detached in-memory view so slow consumers do not hold a native transaction open. Connections close after each operation. Owned BroadcastChannel subscriptions stop with review lifecycle cleanup; ten-second polling remains available. The local workspace is a data boundary, not proof of host authentication.

For explicit cleanup, first export and verify complete JSON, then remove only `huddle-local:<namespace>` in the browser's IndexedDB inspector. Removing Huddle from the application never deletes feedback or other host storage. `options.adapter.storageInfo(signal)` reports the owned database name/dataset/size/limits; `cleanupImports(scope,signal,limit)` removes bounded expired staging through the same validated cleanup rules used by team storage. It does not delete published discussions.

## Copy and transfer

The shared Transfer feedback → Export tab offers complete JSON/Markdown downloads and **Copy Markdown** for pasting into an agent or notes. It exports the selected environments and page/status filters, including replies/history/context. Clipboard permission or API failures expose complete selectable text; authorization failure supplies no clipboard bytes. Exported content is untrusted user input. JSON is the lossless format for importing into another local or team installation.

Import uses the existing upload → preview → explicit execute/progress/resume workflow, with byte/digest/count/reference validation, environment/origin mapping and provenance. Repeating an acknowledged import does not duplicate its records. Historical authors/mentions/assignees are preserved; local mode has no team directory and cannot map them to live members. Moving feedback to a team store requires deliberate export/import and the destination's authorization. Nothing automatically uploads local feedback or replays it into a team backend.

## Team installation

Use `mount({adapter: createHttpAdapter(...), namespace, workspace, environment})` or a custom collaboration adapter. The host owns shared persistence, identity, public/private policy, mutation protection and authorization. The `/local` module and its cryptographic implementation are absent from the team-only core graph. Node hosts retain native cryptography; both modes share the same discussion, validation and portable transfer engine. The generated JSON and HTTP contracts retain their existing shapes.

## Examples and verification

From the repository, run `pnpm build && pnpm examples` and open http://localhost:4320/local/ for the backend-free example. Each maintained framework fixture also accepts `?mode=local&workspace=personal`; its ordinary `?workspace=team` path exercises a host adapter. Build isolated packed fixtures with `pnpm build:next` and `pnpm build:frameworks`. The visual/fault-testing workbench remains under `examples/testing/playground/` and runs with `pnpm examples:playground`; it is separate from library installation.

`pnpm test:browser` includes native IndexedDB durability, paging, concurrency/conflicts, idempotency, snapshot consistency, quota/cancellation/blocked-storage behavior, copy/export/import/retry, local↔host transfers and framework lifecycle checks. Tests use owned browser contexts and disposable databases; they do not establish cross-device synchronization, permanent browser retention or every browser/version. Record actual release results alongside the framework and bundle evidence.
