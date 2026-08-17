# Optimizely → Confidence access and clients

**User-facing docs (this repo):** [README — Optimizely → Confidence](../../README.md#optimizely--confidence).
Operators should learn Phase 0 from there, not only from this agent file.

Read this file when the user runs `/migrate-optimizely` with **no args**
(defaults to `plan access`), `/migrate-optimizely plan access`,
`/migrate-optimizely-plan-access`, `/migrate-optimizely adjust access`,
`/migrate-optimizely-adjust-access`, `/migrate-optimizely execute access`,
`/migrate-optimizely-execute-access`, or asks to migrate or **change**
Optimizely **users, teams, roles, groups, policies, or Flag clients**.
Keep flag-definition and code work in `SKILL.md`.

Phase 0 `plan access` follows the same machinery as `plan flags` in
`SKILL.md` (overview box, step tracker, resume check, Generation
Status after each step, consent rows, then stop). This file is the
IAM mapping, lockout, opening questions, and plan-file template.

Human IAM and runtime clients are **separate**. Do not derive one from
the other. Do not flatten Optimizely teams into per-user shares. Never
lock the operator out.

**Interview when evidence is thin.** Exports, Desktop/Downloads JSON, and
governance docs are preferred — but if they are missing, incomplete, or
the user skipped context lookup, you **must ASK structured questions**
to reconstruct Optimizely governance before translating. Do not guess
project boundaries, who may see/edit flags, app/client isolation, or
multi-app flags. See **Governance discovery interview**.

---

## Commands

Same split as flags: **plan writes the file, execute performs writes.**

| Command | What it does |
|---------|----------------|
| `/migrate-optimizely` *(no args)* | Same as `plan access` — default entry for new migrations |
| `plan access` / `/migrate-optimizely-plan-access` | Extract users/teams/roles **and** propose Flag clients (Step 4). Write `.claude/plans/optimizely-access-migration-<date>.md`. **No IAM writes. No invites. No groups. No `POST /v1/clients`.** If SDK keys arrive later, re-run `plan access` and resume Step 4 |
| `adjust access` / `/migrate-optimizely-adjust-access` | Fine-edit the plan: **users, groups, roles, policies, clients**. Natural language is enough. **No IAM writes.** Next `execute access` applies the tables |
| `execute access` / `/migrate-optimizely-execute-access` | **All writes**, idempotent: groups + policies, invites, **ticked Flag clients**, flag shares, then provision accepted users (including deltas after adjust) |

**Order:** `plan access` → **Step 5 exit ask** → **adjust access** (optional) → tick consent → `execute access` → `plan flags` → **exit ask** → **adjust flags** (optional) → `execute flags` (**create flags → suggested next: targeting-rules import → suggested next: resolve-verify all for segment match**) → `plan code` → **exit ask** → **adjust code** (optional) → `execute code`.

### Transport: MCP first, REST fallback

For Confidence **writes**, prefer tools in this order. Do **not** skip
MCP when it can do the job; do **not** invent IAM MCP tools that do not
exist.

| Work | Try first | Fallback if MCP missing / `needsAuth` / tool error |
|------|-----------|-----------------------------------------------------|
| Flag clients (`listClients`, `createClient`) | **Flags MCP** | IAM REST `GET/POST https://iam.confidence.dev/v1/clients` (+ credential create) |
| Flag attach (`addFlagToClient`) | **Flags MCP** | Flags REST `:addFlagClient` |
| Flag create / simple targeting / resolve | **Flags MCP** | Flags REST (or REST-only for segments / waterfall — see SKILL.md) |
| Users, invites, groups, policies, IAM bindings / flag shares | **IAM REST only** | — (Flags MCP has **no** invite/group/policy tools) |

**Agent rule:** On `execute access` / `execute flags`, probe Flags MCP
once (e.g. `listClients`). If it works, use MCP for every Flag-client
and flag write it supports. If auth fails or a call errors, **fall back
to IAM/Flags REST** with `$TMPDIR/confidence_token` (or OAuth client
credentials) and continue — tell the user which transport you are on.
Do not block the migration waiting for MCP when REST already works.

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

### MUST say to the customer (Optimizely vs Confidence — who can see flags)

**When:** once, before Translate mapping tables / consent rows — and
again if they later confuse Clients with “seeing flags.” Do **not**
bury this only in the plan file; **say it in chat** (plain language).

**Required wording (adapt slightly, keep every bullet’s meaning):**

> **Who can see flags — Optimizely vs Confidence (important)**
>
> In **Optimizely**, people often open flags because they have a
> **project** (or environment) role. Access feels “through the project.”
> Apps / SDK keys sit next to that same mental model.
>
> In **Confidence**, console visibility is **not** project-based and
> **not** granted by attaching a Client:
>
> - **Users/groups seeing a flag or not** = **Group or user + role →
>   that flag** (per-flag **Viewer** / **Editor** share, or **Owner**).
>   Teams become Groups; we share the group’s flags so members can open
>   them.
> - **Which apps can resolve a flag** = **Flag Client** +
>   `:addFlagClient`. Same flag may attach to several Clients (e.g. iOS
>   + Android). That is **runtime only**.
> - **Client association does not** make people able to see the flag in
>   the UI. **IAM share does not** make an app able to resolve it.
>
> So when we migrate users: we invite people, put them in Groups, and
> grant **group/role → flag** shares for console access — separately
> from Clients for apps.

Record under plan `## Customer education (visibility)` that this was
said (date / paraphrase OK). If they ask “will Client X let team Y see
flags?” — answer **no**; only shares/Owner/policies do.

| Mechanism | Scope | Use for |
|-----------|--------|---------|
| **Policy** + role | **All** resources of that type | Account Administrator; optional Reader/Creator baseline. **Not** project/flag/env roles |
| **Owner** on a resource | One flag / segment | Project Owner of flags from that project |
| **Share** on a resource | One flag (Viewer or Editor) | **How the group sees those flags** (group/role → flag). Project defaults + granular flag/audience assignments. Bind the **group**, not each member |
| **Flag client + credential + environments** | Runtime resolve | SDK keys / apps — **not** human IAM; does **not** control who sees flags in the UI |

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
**per-flag share** (**group/role → flag**), not a workspace Flags
Reader/Editor policy, and **not** Flag↔Client attach.

If the customer has not yet heard the **MUST say** block under
**Translate to Confidence**, say it before creating share rows.

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

### Opening questions (MUST be the first user-visible ask for plan access)

When the user starts **plan access** or **access + flags** (code
deferred or not): this source-method question is the **first** thing
you ask. Do **not** put the full migration overview before it.

Do not create `.claude/plans/optimizely-access-migration-*.md`. Do not
curl Optimizely. Do not Read export files. Do not invent people. Do not
paste the REST token paragraph until they pick option 1.

Show this tracker, then the question (same shape as SKILL.md):

```
───── Plan Access ─────────────────────────────────────────
  [1] Source           ⏸ awaiting you
  [2] Translate        ○ pending
  [3] Consent rows     ○ pending
  [4] Flag clients     ○ pending
  [5] Write plan       ○ pending
────────────────────────────────────────────────────────────
```

**How to ask (one question; type `1` / `2` / …):** follow **Question UX**
in SKILL.md for every fixed choice in Phase 0. **One question per
assistant turn.** Always number options and tell the user to reply with
the number. Optional `AskQuestion` / `AskUserQuestion` for that same
question only — never replace the numbered list.

Never skip. Never collapse into "paste a token or a path" without a
numbered choice (or a single free-text ask for secrets). Silence is not
consent. Never ask multiple source / governance / consent questions in
one message.

**Source method — one numbered question per turn (stop after each):**

**Turn A** (always first) — optional one-line tracker, then:

```text
Can we read your Optimizely users, teams, and permissions over the Live REST API (API token + Project ID)?
Reply with the number:
1. Yes — I have (or can create) a token + Project ID
2. No — use files or another option
```

`⏸ awaiting user`. If **1** → Hard gate §1 next (token / project ID;
typed secrets are free-text, still one ask). Do not ask Desktop/sample yet.

**Turn B** (only if Turn A was **2**):

```text
Do you have export files (path, paste, or attach) for users / teams / permissions?
Reply with the number:
1. Yes — I will give a path, paste, or attach
2. No
```

**Turn C** (only if Turn B was **2**):

```text
How should we proceed without a token or export yet?
Reply with the number:
1. Walk me through the file fallback
2. JSON on my Desktop — look, then confirm before Read
3. Sample IAM file in this repo
4. Something else (I will type it)
```

Optional one-line scope on Turn A only (“access + flags; no code”) if
they already said that — then the numbered question.

People (emails, teams, permissions) come only from this source. Extra
strategy/exceptions are a **later** question, after the access file (or
REST) exists — see **Extract context** below.

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

**How to ask:** one numbered question per turn (Question UX). Skip must
be a numbered option. Never invent a strategy. Never treat markdown as
people to invite. Never ask look/paste/skip as three separate questions
in one message — one prompt with `1` / `2` / `3`.

> I have the Optimizely **users, teams, and permissions** source.
> Before I translate to Confidence, is there extra **access migration
> context** (internal strategy, exceptions, who not to invite / keep)?
>
> I will still take people only from the Optimizely REST API or the
> access file. This is extra context around that file.
>
> Reply with the number:
> 1. **Look around** — search next to the access file (and this workspace) for markdown/docs about access migration, IAM, or exceptions. I will list what I find and confirm before using it.
> 2. **I'll paste** extra context in chat (or a path)
> 3. **Skip** — map only the Optimizely REST / file

`⏸ awaiting user` until they reply with `1`, `2`, or `3`.

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

**If they picked skip:** write `Source: none (skipped)` under
`## Access migration context`, then **immediately run Governance
discovery interview** before Step 2. Skip is not “invent governance.”

**If look-around found nothing** (no Desktop/Downloads/workspace docs):
say so, then **run Governance discovery interview**. Do not proceed to
Translate on file/REST people lists alone when project roles, flag
shares, env permissions, audiences, or app/client boundaries are
missing or ambiguous.

### Governance discovery interview (MUST when docs/export are thin)

Run this **whenever** any of these is true:

- Extract context was **skip**, or look-around found **no** governance
  docs (Desktop, Downloads, next to the export, workspace)
- REST/file has people/teams but **missing or partial** project roles,
  env permissions, flag/audience assignments, SDK keys, or app usage
- User cannot provide an Optimizely export and is reconstructing from
  knowledge (“how we run Optimizely today”)
- During **Translate**, **Flag clients**, or later **plan flags**, a
  governance fact is still unknown

`⏸ awaiting user` **between every question**. Follow **Question UX**
(SKILL.md): **exactly one** numbered question per turn — never dump
groups A–D, never ask 1–4 in one message. Split former “question groups”
into a sequence of single asks (A1, then A2, … then B5, …). Record
answers under `## Governance interview` in the plan. **Never invent**
emails, teams, roles, apps, or client splits.

Educate briefly before each group: Optimizely governance does **not**
map 1:1. Confidence uses **different levers** — ask so we match intent
with what Confidence can actually do.

**Before question group B (human access):** deliver the full **MUST say
to the customer** block (Optimizely project access vs Confidence
**group/role → flag** shares). Do not skip it because “they already
know IAM.”

#### Confidence levers (teach this; do not conflate)

| Intent | Confidence lever | Not this |
|--------|------------------|----------|
| Who can **see/edit** a flag in the UI | **Group/user + role → flag**: per-flag **share** (Viewer/Editor) or **Owner** | Optimizely-style “project membership alone”; Flag **Client** attach; Flag **rules**; workspace Flags Reader/Editor **policy** |
| Who is Admin of the workspace | Policy + `roles/admin` | Project Owner |
| Team membership inheritance | **Group** + shares/policy on the group identity | Flattening to per-user shares |
| Former Optimizely **project** boundary | Logical set of flags + shares + which Clients those flags attach to | A Confidence “Project” (does not exist); Project ≠ Client |
| Which **apps** resolve a flag | **Flag Client(s)** + `:addFlagClient` (one flag → many clients OK) | Human IAM share; SDK key alone |
| Prod vs staging behavior | **Environments** on credentials + **flag rules** limited to those envs | Human “environment role” (unmapped as IAM) |
| Who gets which **variant** at runtime | Flag **rules** (segments/criteria, allocations) | Who can open the flag in the console |

Flag **rules** give runtime flexibility (env, audience, traffic). They do
**not** replace IAM for “which flags can this group open.” Use rules
together with Clients/Environments when Optimizely used env roles or
multi-app keys to constrain **behavior**, and use **shares** when they
constrained **console access**.

#### Question group A — org shape (ask first if unclear; ONE question per turn)

Ask each item separately. Example for the first:

```text
Account admins — Who can manage users/billing (Account Administrator), separate from project owners?
Reply with the number (or type free-text if you pick 3):
1. I will list emails / names next
2. Unknown / skip for now
3. Something else (I will type it)
```

Then, only after they answer, ask projects; then teams; then direct
user roles. Do **not** send questions 1–4 together.

Topics to cover (each its own turn):
1. **Account admins**
2. **Projects** — how many / names / teams spanning projects?
3. **Teams** — list teams and members; one Group each?
4. **Direct user roles** — access outside a team?

#### Question group B — human access (one topic per turn)

> **Reminder (say once before the first B question if not already said):**
> In Confidence, **users seeing flags or not** = **group/role → flag**
> (Viewer/Editor share), not Optimizely project membership alone, and
> not Flag Clients.

Then ask **one** of these per turn (numbered options + free-text when
needed): default project role; flag-level exceptions; audience-level
exceptions; environment-level human roles; Publisher vs Editor fidelity.

#### Question group C — apps / clients (one topic per turn)

Educate once that Clients are runtime app identities. Then ask one per
turn: app list; shared vs separate SDK keys; one Client per app?;
multi-app flags; client-less flags.

#### Question group D — runtime rules (one topic per turn)

Ask during Flag clients / plan flags when unclear — still **one** ask
per turn: env-scoped rules; client-only resolve isolation; targeting in
rules vs console permissions.

If answers conflict with a file/REST extract, **ASK which wins**. Prefer
export for people lists; prefer interview for intent when permissions
arrays are empty.

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
   or skip). **If skip / no docs / gaps → Governance discovery
   interview** before marking this step complete. People only from
   REST / file / fallback / interview (interview may supply roles and
   app boundaries; still do not invent emails).
   **After complete:** Generation Status step 1 `✓ complete`.
2. **Translate** — **First, say the MUST-say customer block**
   (Optimizely project access vs Confidence **group/role → flag** for
   who can see flags; Clients ≠ console visibility). Then fill the
   mapping tables (users, teams→groups, project roles, flag/audience
   shares, unmapped env-human IAM, fidelity loss). Apply confirmed
   access-migration context **and** governance interview answers. Map
   console visibility to **shares** (group/role → flag); map app reach
   to **Clients** + multi-client flag attach; map env publish intent to
   Environments + **rules** (not IAM). Missing fact → ASK (re-enter
   interview groups B–D). Propose `default-policy` tightening; do not
   apply it. Record that education under `## Customer education
   (visibility)`.
   **After complete:** Generation Status step 2 `✓ complete`.
3. **Consent rows** — One row per user and per group with empty
   `[ ] Invite` / `[ ] Skip` (users) and `[ ] Create` / `[ ] Skip`
   (groups). Silence is not consent. Same rule as flag `[ ] Migrate` /
   `[ ] Skip`.
   **After complete:** Generation Status step 3 `✓ complete`.
4. **Flag clients** — Propose candidates from project + env + SDK key
   + apps + isolation **and** interview group C. **ASK** (questions
   below + multi-app flag attach). Write section 5 with
   `[ ] Create` / `[ ] Skip`. Record which flags attach to which
   clients (one→many OK; some flags client-less OK). If no `sdk_key`
   and no interview app list: skip, mark blocked — then ASK group C
   before inventing.
   Do not `POST /v1/clients`.
   **After complete or skipped:** Generation Status step 4.
5. **Write plan** — Finish the file. Set step 5 and Overall to
   `✓ complete`. List what execute will do. Do not invite anyone. Do
   not create clients. **Then the Step 5 exit ask in SKILL.md
   (required):** there is **no automatic path** into adjust — ASK
   with structured choices: (1) **Adjust access**, (2) **Tick
   consent**, (3) **Execute access** (only if consent already
   ticked), (4) **Done for now**. If they pick (1), enter **adjust
   access** in the same turn (do not require the slash command).

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

## Customer education (visibility)

Said in chat: <yes — date/paraphrase | pending>
Core message recorded: Optimizely often grants console access via
**project** roles; Confidence grants **users seeing flags or not** via
**group/role → flag** (Viewer/Editor share / Owner). Flag **Clients** =
app resolve only — they do **not** grant UI visibility.

## Governance interview

Ran because: <no docs on Desktop/Downloads/workspace | Extract context skip | gaps in export | user reconstructing>
Answers applied: <yes>

| Topic | Answer | Confidence lever |
|-------|--------|------------------|
| Account admins | | `roles/admin` policy |
| Projects / scopes | | Flag sets + shares (no Project resource) |
| Teams → groups | | Group + group-bound shares |
| Project / flag / audience roles | | **group/role → flag** Viewer/Editor shares (Owner); not Clients |
| Env human roles | | Unmapped IAM; Environments + rules + credentials |
| Apps / Clients | | Flag Clients; ask isolation |
| Multi-app flags | | One flag → many `:addFlagClient` |
| Client-less flags | | No attach until an app needs resolve |
| Publisher vs Editor | | Fidelity loss noted |

## 2. Translation

| Optimizely | Principal | Confidence | Notes |
|------------|-----------|------------|--------|
| Collaborator | <email> | Invite (execute) | Exists only after accept |
| Team <name> | <members> | Group `<groupId>` + policy `optimizely-group-<groupId>` | Do not flatten |
| Project Owner | <email> | Flag **owner** | Not `roles/admin` |
| Project Editor / Publisher | <email> | Flag **Editor share** | Not workspace Flags Editor; Publisher fidelity loss |
| Env human permission | <principal> @ <env> | **Unmapped as IAM** | List in section 4; runtime via env + rules |
| Flag / audience assignment | <principal> | Intended share | After Phase 1; audience→segment share when distinct |
| Project (container) | — | Flag set + shares + client attaches | Not a Confidence Project; ≠ Client |

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

If this file has no `sdk_key` **and** no interview app list: **blocked**
— skip step 4, run Governance interview group C, then re-run.

If keys or interview apps exist, list candidates after ASK:

| clientId | displayName | From (project / env / key / interview) | Apps / isolation | Consent |
|----------|-------------|----------------------------------------|------------------|---------|
| <prod-checkout> | <prod-checkout> | project + env + sdk_key (redacted) | <one client / split ios-android> | [ ] Create  [ ] Skip |

### Flag ↔ Client attach (runtime; not human IAM)

One Confidence flag may attach to **multiple** Clients (multi-app).
Some flags may attach to **none** yet (not running in an app).

| Flag (Optimizely key) | Confidence Clients | Notes |
|----------------------|--------------------|-------|
| <flag-key> | <clientId>, <clientId2> | multi-app |
| <flag-key-2> | _(none yet)_ | console-only / defer |

Never reuse the auto-created `{workspace} client` unless they say so.
`execute access` creates `[x] Create` rows only. `:addFlagClient` does
**not** grant humans permission to see the flag or the client.

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
`/migrate-optimizely-adjust-access`, `modify access`, picks
**Adjust access** on the **plan access Step 5 exit ask** (no
automatic path from plan — that ask is required), or asks to
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
menu). Otherwise **one** numbered question (Question UX):

```text
The access plan is ready to edit. I will change the plan file only — no invites.
What should I change? Reply with the number:
1. Users — invite/skip, move groups, add an email you give me
2. Groups — create/skip, rename, members, merge/split
3. Roles — Viewer / Editor / Owner shares
4. Policies — group policy roles; default-policy tighten yes/no
5. Clients — create/skip, names, which groups see them
6. Done — stop adjusting; return to exit menu
```

Loop: after each applied change, re-ask this **single** menu (or Done).
Do not ask follow-ups in the same turn as the menu pick — next turn.

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

**Progress (MANDATORY).** Every write loop (groups, policies, clients,
invites, provision, flag shares) must show a live progress bar to the
user — same rules as **Execute progress bar** in SKILL.md (`█`/`░`,
current/total, current item). Never run silent multi-minute IAM batches.

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
(**MCP `createClient` first**; if MCP unavailable, IAM REST
`POST /v1/clients` + credential — see **Transport: MCP first, REST
fallback**; secret once; never print Optimizely SDK keys; never delete
the auto-created workspace client), then send each `[x] Invite`
invitation. If flags already exist, run `share_group_flags` now (group
identity — do not wait for accept). Then **immediately** run
`provision_accepted` and the watch loop below. Do not stop after
sending invites.

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

This is **Step 4 of `plan access`** — not a separate command. If SDK
keys arrive after the access plan was written, re-run `plan access`
and resume this step against the existing plan.

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
5. Which flags run in which apps? (one flag → many Clients is OK)
6. Any flags that should stay client-less until an app integrates?
```

If SDK keys are missing but the user can describe apps, **still propose
clients from the interview** (names + isolation), mark credentials
pending, and fill the Flag ↔ Client attach table. Do not invent secret
values.

**Forbidden without an explicit answer:** one client per project only;
one client per environment with no `sdk_key` and no interview; splitting/merging by
assumed platforms; reusing the auto-created `{workspace} client` unless
they say so.

After `execute access` creates a client: prefer Flags MCP
`createClient`; if that fails, IAM REST `POST /v1/clients` (body
`displayName` + `clientType`, or `?clientId=…` only when the API
accepts it) then `POST /v1/clients/{id}/credentials` (secret shown
once). Do not
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
