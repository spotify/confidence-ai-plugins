---
name: migrate-optimizely
description: >-
  Migrate Optimizely to Confidence. No args (or empty) = start from the
  beginning with plan access. Also: plan/adjust/execute access (Flag
  clients are Step 4 of plan access), plan/adjust/execute flags,
  plan/adjust/execute code. Prefer the dedicated / menu items for a
  specific phase.
argument-hint: "[plan access | adjust access | execute access | plan flags | adjust flags | execute flags | plan code | adjust code | execute code | execute <plan-file>] (omit to start plan access)"
---

All migration instructions are in `skills/migrate-optimizely/SKILL.md` and `skills/migrate-optimizely/access.md`.

**Default:** If the user runs `/migrate-optimizely` with **no arguments**
(or only whitespace), treat it as **`plan access`** — start Phase 0 from
the beginning. Same for natural language like “migrate from Optimizely”
with no phase named.

Same split: plan/adjust write the file, execute performs writes.

| Plan (file only) | Execute (writes) |
|------------------|------------------|
| `plan access` (users/teams/roles **and** Flag-client proposal in Step 4) — **also the bare `/migrate-optimizely` default** | `execute access` (groups, invites, **ticked Flag clients**, provision) |
| `adjust access` (users, groups, roles, policies, clients) | same `execute access` (applies the updated tables) |
| `plan flags` | `execute flags` |
| `adjust flags` (scope, ticks, client, bucketing, schema, rules) | same `execute flags` |
| `plan code` | `execute code` |
| `adjust code` (style, resolve mode, transforms, files/flags) | same `execute code` |

**Before doing anything else**, Read `skills/migrate-optimizely/SKILL.md`. If the user asked for **access**, **users**, **teams**, **groups**, **roles**, **policies**, **invites**, or **clients**, or used the bare `/migrate-optimizely` default, also Read `skills/migrate-optimizely/access.md`.

For **`plan access`** (including bare `/migrate-optimizely`), follow **Plan Access: Steps**: overview, resume check (do not create a new plan file yet), tracker, Opening questions (source method first). **ASK first, create the plan file after they answer.** After the access file (or REST) is confirmed, run **Extract context** (look around / paste / skip). Flag clients are Step 4 of this command (propose + ASK; no `POST /v1/clients`). There is no separate `plan clients` command — re-run `plan access` if SDK keys arrive later. After Step 5 Overall is complete, **ASK** the Step 5 exit question (adjust / tick consent / execute / done) — there is no automatic path into adjust; if they pick adjust, enter it in the same turn.

For **`adjust access`**, follow **adjust access** in `access.md` (also entered from the plan access Step 5 exit ask). Edit the existing access plan (users, groups, roles, policies, clients). Natural language is enough. **No IAM writes.** If they already stated the change, apply it. Then `execute access` applies the tables.

For **`plan flags`**, follow **Plan Flag: Steps**. After Overall is complete, **ASK** the Step 5 exit question (adjust flags / tick / execute / done). If they pick adjust, enter **Adjust Flags: Steps** in the same turn.

For **`adjust flags`**, follow **Adjust Flags: Steps** in `SKILL.md`. Edit the existing flag plan. **No createFlag.**

For **`plan code`**, follow **Plan Code: Steps**. After Overall is complete, **ASK** the Step 5 exit question (adjust code / execute / done). If they pick adjust, enter **Adjust Code: Steps** in the same turn.

For **`adjust code`**, follow **Adjust Code: Steps** in `SKILL.md`. Edit the existing code plan. **No source edits / PRs.**

For **`execute flags`**, find `.claude/plans/optimizely-flag-migration-*.md`. After flag create completes, **ASK** the targeting-rules import handoff (`[1] Start targeting-rules import` suggested). After rules import completes, **ASK** the resolve-verify handoff (`[1] Start resolve-verify all flags` suggested — **validates Phase 1** via segment match on every migrated flag). Only after that gate passes, suggest `plan code`. For **`execute code`**, find `.claude/plans/optimizely-code-migration-*.md`. If the plan is missing, run the matching `plan` command first.
