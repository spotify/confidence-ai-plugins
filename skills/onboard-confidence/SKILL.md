---
description: Create Confidence accounts and onboard users. Use when the user asks to create an account, invite users, onboard to Confidence, or check account status.
---

# Confidence Onboarding

Create accounts, invite users, and get started with Confidence — all from the CLI.

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

Write the following to `$TMPDIR/confidence_auth.py`, substituting CLIENT_ID and optional ORGANIZATION parameter. Run with `python3 $TMPDIR/confidence_auth.py`. Outputs `TOKEN:<jwt>` on success.

```python
import http.server, urllib.parse, json, sys, subprocess, hashlib, base64, secrets, string

code_verifier = ''.join(secrets.choice(string.ascii_letters + string.digits + '-._~') for _ in range(43))
code_challenge = base64.urlsafe_b64encode(hashlib.sha256(code_verifier.encode()).digest()).rstrip(b'=').decode()

port = 8084  # Fixed — must match Auth0 Allowed Callback URLs
CLIENT_ID = '<CLIENT_ID>'
ORGANIZATION = '<ORG_ID_OR_EMPTY>'  # Set after account creation, empty for signup
REDIRECT_URI = f'http://localhost:{port}/callback'
auth_code = None
error = None

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        global auth_code, error
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.end_headers()
        if 'code' in q:
            auth_code = q['code'][0]
            self.wfile.write(b'<h1>Login successful!</h1><p>You can close this tab.</p>')
        else:
            error = q.get('error', ['unknown'])[0]
            self.wfile.write(b'<h1>Login failed</h1><p>Please try again.</p>')
    def log_message(self, format, *args):
        pass

params = {
    'client_id': CLIENT_ID,
    'redirect_uri': REDIRECT_URI,
    'response_type': 'code',
    'scope': 'openid profile email offline_access',
    'audience': 'https://confidence.dev/',
    'code_challenge': code_challenge,
    'code_challenge_method': 'S256',
}
if ORGANIZATION:
    params['organization'] = ORGANIZATION
else:
    params['screen_hint'] = 'signup'
    params['prompt'] = 'login'

authorize_url = 'https://auth.confidence.dev/authorize?' + urllib.parse.urlencode(params)
subprocess.Popen(['open', authorize_url])
print('WAITING_FOR_LOGIN', flush=True)

server = http.server.HTTPServer(('127.0.0.1', port), Handler)
server.timeout = 120
while auth_code is None and error is None:
    server.handle_request()
server.server_close()

if error:
    print(f'AUTH_ERROR:{error}', flush=True)
    sys.exit(1)

import urllib.request
token_data = json.dumps({
    'grant_type': 'authorization_code',
    'client_id': CLIENT_ID,
    'code': auth_code,
    'redirect_uri': REDIRECT_URI,
    'code_verifier': code_verifier
}).encode()
req = urllib.request.Request(
    'https://auth.confidence.dev/oauth/token',
    data=token_data,
    headers={'Content-Type': 'application/json'}
)
try:
    with urllib.request.urlopen(req) as resp:
        token_response = json.loads(resp.read())
    print(f'TOKEN:{token_response["access_token"]}', flush=True)
except Exception as e:
    print(f'TOKEN_ERROR:{e}', flush=True)
    sys.exit(1)
```

**Key details:**
- Port is fixed at **8084** (must match Auth0 Allowed Callback URLs)
- For signup (`create-account`): no `organization`, add `screen_hint=signup` + `prompt=login`
- For existing account (all other commands): include `organization=<org_id>` — auto-completes if browser session exists
- After `create-account`, automatically re-auth with `organization` param to get org-scoped token (browser auto-redirects, no interaction)
- If port 8084 is busy: `lsof -ti:8084 | xargs kill -9 2>/dev/null`
- All network commands require `dangerouslyDisableSandbox: true`

### Session-only token management

The token is kept in the current session only and is never saved to disk. If the session ends or the token expires, the skill will open your browser to log in again.

**On every sub-command start**, check if the `TOKEN` variable is set and not expired:

```bash
if [ -n "$TOKEN" ]; then
  PAYLOAD=$(echo "$TOKEN" | cut -d. -f2)
  EXP=$(echo "$PAYLOAD" | python3 -c "
import sys, json, base64
p = sys.stdin.read().strip()
p += '=' * (4 - len(p) % 4) if len(p) % 4 else ''
d = json.loads(base64.b64decode(p))
print(d.get('exp', 0))
")
  NOW=$(date +%s)
  if [ "$EXP" -gt "$NOW" ]; then
    echo "VALID"  # Token still good — skip login
  else
    echo "EXPIRED"  # Token expired — re-authenticate
    unset TOKEN
  fi
fi
```

If `TOKEN` is unset or expired, run the browser auth flow to get a new token. Store the result in the `TOKEN` shell variable only. **NEVER write the token to disk. NEVER reference `~/.confidence/`.**

**Extract region from token** to determine API base URLs:

```bash
PAYLOAD=$(echo "$TOKEN" | cut -d. -f2)
REGION=$(echo "$PAYLOAD" | python3 -c "
import sys, json, base64
p = sys.stdin.read().strip()
p += '=' * (4 - len(p) % 4) if len(p) % 4 else ''
d = json.loads(base64.b64decode(p))
print(d.get('https://confidence.dev/region', 'EU'))
")
```

Then use `${REGION,,}` (lowercase) for URL prefix: `iam.eu.confidence.dev`, `flags.eu.confidence.dev`, etc.

If the token is valid, skip the login step entirely. If expired or missing, run the auth flow.

### Important: gRPC-REST transcoding rules

The Confidence APIs use gRPC with REST transcoding. The `body` field in the proto HTTP binding determines the JSON structure:

- **`body: "client"`** → send the client object directly: `{"display_name": "iOS App"}`
- **`body: "flag"`** → send the flag object directly: `{}`
- **`body: "*"`** → send the full request message: `{"account": {...}, "billingDetails": {...}}`

Fields NOT in the body (like `flag_id`, `parent`) become **query parameters**.

**Field names are `snake_case`** in requests. Responses may use `camelCase`.

### Common notes

- All network commands require `dangerouslyDisableSandbox: true`
- Never show the token value to the user
- Always use region-specific URLs (e.g., `iam.eu.confidence.dev` not `iam.confidence.dev`)

---

## User-Facing Communication Rules

**NEVER expose internal technical details to the user.**

- Do NOT show raw JSON request/response bodies in conversation
- Do NOT show Auth0 configuration details, token values, or OAuth internals
- DO show human-readable status updates: "Opening browser for login...", "Creating your workspace...", "Invitation sent!"
- DO describe results in plain English
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

Write the auth script to `$TMPDIR/confidence_auth.py` with the **signup client ID** (`82qMvwZvqd3t3S0gRDvs8R53TehQXSJY`). Run it and parse the TOKEN from stdout.

Tell the user:
> Opening your browser to log in. Sign up with Google or create an account with email and password.

If login fails, show the error in plain English and offer to retry.

### Step 2: Workspace name

EDUCATE then ASK:

> Your workspace name is the unique identifier for your Confidence account.
> It appears in URLs and is used to log in.
>
> **Rules:** 3-21 characters, lowercase letters, digits, and hyphens. Must start with a letter and end with a letter or digit.

Wait for user input. Then:

1. **Validate locally** against regex `^[a-z][a-z0-9-]{1,19}[a-z0-9]$`
2. **Check availability:**
```bash
curl -s "https://onboarding.confidence.dev/v1/loginIdAvailability:check?login_id=${LOGIN_ID}"
```
Response: `{ "available": true/false, "message": "..." }`

If taken, inform the user and suggest alternatives (append numbers, abbreviations). Re-ask.

### Step 3: Account details

Collect interactively, one field at a time:

1. **Display name** — the human-readable name for the workspace (company name).
   Validate: 3-21 characters, starts with a letter, alphanumeric + spaces + hyphens.

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

5. **Allowed login email domains** — optional. Ask if they want to restrict login to a specific email domain (e.g., `@company.com`).

### Step 4: Create account

Build and send the request:

```bash
curl -s -w "\n%{http_code}" -X POST "https://onboarding.confidence.dev/v1/accounts" \
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
| 400 | Other validation error | Parse `.message`, show in plain English, re-collect the invalid field |
| 401 | Token expired/invalid | "Session expired. Let me log you in again." → re-run Step 1 |
| 409 | Name already taken | "That workspace name was just taken. Let's pick another." → re-run Step 2 |
| 500+ | Server error | "Something went wrong on our end. Let me try again in a moment." |

### Step 5: Get account-scoped token

The token from Step 1 has no `org_id` (it was issued before the account existed). Re-auth with the **regular client ID** and the `organization` parameter set to the `externalId` returned in Step 4.

Run the auth script again with:
- `CLIENT_ID = '2fG3H4RhlAbIZm9Rfn32zTaILH7w1X4w'` (regular client)
- `ORGANIZATION = '<externalId from Step 4>'`

This auto-completes in the browser — no login form, just a redirect. The new token will have `org_id`, `account_name`, and `region` claims.

Store this token in the `TOKEN` shell variable. This is the token used for all subsequent commands in this session. **Do NOT save to disk.**

Tell the user:
> Activating your account... (browser will briefly flash)

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
  • Invite team members:  /onboard-confidence invite-user
  • Create a feature flag: Ask me to create a flag, or use
    the Confidence UI
  • Integrate your app:   Ask me for SDK setup instructions

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

If not, write the auth script with the **regular client ID** (`2fG3H4RhlAbIZm9Rfn32zTaILH7w1X4w`) — this user already has an account.

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

### Prerequisites

Requires an authenticated token. If none available in the current session, run login flow first.

Determine the region from the token or ask the user — this sets the API base URLs:
- EU: `flags.eu.confidence.dev`, `resolver.eu.confidence.dev`, `iam.eu.confidence.dev`
- US: `flags.us.confidence.dev`, `resolver.us.confidence.dev`, `iam.us.confidence.dev`

### Step Tracker

```
───── Setup Wizard ────────────────────────────────────────
  [1] Create client      ○ pending
  [2] Create flag        ○ pending
  [3] Add variants       ○ pending
  [4] Add targeting      ○ pending
  [5] Test resolve       ○ pending
  [6] Done               ○ pending
────────────────────────────────────────────────────────────
```

### Step 1: Create client

Check if the user already has a client:
```bash
curl -s "https://iam.${REGION}.confidence.dev/v1/clients" \
  -H "Authorization: Bearer $TOKEN"
```

If clients exist, ask which one to use. If none, run the `create-client` flow (REST).

Save the client `name` (e.g., `clients/abc123`) and the `clientSecret` for resolve in Step 5. If using an existing client, fetch its credentials:
```bash
curl -s "https://iam.${REGION}.confidence.dev/v1/${CLIENT_NAME}/credentials" \
  -H "Authorization: Bearer $TOKEN"
```

### Step 2: Create flag

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

**Do NOT attach flag to client yet** — the schema update in Step 3 clears the client list. Attach after variants are added.

### Step 3: Add variants

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

### Step 4: Add targeting

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

### Step 5: Test resolve

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

### Step 6: Done

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
  • Integrate the SDK: Ask me for setup instructions
  • Create more flags: Ask me or use the Confidence UI
  • Set up experiments: /onboard-confidence learn

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
→ { "available": bool, "message": string }
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
| `displayName` | 3-21 chars, letters, digits, spaces, hyphens. Starts with letter, ends with letter/digit | `^[a-zA-Z][a-zA-Z0-9\s-]{1,19}[a-zA-Z0-9]$` |
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

All `curl`, `open`, and `python3` commands that access external hosts (`auth.confidence.dev`, `onboarding.confidence.dev`, `iam.confidence.dev`) require `dangerouslyDisableSandbox: true`. On first occurrence, briefly explain to the user that network access outside the sandbox is needed for API calls.

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
- **Port 8084 must be free** — the Auth0 callback server uses a fixed port. If busy, kill the process first.
- **Auth0 Allowed Callback URLs** — both Auth0 clients must have `http://localhost:8084/callback` in their Allowed Callback URLs, Allowed Logout URLs, and Allowed Web Origins.
- **Learning API** — REST-only (gRPC on epx-onboarding). Course content is generated by the skill using docs MCP; the API only tracks progress indices.
- **`learn` sub-command** — uses docs MCP for content. If MCP not connected, the skill can still teach using its own knowledge but won't have the latest docs.
- **Region-specific API URLs** — flags/resolver APIs use region prefixes (`flags.eu.confidence.dev` vs `flags.us.confidence.dev`). Determine region from the JWT token or from the account creation step.
