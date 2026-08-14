---
name: migrate-optimizely-execute-flags
description: >-
  /migrate-optimizely execute flags — create Confidence flags from the
  Phase 1 flag plan. Finds the plan file; no path argument needed.
---

Treat this slash command as **`/migrate-optimizely execute flags`**.

Read `skills/migrate-optimizely/SKILL.md` (agent-only; do not narrate).

Starting **Phase 1** — Flag execute.

Find `.claude/plans/optimizely-flag-migration-*.md` (newest if several).
If none, run `/migrate-optimizely-plan-flags` first — do not create
flags from memory. If Overall is not `complete`, **ask** resume the
plan vs execute anyway.

Then follow **Execute: How It Works → For flag plans** (consent gate,
then Flag Setup Sequence). Do not run access IAM writes or code
transforms.
