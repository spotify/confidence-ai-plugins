# Confidence Plugin

This plugin integrates Confidence with Claude Code, providing tools for feature flag management, experimentation, and migration from other platforms.

## Commands

- `/confidence:migrate-posthog <plan flag | plan code | execute <plan-file>>` — Migrate feature flags from PostHog to Confidence SDK
- `/confidence:migrate-eppo <plan flag | plan code | execute <plan-file>>` — Migrate feature flags from Eppo to Confidence SDK
- `/confidence:migrate-statsig <plan flag | plan code | execute <plan-file>>` — Migrate feature flags from Statsig to Confidence SDK
- `/confidence:migrate-optimizely <plan flags | plan code | execute <plan-file>>` — Migrate feature flags from Optimizely Feature Experimentation to Confidence SDK (flags + code)
- `/confidence:onboard-confidence <create-account | invite-user | create-client | setup-wizard | setup-warehouse | learn | status>` — Create accounts, onboard users, set up SDK clients, configure warehouses, and learn experimentation concepts

## Skills

- **migrate-posthog** — Auto-triggers when the user asks to migrate PostHog flags or transform SDK code to Confidence
- **migrate-eppo** — Auto-triggers when the user asks to migrate Eppo flags or transform SDK code to Confidence
- **migrate-statsig** — Auto-triggers when the user asks to migrate Statsig gates/configs/experiments or transform SDK code to Confidence
- **migrate-optimizely** — Auto-triggers when the user asks to migrate Optimizely flags/rollouts/experiments to Confidence
- **onboard-confidence** — Auto-triggers when the user asks to create a Confidence account, invite users, set up SDK clients, configure warehouses, run the setup wizard, or learn about experimentation

## MCP Servers

- **confidence-flags** — Feature flag management (create, list, resolve, target, archive)
- **confidence-docs** — Confidence documentation and SDK integration guides
