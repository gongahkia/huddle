# @huddle/browser

Framework-independent embedded Huddle client. Requires a self-hosted Huddle service.

```ts
import { mount } from '@huddle/browser';
const huddle = mount({
  serverUrl: 'http://localhost:4310',
  projectId: 'your-project-uuid',
  environment: 'staging',
  release: 'release-identifier',
});
huddle.open();
huddle.close();
huddle.updateContext({ release: 'next-release' });
huddle.destroy();
```

Calling `mount` twice with identical settings returns the existing document instance. Conflicting settings throw; destroy before changing the installation.
`updateContext` changes environment/release; changing environment requires new review authorization.
Use lifecycle cleanup in your frontend framework. No framework runtime or app stylesheet is required.
Imports are SSR-safe; mount only in a browser lifecycle hook after hydration.
The optional `requestTimeoutMs` changes the 15-second API deadline; `onError` reports failures to host diagnostics.
Failed saves preserve retry IDs across reloads when local storage is available. No automatic write replay occurs.

The default page identity retains only pathname. `allowedQueryParameters: ['view']`, `includeHash: true`, and
`pageIdentity: sanitizedUrl => ...` are explicit opt-ins. Never allow parameters/fragments that hold secrets.
The sanitized page URL is saved in comments and exports. The widget reads labels/text around selected targets;
reviewers should avoid pinning sensitive content.

Review access is established through a user-initiated, origin-checked popup and a one-use PKCE exchange.
`accessToken` is an optional integration seam for an already-authorized, origin/project/environment-scoped
review credential. It is not an installation key; do not put credentials in script attributes or source files.

Styles use Shadow DOM and a manual popover with native dialog handling. Standard DOM elements are supported.
Cross-origin frames, closed shadow roots and canvas internals are not supported. Pins can require reattachment
after major changes. See the root README for authentication, deployment and the full compatibility contract.

This package is private and not published. See NOTICE for provenance and licensing status.
