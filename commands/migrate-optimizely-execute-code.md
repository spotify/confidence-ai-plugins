---
name: migrate-optimizely-execute-code
description: >-
  /migrate-optimizely execute code — transform Optimizely SDK code from
  the Phase 2 code plan. Finds the plan file; no path argument needed.
---

Treat this slash command as **`/migrate-optimizely execute code`**.

Read `skills/migrate-optimizely/SKILL.md` (agent-only; do not narrate).

Starting **Phase 2** — Code execute.

Find `.claude/plans/optimizely-code-migration-*.md` (newest if several).
If none, run `/migrate-optimizely-plan-code` first — do not edit files
from memory. If Overall is not `complete`, **ask** resume the plan vs
execute anyway.

Then follow **Execute: How It Works → For code plans** (one PR per flag,
or a single provider-swap PR). Do not run access IAM writes or
createFlag.
