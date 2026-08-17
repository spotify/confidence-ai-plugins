---
name: migrate-optimizely-adjust-code
description: >-
  /migrate-optimizely adjust code — Phase 2: fine-edit the code
  plan (style, resolve mode, transforms, files/flags). Plan file
  only — no source edits, no PRs.
---

Treat this slash command as **`/migrate-optimizely adjust code`**.

Read `skills/migrate-optimizely/SKILL.md` (agent-only; do not narrate).

Follow **Adjust Code: Steps** in `SKILL.md`.

1. Starting **Phase 2** — Code adjust (skip the full overview unless
   they also started a plan command this turn)
2. Find `.claude/plans/optimizely-code-migration-*.md`. If none, run
   `/migrate-optimizely-plan-code` first. Do not create a second plan
3. Show the Adjust Code tracker
4. If they already stated the change, apply it to the plan file. Else
   ASK: style / resolve mode / transforms / files·flags / Done
5. Update sections 1–4, append **## 5. Adjustments**. Keep forbidden
   checks. **No source edits. No PRs.**
6. Loop until Done or they run execute code. On Done, re-ask the
   plan-code exit menu (adjust / execute / done)

Then run `/migrate-optimizely execute code` or
`/migrate-optimizely-execute-code` when ready.
