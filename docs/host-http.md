# Host HTTP integration foundation

The private server package exposes `/http`, `/next`, `/express` and `/fastify` bridges for the [v2 protocol](collaboration-contract.md). The current verified subset is core discussion operations: session, lists/details, create/reply/update, changes and optional directory. Transfer dispatch exists but requires a host implementation; ReviewStore transfers and the twelve-combination runtime matrix are still pending. This is not full Stage 4 or release acceptance. See [frontend-progress.md](frontend-progress.md).

The application supplies `api(request, signal)` and `verifyMutation(request, signal)`. Both are required. The first returns its request-bound review API, normally a ReviewStore using a shared backend and the host's existing authenticated identity, verified workspace/environment and binary internal-review policy. The second invokes the host's existing mutation/CSRF protection. Express and Fastify callbacks also receive the native framework request as their third argument, allowing existing session/user middleware and CSRF helpers to be reused. Do not replace either with arbitrary identity headers, a public demo guest or a separate Huddle login. Every core method rechecks host authorization; the bridge also checks session before reading uploads and all requested export environments before dispatch. Transfer implementations must recheck authorization while streaming and when reading jobs.

Database installation remains a deliberate separate action against a verified destination. Mounting these handlers does not install or upgrade schema. Reuse the host pool/backend; do not create a new database client or product service for each request. Closing a reference backend leaves the host pool/client under host ownership.

Use Node 24.21.0 and the built private host archive. The bridges have no runtime framework imports. Their optional type peers are Express 5.3.0 / @types/express 5.0.6 and Fastify 5.12.8; install only the selected framework and its types. Next uses standard Request/Response types and adds no Next peer. Database-driver requirements are documented in [the host package guide](../packages/host/README.md).

## Next.js

In an existing Node-runtime route such as `app/api/huddle/v2/[...path]/route.ts`, import `createNextHandler` from `@huddle/host/next`, construct it with the two host callbacks, and export the handler as GET, POST and PATCH. Set `runtime = 'nodejs'`. The installed Next 16.4.6 route guide confirms that route handlers use Web Request/Response and GET is dynamic by default. The bridge returns private/no-store headers; do not opt these routes into shared caching.

The bridge was built/typechecked and its common handler tested; a real Next production runtime/packed-consumer check is still pending. Pronto uses a different installed Next version and needs its own guide and verification before integration.

## Express

Call `createExpressMiddleware({...hostCallbacks, origin: canonicalHostOrigin})` from `@huddle/host/express` and mount it before the application's JSON/body parsers. It calls next() for unrelated routes and uses originalUrl when mounted under a prefix. The canonical origin is explicit; Host or forwarding headers do not choose it.

The middleware streams an unread Node request into the common handler. Existing parsed JSON is supported for ordinary mutations; uploads require exact raw bytes, so an already parsed object is rejected for the upload endpoint. Responses honor Node backpressure and cancel on disconnect. A failed download after headers closes the response rather than appending a JSON error to a partial file.

## Fastify

Register `createFastifyPlugin({...hostCallbacks, origin: canonicalHostOrigin})` from `@huddle/host/fastify` on the existing application. Its raw-buffer parser and error handler are encapsulated in that registration, preserving other routes and parsers. Raw bytes retain upload digests. It uses the shared request bridge and Fastify's native response stream path, preserving host onSend hooks, and maps parser size failures to a safe typed 413 response. Existing host authentication/rate-limit hooks remain the host's responsibility.

Node header limits and router limits also apply before handlers. For long Unicode scopes/page filters, configure an appropriate host request-header limit. The live fixture uses 128 KiB; Fastify accepts the Node option under `http: {maxHeaderSize: 131072}` and router options under `routerOptions`. Those are host setup choices, not settings silently changed by the plugin.

## Limits and verification

Defaults: `/api/huddle/v2`, a 15-second request/stream deadline, 1 MiB JSON bodies and 32 MiB uploads. Configure deliberate host limits through `basePath`, `timeoutMs`, `bodyLimitBytes` and `uploadLimitBytes`. Duplicate/unknown query keys, malformed IDs, noninteger limits, unsupported content types, bad UTF-8 and over-complex JSON fail visibly. Responses use the documented safe error envelope and private/no-store/nosniff headers. Only explicit retries reuse mutation keys; no background write replay is introduced.

`pnpm test:http:core` exercises real SQLite discussion through the Web handler and real Express/Fastify HTTP servers. Transfer seam tests check bounded consumption, cancellation, backpressure and incomplete output; they do not establish actual storage transfers. `pnpm test:package:http`, after build, installs the actual host archive in two fresh consumers with only their selected framework and SQLite, then typechecks/runs auth, CSRF, retry, persistence and unrelated-route checks. The separate database conformance command remains required. Next.js plus all four databases across all three frameworks must still run before claiming the twelve-combination matrix.
