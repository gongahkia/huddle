# Huddle engineering guidance

Huddle is a frontend review library using host authentication, APIs and storage; preserve framework-independent browser code.
Use Node 24.21.0 and pnpm 10.33.0. The approved cross-repository implementation in docs/implementation-plan.adoc includes the sibling pronto-prod integration.
Legacy service/manage code is transitional migration material, not the target product architecture.
Keep credentials, databases, build output and benchmark raw data out of Git.
Use isolated disposable Huddle test data. Make coherent atomic commits.
Before completion run typecheck, lint, test, build, browser tests and bundle checks.
Document actual performance evidence and unmet acceptance criteria honestly.
