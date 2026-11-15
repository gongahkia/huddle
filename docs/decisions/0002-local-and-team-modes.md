# ADR 0002: One review UI with local-only and team modes

Status: accepted. Confirmed by the repository owner on 15 November 2026. Implementation follows completion of the current onboarding and compact-dock refinement.

## Decision

Huddle supports two explicit operating modes through the same framework-independent browser library, floating dock, expanded sidebar, pins and discussion UI.

- **Local-only:** install or embed the browser library without connecting a backend, host account system or team database. Feedback stays in that browser/device. Users can annotate a working page and copy or export formatted feedback for a coding agent. Local-only discussion is not shared team collaboration. Explain the storage scope and support deliberate portable export/import without requiring a service to run.
- **Teams:** install or embed the same UI and connect a host collaboration adapter to the application's API and shared database. The host supplies reviewer identity, public/authenticated access policy, mutation protection and authorization. This mode supports shared feedback, replies, persistence and team coordination. Pronto remains an example of this integration.

Both modes retain the framework helpers and direct browser installation path. Neither requires a separately deployed Huddle product service or Huddle account system. Operating mode is a data/adapter choice, not a fork of the widget UI or an authentication role.

Local-only mode must be explicit. A failed or unauthorized team connection must not silently fall back to local storage, hide a sharing failure or automatically replay local writes into a team database. Moving feedback between modes uses deliberate portable transfer with visible destination, identity/provenance handling and existing validation.

## Implementation sequence and acceptance

1. Finish and verify the already-requested first-visit onboarding and compact-dock UI changes in Huddle's playground.
2. Define the local installation/options contract and actual browser-storage behavior. Reuse the neutral collaboration and portable feedback models; keep database/server dependencies out of the browser bundle.
3. Implement a real local adapter and a no-backend example using the same UI. Document reload persistence, origin/browser boundaries, storage failure/limits, clearing data, and complete formatted copy/export/import. The current SQLite-backed playground is a host integration fixture and does not establish this mode.
4. Verify a fresh browser installation without a running API or database, persistence across reload, copy/export for an agent, transfer integrity and explicit mode boundaries. Existing team conformance, authorization and deployment gates keep their own meaning.
5. Document and verify both installation paths. Port to Pronto only when consumer integration/rollout is requested, following ADR 0001.

This decision records approved direction. It does not claim that the existing SDK already provides a backend-free adapter or that local feedback is shared, synced or backed up elsewhere.

The v0.4 local options, storage boundaries, shared engine and installation paths are specified in [Local and team review](../local-review.md). The maintained workbench lives in `examples/testing/playground/`; it remains a team-host testing fixture, alongside the separate no-backend local example. Actual release evidence must cover both paths before consumer rollout.
