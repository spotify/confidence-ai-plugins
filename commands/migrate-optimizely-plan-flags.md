---
name: migrate-optimizely-plan-flags
description: >-
  /migrate-optimizely plan flags — Phase 1: scan Optimizely flags and
  write a flag migration plan. No createFlag. Same split as plan access.
---

Treat this slash command as **`/migrate-optimizely plan flags`**.

Read `skills/migrate-optimizely/SKILL.md` (agent-only; do not narrate).

Follow **Plan Flag: Steps**: overview first, then Starting **Phase 1** —
Flag Definitions, resume check
(`.claude/plans/optimizely-flag-migration-*.md`), step tracker,
Generation Status after each step. **No Confidence writes. No
createFlag.**

When the plan is complete, tell them to tick `[x] Migrate` / `[x] Skip`,
then run `/migrate-optimizely execute flags` or
`/migrate-optimizely-execute-flags`.
