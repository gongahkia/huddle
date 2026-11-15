# Huddle engineering guidance

Huddle is a frontend review library using host authentication, APIs and storage; preserve framework-independent browser code.
Use Node 24.21.0 and pnpm 10.33.0. The approved cross-repository implementation in docs/implementation-plan.adoc includes the sibling pronto-prod integration.
The legacy product service, management app, account bootstrap and source-specific importer are retired. Huddle delegates public or authenticated review policy to the host.
UI development and dogfooding belong in Huddle's examples/testing workbench, before updating a consumer. Pronto dogfooding validates engineering integration, existing host identity/policy, storage, CSP, lifecycle, packaging and deployment. Reproduce and fix shared UI issues in Huddle; do not patch a Pronto-only widget. Follow docs/decisions/0001-huddle-ui-dogfooding.md and docs/ui-playground.md. Updating examples does not authorize a Pronto SDK refresh or deployment.
Explicit backend-free local review and host-backed team review share one UI and discussion/transfer engine; follow docs/decisions/0002-local-and-team-modes.md and docs/local-review.md. Do not silently fall back from a failed team connection to local feedback.
Keep credentials, databases, build output and benchmark raw data out of Git.
Use isolated disposable Huddle test data. Make coherent atomic commits.
Before completion run typecheck, lint, test, build, browser tests and bundle checks.
Document actual performance evidence and unmet acceptance criteria honestly.
