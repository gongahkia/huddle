# ADR 0001: Dogfood the review UI in Huddle before consumer integration

Status: accepted. Approved by the repository owner on 15 November 2026.

## Context

Pronto surfaced basic review UI issues such as unreadable picker controls, unclear icons and overlapping pins. Rebuilding and deploying a consuming application for each visual iteration makes UI review slow and mixes two different kinds of acceptance. The existing framework examples primarily exercise installation and lifecycle wiring; a mostly empty page is insufficient for reviewing the actual widget.

## Decision

Huddle owns the review UI and its UI dogfooding environment. Develop, reproduce, inspect and verify shared UI changes in Huddle's example playground first. The playground must mount the actual built browser SDK, use the real HTTP adapter and host storage implementation, and offer representative content, seeded discussions, multiple reviewers, responsive viewports, themes, dialogs, anchor changes, paging, transfers and failure states. Explicit fault simulation is useful UI evidence and must be identified as simulation.

Pronto dogfooding validates the engineering integration: installation of the real private SDK archive, host identity and authorization, host database persistence, migration/provenance, CSP, lifecycle, application coexistence, deployment revision and operational recovery. Retain basic hosted rendering/launcher/collaboration smoke checks, because integration can affect presentation. Pronto is not the primary visual design or interaction-testing environment for Huddle.

Maintain one comprehensive widget UI playground rather than separate visual implementations per framework. The existing framework pages remain integration/lifecycle examples and link to it. The playground is a fictional loopback-only host with explicitly disposable SQLite data, not a restored Huddle product service, login system or production authentication template. It accepts no application database configuration and never uses Pronto feedback or evaluation data.

## Working sequence

1. Reproduce a shared UI issue in a Huddle example and keep its regression coverage there.
2. Iterate on the shared library and review the concrete example states, including narrow layouts, keyboard interaction and themes. Use the checklist in [the playground guide](../ui-playground.md).
3. Run Huddle's applicable unit, browser, accessibility, package and bundle checks. Record actual results and limitations. Automated checks supplement visual review.
4. Port a verified SDK to Pronto when consumer integration or rollout is requested. Update its packed archive, lockfile and provenance; do not copy or fork widget UI into Pronto.
5. Run Pronto's engineering gates and deployed integration smoke checks. If these expose a generic UI defect, reproduce and correct it in Huddle before repacking.

Routine Huddle UI/example iteration does not itself authorize a Pronto archive refresh, push or deployment. A passing visual playground does not establish real host authorization, database portability, migration parity or hosted acceptance. Existing engineering and data-safety gates remain in force.

## Consequences

Huddle examples become a maintained product surface with representative states, not only minimal integration snippets. UI approval and engineering acceptance are recorded separately. Consumers share one implementation, and production data, credentials, inference workers and paid infrastructure are unnecessary for UI review. The local fixture's data intentionally disappears when its process stops; export anything useful before stopping it.
