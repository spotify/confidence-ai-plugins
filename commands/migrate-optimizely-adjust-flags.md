---
name: migrate-optimizely-adjust-flags
description: >-
  /migrate-optimizely adjust flags — Phase 1: fine-edit the flag
  plan (scope, Migrate/Skip, client, bucketing, schema, rules). Plan
  file only — no createFlag.
---

Treat this slash command as **`/migrate-optimizely adjust flags`**.

Read `skills/migrate-optimizely/SKILL.md` (agent-only; do not narrate).

Follow **Adjust Flags: Steps** in `SKILL.md`.

1. Starting **Phase 1** — Flag adjust (skip the full overview unless
   they also started a plan command this turn)
2. Find `.claude/plans/optimizely-flag-migration-*.md`. If none, run
   `/migrate-optimizely-plan-flags` first. Do not create a second plan
3. Show the Adjust Flags tracker
4. If they already stated the change, apply it to the plan file. Else
   ASK: scope / ticks / client / bucketing / schema·rules / Done
5. Update sections 1–5, append **## 7. Adjustments**. Keep forbidden
   checks. **No createFlag. No targeting writes.**
6. Loop until Done or they run execute flags. On Done, re-ask the
   plan-flags exit menu (adjust / tick / execute / done)

Tell them to tick remaining `[x] Migrate` / `[x] Skip`, then run
`/migrate-optimizely execute flags` or
`/migrate-optimizely-execute-flags`.
