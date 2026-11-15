# Sidebar usability audit — 15 November 2026

Browser SDK 0.2.1 improves the embedded review surface. The host remains responsible for access, APIs and storage; this release requires no database migration.

| Finding | Resulting behavior |
| --- | --- |
| The sidebar obscured the page, and closing it also removed pins. | Review activity and sidebar visibility are separate. Collapse retains pins, drafts and authorized live updates. The compact dock, host launcher or a pin expands the sidebar. Close exits review and stops updates. |
| Pins offered no context until clicked. | Hover and keyboard focus show a bounded, plain-text preview of the latest comment with author and reply count. The preview remains hoverable; Escape dismisses it first. |
| A narrow viewport can leave no room beside a pin. | Previews move above or below the pin, fit the viewport and scroll when needed, preserving access to the pin. |
| Utility labels dominated the header. | Transfer, refresh, collapse and close use inline SVG icons with accessible names and title hints. Primary comment/post actions and deliberate transfer confirmations retain text. SDK 0.2.3 uses Lucide 1.73.0’s vanilla JavaScript package, with named imports bundled into the SDK; framework peers remain external. See the bundled LICENSE-LUCIDE for its notices. |
| Workspace UUID and environment dominated the default view. | These remain available under the footer's Review details control. |
| The list lacked a clear hierarchy. | A smaller 360 px default panel, page heading/count, compact filters, bounded excerpts, correct singular comment count and resolved badges reduce visual noise. Existing theme tokens and the green accent remain supported. |

Open Feedback once to activate review. Collapsing preserves review activity; it does not enable pins automatically on every page load. The host's existing `data-huddle-open` integration continues to mark active review, including the collapsed state. `data-huddle-collapsed` identifies the hidden sidebar. Both core and framework controls expose `collapse()`; `open()` expands it again.

On Node 24.21.0 / pnpm 10.33.0, typecheck, lint and all 122 unit tests passed. Focused collapse/preview/draft interactions passed in Chromium, Firefox and WebKit. The emitted core is 22,043 bytes gzip, HTTP helper 2,846 bytes and installer 23,469 bytes, below the 76,800-byte ceiling. The repository’s full browser suite and Pronto’s independently installed packed consumer remain release gates; their current run results belong in the release handoff. Earlier architecture acceptance does not establish acceptance of this UI revision.

The earlier Pronto panel informed the compact hierarchy, simple cards and labeled primary actions. The library retains its independent styles, complete transfers/history, host policy and lifecycle ownership.

SDK 0.2.3 replaces the initial custom SVGs with Lucide icons. It also gives the pin-picker Cancel button its surface foreground color and a contrasting keyboard focus indicator, and keeps cancellation enabled during background reads. Browser regression checks cover new pins and reattachment in both light and dark themes.

SDK 0.2.4 offsets colliding pin badges within the viewport without changing stored anchors. This keeps discussions on a shared element reachable after picker cancellation or refresh. A completely crowded viewport can still exhaust available badge space.
