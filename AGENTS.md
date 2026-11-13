# Huddle engineering guidance

Huddle is a self-hosted review overlay; preserve framework-independent browser code.
Use Node 24 and pnpm. Source reference pronto-prod is read-only.
Keep credentials, databases, build output and benchmark raw data out of Git.
Use isolated disposable Huddle test data. Make coherent atomic commits.
Before completion run typecheck, lint, test, build, browser tests and bundle checks.
Document actual performance evidence and unmet acceptance criteria honestly.
