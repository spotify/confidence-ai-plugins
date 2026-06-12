---
description: Create Confidence accounts and onboard users. Use when the user asks to create an account, invite users, onboard to Confidence, or check account status.
---

# Confidence Onboarding

Create accounts, invite users, and get started with Confidence — all from the CLI.

## Default behavior (no sub-command)

When the user says "onboard me", "get started with Confidence", or triggers this skill without a specific sub-command, go **straight to the setup wizard**. The first question is always:

> 1. **Create a new account** — I'll walk you through signup
> 2. **Sign in to an existing account** — I already have one

Do NOT show a menu of sub-commands. Do NOT offer "Setup Wizard" as a choice — it IS the default flow. The only decision the user needs to make upfront is whether they have an account.

## Commands

| Command | Description |
|---------|-------------|
| `/onboard-confidence create-account` | Create a new Confidence account |
| `/onboard-confidence invite-user` | Invite a user to an account |
| `/onboard-confidence create-client` | Create an SDK client and generate credentials |
| `/onboard-confidence setup-wizard` | Guided walkthrough: client → flag → targeting → resolve |
| `/onboard-confidence setup-warehouse` | Configure data warehouse, connectors, and assignment tables |
| `/onboard-confidence learn` | Interactive learning about experimentation concepts |
| `/onboard-confidence status` | Check current user/account status |

---

## Authentication

**Browser-based Auth0 login.** The skill opens a browser for Auth0 login (Google, email/password, SSO) and captures the token automatically. The user never touches a token.

### Auth0 Configuration (agent-internal)

| Parameter | Signup (create-account) | Existing account (all other commands) |
|-----------|-------------------------|---------------------------------------|
| Domain | `auth.confidence.dev` | `auth.confidence.dev` |
| Client ID | `82qMvwZvqd3t3S0gRDvs8R53TehQXSJY` | `2fG3H4RhlAbIZm9Rfn32zTaILH7w1X4w` |
| Audience | `https://confidence.dev/` | `https://confidence.dev/` |
| Scope | `openid profile email offline_access` | `openid profile email offline_access` |

### Auth script

The auth script is **bundled in the plugin** as `auth.py` next to this SKILL.md. The path is shown in the "Base directory for this skill" header at the top of the loaded skill context. Do NOT write the script — just run it.

**Usage — single Bash tool call** with `dangerouslyDisableSandbox: true` and `timeout: 130000`:
```bash
lsof -ti:8084 | xargs kill -9 2>/dev/null; python3 <SKILL_BASE_DIR>/auth.py <CLIENT_ID> [ORGANIZATION]
```

Replace `<SKILL_BASE_DIR>` with the actual path from the skill header (e.g., `/Users/.../confidence-ai-plugins/.claude/skills/onboard-confidence`).

**Outputs on stdout** (parse line by line):
- `WAITING_FOR_LOGIN` — browser opened, waiting for callback
- `TOKEN:<jwt>` — success, extract everything after `TOKEN:`
- `AUTH_ERROR:<msg>` — Auth0 returned an error
- `TOKEN_ERROR:<msg>` — token exchange failed

**Examples:**

Signup (no org):
```bash
lsof -ti:8084 | xargs kill -9 2>/dev/null; python3 <SKILL_BASE_DIR>/auth.py 82qMvwZvqd3t3S0gRDvs8R53TehQXSJY
```

Existing account login:
```bash
lsof -ti:8084 | xargs kill -9 2>/dev/null; python3 <SKILL_BASE_DIR>/auth.py 2fG3H4RhlAbIZm9Rfn32zTaILH7w1X4w org_abc123
```

**Key details:**
- Port is fixed at **8084** (must match Auth0 Allowed Callback URLs)
- For signup (`create-account`): omit ORGANIZATION arg → adds `screen_hint=signup` + `prompt=login`
- For existing account (all other commands): pass `ORGANIZATION=<org_id>` → auto-completes if browser session exists
- After `create-account`, automatically re-auth with org param to get org-scoped token (browser auto-redirects, no interaction)
- All network commands require `dangerouslyDisableSandbox: true` and `timeout: 130000`

### Session-only token management

The token is kept in the current session only and is never saved to disk. If the session ends or the token expires, the skill will open your browser to log in again.

**On every sub-command start**, check if the `TOKEN` variable is set and not expired. Combine the check + region extraction in a **single Bash command**:

```bash
echo "$TOKEN" | python3 -c "
import sys, json, base64, time
t = sys.stdin.read().strip()
if not t:
    print('MISSING'); sys.exit(0)
p = t.split('.')[1]
p += '=' * (4 - len(p) % 4)
d = json.loads(base64.b64decode(p))
if d.get('exp', 0) < time.time():
    print('EXPIRED'); sys.exit(0)
print('VALID')
print('REGION=' + d.get('https://confidence.dev/region', 'EU'))
print('ORG=' + d.get('org_id', ''))
print('ACCOUNT=' + d.get('https://confidence.dev/account_name', ''))
"
```

Output is multi-line: first line is `VALID`/`EXPIRED`/`MISSING`, followed by `REGION=EU`, `ORG=...`, `ACCOUNT=...` if valid.

If `TOKEN` is unset or expired, run the browser auth flow to get a new token. Store the result in the `TOKEN` shell variable only. **NEVER write the token to disk. NEVER reference `~/.confidence/`.**

Use the `REGION` value (lowercased) for URL prefixes: `iam.eu.confidence.dev`, `flags.eu.confidence.dev`, etc.

If the token is valid, skip the login step entirely. If expired or missing, run the auth flow.

### Important: gRPC-REST transcoding rules

The Confidence APIs use gRPC with REST transcoding. The `body` field in the proto HTTP binding determines the JSON structure:

- **`body: "client"`** → send the client object directly: `{"display_name": "iOS App"}`
- **`body: "flag"`** → send the flag object directly: `{}`
- **`body: "*"`** → send the full request message: `{"account": {...}, "billingDetails": {...}}`

Fields NOT in the body (like `flag_id`, `parent`) become **query parameters**.

**Field names are `snake_case`** in requests. Responses may use `camelCase`.

### Speed: minimize tool calls

**Every Bash tool call adds latency.** Optimize by combining commands:

- **Chain independent curls** with `&&` or `;` in a single Bash call when the results don't depend on each other
- **Parallel API calls**: When creating multiple variants, setting schema + creating variants can be chained: `curl ... schema && curl ... variant1 && curl ... variant2`
- **Token check + region extract**: Do both in one command (see session-only token management)
- **Port kill + auth run**: Always combine: `lsof -ti:8084 | xargs kill -9 2>/dev/null; python3 ...`
- **Never use Write/Read tools** for temporary files — use Bash heredocs or bundled scripts

### Common notes

- All network commands require `dangerouslyDisableSandbox: true`
- Never show the token value to the user
- Always use region-specific URLs (e.g., `iam.eu.confidence.dev` not `iam.confidence.dev`)

---

## User-Facing Communication Rules

**NEVER expose internal technical details to the user.**

- Do NOT show raw JSON request/response bodies in conversation
- Do NOT show Auth0 configuration details, token values, or OAuth internals
- Do NOT mention error codes, org IDs, JWT claims, token scoping, or API error details
- Do NOT ask the user for organization IDs, external IDs, or any auth-internal identifiers
- DO show human-readable status updates: "Opening browser for login...", "Creating your workspace...", "Invitation sent!"
- DO describe results in plain English
- DO handle all token re-issuance, org-scoping, and retry logic transparently — if something needs to happen behind the scenes (re-auth, polling, retry), just do it and show a friendly progress message
- The agent handles all auth/API complexity silently

**Step Tracker:** Display a visual step tracker at every phase transition. Update and re-display it each time you move to a new step.

---

## Sub-command: create-account

### Step Tracker

Display at START and after EACH step completes (updating status):

```
───── Create Account ──────────────────────────────────────
  [1] Log in             ○ pending
  [2] Workspace name     ○ pending
  [3] Account details    ○ pending
  [4] Create account     ○ pending
  [5] Connect tools      ○ pending
  [6] Done               ○ pending
────────────────────────────────────────────────────────────
```

Use `●` for completed, `▶` for in-progress, `○` for pending.

### Step 1: Log in

Run the bundled auth script with the **signup client ID** (`82qMvwZvqd3t3S0gRDvs8R53TehQXSJY`) and no organization arg. Parse the TOKEN and REFRESH_TOKEN from stdout.

Tell the user:
> Opening your browser to log in. Sign up with Google or create an account with email and password.

Store both `TOKEN` and `REFRESH_TOKEN` in shell variables. The refresh token is used in Step 5 to silently get an org-scoped token without opening the browser again.

If login fails, show the error in plain English and offer to retry.

**After successful login**, immediately extract the user's email by calling the Auth0 userinfo endpoint (combine with the token export in a single Bash call):
```bash
curl -s "https://konfidens.eu.auth0.com/userinfo" -H "Authorization: Bearer $TOKEN"
```
Response: `{ "email": "user@company.com", "name": "...", ... }`

Store the `email` value as `SIGNUP_EMAIL`. This is used to:
- Derive workspace name suggestions in Step 2
- Pre-fill the admin email in Step 3

### Step 2: Workspace name

EDUCATE then ASK:

> Your workspace name is the unique identifier for your Confidence account.
> It appears in URLs and is used to log in.
>
> **Rules:** 3-21 characters, lowercase letters, digits, and hyphens. Must start with a letter and end with a letter or digit.

**Suggest names derived from `SIGNUP_EMAIL`.** Extract the local part (before `@`), strip `+` suffixes, and generate 2-3 suggestions. For example, if `SIGNUP_EMAIL` is `jane+test@acme.com`, suggest `jane`, `jane-acme`, `acme-jane`.

Wait for user input. Then:

1. **Validate locally** against regex `^[a-z][a-z0-9-]{1,19}[a-z0-9]$`
2. **Check availability:**
```bash
curl -s "https://onboarding.confidence.dev/v1/loginIdAvailability:check?login_id=${LOGIN_ID}"
```
Response: `{ "available": true/false }`

If taken, inform the user and suggest alternatives (append numbers, abbreviations). Re-ask.

### Step 3: Account details

Collect interactively, one field at a time:

1. **Display name** — the human-readable name for the workspace (company name).
   Validate: 3-32 characters, starts with a letter/digit, alphanumeric + Unicode letters + spaces + hyphens.

2. **Region** — present as a choice:
   > Where should your data be stored? This **cannot be changed later**.
   > 1. EU (Europe)
   > 2. US (United States)

3. **Authentication method** — present as a choice:
   > How should users log in to your workspace?
   > 1. Google
   > 2. Email + password
   > 3. Both

4. **Admin email** — the email of the first admin user. Must be a **work email** — free email providers (Gmail, Yahoo, etc.) are rejected by the API.
   **Default to `SIGNUP_EMAIL`** (the email from Step 1). Present it as the pre-filled suggestion. Only ask the user to change it if they want a different admin email.

5. **Allowed login email domains** — optional. Ask if they want to restrict login to a specific email domain (e.g., `@company.com`).

### Step 4: Create account

Build and send the request. Use `--max-time 120` to allow for slow gRPC provisioning:

```bash
curl -s -w "\n%{http_code}" --max-time 120 -X POST "https://onboarding.confidence.dev/v1/accounts" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "account": {
      "displayName": "<DISPLAY_NAME>",
      "loginId": "<LOGIN_ID>",
      "region": "<REGION_EU|REGION_US>",
      "authConnections": [<AUTH_CONNECTIONS>],
      "adminEmail": "<ADMIN_EMAIL>",
      "allowedLoginEmailDomains": [<DOMAINS>]
    }
  }'
```

**Auth connections format:**
- Google: `[{"googleAuthConnection": {}}]`
- Password: `[{"passwordAuthConnection": {}}]`
- Both: `[{"googleAuthConnection": {}}, {"passwordAuthConnection": {}}]`

**Success response (HTTP 200):**
```json
{ "name": "accounts/...", "externalId": "...", "loginId": "my-workspace", "displayName": "My Workspace" }
```

Tell the user:
> Your workspace **<displayName>** has been created!
> Workspace ID: `<loginId>`
> Region: <region>
>
> You can access it at: https://confidence.spotify.com

**Error handling:**

| HTTP Status | Meaning | User message |
|---|---|---|
| 400 + "work email" | Free email rejected | "Confidence requires a work email address. Free providers like Gmail aren't allowed." |
| 400 + "already have an account" | Logged-in Auth0 user already has account | "This login already has a Confidence account. Log in with a different email to create a new workspace." → re-run Step 1 |
| 400 + "under review" (code 9) | Email not verified yet | see "Under review retry" below |
| 400 | Other validation error | Parse `.message`, show in plain English, re-collect the invalid field |
| 401 | Token expired/invalid | "Session expired. Let me log you in again." → re-run Step 1 |
| 409 | Name already taken | "That workspace name was just taken. Let's pick another." → re-run Step 2 |
| 504 / timeout | gRPC deadline exceeded | Retry up to 3 times with 3-second delays. If it still fails, tell the user: "The server is taking longer than usual. Let me try once more." |
| 500+ | Server error | "Something went wrong on our end. Let me try again in a moment." |

**Under review retry (code 9):**

Tell the user: "Please check your email for a verification link from Confidence and confirm your address. Let me know once you've done that!"

After the user confirms, **retry 4 times with 2-second delays** in a single Bash command — do NOT re-open the browser or re-authenticate:

```bash
for i in 1 2 3 4; do
  RESP=$(curl -s -w "\n%{http_code}" --max-time 120 -X POST "https://onboarding.confidence.dev/v1/accounts" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '<SAME_BODY>')
  HTTP=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | sed '$d')
  echo "ATTEMPT $i: HTTP=$HTTP"
  echo "$BODY"
  if [ "$HTTP" = "200" ]; then echo "SUCCESS"; break; fi
  if [ "$HTTP" != "400" ] || ! echo "$BODY" | grep -q "under review"; then echo "DIFFERENT_ERROR"; break; fi
  if [ "$i" -lt 4 ]; then sleep 2; fi
done
```

If all 4 attempts still return "under review", tell the user: "Verification hasn't propagated yet. Please wait a moment and let me know when you'd like to try again."

### Step 5: Get account-scoped token

The token from Step 1 has no `org_id` (it was issued before the account existed). The signup client's refresh token **cannot** be exchanged for an org-scoped token — Auth0 rejects cross-client refresh, and the signup client doesn't support org-scoping. A browser auth with the regular client is required.

**Use the browser auth script** with the **regular client ID** and the new org. The browser session from Step 1 is still active, so Auth0 auto-completes — the user sees no extra login prompt:
```bash
lsof -ti:8084 | xargs kill -9 2>/dev/null; python3 <SKILL_BASE_DIR>/auth.py 2fG3H4RhlAbIZm9Rfn32zTaILH7w1X4w <loginId_from_Step_4>
```

The response token will contain `org_id`, `account_name`, and `region` claims. Parse and store in the `TOKEN` shell variable. **Do NOT save to disk.**

Tell the user:
> Connecting to your new workspace... (your browser will briefly open and close automatically — no action needed)

Then suggest connecting MCP:
> To connect Confidence tools for flag management, type `/mcp` and authenticate **confidence-flags**.
> Your browser session will auto-complete it — no extra login.

### Step 6: Done

Show a summary and next steps:

```
═══════════════════════════════════════════════════════════════
  Welcome to Confidence!
═══════════════════════════════════════════════════════════════

  Workspace: <displayName> (<loginId>)
  Region:    <region>
  Admin:     <adminEmail>
  URL:       https://confidence.spotify.com

  Next steps:
  • Run the setup wizard:    /onboard-confidence setup-wizard
  • Invite team members:     /onboard-confidence invite-user
  • Set up data warehouse:   /onboard-confidence setup-warehouse
  • Create a feature flag:   Ask me or use the Confidence UI
  • Integrate your app:      Ask me for SDK setup instructions
  • Learn experimentation:   /onboard-confidence learn

═══════════════════════════════════════════════════════════════
```

---

## Sub-command: invite-user

### Step Tracker

```
───── Invite User ─────────────────────────────────────────
  [1] Authenticate       ○ pending
  [2] Target account     ○ pending
  [3] Invitation details ○ pending
  [4] Send invitation    ○ pending
────────────────────────────────────────────────────────────
```

### Step 1: Authenticate

Check if a token is available from a prior `create-account` run in this session.

If not, run the bundled auth script with the **regular client ID** (`2fG3H4RhlAbIZm9Rfn32zTaILH7w1X4w`) — this user already has an account.

Validate the token works by calling:
```bash
curl -s "https://iam.confidence.dev/v1/currentUser" \
  -H "Authorization: Bearer $TOKEN"
```

### Step 2: Target account

Try to identify the account automatically:

1. If MCP is connected, call `mcp__confidence-flags__getIdentityInfo` (no args) — returns current user's identity and account
2. If MCP isn't connected, use the `/v1/currentUser` REST response
3. If the user has multiple account memberships, ask which one

Tell the user which account will receive the invitation.

### Step 3: Invitation details

Ask for:

1. **Email address(es)** — required. Accept a single email or a comma-separated list for batch invites.
   Validate email format locally.

2. **Send invitation email?** — default yes.
   > Should Confidence send an invitation email? (yes/no, default: yes)

### Step 4: Send invitation

For each email address:

```bash
curl -s -w "\n%{http_code}" -X POST "https://iam.confidence.dev/v1/userInvitations" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userInvitation": {
      "invitedEmail": "<EMAIL>",
      "disableInvitationEmail": <true|false>
    }
  }'
```

**Success response:**
```json
{
  "name": "userInvitations/abc123",
  "invitedEmail": "user@example.com",
  "inviter": "Admin Name",
  "expirationTime": "2026-06-03T10:00:00Z",
  "invitationUri": "https://confidence.spotify.com/...",
  "invitationToken": "..."
}
```

For single invite, tell the user:
> Invitation sent to **user@example.com**!
> They'll receive an email with instructions to join.
> The invitation expires on <date>.

For batch invites, show a summary table:
```
Invitations sent:
  ✓ alice@example.com — expires Jun 3
  ✓ bob@example.com   — expires Jun 3
  ✗ charlie@invalid   — invalid email address
```

**Error handling:**

| HTTP Status | Meaning | User message |
|---|---|---|
| 400 | Invalid email | "That email address doesn't look right. Can you check it?" |
| 401 | Token expired | Re-authenticate (Step 1) |
| 403 | No permission | "You don't have permission to invite users. You need the admin role." |
| 409 | Already invited | "That user has already been invited." |

---

## Sub-command: create-client

Create an SDK client for flag resolution and generate its credentials. Uses REST APIs — no MCP needed.

### Step Tracker

```
───── Create Client ───────────────────────────────────────
  [1] Client name        ○ pending
  [2] Create client      ○ pending
  [3] Get credentials    ○ pending
────────────────────────────────────────────────────────────
```

### Step 1: Client name

Ask the user what to name the client. Suggest based on platform:

> What should we call this client? (e.g., "iOS App", "Web Frontend", "Backend Service")

### Step 2: Create client

Body is the client object directly (proto `body: "client"`):
```bash
curl -s -w "\n%{http_code}" -X POST "https://iam.${REGION}.confidence.dev/v1/clients" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"display_name": "<CLIENT_NAME>"}'
```

Response includes `name` (e.g., `clients/kqr3nc9dh70cwt5e2vws`). Save this for Step 3.

### Step 3: Get credentials

Body is the credential object directly (proto `body: "client_credential"`):
```bash
curl -s -w "\n%{http_code}" -X POST "https://iam.${REGION}.confidence.dev/v1/${CLIENT_NAME}/credentials" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"display_name": "Default Secret"}'
```

The `clientSecret.secret` is only returned once on creation — show it to the user.

```
═══════════════════════════════════════════════════════════════
  Client Created
═══════════════════════════════════════════════════════════════

  Name:    <CLIENT_NAME>
  Secret:  <CLIENT_SECRET>

  Use this secret in your SDK configuration to resolve flags.
  Keep it safe — you can regenerate it, but the old one will
  stop working.

  Next: Ask me for SDK integration instructions, or run
        /onboard-confidence setup-wizard

═══════════════════════════════════════════════════════════════
```

---

## Sub-command: setup-wizard

Guided walkthrough of the full onboarding checklist. Uses REST APIs — no MCP needed.

### Step Tracker

```
───── Setup Wizard ────────────────────────────────────────
  [1] Get started        ○ pending
  [2] Create client      ○ pending
  [3] Create flag        ○ pending
  [4] Add variants       ○ pending
  [5] Add targeting      ○ pending
  [6] Test resolve       ○ pending
  [7] Done               ○ pending
────────────────────────────────────────────────────────────
```

### Step 1: Get started

If the user already answered "create account" vs "sign in" (e.g., from the default onboarding flow), use that answer — do NOT re-ask.

Otherwise (when entered directly via `/onboard-confidence setup-wizard`), ask:

> Do you already have a Confidence account, or would you like to create one?
> 1. **Create a new account** — I'll walk you through signup
> 2. **Sign in to an existing account** — I already have one

**If "Create a new account":**
Run the full `create-account` sub-command flow (Steps 1–6 from that section). This handles signup, workspace creation, and re-auth with an org-scoped token. Once complete, proceed to Step 2 of setup-wizard with the token and region already set.

**If "Sign in to existing account":**
Check if a token is already available from a prior command in this session. If not, run the bundled auth script with the **regular client ID** (`2fG3H4RhlAbIZm9Rfn32zTaILH7w1X4w`). Validate the token, extract the region, and proceed to Step 2.

Determine the region from the token — this sets the API base URLs:
- EU: `flags.eu.confidence.dev`, `resolver.eu.confidence.dev`, `iam.eu.confidence.dev`
- US: `flags.us.confidence.dev`, `resolver.us.confidence.dev`, `iam.us.confidence.dev`

### Step 2: Create client

Check if the user already has a client:
```bash
curl -s "https://iam.${REGION}.confidence.dev/v1/clients" \
  -H "Authorization: Bearer $TOKEN"
```

If clients exist, ask which one to use. If none, run the `create-client` flow (REST).

Save the client `name` (e.g., `clients/abc123`) and the `clientSecret` for resolve in Step 6. If using an existing client, fetch its credentials:
```bash
curl -s "https://iam.${REGION}.confidence.dev/v1/${CLIENT_NAME}/credentials" \
  -H "Authorization: Bearer $TOKEN"
```

### Step 3: Create flag

EDUCATE then ASK:
> A feature flag controls a piece of functionality. Let's create your first one.
> What should it be called? (e.g., "new-checkout-flow", "dark-mode")

Validate: 4-63 chars, `[a-z0-9-]`.

`flag_id` is a **query parameter**, body is the flag object (proto `body: "flag"`):
```bash
curl -s -w "\n%{http_code}" -X POST "https://flags.${REGION}.confidence.dev/v1/flags?flag_id=<FLAG_NAME>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Do NOT attach flag to client yet** — the schema update in Step 4 clears the client list. Attach after variants are added.

### Step 4: Add variants

EDUCATE:
> Variants are the different values a flag can have. For a simple on/off flag, you'd have "on" and "off" variants.

Ask the user:
> What variants should this flag have?
> 1. Simple on/off (boolean)
> 2. Custom variants (I'll name them)

**IMPORTANT: Set the flag schema BEFORE adding variants with values.** Variant values must match the schema.

For on/off, first set schema:
```bash
curl -s -X PATCH "https://flags.${REGION}.confidence.dev/v1/flags/<FLAG_NAME>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"schema": {"schema": {"enabled": {"boolSchema": {}}}}}'
```

For custom variants, infer the schema from the value types the user describes and set it first.

Then create each variant (body is the variant object directly, proto `body: "variant"`):
```bash
curl -s -w "\n%{http_code}" -X POST "https://flags.${REGION}.confidence.dev/v1/flags/<FLAG_NAME>/variants" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "flags/<FLAG_NAME>/variants/<VARIANT_NAME>", "value": {<VALUE>}}'
```

For on/off: create "on" with `{"enabled": true}` and "off" with `{"enabled": false}`.

**After all variants are created**, attach the flag to the client:
```bash
curl -s -X POST "https://flags.${REGION}.confidence.dev/v1/flags/<FLAG_NAME>:addFlagClient" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"client": "<CLIENT_NAME>", "flag": "flags/<FLAG_NAME>"}'
```

### Step 5: Add targeting

EDUCATE:
> Targeting rules control who sees which variant. Let's set a default — you can add more rules later.

Ask:
> Which variant should be the default?

**First, create a catch-all segment** (if one doesn't exist) and allocate it to 100%:
```bash
curl -s -X POST "https://flags.${REGION}.confidence.dev/v1/segments?segment_id=everyone" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"display_name": "Everyone"}'

curl -s -X PATCH "https://flags.${REGION}.confidence.dev/v1/segments/everyone" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"allocation": {"proportion": {"value": "1"}}}'

curl -s -X POST "https://flags.${REGION}.confidence.dev/v1/segments/everyone:allocate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**IMPORTANT:** Segment proportion must be > 0 and `:allocate` must be called, otherwise resolve returns empty.

Then create a rule referencing the segment (body is rule object, proto `body: "rule"`):
```bash
curl -s -w "\n%{http_code}" -X POST "https://flags.${REGION}.confidence.dev/v1/flags/<FLAG_NAME>/rules" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "segment": "segments/everyone",
    "assignment_spec": {
      "bucket_count": 100,
      "assignments": [{
        "assignment_id": "<VARIANT_NAME>",
        "variant": {"variant": "flags/<FLAG_NAME>/variants/<VARIANT_NAME>"},
        "bucket_ranges": [{"lower": 0, "upper": 100}]
      }]
    },
    "targeting_key_selector": "targeting_key",
    "enabled": true
  }'
```

### Step 6: Test resolve

EDUCATE:
> Let's verify the flag works by resolving it.

Use the **resolver API** with the client secret (not Bearer token):
```bash
curl -s -w "\n%{http_code}" -X POST "https://resolver.${REGION}.confidence.dev/v1/flags:resolve" \
  -H "Content-Type: application/json" \
  -d '{
    "flags": ["flags/<FLAG_NAME>"],
    "evaluationContext": {
      "targeting_key": "test-user-1"
    },
    "clientSecret": "<CLIENT_SECRET>",
    "apply": true
  }'
```

Parse the response and show in plain English:
> Flag **<FLAG_NAME>** resolved to variant **<VARIANT>** — it works!

If resolve fails, check that the flag is attached to the client and has at least one enabled rule.

### Step 7: Done

```
═══════════════════════════════════════════════════════════════
  Setup Complete!
═══════════════════════════════════════════════════════════════

  Client:   <CLIENT_NAME>
  Secret:   <CLIENT_SECRET>
  Flag:     <FLAG_NAME>
  Variants: <VARIANT_LIST>
  Default:  <DEFAULT_VARIANT>

  Your flag is live and resolving. Next steps:
  • Invite team members:     /onboard-confidence invite-user
  • Set up data warehouse:   /onboard-confidence setup-warehouse
  • Integrate the SDK:       Ask me for setup instructions
  • Create more flags:       Ask me or use the Confidence UI
  • Learn experimentation:   /onboard-confidence learn

═══════════════════════════════════════════════════════════════
```

---

## Sub-command: setup-warehouse

This command has been split into dedicated skills for each warehouse type. When the user asks to set up a warehouse, use `/onboard-confidence:setup-warehouse` which will guide them to the right one:
- `/onboard-confidence:setup-warehouse-bigquery`
- `/onboard-confidence:setup-warehouse-snowflake`
- `/onboard-confidence:setup-warehouse-databricks`
- `/onboard-confidence:setup-warehouse-redshift`

---

## Sub-command: learn

Interactive learning about experimentation concepts. The skill teaches, asks questions, and the user answers — like a guided course.

### Topics

| Topic | Category | What it covers |
|-------|----------|----------------|
| Statistics | STATS | Statistical significance, p-values, confidence intervals, sample size |
| Experiment Design | DESIGN | Hypothesis formation, control/treatment, randomization, bias |
| Feature Flags | FLAGS | Flag types, targeting rules, rollouts, kill switches |
| Metrics | METRICS | Metric types, guardrails, primary/secondary metrics, SRM |
| Coordination | COORDINATION | Mutual exclusion, layered experiments, interaction effects |

### Flow

1. **Pick a topic:**
   > What would you like to learn about?
   > 1. Statistics fundamentals
   > 2. Experiment design
   > 3. Feature flags
   > 4. Metrics
   > 5. Coordination

2. **Fetch content** — use `mcp__confidence-docs__searchDocumentation` to get relevant Confidence documentation for the chosen topic.

3. **Teach** — present a concept from the docs in 2-3 clear paragraphs. Use examples relevant to the user's product.

4. **Ask a question** — pose a comprehension question with multiple-choice answers:
   > **Question:** When running an A/B test, why is it important to determine sample size before starting?
   > 1. To make the test run faster
   > 2. To ensure you have enough statistical power to detect the expected effect
   > 3. To reduce server costs
   > 4. It's not important — you can stop whenever

5. **Evaluate the answer** — if correct, explain why. If wrong, explain the right answer and the reasoning.

6. **Track progress** — call the Learning API to record the user's answer:
   ```bash
   curl -s -X POST "https://onboarding.confidence.dev/v1/learningProgress:answerQuestions" \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "course": "courses/<CATEGORY>",
       "questionUpdates": [{
         "lessonIndex": <LESSON>,
         "questionIndex": <QUESTION>,
         "currentAnswerIndex": <USER_ANSWER>
       }]
     }'
   ```

7. **Continue or finish** — after each question, ask if they want to continue or switch topics.

8. **Show progress** — at any time, fetch and display progress:
   ```bash
   curl -s "https://onboarding.confidence.dev/v1/learningProgress" \
     -H "Authorization: Bearer $TOKEN"
   ```

   ```
   ───── Learning Progress ────────────────────────────────────
     Statistics:     ██████░░░░ 3/5 lessons
     Design:         ████████░░ 4/5 lessons
     Feature Flags:  ██████████ 5/5 complete!
     Metrics:        ░░░░░░░░░░ not started
     Coordination:   ░░░░░░░░░░ not started
   ────────────────────────────────────────────────────────────
   ```

### Key principles

- **Be conversational** — this is a dialogue, not a textbook
- **Use real examples** — tie concepts to the user's product/domain when possible
- **Encourage exploration** — if the user asks follow-up questions, answer them before moving on
- **Track everything** — every answer gets recorded via the Learning API so progress persists across sessions

---

## Sub-command: status

This is a lightweight command. Try MCP first (no REST auth needed if MCP is connected).

**If MCP is connected:**

1. Call `mcp__confidence-flags__getIdentityInfo` (no args)
2. Call `mcp__confidence-flags__listClients`
3. Display:

```
═══════════════════════════════════════════════════════════════
  Confidence Account Status
═══════════════════════════════════════════════════════════════

  Identity:  <displayName> (<email>)
  Account:   <accountName>
  Clients:   <list of clients>

  MCP Status:
    confidence-flags: ● connected
    confidence-docs:  ● connected

═══════════════════════════════════════════════════════════════
```

**If MCP is NOT connected:**

1. Check if a token is available from a prior command in this session
2. If yes, call `GET https://iam.confidence.dev/v1/currentUser` and display the result
3. If no token, tell the user:
   > No active session. Run `/onboard-confidence create-account` to get started, or `/mcp` to authenticate Confidence tools.

---

## API Reference (agent-internal — do NOT show to user)

### Base URLs

All APIs except onboarding and Auth0 require **region-specific URLs**. Extract region from the JWT token claim `https://confidence.dev/region` (value: `EU` or `US`), lowercase it, and use as prefix.

```
AUTH0_DOMAIN:    auth.confidence.dev
ONBOARDING_API:  https://onboarding.confidence.dev/v1          (no region prefix)
IAM_API:         https://iam.${region}.confidence.dev/v1       (e.g., iam.eu.confidence.dev)
FLAGS_API:       https://flags.${region}.confidence.dev/v1
RESOLVER_API:    https://resolver.${region}.confidence.dev/v1
EVENTS_API:      https://events.${region}.confidence.dev/v1
CONNECTORS_API:  https://connectors.${region}.confidence.dev/v1
METRICS_API:     https://metrics.${region}.confidence.dev/v1
```

### Endpoints

**Check login ID availability (no auth):**
```
GET ${ONBOARDING_API}/loginIdAvailability:check?login_id={id}
→ { "available": bool }
```

**Check region availability (no auth):**
```
GET ${ONBOARDING_API}/country:validate
→ { "allowed": bool }
```

**Create account (Bearer token):**
```
POST ${ONBOARDING_API}/accounts
Body: {
  "account": {
    "displayName": string,
    "loginId": string,
    "region": "REGION_EU" | "REGION_US",
    "authConnections": [ {"googleAuthConnection":{}} | {"passwordAuthConnection":{}} ],
    "adminEmail": string (must be work email — free providers rejected),
    "allowedLoginEmailDomains": [string] (optional)
  },
  "marketingOptIn": bool (optional),
  "userRole": string (optional),
  "userGoals": [string] (optional)
}
→ { "name": string, "externalId": string, "loginId": string, "displayName": string }
```

**Create user invitation (Bearer token + admin permission):**
```
POST ${IAM_API}/userInvitations
Body: {
  "userInvitation": {
    "invitedEmail": string,
    "ttl": { "seconds": int } (optional, default 7 days),
    "disableInvitationEmail": bool (optional, default false),
    "labels": { string: string } (optional)
  }
}
→ {
  "name": string,
  "invitedEmail": string,
  "inviter": string,
  "expirationTime": string,
  "invitationUri": string,
  "invitationToken": string
}
```

**List user invitations (Bearer token):**
```
GET ${IAM_API}/userInvitations
→ { "userInvitations": [...], "nextPageToken": string }
```

**Get current user (Bearer token):**
```
GET ${IAM_API}/currentUser
→ {
  "user": { "name", "fullName", "email", ... },
  "accountMemberships": [{ "account", "displayName", "loginId", "region" }],
  "account": string,
  "identity": { "name", "displayName", ... }
}
```

**Create client (Bearer token, body: "client"):**
```
POST ${IAM_API}/clients
Body (direct client object): { "display_name": string }
→ { "name": "clients/...", "displayName": string, ... }
```

**Create client credential (Bearer token, body: "client_credential"):**
```
POST ${IAM_API}/${clientName}/credentials
Body (direct credential object): { "display_name": string }
→ { "name": "clients/.../clientCredentials/...", "clientSecret": { "secret": string }, ... }
  NOTE: secret only returned once on creation
```

**List clients (Bearer token):**
```
GET ${IAM_API}/clients
→ { "clients": [...], "nextPageToken": string }
```

**Create flag (Bearer token, body: "flag", flag_id is query param):**
```
POST ${FLAGS_API}/flags?flag_id=<id>
Body (direct flag object): {}
  flag_id: 4-63 chars, [a-z0-9-]
→ Flag object
```

**Update flag schema (Bearer token, body: "flag"):**
```
PATCH ${FLAGS_API}/flags/<id>
Body: { "schema": { "schema": { "<field>": { "boolSchema": {} | "stringSchema": {} | "intSchema": {} | "doubleSchema": {} } } } }
→ Flag object
  NOTE: schema MUST be set before adding variants with values
```

**Add flag to client (Bearer token, body: "*"):**
```
POST ${FLAGS_API}/flags/<id>:addFlagClient
Body: { "client": "clients/<id>", "flag": "flags/<id>" }
→ Flag object
```

**Create variant (Bearer token, body: "variant"):**
```
POST ${FLAGS_API}/flags/<id>/variants
Body (direct variant object): { "name": "flags/<id>/variants/<name>", "value": { ... } }
→ Variant object
  NOTE: value fields must match the flag schema
```

**Create rule (Bearer token, body: "rule"):**
```
POST ${FLAGS_API}/flags/<id>/rules
Body (direct rule object): { "assignment_spec": { ... }, "targeting_key_selector": "targeting_key", "enabled": true }
→ Rule object
```

**Resolve flags (client secret — NOT Bearer token):**
```
POST ${RESOLVER_API}/flags:resolve
Body: {
  "flags": ["flags/<id>"],
  "evaluationContext": { "targeting_key": string, ... },
  "clientSecret": string,
  "apply": bool
}
→ { "resolvedFlags": [{ "flag": string, "variant": string, "value": {...}, "reason": string }] }
```

**List event definitions (Bearer token):**
```
GET https://events.${region}.confidence.dev/v1/eventDefinitions
→ { "eventDefinitions": [...], "nextPageToken": string }
```

**Create event definition (Bearer token):**
```
POST https://events.${region}.confidence.dev/v1/eventDefinitions?event_definition_id=<id>
Body (direct object): { "schema": { "<field>": { "stringSchema": {} | "intSchema": {} | "doubleSchema": {} | "boolSchema": {} } } }
→ EventDefinition object
```

**Update event definition schema (Bearer token):**
```
PATCH https://events.${region}.confidence.dev/v1/eventDefinitions/<id>
Body: { "schema": { "<field>": { "stringSchema": {} } } }
→ EventDefinition object
  NOTE: schema fields determine which payload fields appear as columns in warehouse
```

**Publish events (client secret — NOT Bearer token):**
```
POST https://events.${region}.confidence.dev/v1/events:publish
Body: {
  "client_secret": string,
  "events": [{ "event_definition": "eventDefinitions/<id>", "payload": {...}, "event_time": "ISO8601" }],
  "send_time": "ISO8601"
}
→ { "errors": [{ "index": int, "reason": string, "message": string }] }
  Empty errors array = success
```

**Create data warehouse (Bearer token):**
```
POST ${METRICS_API}/dataWarehouses
Body: { "dataWarehouse": { "config": { "<type>Config": {...} } } }
→ DataWarehouse object
```

**Validate warehouse config (Bearer token):**
```
POST ${METRICS_API}/dataWarehouseConfig:validate
Body: { "<type>Config": {...} }
→ { "validation": [...], "successful": bool, "configurationResponse": {...} }
```

**Check warehouse exists (Bearer token):**
```
GET ${METRICS_API}/dataWarehouses:exists
→ { "exists": bool }
```

**Create flag applied connection (Bearer token):**
```
POST ${CONNECTORS_API}/flagAppliedConnections
Body: { "flagAppliedConnection": { "<type>": { "<type>Config": {...}, "table": "..." } } }
→ FlagAppliedConnection object
```

**Create event connection (Bearer token):**
```
POST ${CONNECTORS_API}/eventConnections
Body: { "eventConnection": { "<type>": { "<type>Config": {...}, "tablePrefix": "..." } } }
→ EventConnection object
```

**Create assignment table (Bearer token):**
```
POST ${METRICS_API}/assignmentTables
Body: { "assignmentTable": { "displayName": str, "sql": str, "entityColumn": {...}, "timestampColumn": {...}, "exposureKeyColumn": {...}, "variantKeyColumn": {...}, "dataDeliveredUntilUpdateStrategyConfig": {...} } }
→ AssignmentTable object
```

**Get learning progress (Bearer token):**
```
GET https://onboarding.confidence.dev/v1/learningProgress
→ { "courseProgresses": [...], "completedCourses": int }
```

**Answer questions (Bearer token):**
```
POST https://onboarding.confidence.dev/v1/learningProgress:answerQuestions
Body: { "course": "courses/<category>", "questionUpdates": [{ "lessonIndex": int, "questionIndex": int, "currentAnswerIndex": int }] }
→ LearningProgress object
```

### Validation Rules

| Field | Rule | Regex |
|-------|------|-------|
| `loginId` | 3-21 chars, lowercase, digits, hyphens. Starts with letter, ends with letter/digit | `^[a-z][a-z0-9-]{1,19}[a-z0-9]$` |
| `displayName` | 3-32 chars, letters, digits, Unicode letters, spaces, hyphens. Starts/ends with word char/digit/letter | `[\w\d\p{L}][\w\s\d\-\p{L}]{1,30}[\w\d\p{L}]` |
| `region` | Exactly `REGION_EU` or `REGION_US` | — |
| `authConnections` | At least one required | — |
| `adminEmail` | Must be a work email. Free providers (Gmail, Yahoo, Hotmail, etc.) are rejected | — |

---

## Error Handling Reference (agent-internal)

### Common HTTP errors

| Status | Meaning | Recovery |
|--------|---------|----------|
| 400 | Validation error | Parse `.message`, show plain English, re-collect invalid field |
| 401 | Invalid/expired token | Re-trigger Auth0 login |
| 403 | Insufficient permissions | Explain needed role/permission |
| 404 | Resource not found | Check account/resource exists |
| 409 | Conflict (already exists) | Name taken or user already invited |
| 429 | Rate limited | Wait briefly and retry |
| 500+ | Server error | Inform user, suggest retry |

### Sandbox note

All `curl`, `open`, and `python3` commands that access external hosts (`auth.confidence.dev`, `onboarding.confidence.dev`, `iam.confidence.dev`) require `dangerouslyDisableSandbox: true`. The auth script additionally requires `timeout: 130000` (server timeout is 120s). On first occurrence, briefly explain to the user that network access outside the sandbox is needed for API calls.

---

## Required MCP Tools (optional — only for `status` and `learn`)

Most sub-commands use REST APIs and do NOT require MCP. MCP is only used as a convenience:

| Tool | Used by | Purpose |
|------|---------|---------|
| `mcp__confidence-flags__getIdentityInfo` | `status` | Get current identity (convenience) |
| `mcp__confidence-flags__listClients` | `status` | List available clients (convenience) |
| `mcp__confidence-docs__searchDocumentation` | `learn` | Fetch educational content |

**All other sub-commands (`create-account`, `invite-user`, `create-client`, `setup-wizard`, `setup-warehouse`) work entirely via REST APIs with the session auth token.**

---

## Known Limitations

- **MCP auth cannot be triggered programmatically** — user must run `/mcp` to authenticate MCP servers. The Auth0 browser session from the login step makes this instant (no second login).
- **Port 8084 must be free** — the Auth0 callback server uses a fixed port. The auth script auto-kills any existing process on port 8084.
- **Auth0 Allowed Callback URLs** — both Auth0 clients must have `http://localhost:8084/callback` in their Allowed Callback URLs, Allowed Logout URLs, and Allowed Web Origins.
- **Auth script is bundled** — `auth.py` ships with the plugin in the skill directory. Never write auth scripts to disk; always use the bundled script.
- **Learning API** — REST-only (gRPC on epx-onboarding). Course content is generated by the skill using docs MCP; the API only tracks progress indices.
- **`learn` sub-command** — uses docs MCP for content. If MCP not connected, the skill can still teach using its own knowledge but won't have the latest docs.
- **Region-specific API URLs** — flags/resolver APIs use region prefixes (`flags.eu.confidence.dev` vs `flags.us.confidence.dev`). Determine region from the JWT token or from the account creation step.
