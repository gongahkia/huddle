# Failure handling

Huddle is a single-instance service with durable SQLite transactions. Interrupted review sessions are recoverable; distributed high availability is outside this release.

| Failure | Behavior |
| --- | --- |
| API hangs or stalls during its response body | Default 15-second deadline aborts the request and frees the saving state. Widget and management share this transport. |
| Proxy returns HTML errors | A readable error replaces the JSON parser exception. Transient feedback-list failures retry with capped backoff. |
| Save commits but the response is lost | An unchanged retry reuses its ID, including after reload when browser persistence is available. The service returns the existing thread instead of inserting another comment. |
| Reviewer edits an uncertain save before retry | Changed payload gets a new ID. Check existing feedback before changing and resending an uncertain save; writes are never automatically replayed. |
| Reviewer types during a slow save | New text remains in the draft after the original save succeeds. |
| Live stream drops or silently stalls | A 45-second receive watchdog and capped reconnect delay with jitter recover it. Heartbeats arrive every 15 seconds; durable cursors resume changes. |
| Large catch-up batch | Individual packets are bounded; many valid events are not mistaken for one oversized event. |
| Document becomes hidden / integration is destroyed | Hidden streams pause. Destroy aborts requests and popup work, closes streams and removes owned timers/listeners/observers/DOM. |
| Browser returns online | Stream resumes and feedback refreshes. |
| Session expires or invitation is revoked | Private view state clears and reconnection is required. Unsent drafts stay scoped to the original user/project/environment. |
| Environment changes during authorization | Old connection is cancelled; old credentials/member results cannot initialize the new environment. |
| SIGTERM with live reviewers | Streams close in Fastify's `preClose` phase before database cleanup so they cannot hold shutdown open. |
| Service process exits | Compose's `restart: unless-stopped` restarts it with its persistent database volume. Health status alone does not restart a running process. |
| Local storage is denied, full or evicted | Active draft remains in memory. Reload recovery and persistent retry IDs cannot be guaranteed. |

Mutations, history, durable events and idempotency references commit atomically. Expected versions reject conflicting coordination edits. Draft/retry persistence shares the existing 2 MiB cap and 14-day expiration; no review credential is stored there.

## Deployment boundaries

Run one process against a persistent local volume. Do not use multiple replicas or a network-mounted SQLite file. Use HTTPS remotely and set the exact `HUDDLE_BASE_URL`. Configure the proxy to preserve authorization/Origin headers and forward SSE without buffering; an idle timeout of at least 60 seconds is a reasonable starting configuration for 15-second heartbeats. Allow shutdown time for ordinary in-flight work and exports.

Use SQLite's online backup command and test restore against disposable data. Disk or volume loss requires an operator restore; client retries cannot repair it. Monitor `/api/health`, process restarts, disk capacity and backup age.

Controlled-clock tests cover request/body/stream stalls, reconnect cursors and cancellation. Browser fault injection commits a real comment, withholds acknowledgement, reloads and retries against the real service. Another test injects temporary proxy failures and checks read recovery. Service tests shut down with an open authenticated live stream. See [verification](verification.md#integration-hardening) for results and remaining gaps.

The earlier ten-minute, 100-reviewer benchmark applies to its recorded revision. It is not evidence of zero downtime, distributed failover, unlimited teams or every framework version. Public registry distribution and a browser extension remain future work.
