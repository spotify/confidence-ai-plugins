---
name: migrate-optimizely-execute-flags
description: >-
  /migrate-optimizely execute flags — create Confidence flags from the
  Phase 1 flag plan. Ends with a full resolve gate (every migrated
  flag). Finds the plan file; no path argument needed.
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

**Catch-all guarantee:** after rules for each flag, if it still has zero
enabled targeting rules, **automatically** add/enable an everyone
catch-all (default variant). Empty Confidence rules do not serve
everyone. See **Automatic everyone catch-all** in `SKILL.md`.

**Unsupported operators (must stay flagged):** before create or rules
import, re-check for `exists` / `substring` / `regex`. Those rules are
**BLOCKED** in Confidence — list them, do not import them as-is, and do
not clear BLOCKED without a recorded workaround. See **UNSUPPORTED-
OPERATOR GATE** and **Rules operator audit** in `SKILL.md`.

**Progress bars (mandatory — must be visible in chat):** every long
write loop must show a live `█`/`░` bar in the **chat transcript**
(not only inside a collapsed shell panel). Required for flag create,
**production waterfall / targeting-rules import**, catch-alls, and
resolve verify. For bulk runs: write a script file + progress file,
then every ~15–30s paste the latest bar line into a chat reply.
Do **not** use a giant inline heredoc whose UI shows
`… N lines hidden`, and do not treat silent waits as progress. See
**Execute progress bar** in `SKILL.md`.

**Targeting rules (mandatory next step after flag create):** after
flag shells exist, **stop and suggest** importing planned specific
rules (`_rulesets` / `confidenceRules`) as the next step — do **not**
jump to `plan code` or declare Phase 1 complete. Use this handoff in
chat:

```
───── Flag create complete ─────────────────────────────
Next (required): import targeting rules
  [1] Start targeting-rules import  ← suggested
  [2] Pause
```

Then run the import with its own chat-visible bar:

`Execute Flags · targeting rules ████… N/TOTAL flag-id · rule-name`

Do **not** only create flags + everyone catch-alls while skipping
planned rules. Do **not** fold rules into the create bar. Use the
canonical emitter in **Production waterfall / targeting-rules import**
(`optimizely_execute_rules_progress.txt` + chat paste every ~15–30s).
Milestone-only `... created 50 rules` or collapsed shell output alone
is a bug.

**Validate Phase 1 — resolve all (natural next step after rules):**
after targeting-rules import finishes, **stop and suggest**
resolve-verifying **every** migrated flag for **segment match**. This
is how Phase 1 is **definitively validated** — do **not** call Phase 1
complete or jump to `plan code` after rules alone. Use this handoff:

```
───── Targeting rules import complete ──────────────────
Next (required to validate Phase 1): resolve-verify ALL migrated flags
  Goal: every flag returns a segment match (expected variant)
  [1] Start resolve-verify all flags  ← suggested (validates Phase 1)
  [2] Pause
```

Then run **Phase 1 resolve gate** with a chat-visible bar
(`Execute Flags · resolve verify ████… N/TOTAL`). Spot-checking 3–5
flags is not enough. `NO_SEGMENT_MATCH` / empty assignment = fail.
Write `.claude/plans/optimizely-flag-resolve-verify-<date>.json`.
Do not say **Phase 1 validated** while any migrated flag fails verify
unless the operator explicitly skips it with a reason. Only then
suggest `plan code`.
