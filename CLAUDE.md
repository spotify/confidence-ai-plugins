# Confidence Plugin

This plugin integrates Confidence with Claude Code, providing tools for feature flag management, experimentation, and migration from other platforms.

## Commands

- `/confidence:migrate-posthog <plan flag | plan code | execute <plan-file>>` — Migrate feature flags from PostHog to Confidence SDK
- `/confidence:migrate-eppo <plan flag | plan code | execute <plan-file>>` — Migrate feature flags from Eppo to Confidence SDK
- `/confidence:migrate-statsig <plan flag | plan code | execute <plan-file>>` — Migrate feature flags from Statsig to Confidence SDK

## Skills

- **migrate-posthog** — Auto-triggers when the user asks to migrate PostHog flags or transform SDK code to Confidence
- **migrate-eppo** — Auto-triggers when the user asks to migrate Eppo flags or transform SDK code to Confidence
- **migrate-statsig** — Auto-triggers when the user asks to migrate Statsig gates/configs/experiments or transform SDK code to Confidence

## MCP Servers

- **confidence-flags** — Feature flag management (create, list, resolve, target, archive)
- **confidence-docs** — Confidence documentation and SDK integration guides
