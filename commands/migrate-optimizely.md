---
name: migrate-optimizely
description: >-
  Migrate Optimizely to Confidence — plan/adjust/execute access (Flag
  clients are inside plan access), plan/execute flags, plan/execute code.
  Prefer the dedicated / menu items.
argument-hint: [plan access | adjust access | execute access | plan clients | plan flags | execute flags | plan code | execute code | execute <plan-file>]
---

All migration instructions are in `skills/migrate-optimizely/SKILL.md` and `skills/migrate-optimizely/access.md`.

Same split: plan/adjust write the file, execute performs writes.

| Plan (file only) | Execute (writes) |
|------------------|------------------|
| `plan access` (includes Flag-client proposal + ASK) | `execute access` (groups, invites, **ticked Flag clients**, provision) |
| `adjust access` (users, groups, roles, policies, clients) | same `execute access` (applies the updated tables) |
| `plan clients` | **Alias** of plan access Step 4 — not a separate execute |
| `plan flags` | `execute flags` |
| `plan code` | `execute code` |

**Before doing anything else**, Read `skills/migrate-optimizely/SKILL.md`. If the user asked for **access**, **users**, **teams**, **groups**, **roles**, **policies**, **invites**, or **clients**, also Read `skills/migrate-optimizely/access.md`.

For **`plan access`**, follow **Plan Access: Steps**: overview, resume check (do not create a new plan file yet), tracker, Opening questions (source method first). **ASK first, create the plan file after they answer.** After the access file (or REST) is confirmed, run **Extract context** (look around / paste / skip). Flag clients are Step 4 of this command (propose + ASK; no `POST /v1/clients`).

For **`adjust access`**, follow **adjust access** in `access.md`. Edit the existing access plan (users, groups, roles, policies, clients). Natural language is enough. **No IAM writes.** If they already stated the change, apply it. Then `execute access` applies the tables.

For **`plan clients`**, run only Step 4 of `plan access` against the existing access plan (or start `plan access` if none).

For **`execute flags`**, find `.claude/plans/optimizely-flag-migration-*.md`. For **`execute code`**, find `.claude/plans/optimizely-code-migration-*.md`. If the plan is missing, run the matching `plan` command first.
