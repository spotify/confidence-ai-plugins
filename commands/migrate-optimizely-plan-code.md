---
name: migrate-optimizely-plan-code
description: >-
  /migrate-optimizely plan code — Phase 2: scan Optimizely SDK usage
  and write a code migration plan. No file edits. Same split as plan
  access / plan flags.
---

Treat this slash command as **`/migrate-optimizely plan code`**.

Read `skills/migrate-optimizely/SKILL.md` (agent-only; do not narrate).

Follow **Plan Code: Steps**: overview first, then Starting **Phase 2** —
Code Transformation. Flags must exist in Confidence first. Resume check
(`.claude/plans/optimizely-code-migration-*.md`). **No code edits. No
PRs.**

After Overall is `✓ complete`, **ASK** the Step 5 exit question in
`SKILL.md` (required — there is no automatic path into adjust):
(1) **Adjust code**, (2) **Execute code**, (3) **Done for now**. If
they pick (1), enter adjust in the same turn; do not require
`/migrate-optimizely adjust code`.
