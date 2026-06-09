# Confidence Plugin

This plugin integrates Confidence with Claude Code, providing tools for feature flag management, experimentation, and migration from other platforms.

## Commands

- `/confidence:migrate-posthog <plan flag | plan code | execute <plan-file>>` — Migrate feature flags from PostHog to Confidence SDK
- `/confidence:onboard-confidence <create-account | invite-user | create-client | setup-wizard | setup-warehouse | learn | status>` — Create accounts, onboard users, set up SDK clients, configure warehouses, and learn experimentation concepts

## Skills

- **migrate-posthog** — Auto-triggers when the user asks to migrate PostHog flags or transform SDK code to Confidence
- **onboard-confidence** — Auto-triggers when the user asks to create a Confidence account, invite users, set up SDK clients, configure warehouses, run the setup wizard, or learn about experimentation

## MCP Servers

- **confidence-flags** — Feature flag management (create, list, resolve, target, archive)
- **confidence-docs** — Confidence documentation and SDK integration guides
