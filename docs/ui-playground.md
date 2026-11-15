# Local Huddle UI playground

Huddle's examples are the first place to review the widget UI. Pronto is the downstream engineering integration check, as recorded in [ADR 0001](decisions/0001-huddle-ui-dogfooding.md). This guide applies to the Huddle source checkout, not a separately deployed service or an installed SDK-only project.

Use Node 24.21.0 and pnpm 10.33.0:

```sh
pnpm install --frozen-lockfile
pnpm playground
```

Open **http://localhost:4327/playground/**. The command builds the current SDK/examples and starts an example host bound to loopback. It creates its own marked temporary SQLite fixture, takes no database URL and accepts no Pronto credentials. Stop with Ctrl+C; only that invocation's verified disposable fixture is removed. Restarting gives a fresh dataset. Saved local feedback is fictional and lasts until the host stops; export it first if you want to retain it. A non-default loopback port can be set with `HUDDLE_BROWSER_FIXTURE_PORT`.

The Atlas example is a small working product with Overview and Settings pages, forms, a table, changing targets, a scrollable activity panel and a native preferences dialog. The persistent dock and host Feedback launcher use the actual built SDK from `/sdk`, through the real HTTP adapter and SQLite reference store. There is no playground-specific implementation of the Huddle panel or pins.

## Controls and data

- **Everyday review** includes several threads on one target, two authors, long replies/history, a mention, assignment, a resolved thread and feedback on another page.
- **Empty workspace** starts without feedback and supports creating your own page and element comments.
- **Busy workspace** adds enough threads for list paging; the long discussion and member directory also span pages.
- **Reviewer** defaults to an anonymous visitor with a generated display name. Expand the dock, click the reviewer name in the footer, and optionally set your own name; its stable host-issued ID survives Reload example. Alex/Morgan remain useful fixed personas, alongside a guest who can browse the example but is denied review access. **Open a second reviewer** gives another independent host-issued fixture session, even in the same browser profile. These are fictional local personas, not Huddle accounts or production session middleware.
- **Host capabilities** offers the complete directory/mentions/assignment UI or basic commenting.
- **Preview size** changes the actual iframe viewport to available desktop width, 390 × 844 or 320 × 720. It does not scale a desktop screenshot. **Open example full-page** also supports normal browser/device inspection.
- **Theme** applies coordinated host and widget light/dark tokens.
- **Service** changes the current review session's backend behavior without reloading its draft: normal, slow responses, failed writes, service unavailable or expired access. It affects subsequent review requests; use Refresh feedback to observe a read failure immediately, or submit a draft to inspect failed-write recovery. These responses are explicitly simulated. For actual networking failure, use browser offline mode separately.

Changing reviewer, dataset or capabilities reloads the sample application; changing Service or Theme does not. Reload example keeps the process's dataset and uses the same fictional actor, so local draft restoration can be inspected. It does not delete feedback. Browser-local drafts/read markers follow the SDK's normal persistence and can outlive a fixture restart; the SQLite feedback itself does not. Fixed device previews can require scrolling the outer workbench on a short display. The fixture host also serves the existing CSR examples; their framework lifecycle controls remain separate from the canonical widget UI playground. SSR examples retain their individual build/start commands.

## UI review pass before porting

| Area | Inspect in Huddle |
| --- | --- |
| Initial states | Empty, seeded, busy, checking access, loading, basic capabilities and guest denial. |
| Reading | Cards, authors, counts, wrapping, Unicode, unread state, resolved filters, all pages, full reply/history/member paging. |
| Pins | Drag and keyboard-move/reset the persistent dock; collapse/expand transitions, reduced motion, speech-bubble shapes, shared color choices, hover and keyboard previews, Escape, shared targets, viewport edges, page scrolling and nested scrolling. |
| Writing | Page/element comments, multiline drafts, mentions/assignment, reply, resolve/reopen, locate, reattach and cancel. |
| Accessibility | Keyboard-only use, focus/return focus, readable Cancel in both picker modes and themes, labels, contrast, narrow layouts and browser zoom. |
| Navigation | Overview/Settings with active review, unsent drafts and the sidebar collapsed. |
| DOM changes | Rename, hide, remove and restore Delivery notes; check warnings and deliberate reattachment. |
| Native surfaces/privacy | Preferences dialog, scrolling dialog content and excluded sample-data card. Inputs and excluded content must not be captured. |
| Failures | Slow reads, failed writes with draft retention and deliberate retry, unavailable service, expiry/recovery and actual offline/online. |
| Transfers | Complete JSON/Markdown download, import preview/mappings, explicit execution, progress and retained job recovery. Export a fixture snapshot to supply a valid import file. |

Run the automated playground checks with the ordinary browser suite:

```sh
pnpm test:browser
# after building the SDK and maintained browser fixtures:
pnpm exec playwright test tests/browser/playground.spec.ts
```

The suite uses its own loopback fixture on port 4326 and leaves a manual playground on 4327 alone. Test-owned session tokens and raw traces stay in ignored output. On hosts needing the local WebKit compatibility runtime, follow `docs/browser-runtime.md`.

Record the SDK/source revision, browser/device widths, checked states, actual automated results, visual findings and remaining limitations. A sample-host pass is UI evidence; the existing database/framework/portability and real consumer engineering gates retain their own acceptance meaning. Do not update or deploy Pronto merely to preview widget changes.

## Initial playground verification — 15 November 2026 (`ce1d5bc`)

Verified with Node 24.21.0, pnpm 10.33.0, Playwright 1.65.0 and the unchanged browser SDK 0.2.4. The working changes extend commit `123fb0b`; the containing commit completes the playground's host/build wiring, documentation and checks.

- Frozen dependency installation, `pnpm typecheck`, `pnpm lint`, `pnpm test` (126 tests), build, the eleven packed framework/HTML fixtures, `pnpm test:package` and `pnpm check:bundle` passed.
- The full browser suite passed 94 tests, including all 18 new playground checks across Chromium, Firefox and WebKit. The existing Chromium DevTools metric check was intentionally skipped on Firefox and WebKit (two skips). WebKit used the local compatibility runtime described in `docs/browser-runtime.md`.
- Automated WCAG checks covered the sample application and framed workbench. Desktop light and true 320 × 720 dark previews were inspected; browser-local draft restoration was checked across Reload example. A final Settings seed correction was verified against a freshly started manual host: its saved `h1` anchor opens without a changed-target warning.
- SDK module graph sizes remain 23,004 bytes gzip for core and 2,846 for HTTP. The existing real-host resource check passed twenty mount/destroy cycles per browser, a 120-second open-thread sample on Chromium and 30 seconds on Firefox/WebKit. Chromium measured zero listener delta after cleanup, zero closed-widget requests and six requests per 30-second open window. These bounded samples do not establish hours-long or every-device performance.

Your visual/interaction approval of the checklist remains a separate review step. Fault controls simulate backend failures; actual offline behavior needs browser offline testing. This examples-only change does not renew the four-database/twelve-combination, migration or hosted Pronto acceptance evidence, and does not update Pronto's archive or deployment. Screenshots, logs, fixture tokens and raw measurements remain in ignored local output.

## Shared SDK v0.3 UI refinement — 15 November 2026

This iteration changes the shared browser library, its neutral color contracts and host references. Both private packages are version 0.3.0. It retains the Huddle-first UI review decision; no Pronto archive, source, environment or deployment was changed by this work.

The normal installation begins with authorized speech-bubble pins and a persistent draggable dock. There is no close icon; expand/collapse transitions respect reduced motion. Arrow keys move a focused grip and Home restores the bottom-right position. The explicit `launcher: 'hidden'` integration still waits for a host opener. Programmatic `close()` pauses review and clears private rendered state while retaining the floating dock; `destroy()` removes the installation.

Typing `@` offers filtered, paged keyboard-accessible suggestions instead of a member checklist. Six named comment colors are shared through stored thread/comment fields and complete transfers. Anonymous visitors get a stable host-issued identity and a generated display-name placeholder; an optional host callback accepts a chosen name without creating a Huddle account. Export and Import now have separate tabs, progressive filters/mappings and an explicit import preview/confirmation. Hidden-target badges use Lucide's slashed-eye icon. See [browser workflows](browser-workflows.md) and [the color contract](collaboration-contract.md).

Verified on Node 24.21.0, pnpm 10.33.0, Playwright 1.65.0 and SQLite 3.53.4:

- `pnpm typecheck`, `pnpm lint` and 131 unit tests passed, including stale directory responses, IME entry, mention limits, retained drafts and actor-bound name cleanup.
- `pnpm test:storage` passed 41 SQLite checks and 170 checks across the native PostgreSQL/MySQL/MongoDB suites and sixteen ordered database portability pairs. Colored records survive export/import; unsupported and arbitrary CSS colors are rejected.
- The packed server matrix passed all twelve Next.js/Express/Fastify × SQLite/PostgreSQL/MySQL/MongoDB combinations, including colored creates/replies, transfers, restart persistence, authorization denial and data retention after uninstall.
- The final full `pnpm test:browser` rebuilt the eleven packed framework/HTML fixtures and passed 100 tests on Chromium 158.0.8127.18, Firefox 159.0 and WebKit 27.2. Two intentional skips cover the Chromium DevTools-only metric check on Firefox/WebKit. The new flows passed accessibility checks, real downloads and CSP checks. The framing fixture explicitly allows blob downloads; script/style restrictions remain in place. Application CSP is checked before axe injects its own audit styles.
- Fresh packed browser consumers and the SQLite host consumer passed installation, declarations, SSR imports, bundling and persistence checks. Core is 29,676 bytes gzip and HTTP is 2,878, including their shared chunks, below the 75 KiB budget.
- The final resource run passed twenty mount/destroy cycles per browser and open-thread windows of 120 seconds in Chromium and thirty seconds in Firefox/WebKit. All measured six requests per thirty-second open window and zero closed-widget requests. Chromium retained 980,712 heap bytes after cleanup with zero listener delta. Firefox/WebKit do not supply comparable heap/listener metrics.

The work preserves owner commits `0307c65`, `cf8c323`, `ab77173` and `0c55906`; the containing final commit records the verified checks and final CSP-audit test correction. Earlier checks exposed an interrupted-animation listener leak, a focused-pin/hover race and blocked iframe downloads; these were corrected and the complete rebuilt browser suite rerun. Local fixture snapshots were retained in ignored operator output before refreshes. Visual approval, every-device/screen-reader testing, hours-long performance and a future paired Pronto rollout remain separate gates. Older strict v2 readers require an upgrade before enabling shared colors or importing colored feedback.
