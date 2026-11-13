Make Huddle easy to integrate through thin framework helpers, and verify the remaining major SSR integrations end to end.

Work in the existing repository:
/home/gongahkia/coding/projects/huddle

This is an implementation task. Continue autonomously until the acceptance criteria below are met. Make frequent, coherent, atomic Git commits. Do not stop after writing a plan or scaffolding.

Context
Huddle is a lightweight, self-hosted commenting overlay extracted from Pronto. It already has a framework-independent DOM engine, authenticated commenting service, management UI, and an importable @huddle/browser package.

Existing fixtures cover HTML, React, Angular, Vue, Svelte, Preact, Solid and production Next.js. Chromium and Firefox have passed integration tests. Nuxt, SvelteKit and Astro still lack dedicated fixtures.

The browser package is private and distributed through a local tarball. Registry publication, separate packages for every framework, and integrations for less-used frameworks are deferred.

Read AGENTS.md, README.md, docs/integration.md, docs/reliability.md, docs/architecture.md and the relevant implementation/tests before changing anything. Inspect Git status and preserve unrelated changes. Follow current official framework documentation; read installed Next.js guides before writing Next.js code.

Boundaries
- Keep pronto-prod entirely untouched.
- Preserve existing Huddle functionality and persisted data.
- Use disposable databases and fixtures for tests.
- Do not publish packages, push commits, deploy, provision paid services or access private credentials.
- Keep the browser engine independent of frontend frameworks.

Build the following

1. Optional framework helpers
Add small, idiomatic helpers for React, Vue, Angular, Svelte, Preact and Solid.

Prefer optional entry points within @huddle/browser, such as @huddle/browser/react, rather than creating a separate package for every framework. Choose precise APIs after inspecting the existing code.

Helpers should:
- Handle browser mounting and lifecycle cleanup.
- Provide typed configuration.
- Support environment/release updates with documented behavior.
- Be safe to import during SSR and mount only in the browser.
- Handle configuration changes and development remounts predictably.
- Preserve one widget per document and reject conflicting installations clearly.
- Define ownership so cleanup cannot accidentally destroy another integration's widget.
- Reuse the same engine without duplicating it or adding framework code to the core bundle.

Keep framework dependencies external and optional. A consumer installing the core package must not need Angular, React, Vue or any other framework it does not use.

2. Real SSR framework integrations
Add production-built, runnable fixtures for:
- Nuxt using the Vue integration.
- SvelteKit using the Svelte integration.
- Astro with appropriate initial-load and client-navigation lifecycle handling.

Update the existing Next.js fixture to exercise the React helper. Update other fixtures to use their corresponding helpers where appropriate.

Verify real frameworks, not simulated pages labelled with framework names.

3. Meaningful integration tests
Test against the real Huddle service:
- Production rendering and hydration.
- Authentication and an actual persisted comment.
- Host application interactions remaining functional.
- Client navigation and back/forward navigation.
- Component unmount/remount and development lifecycle behavior where relevant.
- Cleanup of owned DOM, listeners, observers, requests and live streams.
- Configuration changes, duplicate/conflicting installations and ownership.
- Existing timeout, draft recovery and lost-acknowledgement retry behavior remaining intact.

Run the applicable browser workflows in Chromium and Firefox.

WebKit is currently blocked locally by Fedora/WSL system dependencies. Attempt it when feasible, retain a reproducible supported-environment configuration, and report its actual status honestly. WebKit is not a required completion gate for this milestone.

4. Verify the distributable package
Pack the actual browser package and install it into isolated consumers outside the workspace.

Verify:
- Core JavaScript and TypeScript imports.
- Every new helper's public exports and declarations.
- SSR-safe imports where applicable.
- Consumers install only the framework they actually need.
- No unresolved workspace aliases, source paths or private internal dependencies.
- Importing one helper does not pull in other frameworks.
- Supported consumers can build using the packed artifact.

Use the packed artifact in representative integration fixtures so tests exercise the distributable package as well as repository source.

5. Documentation and evidence
Document exact installation commands, minimal usage examples, lifecycle behavior, ownership, configuration updates and cleanup.

Update the coverage matrix to distinguish:
- Verified framework versions and browser engines.
- Importable integrations without complete acceptance.
- Unsupported targets and remaining gaps.

Record commands, outcomes and limitations. Preserve historical performance evidence with its original scope. Do not describe CI as passing unless its execution was observed.

Acceptance criteria
- The helpers and all three new SSR integrations are implemented and usable.
- Existing public core imports and behavior remain compatible.
- Typecheck, lint, unit/integration tests, production builds, package-consumer checks and applicable Chromium/Firefox browser tests pass.
- Core installer and ES-module assets remain under the existing 75 KiB gzip budget; report measured sizes and any material increase.
- No framework runtime is added to the core widget.
- Integration documentation is sufficient for someone working in a separate repository.
- All task changes are committed in coherent atomic commits.
- Temporary services and disposable fixtures are cleaned up.
- Final Git status is clean except for explicitly preserved pre-existing changes.

Use judgment to resolve routine implementation choices without repeatedly asking permission. If a check fails, diagnose and fix the cause rather than weakening the assertion or silently dropping coverage.

Finish with a concise handoff: implemented import paths, verified frameworks/browsers, validation results, bundle sizes, commit IDs and any remaining limitations.