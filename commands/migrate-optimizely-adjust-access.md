---
name: migrate-optimizely-adjust-access
description: >-
  /migrate-optimizely adjust access — Phase 0: fine-edit the access
  plan (users, groups, roles, policies, clients). Plan file only —
  no invites, no IAM writes, no POST /v1/clients.
---

Treat this slash command as **`/migrate-optimizely adjust access`**.

Read `skills/migrate-optimizely/SKILL.md` and
`skills/migrate-optimizely/access.md` (agent-only; do not narrate).

Follow **adjust access** in `access.md`.

1. Starting **Phase 0** — Access adjust (skip the full overview unless
   they also started a plan command this turn)
2. Find `.claude/plans/optimizely-access-migration-*.md`. If none, run
   `/migrate-optimizely-plan-access` first. Do not create a second plan
3. Show the Adjust Access tracker
4. If they already stated the change, apply it to the plan file. Else
   ASK: users / groups / roles / policies / clients / Done
5. Update sections 2–5, append **## 7. Adjustments**. Keep forbidden
   checks. **No invites. No groups. No Flag clients. No policy PATCH.**
6. Loop until Done or they run execute access

Tell them to tick remaining `[x] Invite` / `[x] Create`, then run
`/migrate-optimizely execute access` or
`/migrate-optimizely-execute-access`. Skip ≠ delete.
