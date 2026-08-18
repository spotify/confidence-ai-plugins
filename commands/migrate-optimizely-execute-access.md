---
name: migrate-optimizely-execute-access
description: >-
  /migrate-optimizely execute access — invite users, create groups, and
  as soon as each person accepts: put them in the right group, policy,
  Flag client, and share that group’s flags (Viewer/Editor by role)
---

Treat this slash command as **`/migrate-optimizely execute access`**.

## First: Confidence auth (check, then ask only if needed)

Read `skills/migrate-optimizely/SKILL.md` and
`skills/migrate-optimizely/access.md` (agent-only; do not narrate).

**Do not ask them to sign in if you already know they are
authenticated.** Prove it first (same turn, before any user-facing
login ask):

1. `$TMPDIR/confidence_token` exists, JWT `exp` is in the future, and
   `GET /v1/users` returns **200** with at least the operator user.
2. Or a session token you already captured this chat (Debug clipboard /
   prior execute) still passes that smoke-test.

If **authenticated:** say you are using their Confidence account
(email / workspace from the smoke-test). Do **not** ask them to log
in. Do **not** open the browser. Continue execute access (consent
gate, then writes).

If **not authenticated** (missing, expired, 401/403, or no token):
**ASK** them to sign in to their Confidence account. Do not open the
browser until they agree. Use a structured question:

> Starting **Phase 0** — Access execute.
> You are not signed in to Confidence. I need your account to create
> groups and send invites.
>
> 1. **Sign in now** — open Confidence login in the browser
> 2. **Debug token** — I’ll copy from Confidence Debug after you say
>    “copied”

`⏸ awaiting user` until they pick. Then follow hard gate §2 in
`access.md` (auth.py `login`, or Option B). Never paste a token
prompt first. Never echo the token.

Then follow **execute access** in `access.md`. Require a completed
access plan (`optimizely-access-migration-*.md`, Generation Status
complete, ticked consent rows). If the plan is missing, run
`/migrate-optimizely-plan-access` first — do not invite from memory.
