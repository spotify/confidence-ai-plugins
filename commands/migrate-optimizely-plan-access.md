---
name: migrate-optimizely-plan-access
description: >-
  /migrate-optimizely plan access — Phase 0: map Optimizely users,
  teams, roles, and Flag-client candidates. Writes a plan file only
  (no invites, no IAM writes, no POST /v1/clients).
---

Treat this slash command as **`/migrate-optimizely plan access`**.

Read `skills/migrate-optimizely/SKILL.md` and
`skills/migrate-optimizely/access.md` (agent-only; do not narrate).

Follow **Plan Access: Steps** in `SKILL.md` — the same pattern as
**Plan Flag: Steps** (overview first, resume check, step tracker,
Generation Status after each step, consent rows, then stop).

1. Display the migration overview, then: Starting **Phase 0** — Access
2. Resume check: `.claude/plans/optimizely-access-migration-*.md`
   (Read if it exists; **do not create** a new file yet)
3. Show the Plan Access step tracker
4. Run **Opening questions** in `access.md` (source method first:
   REST, files, or the user-provided fallback). **Stop and wait.** Do
   not write the plan file. Do not dump a token request until they
   pick Live REST API.
5. **After they answer:** create the plan file from the access.md
   template. Then extract. If they picked Desktop JSON, search
   `~/Desktop` then `~/Downloads` for files that relate users to
   groups/teams; confirm before using.
6. **After the access file (or REST) is confirmed:** run **Extract
   context** in `access.md` (look around that file for internal
   access-migration strategy / exceptions, or paste, or skip). Then
   translate, Flag-client proposal (ASK; skip if no SDK keys), consent
   rows, finish the plan. **No invites. No groups. No Flag clients.**

After Overall is `✓ complete`, **ASK** the Step 5 exit question in
`SKILL.md` (required — there is no automatic path into adjust):
(1) **Adjust access**, (2) **Tick consent**, (3) **Execute access**
(only if consent already ticked), (4) **Done for now**. If they pick
(1), enter adjust in the same turn; do not require
`/migrate-optimizely adjust access`.
