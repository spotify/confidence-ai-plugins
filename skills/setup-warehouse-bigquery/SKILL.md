---
description: Set up BigQuery as a data warehouse for Confidence. Use when the user chose BigQuery for warehouse setup.
---

# Setup Warehouse: BigQuery

Configure BigQuery as the data warehouse for Confidence experimentation analytics. This skill handles the full end-to-end setup: collect GCP config, validate permissions, create the warehouse, set up connectors, create the assignment table, and verify the pipeline.

---

## Authentication

**Browser-based Auth0 login.** The skill opens a browser for Auth0 login (Google, email/password, SSO) and captures the token automatically. The user never touches a token.

### Session-only token management

The token is kept in the current session only and is never saved to disk. If the session ends or the token expires, the skill will open your browser to log in again.

On every sub-command start, check if the `TOKEN` variable is set and not expired:

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
    echo "VALID"
  else
    echo "EXPIRED"
    unset TOKEN
  fi
fi
```

If `TOKEN` is unset or expired, run the Auth0 login flow with the **regular client ID** (`2fG3H4RhlAbIZm9Rfn32zTaILH7w1X4w`) and the user's `organization` parameter. Store the result in the `TOKEN` shell variable only. **NEVER write the token to disk. NEVER reference `~/.confidence/`.**

### Auth script

Write the following to `$TMPDIR/confidence_auth.py` with CLIENT_ID=`2fG3H4RhlAbIZm9Rfn32zTaILH7w1X4w` and ORGANIZATION from the token. Run with `python3 $TMPDIR/confidence_auth.py`. Outputs `TOKEN:<jwt>` on success.

```python
import http.server, urllib.parse, json, sys, subprocess, hashlib, base64, secrets, string

code_verifier = ''.join(secrets.choice(string.ascii_letters + string.digits + '-._~') for _ in range(43))
code_challenge = base64.urlsafe_b64encode(hashlib.sha256(code_verifier.encode()).digest()).rstrip(b'=').decode()

port = 8084
CLIENT_ID = '<CLIENT_ID>'
ORGANIZATION = '<ORG_ID>'
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

### Extract region from token

```bash
REGION=$(echo "$PAYLOAD" | python3 -c "
import sys, json, base64
p = sys.stdin.read().strip()
p += '=' * (4 - len(p) % 4) if len(p) % 4 else ''
d = json.loads(base64.b64decode(p))
print(d.get('https://confidence.dev/region', 'EU'))
")
```

Then use `${REGION,,}` (lowercase) for URL prefix: `iam.eu.confidence.dev`, `metrics.eu.confidence.dev`, etc.

### Common notes

- Port is fixed at **8084** (must match Auth0 Allowed Callback URLs)
- If port 8084 is busy: `lsof -ti:8084 | xargs kill -9 2>/dev/null`
- All network commands require `dangerouslyDisableSandbox: true`
- Never show the token value to the user
- Always use region-specific URLs (e.g., `iam.eu.confidence.dev` not `iam.confidence.dev`)

### Important: gRPC-REST transcoding rules

The Confidence APIs use gRPC with REST transcoding. The `body` field in the proto HTTP binding determines the JSON structure:

- **`body: "data_warehouse"`** -> send the data warehouse object directly: `{"config": {...}}`
- **`body: "flag_applied_connection"`** -> send the connection object directly: `{"bigQuery": {...}}`
- **`body: "event_connection"`** -> send the connection object directly: `{"bigQuery": {...}}`
- **`body: "assignment_table"`** -> send the assignment table object directly: `{"displayName": "...", "sql": "...", ...}`
- **`body: "*"`** -> send the full request message

The body is the object directly, NOT wrapped in an outer key.

Fields NOT in the body (like `flag_id`, `parent`) become **query parameters**.

**Field names are `snake_case`** in requests. Responses may use `camelCase`.

---

## User-Facing Communication Rules

**NEVER expose internal technical details to the user.**

- Do NOT show raw JSON request/response bodies in conversation
- Do NOT show Auth0 configuration details, token values, or OAuth internals
- DO show human-readable status updates: "Opening browser for login...", "Creating your warehouse...", "Connectors configured!"
- DO describe results in plain English
- The agent handles all auth/API complexity silently

**Step Tracker:** Display a visual step tracker at every phase transition. Update and re-display it each time you move to a new step.

---

## Step Tracker

Display at START and after EACH step completes (updating status):

```
───── Setup Warehouse (BigQuery) ──────────────────────────
  [1] Choose warehouse     ● done
  [2] GCP project ID       ○ pending
  [3] Dataset name         ○ pending
  [4] Service account      ○ pending
  [5] Validate & fix       ○ pending
  [6] Create warehouse     ○ pending
  [7] Create connectors    ○ pending
  [8] Assignment table     ○ pending
  [9] Verify pipeline      ○ pending
  [10] Done                ○ pending
────────────────────────────────────────────────────────────
```

Use `●` for completed, `▶` for in-progress, `○` for pending. Re-display the full tracker after every step transition.

---

## Step 1: Choose warehouse (already done)

The user has already chosen BigQuery. Mark step 1 as done.

---

## Step 2: GCP Project ID

Guide the user:

> What's your GCP project ID? Go to **Google Cloud Console** (console.cloud.google.com). Your project ID is shown in the top bar next to "Google Cloud". It looks like `my-company-prod` or `project-12345`.

---

## Step 3: Dataset name

> A dataset is like a folder in BigQuery where Confidence stores its tables. The default is `confidence`.
> If you don't have one yet, I can create it for you via `bq mk`.

Default: `confidence`

---

## Step 4: Service account

> A service account is a robot account that Confidence uses to write data to your BigQuery dataset.
> Go to **Google Cloud Console -> IAM & Admin -> Service Accounts**. Create one (e.g., `confidence-connector@<project>.iam.gserviceaccount.com`) or pick an existing one.
> It needs **BigQuery Data Editor** and **BigQuery Job User** roles.

---

## Step 5: Validate & fix permissions

Run the validation endpoint:

```bash
curl -s -w "\n%{http_code}" -X POST "https://metrics.${REGION}.confidence.dev/v1/dataWarehouseConfig:validate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "bigQueryConfig": {
      "serviceAccount": "<SA_EMAIL>",
      "project": "<PROJECT_ID>",
      "dataset": "<DATASET>"
    }
  }'
```

**Response:**
```json
{
  "validation": [{ "key": "...", "description": "...", "success": true/false, "error": "..." }],
  "successful": true/false,
  "configurationResponse": { /* available schemas, etc. */ }
}
```

If `successful` is true, move to Step 6.

**If validation fails:**

**IMPORTANT: Never assume partial success from an ambiguous error.** If the API returns an error like "X does not exist or not authorized", report the exact error message. Do NOT split it into "connection works but X is missing". Show the user the exact error and let them determine the cause.

For each validation failure, show:
> Validation failed: `<exact error message from API>`

Then offer remediation:

> Some permissions need to be configured on your GCP project. I can fix this automatically if you have `gcloud` set up, or I can show you the exact commands to run yourself.
>
> 1. Fix it for me (requires gcloud CLI)
> 2. Show me the commands

### Fix it automatically (gcloud)

First check gcloud is available: `which gcloud`. If not found, fall back to option 2.

Extract the account ID from the token claim `https://confidence.dev/account_name` (e.g., `accounts/my-workspace` -> `my-workspace`). The Confidence SA is: `account-${ACCOUNT_ID}@spotify-confidence.iam.gserviceaccount.com`

For each failure, **confirm before each action:**

**"Unable to create access token" (SERVICE_ACCOUNT):**
> Confidence needs permission to access your service account. Can I grant that now?
```bash
CONFIDENCE_SA="account-${ACCOUNT_ID}@spotify-confidence.iam.gserviceaccount.com"
gcloud iam service-accounts add-iam-policy-binding ${CUSTOMER_SA} \
  --project=${PROJECT} \
  --member="serviceAccount:${CONFIDENCE_SA}" \
  --role="roles/iam.workloadIdentityUser" --quiet
gcloud iam service-accounts add-iam-policy-binding ${CUSTOMER_SA} \
  --project=${PROJECT} \
  --member="serviceAccount:${CONFIDENCE_SA}" \
  --role="roles/iam.serviceAccountTokenCreator" --quiet
```

**"Missing permission 'bigquery.jobs.create'" (PERMISSIONS):**
> Your service account needs BigQuery Job User permissions. Can I grant that?
```bash
gcloud projects add-iam-policy-binding ${PROJECT} \
  --member="serviceAccount:${CUSTOMER_SA}" \
  --role="roles/bigquery.jobUser" --quiet
```

**"Could not find dataset" or dataset errors (DATASET):**
> The BigQuery dataset needs to be created or permissions updated. Can I do that?
```bash
bq mk --project_id=${PROJECT} --dataset --location=${REGION} ${DATASET}
bq update --project_id=${PROJECT} --source /dev/stdin ${DATASET} << EOF
{"access": [
  {"role": "WRITER", "userByEmail": "${CUSTOMER_SA}"},
  {"role": "OWNER", "specialGroup": "projectOwners"},
  {"role": "WRITER", "specialGroup": "projectWriters"},
  {"role": "READER", "specialGroup": "projectReaders"}
]}
EOF
```

**"free tier" / "Streaming insert is not allowed":**
> BigQuery streaming requires billing enabled on your GCP project. Can I link a billing account?
```bash
gcloud billing accounts list
gcloud billing projects link ${PROJECT} --billing-account=${BILLING_ACCOUNT}
```
Note: billing propagation to BigQuery can take up to 15 minutes.

After fixing, re-validate. If still failing (e.g., IAM propagation), inform the user and offer to retry.

### Show commands (manual)

Show the exact gcloud/bq commands they need to run, with their specific values filled in:

```
Here's what needs to be configured on your GCP project:

# 1. Grant Confidence access to your service account
gcloud iam service-accounts add-iam-policy-binding \
  <SA_EMAIL> \
  --project=<PROJECT> \
  --member="serviceAccount:account-<ACCOUNT_ID>@spotify-confidence.iam.gserviceaccount.com" \
  --role="roles/iam.workloadIdentityUser"

gcloud iam service-accounts add-iam-policy-binding \
  <SA_EMAIL> \
  --project=<PROJECT> \
  --member="serviceAccount:account-<ACCOUNT_ID>@spotify-confidence.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"

# 2. Grant BigQuery Job User
gcloud projects add-iam-policy-binding <PROJECT> \
  --member="serviceAccount:<SA_EMAIL>" \
  --role="roles/bigquery.jobUser"

# 3. Enable billing (if not already)
gcloud billing projects link <PROJECT> --billing-account=<BILLING_ACCOUNT_ID>

Run these commands, then let me know and I'll retry validation.
```

If `configurationResponse` contains available options (schemas, roles), present these as choices to help the user.

---

## Step 6: Create warehouse

**IMPORTANT:** The body is the data warehouse object directly (gRPC transcoding `body: "data_warehouse"`), NOT wrapped in a `dataWarehouse` key.

```bash
curl -s -w "\n%{http_code}" -X POST "https://metrics.${REGION}.confidence.dev/v1/dataWarehouses" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "bigQueryConfig": {
        "serviceAccount": "<SA_EMAIL>",
        "project": "<PROJECT_ID>",
        "dataset": "<DATASET>"
      }
    }
  }'
```

Save the returned `name` (e.g., `dataWarehouses/...`) for reference.

---

## Step 7: Create connectors

Create both connectors:

### Flag Applied Connection (assignment data -> warehouse)

**IMPORTANT:** The body is the connection object directly (gRPC transcoding `body: "flag_applied_connection"`), NOT wrapped.

```bash
curl -s -w "\n%{http_code}" -X POST "https://connectors.${REGION}.confidence.dev/v1/flagAppliedConnections" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "bigQuery": {
      "bigQueryConfig": {
        "serviceAccount": "<SA_EMAIL>",
        "project": "<PROJECT_ID>",
        "dataset": "<DATASET>"
      },
      "table": "assignments"
    }
  }'
```

### Event Connection (events -> warehouse)

**IMPORTANT:** The body is the connection object directly (gRPC transcoding `body: "event_connection"`), NOT wrapped.

```bash
curl -s -w "\n%{http_code}" -X POST "https://connectors.${REGION}.confidence.dev/v1/eventConnections" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "bigQuery": {
      "bigQueryConfig": {
        "serviceAccount": "<SA_EMAIL>",
        "project": "<PROJECT_ID>",
        "dataset": "<DATASET>"
      },
      "tablePrefix": "events_"
    }
  }'
```

---

## Step 8: Assignment table

Create an assignment table so Confidence can analyze experiment assignments.

**IMPORTANT:** The body is the assignment table object directly (gRPC transcoding `body: "assignment_table"`), NOT wrapped in an `assignmentTable` key.

```bash
curl -s -w "\n%{http_code}" -X POST "https://metrics.${REGION}.confidence.dev/v1/assignmentTables" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "Assignments",
    "sql": "SELECT targeting_key, rule, assignment_id, assignment_time FROM `<PROJECT>.<DATASET>.assignments`",
    "entityColumn": { "name": "targeting_key" },
    "timestampColumn": { "name": "assignment_time" },
    "exposureKeyColumn": { "name": "rule" },
    "variantKeyColumn": { "name": "assignment_id" },
    "dataDeliveredUntilUpdateStrategyConfig": {
      "strategy": "AUTOMATIC",
      "automaticUpdateConfig": {
        "commitDelay": "300s"
      }
    }
  }'
```

---

## Step 9: Verify data pipeline

Verify both connectors by generating test data and checking it lands in the warehouse.

### 9a. Get a client secret for testing

The resolver and events APIs require a **client secret** (not a Bearer token).

1. **List the user's clients** and show them:
   ```bash
   curl -s "https://iam.${REGION}.confidence.dev/v1/clients" -H "Authorization: Bearer $TOKEN"
   ```
   Display each client with its name and last-seen time. If only one client exists, confirm it with the user. If multiple, let them pick.

2. **Ask the user** if they have a client secret or want a new one:
   > I'll use **<client name>** for the pipeline test. Do you have the client secret, or should I create a new credential?

3. If the user wants a new credential, create one on the chosen client:
   ```bash
   curl -s -X POST "https://iam.${REGION}.confidence.dev/v1/<CLIENT_NAME>/credentials" \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"display_name": "Pipeline Test"}'
   ```
   Save the secret to a temp file for pipeline use. **Never print the secret to the user's terminal.**

### 9b. Verify flag assignments

Resolve a flag to generate assignment data (use an existing flag + client secret):
```bash
curl -s -X POST "https://resolver.${REGION}.confidence.dev/v1/flags:resolve" \
  -H "Content-Type: application/json" \
  -d '{
    "flags": ["flags/<ANY_EXISTING_FLAG>"],
    "evaluation_context": {"targeting_key": "warehouse-verify-user"},
    "client_secret": "<CLIENT_SECRET>",
    "apply": true
  }'
```

If no flags exist yet, tell the user:
> No flags to test with. Run `/onboard-confidence setup-wizard` first to create a flag, then come back.

### 9c. Verify events

First check for an event definition to use:
```bash
curl -s "https://events.${REGION}.confidence.dev/v1/eventDefinitions" \
  -H "Authorization: Bearer $TOKEN"
```

If no event definitions exist, create one with a schema:
```bash
curl -s -X POST "https://events.${REGION}.confidence.dev/v1/eventDefinitions?event_definition_id=test-event" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"schema": {"action": {"stringSchema": {}}, "page": {"stringSchema": {}}}}'
```

If an event definition exists but has an empty schema, update it so payload data flows through:
```bash
curl -s -X PATCH "https://events.${REGION}.confidence.dev/v1/eventDefinitions/<NAME>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"schema": {"action": {"stringSchema": {}}, "page": {"stringSchema": {}}}}'
```

Then publish test events (uses client secret, NOT Bearer token):
```bash
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
curl -s -X POST "https://events.${REGION}.confidence.dev/v1/events:publish" \
  -H "Content-Type: application/json" \
  -d '{
    "client_secret": "<CLIENT_SECRET>",
    "events": [
      {
        "event_definition": "eventDefinitions/<EVENT_DEF>",
        "payload": {"action": "clicked_button", "page": "homepage"},
        "event_time": "'$NOW'"
      }
    ],
    "send_time": "'$NOW'"
  }'
```

Check response: `{"errors": []}` means success. If `EVENT_DEFINITION_NOT_FOUND`, the definition doesn't exist. If `EVENT_SCHEMA_VALIDATION_FAILED`, the payload doesn't match the schema.

### 9d. Check data in BigQuery

Ask the user: "Want me to check the data, or show you the queries?"

If user has `bq` CLI:
```bash
echo "=== ASSIGNMENTS ===" && \
bq query --project_id=${PROJECT} --use_legacy_sql=false \
  'SELECT targeting_key, rule, assignment_id, assignment_time
   FROM `${PROJECT}.${DATASET}.assignments`
   ORDER BY assignment_time DESC LIMIT 5' && \
echo "=== EVENTS ===" && \
bq query --project_id=${PROJECT} --use_legacy_sql=false \
  'SELECT * FROM `${PROJECT}.${DATASET}.events_*`
   ORDER BY _event_time DESC LIMIT 5'
```

If no `bq`, show queries for BigQuery console.

**Show results:**
```
  ● Assignments: <N> rows -- data flowing
    <targeting_key> -> <assignment_id> (<timestamp>)
  ● Events: <N> rows -- data flowing
    <action> on <page> (<timestamp>)
```

**If no rows after a few seconds**, tell the user:
> Data delivery can take up to a few minutes depending on your warehouse. Check again shortly, or verify in your BigQuery console.

---

## Step 10: Done

```
═══════════════════════════════════════════════════════════════
  Data Warehouse Connected & Verified
═══════════════════════════════════════════════════════════════

  Warehouse:    BigQuery (<project>)
  Dataset:      <DATASET>
  Connectors:
    ● Flag assignments -> assignments table (verified)
    ● Events -> events_* tables (running)
  Assignment:
    ● Assignment table configured (auto-updating)

  Flag assignment and event data is flowing to your
  warehouse. Experiment analysis is ready.

═══════════════════════════════════════════════════════════════
```

---

## API Reference (agent-internal -- do NOT show to user)

### Base URLs

All APIs require **region-specific URLs**. Extract region from the JWT token claim `https://confidence.dev/region` (value: `EU` or `US`), lowercase it, and use as prefix.

```
IAM_API:         https://iam.${region}.confidence.dev/v1
RESOLVER_API:    https://resolver.${region}.confidence.dev/v1
EVENTS_API:      https://events.${region}.confidence.dev/v1
CONNECTORS_API:  https://connectors.${region}.confidence.dev/v1
METRICS_API:     https://metrics.${region}.confidence.dev/v1
```

### Endpoints

**Validate warehouse config (Bearer token):**
```
POST ${METRICS_API}/dataWarehouseConfig:validate
Body: { "bigQueryConfig": {...} }
-> { "validation": [...], "successful": bool, "configurationResponse": {...} }
```

**Check warehouse exists (Bearer token):**
```
GET ${METRICS_API}/dataWarehouses:exists
-> { "exists": bool }
```

**Create data warehouse (Bearer token, body: "data_warehouse"):**
```
POST ${METRICS_API}/dataWarehouses
Body (direct object): { "config": { "bigQueryConfig": {...} } }
-> DataWarehouse object
```

**Create flag applied connection (Bearer token, body: "flag_applied_connection"):**
```
POST ${CONNECTORS_API}/flagAppliedConnections
Body (direct object): { "bigQuery": { "bigQueryConfig": {...}, "table": "assignments" } }
-> FlagAppliedConnection object
```

**Create event connection (Bearer token, body: "event_connection"):**
```
POST ${CONNECTORS_API}/eventConnections
Body (direct object): { "bigQuery": { "bigQueryConfig": {...}, "tablePrefix": "events_" } }
-> EventConnection object
```

**Create assignment table (Bearer token, body: "assignment_table"):**
```
POST ${METRICS_API}/assignmentTables
Body (direct object): { "displayName": str, "sql": str, "entityColumn": {...}, "timestampColumn": {...}, "exposureKeyColumn": {...}, "variantKeyColumn": {...}, "dataDeliveredUntilUpdateStrategyConfig": {...} }
-> AssignmentTable object
```

**List clients (Bearer token):**
```
GET ${IAM_API}/clients
-> { "clients": [...], "nextPageToken": string }
```

**Create client credential (Bearer token, body: "client_credential"):**
```
POST ${IAM_API}/${clientName}/credentials
Body (direct object): { "display_name": string }
-> { "name": "...", "clientSecret": { "secret": string }, ... }
  NOTE: secret only returned once on creation
```

**Resolve flags (client secret -- NOT Bearer token):**
```
POST ${RESOLVER_API}/flags:resolve
Body: { "flags": ["flags/<id>"], "evaluationContext": {...}, "clientSecret": string, "apply": bool }
-> { "resolvedFlags": [...] }
```

**Publish events (client secret -- NOT Bearer token):**
```
POST ${EVENTS_API}/events:publish
Body: { "client_secret": string, "events": [...], "send_time": "ISO8601" }
-> { "errors": [...] }
```

---

## Error Handling Reference (agent-internal)

### Common HTTP errors

| Status | Meaning | Recovery |
|--------|---------|----------|
| 400 | Validation error | Parse `.message`, show plain English, re-collect invalid field |
| 401 | Invalid/expired token | Re-trigger Auth0 login |
| 403 | Insufficient permissions | Explain needed role/permission |
| 404 | Resource not found | Check account/resource exists |
| 409 | Conflict (already exists) | Resource already created |
| 429 | Rate limited | Wait briefly and retry |
| 500+ | Server error | Inform user, suggest retry |

### Sandbox note

All `curl`, `open`, and `python3` commands that access external hosts (`auth.confidence.dev`, `metrics.confidence.dev`, `connectors.confidence.dev`, etc.) require `dangerouslyDisableSandbox: true`. On first occurrence, briefly explain to the user that network access outside the sandbox is needed for API calls.
