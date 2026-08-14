# Optimizely → Confidence access and clients

**User-facing docs (this repo):** [README — Optimizely → Confidence](../../README.md#optimizely--confidence).
Operators should learn Phase 0 from there, not only from this agent file.

Read this file when the user runs `/migrate-optimizely plan access`,
`/migrate-optimizely-plan-access`, `/migrate-optimizely adjust access`,
`/migrate-optimizely-adjust-access`, `/migrate-optimizely execute access`,
`/migrate-optimizely-execute-access`, `/migrate-optimizely plan clients`
(alias of the Flag-clients step), or asks to migrate or **change**
Optimizely **users, teams, roles, groups, policies, or Flag clients**.
Keep flag-definition and code work in `SKILL.md`.

Phase 0 `plan access` follows the same machinery as `plan flags` in
`SKILL.md` (overview box, step tracker, resume check, Generation
Status after each step, consent rows, then stop). This file is the
IAM mapping, lockout, opening questions, and plan-file template.

Human IAM and runtime clients are **separate**. Do not derive one from
the other. Do not flatten Optimizely teams into per-user shares. Never
lock the operator out.

---

## Commands

Same split as flags: **plan writes the file, execute performs writes.**

| Command | What it does |
|---------|----------------|
| `plan access` / `/migrate-optimizely-plan-access` | Extract users/teams/roles **and** propose Flag clients. Write `.claude/plans/optimizely-access-migration-<date>.md`. **No IAM writes. No invites. No groups. No `POST /v1/clients`.** |
| `adjust access` / `/migrate-optimizely-adjust-access` | Fine-edit the plan: **users, groups, roles, policies, clients**. Natural language is enough. **No IAM writes.** Next `execute access` applies the tables |
| `execute access` / `/migrate-optimizely-execute-access` | **All writes**, idempotent: groups + policies, invites, **ticked Flag clients**, flag shares, then provision accepted users (including deltas after adjust) |
| `plan clients` | **Alias** of `plan access` Step 4 (Flag clients). Use when SDK keys arrive after the access plan. Still ASK; still no create until `execute access` |

**Order:** `plan access` → **adjust access** (optional, any time) → tick consent → `execute access` → `plan flags` → `execute flags` → `plan code` → `execute code`.

Partial migrate is allowed. IAM files only → access. Datafile only → flags. Do not block flags because users are missing.

---

## Hard gate — credentials first

Two separate asks. Do not mix them. Do not search the machine. Do not
invent credentials. `⏸ awaiting user` until they exist.

**First ask is always the source method** (Opening questions below):
Optimizely REST, a file path the user provides, or the file fallback.
Do not open with a token dump. Token + project ID is the **follow-up**
after they pick Live REST API.

**After the access source is confirmed** (export path, Desktop JSON they
confirmed, sample fixture, or REST token + project ID): run **Extract
context** (look around that file / paste / skip). Do not mix it into
the first source-method form. People still come only from REST / the
file / the user-provided fallback.

### 1. Optimizely (source) — ASK before any `api.optimizely.com` call

If they **chose REST** to migrate **users / teams / access** (or flags):

| Ask | How they get it |
|-----|-----------------|
| **API token** | Optimizely **Account Settings → API Access** (Personal Access Token or Service Account). For users it must **read collaborators and teams**, not only flags |
| **Project ID** | Number in `app.optimizely.com/v2/projects/<PROJECT_ID>/…` |

**Say this for access (only after they picked REST):**

> To migrate Optimizely **users, teams, and permissions** over the REST API, I need:
> 1. An Optimizely **API token** (Account Settings → API Access). It must read **collaborators and teams**, not only flags.
> 2. Your **Project ID** (the number in `app.optimizely.com/v2/projects/<PROJECT_ID>/…`).
>
> Paste the token, or export `OPTIMIZELY_API_TOKEN` in this session and tell me the project ID.
> I will not start REST calls until I have both.

Do **not** append "or we can use files" here — they already chose REST.
If REST then fails (401/403), switch to the file-fallback questions.

Store as session env. Never write the token into the plan, git, or logs.
Project ID is not a secret.

**Smoke test (users / access):**

```bash
curl -sS -H "Authorization: Bearer $OPTIMIZELY_API_TOKEN" \
  "https://api.optimizely.com/v2/projects/$OPTIMIZELY_PROJECT_ID"
```

401/403 or HTML → stop REST. Fix the token or switch to files. Do not
list users. Then list collaborators / teams / roles on Platform API v2
with the same header. If those endpoints are 401/403, ASK for an IAM
export file — do not invent users.

Same token for Flags API: `https://api.optimizely.com/flags/v1`.

Do **not** reuse a Confidence token as an Optimizely token.

### 2. Confidence (destination) — ASK before `execute access` / any IAM write

**Not required for `plan access`.** Plan from REST or files only. Do not
ask for a Confidence token until the user runs `execute access` (or
confirms Flag clients).

**`/migrate-optimizely-execute-access` and `execute access`:** check
auth **before** the consent gate. **Ask them to sign in only if they
are not already authenticated.** Do not open the browser, and do not
ask for an IAM API client, when the session is already valid.

**Already authenticated (do not ask)**

Same turn, before any login copy: `$TMPDIR/confidence_token` (or a
token from this chat) has a future `exp`, and `GET /v1/users` is 200.
Then tell them the account (email / workspace) and continue. Do not
ask “sign in?” or “continue with this account?”.

**Not authenticated (ASK, then login)**

Missing token, expired JWT, or 401/403 → **ASK** (structured
question). Do not start the browser until they agree.

> You are not signed in to Confidence. Sign in so I can write users
> and groups in your workspace.
> 1. **Sign in now** — open Confidence login in the browser
> 2. **Debug token** — Copy token in Debug, reply “copied”

Then run `skills/onboard-confidence/auth.py` with the existing-account
Auth0 client (`2fG3H4RhlAbIZm9Rfn32zTaILH7w1X4w`) and `login`:

```bash
lsof -ti:8084 | xargs kill -9 2>/dev/null
python3 skills/onboard-confidence/auth.py 2fG3H4RhlAbIZm9Rfn32zTaILH7w1X4w login
```

Never show the token. Save `TOKEN:` to `$TMPDIR/confidence_token`.
Smoke-test `GET /v1/users`. Say the account email / workspace.
If the JWT has `org_id`, re-run auth.py with that org id for a
workspace-scoped token.

If browser login fails, use **Option B** (Debug clipboard). **Option A**
(IAM API client) only if they cannot sign in as a user, or the user
token cannot write IAM (403). Never ask them to paste a Confidence
token first.

**Option A — IAM API client (fallback)**

| Ask | How they get it |
|-----|-----------------|
| Workspace | App URL / login |
| Region | `EU` or `US` |
| API client ID + secret | **Admin → API Clients** (`/v1/apiClients`). Not a Flag / SDK client |
| Roles | At least **IAM Editor** (or Admin) |
| Inviter | `users/{id}` from **Admin → Users** or `GET /v1/users` |

```bash
curl -sS -X POST "https://iam.confidence.dev/v1/oauth/token" \
  -H "Content-Type: application/json" \
  -d '{"grantType":"client_credentials","clientId":"<id>","clientSecret":"<secret>"}'
```

Use `accessToken` as `Authorization: Bearer`. This client is **not** the
signup Flag client (SDK resolve). Do not ask for Flag client secrets to
call IAM.

**Option B — Debug token, clipboard only**

If they cannot create an API client, or prefer a short-lived user token:

> 1. Log in to https://app.confidence.spotify.com
> 2. Open **Debug**: https://app.confidence.spotify.com/debug
> 3. Click **Copy token**
> 4. Leave it on the clipboard. Do **not** paste it here.
> 5. Reply “copied”

Then read the clipboard (`pbpaste` on macOS). Write at most to a temp
file outside git. Never echo it. Smoke-test `GET /v1/users`. **Paste in
chat only if clipboard read fails.**

IAM base: `https://iam.confidence.dev/v1`. Flags:
`https://flags.{eu|us}.confidence.dev/v1`.

---

## Optimizely source: REST first, file fallback

Do not fail the whole migration because they cannot call
`api.optimizely.com`. One combined JSON is **not** required.

**REST (preferred):** only after they pick Live REST API in Opening
questions. Then ASK for token + project ID (Hard gate §1).

```text
Flags API     https://api.optimizely.com/flags/v1
Platform API  https://api.optimizely.com/v2   # collaborators, teams, roles, environments, audiences
```

**Files:** if REST is refused, blocked, or 401/403 — stop REST.

> I cannot read Optimizely over the API. You can still migrate from files.
> One file is fine. Several files are also fine.
> Please provide (paths, paste, or attach):
> 1. Users / collaborators (emails, ids)
> 2. Teams and members
> 3. Roles / permissions (project, environment, flag, audience)
> 4. Flags (keys, variations, rules, audiences) or a datafile
> 5. Environments and SDK keys
>
> If two files overlap, tell me which is authoritative.

Best: put files in the project (e.g. `optimizely-export/`) and say the
path. Also fine: attach in chat, a full path, or **opt in to Desktop
JSON** (Opening question 1 option 5). Do not search the whole machine
unless they picked that option. Do not scrape the Optimizely UI. Record
**paths** in the plan; redact SDK keys (`<sdk_key>`).

A permissions-only flag list (`id` + `permissions`, no variations/rules)
is **access metadata**, not Phase 1 flag definitions.

The skill **does** understand JSON where users and groups/teams are
related (ids, emails, nested members, or a join list). Exact Optimizely
key names are not required. See **Relational JSON** below.

Sample IAM shape: `test-fixtures/iam-export-sample.json`.

---

## Optimizely source model

Reconstruct this **before** creating Confidence resources. Preserve
assignments, not only the calculated effective role. Do not flatten
teams.

```text
Account
├── Collaborators / Users
├── Teams (members + team permissions)
└── Projects
     ├── Project collaborator roles (Viewer, Editor, Publisher, Project Owner)
     ├── Environments (SDK key + granular permissions)
     ├── Flags (granular permissions)
     └── Audiences (granular permissions)
```

Account **Administrator** is separate from Project Owner.

Extract at least: collaborator `{id, email}` + per-project role; team
`{id, name, members[]}` + team permissions; environment
`{id, name, key, sdk_key}` + assignments; flag/audience assignments
`{principal_type, principal_id, scope, role}`.

Users + groups/teams with a join (members / nested users / memberships)
is enough for an access plan even if projects are missing. Do not
invent people. Resolve member ids to emails before writing consent rows.

Treat SDK keys as secrets.

---

## Relational JSON (Desktop and files)

Yes — if the file has **users** and **groups/teams** with a clear join,
the skill can plan from it. It does not have to match
`iam-export-sample.json` field-for-field.

**When they pick source option 5, or say the data is on the Desktop
without a path:** scoped find only. Confirm before Read of the chosen
file.

```text
1. ~/Desktop           *.json  (and one subdirectory level)
2. If none look right  ~/Downloads  same globs
```

Do **not** walk `$HOME`, `/`, or the whole machine. Cap the candidate
list (~15). Peek keys / first objects only (not secrets). Then ASK
which file if more than one matches.

**IAM vs flags (detect, then say it):**

| Treat as access JSON | Treat as flag export (not this command) |
|----------------------|-----------------------------------------|
| `users` / `collaborators` / `people` **and** `teams` / `groups` | `variations` / `rules` / `rules_detail` / `percentage_included` and **no** user/team lists |
| Join: `members`, `member_ids`, `user_ids`, nested `users`, or `memberships` | Datafile / flag definitions only |

Permissions-only `flags[].permissions` with no variations = access
metadata. Keep it on this command.

**Join shapes the skill must follow** (any one is enough):

```text
users[]  {id|user_id|userId, email}
teams[] or groups[]  {id|team_id|group_id, name|displayName,
                      members[] | member_ids[] | user_ids[] | users[]}
memberships[] / team_members[]  {user_id, team_id} or emails
```

`members[]` may be user **ids**, **emails**, or `{id, email}` objects.
Map id → email via `users[]`. Nested `groups[].users[]` is the same
relation — do **not** flatten into per-user shares; still create one
Confidence group per team/group.

Also accept camelCase (`userId`) and snake_case (`user_id`). Extra
keys are fine. Missing projects → still invite + create groups; record
unmapped roles as unknown.

**Not understood (ASK, do not invent):** no emails; members that match
neither an id nor an email; CSV/Excel until converted; a screenshot.
If two JSON files overlap, ASK which is authoritative.

---

## Translate to Confidence

Confidence has **no** Optimizely projects, human environment roles,
Publisher, or flag×env least-privilege intersection. State fidelity loss
in the plan.

| Mechanism | Scope | Use for |
|-----------|--------|---------|
| **Policy** + role | **All** resources of that type | Account Administrator; optional Reader/Creator baseline. **Not** project/flag/env roles |
| **Owner** on a resource | One flag / segment | Project Owner of flags from that project |
| **Share** on a resource | One flag (Viewer or Editor) | **How the group sees those flags.** Project defaults + granular flag/audience assignments. Bind the **group**, not each member |
| **Flag client + credential + environments** | Runtime resolve | SDK keys / apps — **not** human IAM |

[IAM intro](https://confidence.spotify.com/docs/iam/introduction): do
**not** give Flags Editor via policy if you want per-flag control.

| Optimizely | Confidence | Import |
|------------|------------|--------|
| Collaborator | User | `POST /v1/userInvitations`. User exists only after accept. **The same execute run (and every later run) must provision immediately** — group + group policy + Flag client + **flag shares so the group can see its flags**. Do not wait for a separate “people accepted” message |
| Team + members | Group + group policy | `POST /v1/groups?groupId=…` then `POST /v1/policies?policyId=optimizely-group-{groupId}` with `identities: ["identities/g…"]`. After accept: `POST /v1/groups/{id}:addGroupMembers`. `POST …/members` is **405**. Pending invites cannot be members |
| Account Administrator | `roles/admin` | **Add** to a policy. Never remove the operator from `admin-policy` |
| Project | No Confidence project | Group of flags from that project; shares on those flags; Flag client(s) those flags attach to |
| Project Viewer / Editor | Flag Viewer / Editor **share** on that project's flags | Group can **see** (Viewer) or see+edit (Editor). Not workspace `roles/flags-reader` / `roles/flags-editor` |
| Publisher | Per-flag **Editor** share | Same as Editor. No Workflows Editor, no Admin |
| Project Owner | **Owner** of those flags | **Not** workspace Admin. Group still gets Viewer/Editor share so members can **see** them |
| Flag Admin | Flag Editor share | Note fidelity loss |
| Team / flag `permissions[]` | Share those flags with the **group** | Role → Viewer or Editor (table below). Do not copy onto each user |
| Environment | Runtime env on a credential | **Not** a human role |
| Env human permission | **Unmapped as IAM** | List in the plan. Runtime isolation only |
| SDK key + apps | Candidate Flag clients | Proposal, then ASK. After they exist, attach project flags (`:addFlagClient`) and list them on the group’s after-accept row |

### Confirmed defaults (use unless the customer overrides)

| Topic | Default |
|-------|---------|
| Project Owner | Owner of flags from that project. **Not** workspace Admin. Only account Administrators get `roles/admin` |
| Env human permissions | Do **not** import as IAM. List unmapped in the plan |
| Publisher | Per-flag Editor share only |
| Group can see its flags | **Viewer or Editor share on those flags**, bound to `identities/g{groupId}`. Not a workspace Flags Reader/Editor policy |
| `default-policy` (Everyone = Creator + Reader) | **Propose tightening**. Wait. Never change without asking. Never remove `admin-policy`. Workspace Reader = see **all** flags; per-flag shares are still required so a group can see its flags after tighten |

### Forbidden

- Team Editor → `roles/flags-editor` **policy** (edits **all** flags). Per-flag Editor **share** on the group's flags is required
- Using `roles/flags-reader` on a **policy** so a team can "see flags" (that is every flag)
- Project Owner → `roles/admin`
- Environment or SDK key → Flag client without a proposal
- Flattening teams instead of groups
- Applying flag shares before flags exist
- Printing real SDK keys
- Changing `default-policy` without a yes
- Changing `admin-policy` identities except to **add** known Administrators

### Import order

```text
plan access (read-only):
1. Extract source. Missing flag/audience permissions, sdk_key, or app split → ASK.
2. Write the plan: users to invite, groups to create, intended owners/shares,
   **and Flag-client candidates** (propose + ASK; tick Create/Skip).
   Propose tightening default-policy; wait. Never touch admin-policy.
   Stop. Do not call Confidence IAM. Do not POST /v1/clients.

execute access (writes):
3. Create groups from teams. Create **group policies** bound to
   `identities/g{groupId}` (Reader — not Flags Editor). Invite ticked
   users. Create each `[x] Create` Flag client (never the auto-created
   workspace client). Pending invites are not members.
4. **As soon as** `GET /v1/users` lists them: addGroupMembers, confirm
   the group policy, wire the planned Flag client(s), **share that
   group's flags** (Viewer/Editor by role so they can see them),
   PATCH owner if they were Project Owner. Poll this turn, then every
   later `execute access` — do not wait to be told they accepted.
   Run `share_group_flags` whenever the flags exist, even before
   anyone accepts (the share is on the group identity).

Then:
5. Flags + segments (SKILL.md Phase 1). Set Project Owners on those flags.
6. Verify operator still on admin-policy. Report unmapped env-human IAM.
```

Invites expire in **7 days** (`ttl` default `604800s`). Send with email
**enabled** (`disableInvitationEmail` omitted or `false`) unless a dry
run. Tell invitees to accept promptly. Re-invite after expiry.

API-client tokens **must** send `"inviter": "users/{id}"` on
`POST /v1/userInvitations`.

If the workspace uses [SSO](https://confidence.spotify.com/docs/iam/users),
users may auto-provision — confirm before bulk-inviting.

---

## Group flag visibility (shares)

Members of a group must **see that group’s flags**. That is a
**per-flag share**, not a workspace Flags Reader/Editor policy.

### Role → share (use this table)

| Optimizely role (project, team, or flag `permissions[]`) | Share on those flags | Can see | Can edit |
|----------------------------------------------------------|----------------------|---------|----------|
| Viewer | **Viewer** | yes | no |
| Editor | **Editor** | yes | yes |
| Publisher | **Editor** | yes | yes |
| Flag Admin | **Editor** (note: no Flag Admin in Confidence) | yes | yes |
| Project Owner | **Owner** (`PATCH owner`) **and** Viewer share on the group so other members still **see** the flag | yes | yes (owner) |

Env-human roles stay unmapped. Do not share Production-only as IAM.

**Principal:** always `identities/g{groupId}` for a team assignment.
Also share `identities/u…` when the person has a **direct**
collaborator/flag assignment. Do not flatten the team into per-user
shares instead of the group.

**Which flags:** every Confidence flag that came from that Optimizely
project, plus any flag with an explicit team/user `permissions[]`
row. Skip flags that do not exist yet; retry after Phase 1.

### `share_group_flags`

Run whenever groups exist **and** flags exist: first `execute access`
after flags, every later `execute access`, and at the end of Phase 1
flag create. Do **not** wait for invites to be accepted — the share is
on the group.

For each planned (group, flag, Viewer|Editor) row:

1. Skip if already shared (GET the flag / bindings if the API lists
   them).
2. Try, in order, until one returns 200. Cache the winner for the
   session (do not retry failed shapes every flag):

```bash
# Viewer → roles/flags-reader on THIS flag only
# Editor → roles/flags-editor on THIS flag only
# These roles on a *policy* would grant every flag — forbidden.

POST "$FLAGS/flags/{flagId}:addIamBinding" \
  -d '{"identity":"identities/gteam-checkout","role":"roles/flags-reader"}'

POST "$IAM/flags/{flagId}:addIamBinding" \
  -d '{"identity":"identities/gteam-checkout","role":"roles/flags-reader"}'

# If GET flag has a permissions/bindings array:
PATCH "$FLAGS/flags/{flagId}?updateMask=permissions" \
  -d '{"permissions":[{"identity":"identities/gteam-checkout","role":"Viewer"}]}'
```

3. If every call is 404/400: record in the plan
   `UI: Flag → Permissions → add group <displayName> as Viewer|Editor`.
   Tell the operator. Do **not** create `policies/*` with
   `roles/flags-reader` or `roles/flags-editor` as a substitute.

After shares: group members who have accepted must be able to open
those flags (and the planned client). Workspace `roles/reader` on
`default-policy` still shows **all** flags — shares are what remain
after that is tightened, and what grants **Editor**.

---

## plan access — extract, map, write the plan (no writes)

**Do not** `POST /v1/userInvitations`, `POST /v1/groups`,
`:addGroupMembers`, or any other Confidence IAM call. A live
follow-through of `plan access` must not email anyone.

### Resume check (MUST do first)

Before starting, look for `.claude/plans/optimizely-access-migration-*.md`
(see also SKILL.md → Plan Files).

- Status `complete` → tell the user a plan exists; **ask** start fresh vs use it (same structured-question rule as Opening questions)
- Status not `complete` → resume from the last incomplete step. If the file uses old step names, **ask** start fresh vs keep it
- None → **do not create the file yet.** Run Opening questions first. Create
  `.claude/plans/optimizely-access-migration-<date>.md` only after they
  answer (source method). ASK first, create the plan file after.

**Do not** Write or mkdir a new access plan during overview or while
awaiting Opening questions. Reading an existing plan for resume is OK.

### Opening questions (MUST run before any fetch **and** before creating the plan file)

After the migration overview and resume check, **stop and ask**. Do not
create `.claude/plans/optimizely-access-migration-*.md`. Do not curl
Optimizely. Do not Read export files. Do not invent people. Do not
paste the REST token paragraph until they pick option 1.

Show this tracker (same shape as SKILL.md Plan Flags / Plan Access
step tracker):

```
───── Plan Access ─────────────────────────────────────────
  [1] Source           ⏸ awaiting you
  [2] Translate        ○ pending
  [3] Consent rows     ○ pending
  [4] Flag clients     ○ pending
  [5] Write plan       ○ pending
────────────────────────────────────────────────────────────
```

**How to ask:** use a structured multiple-choice tool if the agent has
one (`AskQuestion`, `AskUserQuestion`). If the tool is skipped or
unavailable, print the numbered options in chat and wait. Never skip
this question. Never collapse it into "paste a token or a path".

**Source method (required) — ask this first, alone:**

> How should I read your Optimizely users, teams, and permissions?
> I will not call api.optimizely.com or invent people. This command
> only writes a plan — no invites.
>
> 1. **Live REST API** — I have (or can create) an Optimizely API token + Project ID
> 2. **Export files** — I will give a path, paste, or attach JSON (users/teams/permissions)
> 3. **I cannot create a token** — walk me through the file fallback

If `skills/migrate-optimizely/test-fixtures/iam-export-sample.json`
exists in the workspace, add:

> 4. **Sample IAM file in this repo** — `test-fixtures/iam-export-sample.json` (skill test only)

Always add:

> 5. **JSON on my Desktop** — look on Desktop (then Downloads) for a
>    file that relates **users to groups/teams**. I will confirm before
>    you use it.

People (emails, teams, permissions) come only from this source. Extra
strategy/exceptions are a **later** question, after the access file (or
REST) exists — see **Extract context** below.

`⏸ awaiting user` until they pick a source (1–5). Do not fetch Optimizely
yet. Do not create the plan file yet. Do not run Extract context yet.

**After they answer source method:** create
`.claude/plans/optimizely-access-migration-<date>.md` from the template
below. Then continue (REST token, files, Desktop search, or sample).
Do **not** mark Step 1 complete until Extract context has an answer
(look / paste / skip).

**Follow-up — only if they picked 1 (REST):**

Use the REST copy in Hard gate §1 (token + project ID). Then smoke-test.
Do not search the machine. Then run **Extract context** (workspace
only — no access file on disk).

**Follow-up — only if they picked 2 or 3 (files):**

> I cannot read Optimizely over the API until you provide files.
> One file is fine. Several files are also fine.
> Please provide (paths, paste, or attach):
> 1. Users / collaborators (emails, ids)
> 2. Teams and members
> 3. Roles / permissions (project, environment, flag, audience)
> 4. Flags (keys, variations, rules, audiences) or a datafile — optional for access
> 5. Environments and SDK keys — optional; used in plan access Step 4 (Flag clients)
>
> If two files overlap, tell me which is authoritative.
>
> Or say **Desktop** if the JSON is there (users related to
> groups/teams) and I will look on `~/Desktop` then `~/Downloads`.

`⏸ awaiting user` until a path, paste, attachment, or Desktop opt-in
exists. Do not search the whole machine unless they asked for Desktop
(or picked source option 5). Do not scrape the Optimizely UI.

**Once a file path is confirmed** (typed, pasted, attached, or Desktop):
run **Extract context** before marking Step 1 complete.

**If they picked 5 (Desktop JSON):** follow **Relational JSON** — find
candidates, detect access vs flags, ASK which file, then run
**Extract context** (the confirmed file is the “around here”).

**If they picked 4 (sample):** Read
`skills/migrate-optimizely/test-fixtures/iam-export-sample.json` as the
IAM source (not a flag export). Then run **Extract context** (fixture
dir + workspace).

### Extract context (MUST run after the access source exists)

Run this **once the Optimizely access source is confirmed** — the export
path they gave, the Desktop JSON they confirmed, the sample fixture, or
REST after token + project ID. Not before. Not in the same form as
source method.

This is **not** a second user list. It is extra **access migration
context**: internal strategy, exceptions, keep/skip notes, anything
defined next to the permissions file.

**How to ask:** structured multiple-choice (`AskQuestion`) if available;
otherwise print the options and wait. Skip is valid. Never invent a
strategy. Never treat markdown as people to invite.

> I have the Optimizely **users, teams, and permissions** source.
> Before I translate to Confidence, is there extra **access migration
> context** (internal strategy, exceptions, who not to invite / keep)?
>
> I will still take people only from the Optimizely REST API or the
> access file. This is extra context around that file.
>
> 1. **Look around** — search next to the access file (and this
>    workspace) for markdown/docs about access migration, IAM, or
>    exceptions. I will list what I find and confirm before using it.
> 2. **I'll paste** extra context in chat (or a path)
> 3. **Skip** — map only the Optimizely REST / file

`⏸ awaiting user` until they pick look / paste / skip.

**If they picked paste:** wait for the paste (or a path they type). Do
not invent context. Record it in the plan `## Access migration context`.

**If they picked look around:** do **not** search the whole machine or
`$HOME`. Search **next to where you found the access file**:

- Same directory as the export (and one parent)
- Workspace root, `docs/`, `.cursor/`, `.claude/`
- For REST (no file): workspace only — not `$HOME`
- For Desktop JSON: the folder of the **confirmed** file (e.g.
  `~/Desktop/test/`) and one parent; not all of Desktop

Names / globs (cap ~15): `*access*`, `*iam*`, `*migrat*`, `*rbac*`,
`*exception*`, `*govern*`, `ACCESS.md`, `IAM.md`, `GOVERNANCE.md`,
`*optimizely*confidence*`

If **none**: say so and offer paste. If **one**: Read it and **confirm**
before applying. If **several**: list paths and ASK which. Do not use a
flag-definition export as strategy context.

**Apply rules:** exceptions may skip invites, rename groups, or note
keep-lists. They must **not** invent people. Keep-list and forbidden
checks in this file always win — quote conflicts in the plan. Record
source (none | pasted | path) under `## Access migration context`.

**If they picked skip:** write `Source: none (skipped)` and continue
Step 1 extract / Step 2 translate from REST / file only.

### Steps

Same numbered flow as **Plan Access: Steps** in SKILL.md (and as
**Plan Flag: Steps** for flags). After **each** step, update
`## Generation Status` and re-display the tracker. Do not wait until
the end.

1. **Source** — Run Opening questions (source method). **Create the
   plan file only after they answer source method.** Then extract.
   Detect IAM vs flag export (including relational Desktop JSON:
   users + groups/teams + a join). Reconstruct the source model.
   Record file paths (redact SDK keys). **When the access file / REST
   is confirmed, run Extract context** (look around that file, paste,
   or skip) before marking this step complete. People only from REST /
   file / fallback.
   **After complete:** Generation Status step 1 `✓ complete`.
2. **Translate** — Fill the mapping tables (users, teams→groups, project
   roles, flag/audience shares, unmapped env-human IAM, fidelity loss).
   Apply confirmed access-migration context as constraints (exceptions,
   skip rows, notes). Propose `default-policy` tightening; do not apply it.
   **After complete:** Generation Status step 2 `✓ complete`.
3. **Consent rows** — One row per user and per group with empty
   `[ ] Invite` / `[ ] Skip` (users) and `[ ] Create` / `[ ] Skip`
   (groups). Silence is not consent. Same rule as flag `[ ] Migrate` /
   `[ ] Skip`.
   **After complete:** Generation Status step 3 `✓ complete`.
4. **Flag clients** — Propose candidates from project + env + SDK key
   + apps + isolation. **ASK** (questions below). Write section 5 with
   `[ ] Create` / `[ ] Skip`. If no `sdk_key`: skip, mark blocked.
   Do not `POST /v1/clients`.
   **After complete or skipped:** Generation Status step 4.
5. **Write plan** — Finish the file. Set step 5 and Overall to
   `✓ complete`. Tell the user to review, tick the boxes, then run
   `/migrate-optimizely execute access` or
   `/migrate-optimizely-execute-access`. Tell them they can also
   **adjust** users, groups, roles, policies, or clients through the
   skill (`/migrate-optimizely adjust access`) instead of hand-editing
   the file. List what execute will do. Do not invite anyone. Do not
   create clients.

`⏸ awaiting user` if emails, team membership, or project roles are
missing. Do not invent people.

### Plan-file template

Copy this into the plan file. Replace angle-bracket placeholders.
Keep the heading names — `execute access` parses them.

~~~~markdown
# Optimizely → Confidence access migration

**Source:** <REST project <id> | path to export>
**Destination writes:** none until `execute access`

## Generation Status

| Step | Status |
|------|--------|
| 1. Source | ◉ in progress |
| 2. Translate | ○ not started |
| 3. Consent rows | ○ not started |
| 4. Flag clients | ○ not started |
| 5. Write plan | ○ not started |

Status values: `✓ complete`, `◉ in progress`, `○ not started`.
When steps 1–4 are `✓ complete` or step 4 is `⊘ skipped` (no SDK keys),
set step 5 to `✓ complete`.

## 1. Source model

```text
Account
├── Collaborators  {id, email}
├── Teams          {id, name, members[]}
└── Projects       {id, name, collaborator roles, env permissions, flag/audience assignments}
```

No account Administrator in this export: <yes/no>
SDK keys present: <yes / redacted / missing — Flag clients step ASK or skip>

## Access migration context

Source: <none (skipped) | pasted | path>
Applied to translation: <yes / n/a>
Exceptions: <none | bullets>
Conflicts with skill rules (keep-list / forbidden): <none | quotes>

## 2. Translation

| Optimizely | Principal | Confidence | Notes |
|------------|-----------|------------|--------|
| Collaborator | <email> | Invite (execute) | Exists only after accept |
| Team <name> | <members> | Group `<groupId>` + policy `optimizely-group-<groupId>` | Do not flatten |
| Project Owner | <email> | Flag **owner** | Not `roles/admin` |
| Project Editor / Publisher | <email> | Flag **Editor share** | Not workspace Flags Editor |
| Env human permission | <principal> @ <env> | **Unmapped as IAM** | List in section 4 |
| Flag / audience assignment | <principal> | Intended share | After Phase 1 resources exist |

### Forbidden checks (must stay unchecked)

- [ ] Team Editor → `roles/flags-editor` **policy** (per-flag Editor share is required)
- [ ] Team “see flags” → `roles/flags-reader` **policy**
- [ ] Project Owner → `roles/admin`
- [ ] Environment or SDK key → Flag client without a proposal
- [ ] Flattening teams into per-user shares
- [ ] Applying flag shares before flags exist
- [ ] Printing real SDK keys
- [ ] Change `default-policy` without a yes
- [ ] Change `admin-policy` except to **add** known Administrators

### `default-policy`

Propose tightening. Wait for an explicit yes. Never change during plan.

## 3. Planned writes (execute only)

### Groups

| groupId | displayName | Policy | Members (after accept) | Clients they should see | Consent |
|---------|-------------|--------|------------------------|-------------------------|---------|
| <team-checkout> | <Checkout> | `optimizely-group-team-checkout` (`roles/reader` on `identities/gteam-checkout`) | <emails> | <client ids or pending keys> | [ ] Create  [ ] Skip |

Policy roles: **Reader** so they can open flags and pick Flag clients.
Not `roles/flags-editor`. Not `admin-policy`. Bind the policy to the
**group** identity so membership = policy as soon as they are added.

### Users

| Email | Groups | Policy | Clients | After accept | Consent |
|-------|--------|--------|---------|--------------|---------|
| <user@example.com> | <groupIds> | group policies above | <client ids or pending> | provision immediately | [ ] Invite  [ ] Skip |

Invites: ttl 7 days, email enabled, `"inviter": "users/{id}"` on
API-client tokens.

**As soon as they accept:** group membership + group policy + Flag
client (see execute `provision_accepted`). Do not leave them as a
user with only `default-policy`.

### Intended shares (group must see these flags)

Share with the **group** as soon as the flags exist (`share_group_flags`).
Do not wait for accept.

| Flags | Principal | Role (see / edit) |
|-------|-----------|-------------------|
| Flags from project <name> | group `<groupId>` | Viewer or Editor |
| Flags from project <name> | <owner email> | Owner |
| <flag> (granular) | group `<groupId>` or user | Viewer or Editor |

## 4. Unmapped environment human IAM

| Environment | Principal | Optimizely role | Confidence |
|-------------|-----------|-----------------|------------|
| <name> (`<id>`) | <team> | <admin/viewer/…> | Unmapped. Runtime env on a credential only |

## 5. Flag clients

Planned **inside `plan access`**. Do not invent. Project ≠ Client.
Env ≠ Client. SDK key ≠ Client. Redact real SDK keys (`<sdk_key>`).

If this file has no `sdk_key`: **blocked** — skip step 4. Re-run
`plan access` (or `plan clients` alias) when keys / app split exist.

If keys exist, list candidates after ASK:

| clientId | displayName | From (project / env / key) | Apps / isolation | Consent |
|----------|-------------|----------------------------|------------------|---------|
| <prod-checkout> | <prod-checkout> | project + env + sdk_key (redacted) | <one client / split ios-android> | [ ] Create  [ ] Skip |

Never reuse the auto-created `{workspace} client` unless they say so.
`execute access` creates `[x] Create` rows only.

## 6. Execute progress

`execute access` updates this table. Leave it empty during `plan access`.

| Item | Status |
|------|--------|
| Groups created | |
| Group policies created | |
| Flag clients created | |
| Invites sent | |
| Accepted and provisioned (group + policy + client + flag shares) | |
| Flag shares (group can see its flags) | |
| Still pending | |
| Re-invited | |
| Owners updated | |

## 7. Adjustments

`adjust access` appends rows. Leave empty during the first `plan access`.

| When | Kind | Change |
|------|------|--------|
~~~~

---

## adjust access — fine modifications (plan file; no IAM writes)

Use when the user runs `/migrate-optimizely adjust access`,
`/migrate-optimizely-adjust-access`, `modify access`, or asks to
change **users, groups, roles, policies, or clients** after a plan
exists. Natural language is enough ("skip all @example.com",
"Checkout should be Editor", "don't create team-data", "rename
Growth to Growth Eng").

**Plan writes only.** Edit the existing plan file. Do **not** invite,
create groups, PATCH policies, or `POST /v1/clients` here.
`execute access` applies the updated tables (idempotent, including
deltas after a prior execute).

### Require a plan

Find `.claude/plans/optimizely-access-migration-*.md`. If none, run
`plan access` first. If several, use the newest unless they name one.
Do not invent a second plan file.

### Tracker

Show at start and after each applied change:

```
───── Adjust Access ───────────────────────────────────────
  Plan: optimizely-access-migration-<date>.md
  Edit: users · groups · roles · policies · clients
────────────────────────────────────────────────────────────
```

Starting **Phase 0** — Access adjust. Skip the full migration
overview unless they also started a plan command this turn.

### How to ask

If they already stated the change, **apply it** (do not re-ask the
menu). Otherwise structured question:

> The access plan is ready to edit. I will change the plan file only
> — no invites. What should I change?
>
> 1. **Users** — invite/skip (all, by team, by domain), move groups, add an email you give me
> 2. **Groups** — create/skip, rename, members, merge/split
> 3. **Roles** — Viewer / Editor / Owner shares (per group, user, or default mapping)
> 4. **Policies** — group policy roles; yes/no on default-policy tighten
> 5. **Clients** — create/skip, names, split/merge, which groups see them
> 6. **Done** — stop adjusting; tick remaining consent or run execute access

Loop until they pick Done or run execute. After each applied change,
summarize the diff (counts, not every email unless they asked for one
person). Append a row to **## 7. Adjustments** (create that section
if missing). Keep heading names in sections 2–5 — `execute access`
parses them.

Do not treat a rename or membership edit as consent. Only tick
`[x] Invite` / `[x] Skip` / `[x] Create` when they asked to tick.

### Users

- Tick `[x] Invite` / `[x] Skip` for one email, a team, a domain, or all
- Move / add / remove group membership on the user row **and** the group Members cell
- Add a person only if they **give an email**. Record as extra (not from Optimizely). Do not invent people
- Cannot invite without an email

### Groups

- Tick `[x] Create` / `[x] Skip`
- Change `displayName` anytime. Change `groupId` only if Execute progress shows the group is not created yet. If already created, keep `groupId`; `displayName` is a PATCH on next execute
- Merge: one surviving `groupId`, combined members, Skip the other. Do not flatten into per-user shares
- Split: new `groupId` + move named members. ASK the new displayName
- Extra group: only if they name it and who belongs

### Roles

- Override share Viewer / Editor / Owner on intended-shares rows (group or direct user)
- Override default mapping (e.g. Publisher → Viewer) for all matching rows; record in section 2
- Forbidden still wins: Project Owner → `roles/admin`; Flags Editor/Reader **policy**; flatten teams

### Policies

- Change `optimizely-group-*` roles. Default stays `roles/reader`. Allowed extras: other non-flag workspace roles they name. **Never** `roles/flags-editor` or `roles/flags-reader` on a policy
- `default-policy` tighten: record explicit yes or no. Never apply during adjust
- `admin-policy`: only **add** known Account Administrators. Never remove identities

### Clients

- Tick `[x] Create` / `[x] Skip` on section 5 rows
- Rename displayName / clientId; split or merge only with an explicit answer
- Assign which groups should see which clients
- Still blocked if no `sdk_key` — do not invent clients from project/env names
- Never reuse the auto-created `{workspace} client` unless they say so

### After execute (deltas)

Adjust still edits the plan. Next `execute access` applies:

- New `[x] Create` groups / `[x] Invite` users / `[x] Create` clients
- PATCH group `displayName` if it changed
- PATCH group policy roles if they changed (forbidden check)
- `addGroupMembers` for new membership. **ASK before removing** a live member
- Do **not** delete a group, policy, user, or Flag client because a row is now Skip. Skip = do not create if missing. Delete imported artifacts only if they explicitly say delete, then keep-list in **Never lock the operator out**

---

## execute access (idempotent)

**First: Confidence auth.** If `GET /v1/users` already succeeds with a
valid session token, skip login. If not, **ASK** them to sign in
(hard gate §2) before the consent gate and before any IAM write. Then
require a completed access plan (`## Generation Status` step 5
`✓ complete`, or Overall `complete`). If the plan is missing or incomplete, run
`plan access` first — do not invite from memory.

`execute access` is the **only** command that sends invitations,
creates groups, or creates planned Flag clients. Safe to repeat.
Re-run after **adjust access**: use sections 3–5 as source of truth
(not the adjustments log). Create anything newly ticked; PATCH
`displayName` and group-policy roles when they changed; add new
members. **ASK before removing** a live group member. Skip ≠ delete.

**CONSENT GATE (before any IAM write):** If any user row has both
`[ ] Invite` and `[ ] Skip` empty, or any group row has both
`[ ] Create` and `[ ] Skip` empty, **stop**. If section 5 lists
candidate clients and any row has both boxes empty, **stop**. List the
unticked rows. Silence is not consent. Blocked / skipped Flag clients
(no `sdk_key`) are not a consent failure.

First run (groups/invites not created yet): create each `[x] Create`
group, then create each group's policy bound to `identities/g{groupId}`
(Reader — **not** Flags Editor), then each `[x] Create` Flag client
(`POST /v1/clients` + credential; secret once; never print Optimizely
SDK keys; never delete the auto-created workspace client), then send
each `[x] Invite` invitation. If flags already exist, run
`share_group_flags` now (group identity — do not wait for accept). Then
**immediately** run `provision_accepted` and the watch loop below. Do
not stop after sending invites.

Accepting an invite creates the user only. **This command** puts them
in the right group, on the right policy, seeing the right Flag client
**and that group’s flags** (Viewer/Editor share by role).
Do not wait for the operator to say people have accepted. Re-run is
safe and does the same provision for anyone new.

Detect first:

```text
GET /v1/users                 → email → users/{id} → identities/u{id}
GET /v1/userInvitations       → still pending
GET /v1/groups                → teams already created?
GET /v1/groups/{id}/members   → already in the group?
GET /v1/policies              → group policies exist?
GET /v1/clients               → planned Flag clients exist?
GET flags /v1/flags           → current owner + clients[] + which flags exist to share
```

If the user resource has no `identity`, use `identities/u` + the id from
`users/{id}`.

### `provision_accepted` (every accepted email, immediately)

For each planned email that appears in `GET /v1/users` (skip the
operator unless they are also in the export):

1. **Group** — `POST /v1/groups/{groupId}:addGroupMembers`
   `{"identities":["identities/u…"]}` for every group in their plan
   row. Skip if already a member. Never `POST …/members` (405).
2. **Policy** — `GET` `policies/optimizely-group-{groupId}`. It must
   list `identities/g{groupId}` and `roles/reader` (or the roles in
   the plan). Create it if missing (`POST /v1/policies?policyId=…`).
   Do **not** put the user on `admin-policy` unless they are an
   account Administrator. Do **not** attach `roles/flags-editor`.
   Binding the **group** (not each user) means step 1 is enough for
   the policy to apply.
3. **Client** — they must see the Flag client(s) in the plan row:
   - If those `clients/{id}` exist: `POST /v1/flags/{flag}:addFlagClient`
     for flags from that team's projects (skip if already listed).
     If the client resource has identities/share, add
     `identities/g{groupId}`.
   - If section 5 is blocked (no `sdk_key`): still do group + policy.
     Record “client pending keys”. Do not invent a client. Re-run
     `plan access` Step 4 when keys exist, then `execute access`.
   - Do not replace the auto-created `{workspace} client` unless the
     plan says that is the intended client.
4. **Owner** — if they were Project Owner and those flags exist:
   `PATCH` `updateMask=owner`.
5. **Flags they can see** — `share_group_flags` for every group on
   their plan row (and any direct user shares). Viewer = see;
   Editor/Publisher = see+edit. Skip if flags do not exist yet.
6. **Verify** that user before the next email:
   `GET /v1/groups/{id}/members` contains them; policy still has the
   group; planned clients appear on `GET /v1/clients` and on the
   flags; planned flags are shared with the group (or listed as UI
   fallback). If any check fails: **stop** and report. Do not skip to
   the next person as if it succeeded.

| Source person | Action |
|---------------|--------|
| In `GET /v1/users` | `provision_accepted` now (group + policy + client + flag shares). Skip steps already done |
| Invitation pending, not a user | Count. Do not add to groups. Do not re-invite unless expired |
| Missing / expired | Re-invite, then they must accept again — provision on the next detect |

### Watch loop (same turn as invites)

After sending invites, poll `GET /v1/users` every **15–30s for up to
5 minutes**. Each newly accepted email: `provision_accepted` before
the next poll. Then stop polling and tell the operator: anyone who
accepts later is picked up by `/migrate-optimizely execute access`
(no extra consent). Optional: they can loop that command.

Do not re-create existing groups or policies. Do not flatten pending
members into per-user policies.

Report: accepted and provisioned (group + policy + client + flags they
can see); already done; still pending (emails); client still pending
client still pending keys / skipped Flag clients; flag shares pending Phase 1; re-invited; owners
updated; shares still needing UI if no share API.

`pageSize` max is **100**.

---

## Flag clients (inside plan access) — ASK, never auto-create

This is **Step 4 of `plan access`**. `/migrate-optimizely plan clients`
is an alias that runs only this step against the existing access plan
(or starts `plan access` if none exists).

**Do not** treat an Optimizely project, environment, or SDK key as a
Confidence Client. They are different objects.

Flag client (`/v1/clients`, SDK resolve) ≠ IAM API client
(`/v1/apiClients`, `POST /v1/oauth/token`).

Build a **candidate_clients** inventory from `{project_id, project_name,
environment_id, environment_name, environment_key, sdk_key}` **plus**
which apps use each key and desired isolation. Then ASK. Write the
answers into plan section 5. **Do not `POST /v1/clients` here** —
`execute access` creates `[x] Create` rows.

`⏸ awaiting user` when any of these is missing: `sdk_key`,
`environment_key`, app boundary (iOS + Android sharing one key),
display names, or cardinality (one client vs split).

Ask:

```text
1. Do you have environment SDK keys (per project + environment)?
2. Should each unique SDK key become one Confidence Flag client?
3. If iOS and Android (or web) share one SDK key, one client or split?
4. What display names? Suggested: {environment_key}-{project-slug}[-ios|-android|-web]
```

**Forbidden without an explicit answer:** one client per project only;
one client per environment with no `sdk_key`; splitting/merging by
assumed platforms; reusing the auto-created `{workspace} client` unless
they say so.

After `execute access` creates a client: `POST /v1/clients?clientId=…`
then `POST /v1/clients/{id}/credentials` (secret shown once). Do not
print Optimizely SDK keys. Then **run `provision_accepted`** so
accepted groups get `:addFlagClient` and see them in the picker.

Never delete the auto-created Flag client (`labels.auto-created: true`
or display name `{workspace} client`).

---

## Never lock the operator out

Applies to import, execute, rollback, cleanup, and “delete everything”.

**Never delete or overwrite**

| Resource | Why |
|----------|-----|
| The operator user (token subject) | Removes login + admin |
| `policies/admin-policy` | Admin for the operator |
| `policies/default-policy` | Workspace baseline |
| Auto-created Flag client | Signup resolve client |
| Built-in roles | System |
| Last remaining admin | Workspace would have no administrator |
| The IAM API client currently used for auth | Agent could not call IAM |

“Delete everything” = **imported artifacts only** (`optimizely-*`
policies, imported groups, pending invites, Flag clients this skill
created). Then verify the keep-list still exists.

After every destructive step:

```text
GET /v1/users                    → operator still present
GET /v1/policies                 → admin-policy + default-policy
GET /v1/policies/admin-policy    → operator still in identities
GET /v1/clients                  → auto-created client still present
```

If any check fails: **stop**. Do not continue deleting.

Flags cannot be hard-deleted (`DELETE` is 405) — `:archive` only.

---

## IAM write APIs

```bash
# Group
curl -X POST "$IAM/groups?groupId=team-checkout" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"displayName":"Checkout"}'
# → identity like identities/gteam-checkout

# After adjust: PATCH displayName if the group already exists
curl -X PATCH "$IAM/groups/team-checkout?updateMask=displayName" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"displayName":"Checkout Eng"}'

# Group policy (bind GROUP, not each user — membership applies it)
curl -X POST "$IAM/policies?policyId=optimizely-group-team-checkout" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"roles":["roles/reader"],"identities":["identities/gteam-checkout"]}'

# After adjust: PATCH policy roles (never flags-editor / flags-reader)
curl -X PATCH "$IAM/policies/optimizely-group-team-checkout?updateMask=roles" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"roles":["roles/reader"]}'

# Members (accepted users only) — do this as soon as GET /v1/users lists them
curl -X POST "$IAM/groups/team-checkout:addGroupMembers" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"identities":["identities/u…"]}'

# Invite
curl -X POST "$IAM/userInvitations" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"invitedEmail":"user@example.com","inviter":"users/…"}'

# Flag owner (after the flag exists)
curl -X PATCH "$FLAGS/flags/{flagId}?updateMask=owner" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"owner":"identities/u…"}'   # or a group identity

# Right Flag client on those flags (after execute access created the client)
curl -X POST "$FLAGS/flags/{flagId}:addFlagClient" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"client":"clients/{id}"}'

# Group can SEE this flag (Viewer). Use roles/flags-editor on THIS flag for Editor.
# Do not put those roles on a workspace policy.
curl -X POST "$FLAGS/flags/{flagId}:addIamBinding" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"identity":"identities/gteam-checkout","role":"roles/flags-reader"}'
```

Per-flag Viewer/Editor **share** is how a group sees its flags. Try
`:addIamBinding` (and the fallbacks in **Group flag visibility**). If
every call fails, record the UI path; do not invent a policy that
grants Flags Reader/Editor on every flag.

Also: `GET/POST /v1/policies`, `GET /v1/roles`, `GET/DELETE /v1/userInvitations/{id}`.
`pageSize` ≤ 100.
