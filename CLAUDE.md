# Confidence Plugin

This plugin integrates Confidence with Claude Code, providing tools for feature flag management, experimentation, and migration from other platforms.

## Commands

- `/confidence:migrate-posthog <plan flag | plan code | execute <plan-file>>` — Migrate feature flags from PostHog to Confidence SDK
- `/confidence:migrate-eppo <plan flag | plan code | execute <plan-file>>` — Migrate feature flags from Eppo to Confidence SDK
- `/confidence:migrate-statsig <plan flag | plan code | execute <plan-file>>` — Migrate feature flags from Statsig to Confidence SDK
- `/confidence:migrate-optimizely` *(no args → `plan access`)* or `/confidence:migrate-optimizely <plan access | adjust access | execute access | plan flags | adjust flags | execute flags | plan code | adjust code | execute code | execute <plan-file>>` — Migrate Optimizely to Confidence. Phase 0–2 each support plan / adjust / execute; Flag clients are Step 4 of `plan access`. See [README — Optimizely → Confidence](./README.md#optimizely--confidence)
- `/confidence:onboard-confidence <create-account | invite-user | create-client | setup-wizard | setup-warehouse | learn | status>` — Create accounts, onboard users, set up SDK clients, configure warehouses, and learn experimentation concepts
- `/confidence:analyze-project [project-dir]` — Analyze a project and propose meaningful feature flag changes using Confidence

## Skills

- **migrate-posthog** — Auto-triggers when the user asks to migrate PostHog flags or transform SDK code to Confidence
- **migrate-eppo** — Auto-triggers when the user asks to migrate Eppo flags or transform SDK code to Confidence
- **migrate-statsig** — Auto-triggers when the user asks to migrate Statsig gates/configs/experiments or transform SDK code to Confidence
- **migrate-optimizely** — Auto-triggers when the user asks to migrate or adjust Optimizely users, teams, groups, roles, policies, clients, flags/rollouts/experiments, or SDK code to Confidence (including adjust flags / adjust code)
- **onboard-confidence** — Auto-triggers when the user asks to create a Confidence account, invite users, set up SDK clients, configure warehouses, run the setup wizard, or learn about experimentation
- **analyze-project** — Auto-triggers when the user asks what to feature-flag, wants flag suggestions, or asks to analyze their project for feature flag opportunities

## MCP Servers

- **confidence-flags** — Feature flag management (create, list, resolve, target, archive)
- **confidence-docs** — Confidence documentation and SDK integration guides
