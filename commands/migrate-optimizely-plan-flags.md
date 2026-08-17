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

Flags with **no Optimizely rules** must appear in the plan under
**"Flags with no Optimizely rules → auto everyone catch-all"** so the
operator knows `execute` will add an everyone catch-all (Confidence empty
rules do not resolve for everyone). See **Automatic everyone catch-all**
in `SKILL.md`.

**Rules operator audit (mandatory in Step 2):** walk every audience
`match_type`. Flag **`exists` / `substring` / `regex`** (and
non-`custom_attribute`) as **BLOCKED** with flag ids in a **Rules audit
(production)** table — Confidence does not support those operators.
Ask workarounds before clearing BLOCKED. Do **not** complete Step 2
or pre-tick Migrate as if those rules were fine. See **Rules operator
audit** in `SKILL.md`.

After Overall is `✓ complete`, **ASK** the Step 5 exit question in
`SKILL.md` (required — there is no automatic path into adjust):
(1) **Adjust flags**, (2) **Tick consent**, (3) **Execute flags**
(only if Migrate/Skip already set), (4) **Done for now**. If they pick
(1), enter adjust in the same turn; do not require
`/migrate-optimizely adjust flags`.
