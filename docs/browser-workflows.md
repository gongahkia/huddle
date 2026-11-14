# Embedded browser workflows

The v0.2 overlay reads and writes through the host collaboration adapter. It needs no management app, separate Huddle login or product service. The server remains responsible for authorization, authorship, validation, limits and CSRF protection.

Thread, reply and history controls replace one page at a time. First/next navigation remains available beyond the old display caps. Pending reads disable paging and announce busy state. Expanded history shows its complete structured payload; captured source/context is available without dumping the host DOM. Directory lookup uses replaceable host-approved pages of at most 100 members, preserving selected mentions across pages. The composer states its 30-member mention limit and disables additional choices at that limit. Directory responses accept only member ID/name plus an optional cursor; host account records must not be returned directly.

Open Import / export from the panel header. Exports select explicitly authorized environment IDs, JSON or escaped Markdown, and optional page/status filters. A browser download is created after receiving the bounded complete response. JSON must have the supported schema, complete footer and matching record counts. Interrupted/invalid downloads do not become downloadable complete datasets. Host exports use a consistent snapshot; see [host transfers](host-transfers.md).

An import stages a selected JSON file, then previews source scope/record counts, environment/origin mappings, historical identities and conflicts. Mapping changes invalidate the preview and require another preview before execution. Identity choices come from the host-approved directory; a historical name grants no access. Execute is explicit. Each acknowledged request advances one bounded host batch; an uncertain response stops automatic advancement. Resume reuses the same preview, digest, job and request key. Reopening a retained job performs a read-only progress check. A stalled job pauses with a visible message. Completed counts are checked against the preview; a false completion response is an error.

Default upload/download assembly limits are 32 MiB / 64 MiB. Configure `transferLimits: {uploadBytes, downloadBytes}` within maxima 64 MiB / 1 GiB and matching host/proxy limits. Fragmented streams are coalesced into 64 KiB blocks; these are bounded in-memory file operations, not constant-memory streaming to disk. Larger datasets require a smaller export scope or an application-specific transfer tool. File bytes never enter draft storage. Closing, navigation, identity change, revocation and destroy cancel owned UI operations; published discussion stays on the host.

Polling defaults to ten seconds while the authorized panel is open and visible, with one request at a time and bounded backoff/jitter. Open, reconnect and visibility return catch up immediately. Subscription failures fall back to polling. Draft and uncertain-write state are isolated by integration namespace, workspace, actor, environment and page. Local persistence has bounds/expiry and memory fallback; sensitive hosts can select memory-only or disabled persistence. Authentication denial clears private rendered content. Sign-in belongs to the host.

Capture hooks apply before persistence: `excludeElement` rejects sensitive targets, `redact(text, field)` handles all captured anchor/context strings, `pageIdentity` receives a sanitized URL and `viewContext` supplies bounded JSON. Private descendants/ancestors, form controls and excessively broad target subtrees are rejected. Selection quotes are limited to the selected target. Query/hash retention is opt-in. Stored view context does not restore tabs, dialogs or records automatically. Frame contents, closed shadow DOM and canvas internals remain inaccessible.

The overlay uses Shadow DOM, a host-provided CSP style nonce and native top-layer behavior. Focus returns to the opening control, including a control inside an accessible shadow root. Escape closes the active review interaction. Focus indicators, live status and busy announcements are present. Pin selection intercepts page clicks only while deliberately active. Destroy removes owned DOM/listeners/timers/route hooks and clears detached private UI content.

Set variables on the Huddle root or an inherited host ancestor. No host stylesheet reset is required.

| Variables | Purpose |
| --- | --- |
| `--huddle-font-family`, `--huddle-color-scheme` | Typography and native control color scheme |
| `--huddle-text`, `--huddle-muted`, `--huddle-link` | Text colors |
| `--huddle-background`, `--huddle-surface`, `--huddle-hover`, `--huddle-border` | Panel and control surfaces |
| `--huddle-accent`, `--huddle-accent-hover`, `--huddle-accent-text`, `--huddle-focus` | Actions and visible focus |
| `--huddle-notice-background`, `--huddle-error-background`, `--huddle-error-text` | Notices and failures |
| `--huddle-badge-background`, `--huddle-target-background`, `--huddle-warning` | Review metadata and anchor warnings |
| `--huddle-panel-width`, `--huddle-radius` | Panel geometry |

Automated accessibility checks and short resource measurements cover the tested browser/fixture combinations. They do not establish every screen-reader/device combination or hours-long performance. Actual versions, measurements, limitations and failed/unavailable gates belong in the implementation evidence, not inferred from old server benchmarks.
