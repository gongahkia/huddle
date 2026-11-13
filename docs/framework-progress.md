# Framework helper milestone

Objective: [framework-goal.md](framework-goal.md). Baseline is c177b27, with a clean worktree when this milestone started. Pronto remains untouched.

## Plan and acceptance evidence

1. Introduce exclusive adapter ownership while preserving the public core API. Add optional React, Preact, Vue, Svelte, Solid, Angular and Astro entry points, sharing one emitted engine and external framework peers. Verify ownership, configuration updates, cleanup and SSR import behavior.
2. Update existing examples to use the helpers. Add production Nuxt, SvelteKit and Astro fixtures, with real lifecycle/navigation and service-backed workflows.
3. Pack the artifact and install it in isolated consumers. Verify each helper's runtime import, declarations, bundling and dependency isolation. Representative SSR fixtures must use that packed artifact.
4. Run required engineering and Chromium/Firefox checks, measure complete core dependency graphs against the 75 KiB gzip budget, record WebKit's actual status and write a requirement-by-requirement completion audit.
5. Document exact setup/usage and remaining limits; commit coherent changes and clean up task-owned resources.

## Current state

- Objective and current implementation inspected. Existing package exports only the core entry; lifecycle logic is duplicated in examples.
- No paid services, private credentials or user databases are needed.
- Shared-engine output will use ESM chunks; budget checks and static example copying must account for those chunks rather than measuring entry shims alone.
- Implemented exclusive ownership, reusable lifecycle bindings and React/Preact/Vue/Svelte/Solid/Angular/Astro entry points. Updated existing examples and Next.js to use them.
- Core build, typecheck, lint and 41 tests pass, including actual React StrictMode and ownership checks. All eight exports passed independent installation, declaration, SSR import and browser-bundle checks with only their own framework installed.
- Complete core sizes at this checkpoint: installer 12,113 bytes gzip; ES-module graph 11,805 bytes gzip. Shared chunks are included in the measurement.
- Production Nuxt build succeeds. Installed SvelteKit 3 requires adapter configuration in Vite rather than svelte.config.js; corrected the fixture against its current source/documentation. Packed SSR fixture builds and browser validation are ongoing.
