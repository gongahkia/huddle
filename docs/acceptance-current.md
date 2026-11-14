# Frontend-only acceptance and remaining rollout gates

This records the new architecture, separately from the historical service release. Runtime milestones are browser workflows `e645e7f`, host stream correction `00426a5`, Pronto integration `8c830d5` and Pronto migration rehearsal `de38210`. Both use Node 24.21.0 / pnpm 10.33.0. Full chronological evidence, exact archive/run hashes and limitations are in [frontend progress](frontend-progress.md) and Pronto's `docs/integrations/huddle-v2-progress.md`.

| Gate | Fresh local result |
| --- | --- |
| Neutral contracts, HTTP/OpenAPI, feedback.v2 schema | Implemented before the browser rewrite; generated/schema checks passed |
| Browser and host engineering | Frozen install, typecheck, lint, 144 ordinary checks, build and bundle checks pass |
| Four real stores and complete transfers | 207 checks pass; PostgreSQL 18.6, MySQL 8.4.13, SQLite 3.53.4, MongoDB 8.0.38 replica set |
| Three server bindings × four stores | All twelve pass through real installed archives, positive transfers/auth, restart and SDK removal/data retention; run `4c0a79fb-b059-41d2-9ce1-ef8b62d1a9cc` |
| Portability | All sixteen ordered pairs pass complete normalized comparisons, provenance and repeat imports |
| Framework/HTML consumers | Nine packed consumers plus real production framework fixtures pass; jQuery/htmx host checks pass |
| Browser, privacy, lifecycle and accessibility | Full run 64 pass / two CDP-only skips across Chromium 158, Firefox 159, WebKit 27.2; twelve focused host/HTML checks pass after the final bounded follow-up |
| Bundle | Core 19,139 bytes gzip, optional HTTP 2,849, installer 20,519; unchanged 76,800 ceiling |
| Resource evidence | Twenty mount/open/destroy cycles per browser; zero closed requests or final DOM delta; bounded storage and 30-second open samples. Four Chromium windows cover 120 seconds. See actual heap/task/listener figures and limits in progress |
| Pronto private archives and independent install | Real browser/host 0.2.0 archives, frozen lock, separate consumer install, production build and existing PostgreSQL/session binding pass |
| Pronto central policy and navigation | Named-user positive workflows, both old/new endpoint denial, guest navigation, nonce/RSC stability and real session-version revocation pass |
| Pronto engineering | Frozen install, types/lint/build; 956 ordinary pass / 147 database skips; full real database suite 1,095 pass / eight unrelated optional skips |
| Pronto migration rehearsal | Six checks pass, including pre-058 backup/recovery/install, 108 threads / 475 comments / 475 source-history records, lost acknowledgements, expiry/repreview, complete parity, activation, new reply and readonly rollback/resume |
| Pronto migrated browser fixture | Eight pass in Chromium 148 / Firefox 150 with Playwright 1.60.0, actual Pronto logins and independent archive consumer; run `e72301ea-803e-4b82-872c-f738daa77e50` |

The browser performance evidence is reproducible and bounded. It does not establish hours-long use, all devices or Firefox/WebKit heap metrics. Automated axe WCAG checks passed; manual screen-reader acceptance is not established. Current tests do not relabel old service load/RSS/Docker results as new browser support. CI now uses disposable host integration fixtures instead of the old product-service container/load jobs. Review branches can run remote acceptance before any main release.

## Original stores and hosted state

Read-only inventory of the existing local `.data/huddle.sqlite` found schema version 3 and zero projects/users/threads/comments/history/events/requests or authentication records. A supported consistent SQLite backup including committed WAL state passed integrity checking. Inventory run `3aef2d58-3ab6-45a9-b2f3-7d907bc59fab`, private backup SHA-256 `362500471b1b8ba89fa1b1fbe32fd55f9e8465d6c4f571469db21e4965ded466`; both original and ignored mode-600 backup are retained. No application constructor/service/schema upgrade was used. This does not inventory an old machine or the hosted Pronto PostgreSQL source.

At 2026-11-14 23:00:58 UTC, the read-only Pronto `/api/status` observation returned HTTP 503, revision `ac588e6589dcb1cb933483379da5218e79e9974b`, database unavailable, `providerProbe:false`. No inference was invoked. GitHub metadata resolves the existing Pronto remote alias to `gongahkia/pronto-poc`; no remote main commits were newer than the local base at the checked fetch. No production schema/data changes or main push/deployment have occurred during this implementation.

The following acceptance remains open: verified hosted database/backup access; inventory and consistent recovery of its actual feedback and any old-machine Huddle data; confirmed Render deployment settings; two genuine named internal sessions; fresh remote CI; bounded final source pause/migration; complete real source/destination parity and provenance; activation and main release; actual deployed revision; internal collaboration/fresh-session persistence and guest denial. Local fixture credentials are not substitutes. No deployment/database credentials or the documented old private session files are available in this workspace. Do not request secrets in chat or provision paid replacements.

Pronto's private runbook supplies guarded `status`, `backup`, `install`, `pause`, `prepare`, `preview`, `execute`, `verify`, `activate`, `readonly`, `export` and `resume` commands. They retain source tables/backups and require exact target identity plus an existing internal actor. A changed source/target is refused. Rollback uses the current new store read-only and complete neutral export so post-cutover discussion remains visible; reverting to the old store is unsafe.

Legacy service/manage and source-specific conversion material remain transitional because actual external source inventory/migration is unresolved. The permanent browser/host packages contain no Pronto conversion. Retire those components and temporary production migration commands only after actual migration dependencies and hosted parity permit it. Package detachment never authorizes data deletion. No paid loop, inference worker, paid infrastructure or evaluation-budget change was made.
