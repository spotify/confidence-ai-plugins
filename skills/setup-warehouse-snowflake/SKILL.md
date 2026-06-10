---
description: Set up Snowflake as a data warehouse for Confidence. Use when the user chose Snowflake for warehouse setup.
---

# Setup Warehouse: Snowflake

Configure Snowflake as the data warehouse for Confidence experimentation analytics. This skill handles the full end-to-end setup: collect Snowflake config, create a crypto key, register the key in Snowflake, validate, create the warehouse, set up connectors, create the assignment table, and verify the pipeline.

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
- **`body: "flag_applied_connection"`** -> send the connection object directly: `{"snowflake": {...}}`
- **`body: "event_connection"`** -> send the connection object directly: `{"snowflake": {...}}`
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
───── Setup Warehouse (Snowflake) ─────────────────────────
  [1] Choose warehouse     ● done
  [2] Account & user       ○ pending
  [3] Role & warehouse     ○ pending
  [4] Database & schema    ○ pending
  [5] Create crypto key    ○ pending
  [6] Register key in SF   ○ pending
  [7] Validate             ○ pending
  [8] Create warehouse     ○ pending
  [9] Create connectors    ○ pending
  [10] Assignment table    ○ pending
  [11] Verify pipeline     ○ pending
  [12] Done                ○ pending
────────────────────────────────────────────────────────────
```

Use `●` for completed, `▶` for in-progress, `○` for pending. Re-display the full tracker after every step transition.

---

## Step 1: Choose warehouse (already done)

The user has already chosen Snowflake. Mark step 1 as done.

---

## Step 2: Account & user

Ask the user for these fields (explain each briefly):

- **Account** -- Snowflake account identifier (e.g., `zlvpqre-wr49874`). This is the part before `.snowflakecomputing.com` in the Snowflake URL.
- **User** -- Snowflake user for Confidence to connect as.

---

## Step 3: Role & warehouse

- **Role** -- Snowflake role (default: `ACCOUNTADMIN`).
- **Warehouse** -- SQL warehouse for query execution (default: `COMPUTE_WH`).

---

## Step 4: Database & schema

- **Exposure database** -- database for exposure tables (default: `CONFIDENCE`).
- **Exposure schema** -- schema for exposure tables (default: `EXPOSURE`).

Also generate SQL for creating the database/schema if the user says they don't exist yet:
```sql
CREATE DATABASE IF NOT EXISTS <DATABASE>;
CREATE SCHEMA IF NOT EXISTS <DATABASE>.<SCHEMA>;
GRANT USAGE ON DATABASE <DATABASE> TO ROLE <ROLE>;
GRANT ALL ON SCHEMA <DATABASE>.<SCHEMA> TO ROLE <ROLE>;
```

---

## Step 5: Create crypto key

The user does NOT provide this. The skill creates it automatically via the IAM API:

```bash
curl -s -w "\n%{http_code}" -X POST "https://iam.${REGION}.confidence.dev/v1/cryptoKeys?crypto_key_id=snowflake-key" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"kind": "SNOWFLAKE"}'
```

If the key already exists (HTTP 409), fetch it instead:
```bash
curl -s "https://iam.${REGION}.confidence.dev/v1/cryptoKeys/snowflake-key" \
  -H "Authorization: Bearer $TOKEN"
```

Extract the `publicKey` from the response, strip PEM headers and newlines to get raw base64.

Save the crypto key name (e.g., `cryptoKeys/snowflake-key`) for use in the warehouse config.

---

## Step 6: Register key in Snowflake

Generate the Snowflake SQL to register the key, **copy it to clipboard**, and tell the user:

> I've created an authentication key for Snowflake. You need to register it with your Snowflake user.
> The SQL has been copied to your clipboard -- paste it in the Snowflake worksheet and run it.

The SQL should be:
```sql
ALTER USER <USER> SET RSA_PUBLIC_KEY='<PUBLIC_KEY_BASE64>';
```

**IMPORTANT:** Always ask the user if other Confidence accounts share this Snowflake user. If yes, use `RSA_PUBLIC_KEY_2` instead of `RSA_PUBLIC_KEY` to avoid breaking existing connections. Snowflake accepts auth from either key.

```bash
echo "ALTER USER <USER> SET RSA_PUBLIC_KEY='<PUBLIC_KEY_BASE64>';" | pbcopy
```

---

## Step 7: Validate

```bash
curl -s -w "\n%{http_code}" -X POST "https://metrics.${REGION}.confidence.dev/v1/dataWarehouseConfig:validate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "snowflakeConfig": {
      "account": "<ACCOUNT>",
      "user": "<USER>",
      "role": "<ROLE>",
      "warehouse": "<WAREHOUSE>",
      "database": "<DATABASE>",
      "schema": "<SCHEMA>",
      "cryptoKey": "<CRYPTO_KEY_NAME>"
    }
  }'
```

**Response:**
```json
{
  "validation": [{ "key": "...", "description": "...", "success": true/false, "error": "..." }],
  "successful": true/false,
  "configurationResponse": { /* available schemas, databases, roles */ }
}
```

If `successful` is true, move to Step 8.

**If validation fails:**

**IMPORTANT: Never assume partial success from an ambiguous error.** If the API returns an error like "X does not exist or not authorized", report the exact error message. Do NOT split it into "connection works but X is missing". Show the user the exact error and let them determine the cause.

For each validation failure, show:
> Validation failed: `<exact error message from API>`

### Snowflake remediation

Generate the full remediation SQL, **copy it to clipboard via `pbcopy`**, and tell the user to paste it in the Snowflake worksheet (https://app.snowflake.com):

1. **Fetch the crypto key's public key** from the IAM API:
   ```bash
   curl -s "https://iam.${REGION}.confidence.dev/v1/cryptoKeys/<KEY_NAME>" -H "Authorization: Bearer $TOKEN"
   ```
   Strip the PEM headers (`-----BEGIN/END PUBLIC KEY-----`) and newlines to get the raw base64 string for Snowflake.

2. **Generate SQL based on the error:**

   Auth failures -> register the public key:
   ```sql
   -- If this is the only Confidence account using this Snowflake user:
   ALTER USER <USER> SET RSA_PUBLIC_KEY='<PUBLIC_KEY_BASE64>';
   -- If another Confidence account already uses RSA_PUBLIC_KEY, use key 2:
   ALTER USER <USER> SET RSA_PUBLIC_KEY_2='<PUBLIC_KEY_BASE64>';
   ```
   **IMPORTANT:** Always ask the user if other Confidence accounts share this Snowflake user. If yes, use `RSA_PUBLIC_KEY_2` to avoid breaking existing connections. Snowflake accepts auth from either key.

   Database/schema missing:
   ```sql
   CREATE DATABASE IF NOT EXISTS <DATABASE>;
   CREATE SCHEMA IF NOT EXISTS <DATABASE>.<SCHEMA>;
   GRANT USAGE ON DATABASE <DATABASE> TO ROLE <ROLE>;
   GRANT USAGE ON SCHEMA <DATABASE>.<SCHEMA> TO ROLE <ROLE>;
   GRANT ALL ON SCHEMA <DATABASE>.<SCHEMA> TO ROLE <ROLE>;
   ```

3. **Copy to clipboard and tell the user:**
   ```bash
   echo "<GENERATED_SQL>" | pbcopy
   ```
   > The SQL commands have been copied to your clipboard. Paste them in the Snowflake worksheet at https://app.snowflake.com and run them. Let me know when done and I'll retry validation.

If `configurationResponse` contains available options (schemas, databases, roles), present these as choices to help the user.

---

## Step 8: Create warehouse

**IMPORTANT:** The body is the data warehouse object directly (gRPC transcoding `body: "data_warehouse"`), NOT wrapped in a `dataWarehouse` key.

```bash
curl -s -w "\n%{http_code}" -X POST "https://metrics.${REGION}.confidence.dev/v1/dataWarehouses" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "snowflakeConfig": {
        "account": "<ACCOUNT>",
        "user": "<USER>",
        "role": "<ROLE>",
        "warehouse": "<WAREHOUSE>",
        "database": "<DATABASE>",
        "schema": "<SCHEMA>",
        "cryptoKey": "<CRYPTO_KEY_NAME>"
      }
    }
  }'
```

Save the returned `name` (e.g., `dataWarehouses/...`) for reference.

---

## Step 9: Create connectors

Create both connectors. **Snowflake connectors require `database` and `schema` fields in snowflakeConfig.**

### Flag Applied Connection (assignment data -> warehouse)

**IMPORTANT:** The body is the connection object directly (gRPC transcoding `body: "flag_applied_connection"`), NOT wrapped.

```bash
curl -s -w "\n%{http_code}" -X POST "https://connectors.${REGION}.confidence.dev/v1/flagAppliedConnections" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "snowflake": {
      "snowflakeConfig": {
        "account": "<ACCOUNT>",
        "user": "<USER>",
        "role": "<ROLE>",
        "warehouse": "<WAREHOUSE>",
        "database": "<DATABASE>",
        "schema": "<SCHEMA>",
        "cryptoKey": "<CRYPTO_KEY_NAME>"
      },
      "table": "ASSIGNMENTS"
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
    "snowflake": {
      "snowflakeConfig": {
        "account": "<ACCOUNT>",
        "user": "<USER>",
        "role": "<ROLE>",
        "warehouse": "<WAREHOUSE>",
        "database": "<DATABASE>",
        "schema": "<SCHEMA>",
        "cryptoKey": "<CRYPTO_KEY_NAME>"
      },
      "tablePrefix": "EVENTS_"
    }
  }'
```

---

## Step 10: Assignment table

Create an assignment table so Confidence can analyze experiment assignments.

**IMPORTANT:** The body is the assignment table object directly (gRPC transcoding `body: "assignment_table"`), NOT wrapped in an `assignmentTable` key.

```bash
curl -s -w "\n%{http_code}" -X POST "https://metrics.${REGION}.confidence.dev/v1/assignmentTables" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "Assignments",
    "sql": "SELECT targeting_key, rule, assignment_id, assignment_time FROM <DATABASE>.<SCHEMA>.ASSIGNMENTS",
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

## Step 11: Verify data pipeline

Verify both connectors by generating test data and checking it lands in the warehouse.

### 11a. Get a client secret for testing

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

### 11b. Verify flag assignments

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

### 11c. Verify events

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

### 11d. Check data in Snowflake

Ask the user: "Want me to check the data, or show you the queries?"

If user has `snowsql` CLI:
```bash
snowsql -a ${SNOWFLAKE_ACCOUNT} -u ${SNOWFLAKE_USER} -r ${SNOWFLAKE_ROLE} -w ${SNOWFLAKE_WAREHOUSE} -d ${SNOWFLAKE_DATABASE} -s ${SNOWFLAKE_SCHEMA} -q "
SELECT targeting_key, rule, assignment_id, assignment_time
FROM ${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.ASSIGNMENTS
ORDER BY assignment_time DESC LIMIT 5;
"
```

If no `snowsql`, use the Snowflake SQL REST API:
```bash
# Get a JWT token for Snowflake (using keypair auth) or prompt user for password
# Then query via the SQL API:
curl -s -X POST "https://${SNOWFLAKE_ACCOUNT}.snowflakecomputing.com/api/v2/statements" \
  -H "Authorization: Bearer ${SNOWFLAKE_JWT}" \
  -H "Content-Type: application/json" \
  -H "X-Snowflake-Authorization-Token-Type: KEYPAIR_JWT" \
  -d '{
    "statement": "SELECT targeting_key, rule, assignment_id, assignment_time FROM '${SNOWFLAKE_DATABASE}'.'${SNOWFLAKE_SCHEMA}'.ASSIGNMENTS ORDER BY assignment_time DESC LIMIT 5",
    "warehouse": "'${SNOWFLAKE_WAREHOUSE}'",
    "database": "'${SNOWFLAKE_DATABASE}'",
    "schema": "'${SNOWFLAKE_SCHEMA}'",
    "role": "'${SNOWFLAKE_ROLE}'"
  }'
```

If neither available, show the queries for the Snowflake worksheet (https://app.snowflake.com):
> ```sql
> -- Assignments
> SELECT targeting_key, rule, assignment_id, assignment_time
> FROM <DATABASE>.<SCHEMA>.ASSIGNMENTS
> ORDER BY assignment_time DESC LIMIT 5;
>
> -- Events (list event tables first, then query)
> SHOW TABLES LIKE 'EVENTS_%' IN <DATABASE>.<SCHEMA>;
> SELECT * FROM <DATABASE>.<SCHEMA>.<EVENT_TABLE>
> ORDER BY _event_time DESC LIMIT 5;
> ```

**Show results:**
```
  ● Assignments: <N> rows -- data flowing
    <targeting_key> -> <assignment_id> (<timestamp>)
  ● Events: <N> rows -- data flowing
    <action> on <page> (<timestamp>)
```

**If no rows after a few seconds**, tell the user:
> Data delivery can take up to a few minutes depending on your warehouse. Check again shortly, or verify in your Snowflake worksheet.

---

## Step 12: Done

```
═══════════════════════════════════════════════════════════════
  Data Warehouse Connected & Verified
═══════════════════════════════════════════════════════════════

  Warehouse:    Snowflake (<account>)
  Database:     <DATABASE>
  Schema:       <SCHEMA>
  Connectors:
    ● Flag assignments -> ASSIGNMENTS table (verified)
    ● Events -> EVENTS_* tables (running)
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

**Create crypto key (Bearer token):**
```
POST ${IAM_API}/cryptoKeys?crypto_key_id=<id>
Body: { "kind": "SNOWFLAKE" }
-> CryptoKey object with publicKey field
```

**Get crypto key (Bearer token):**
```
GET ${IAM_API}/cryptoKeys/<id>
-> CryptoKey object with publicKey field
```

**Validate warehouse config (Bearer token):**
```
POST ${METRICS_API}/dataWarehouseConfig:validate
Body: { "snowflakeConfig": {...} }
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
Body (direct object): { "config": { "snowflakeConfig": {...} } }
-> DataWarehouse object
```

**Create flag applied connection (Bearer token, body: "flag_applied_connection"):**
```
POST ${CONNECTORS_API}/flagAppliedConnections
Body (direct object): { "snowflake": { "snowflakeConfig": {..., "database": "...", "schema": "..."}, "table": "ASSIGNMENTS" } }
-> FlagAppliedConnection object
NOTE: Snowflake connectors require database and schema fields in snowflakeConfig
```

**Create event connection (Bearer token, body: "event_connection"):**
```
POST ${CONNECTORS_API}/eventConnections
Body (direct object): { "snowflake": { "snowflakeConfig": {..., "database": "...", "schema": "..."}, "tablePrefix": "EVENTS_" } }
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
| 409 | Conflict (already exists) | Resource already created (e.g., crypto key) |
| 429 | Rate limited | Wait briefly and retry |
| 500+ | Server error | Inform user, suggest retry |

### Sandbox note

All `curl`, `open`, and `python3` commands that access external hosts (`auth.confidence.dev`, `iam.confidence.dev`, `metrics.confidence.dev`, `connectors.confidence.dev`, etc.) require `dangerouslyDisableSandbox: true`. On first occurrence, briefly explain to the user that network access outside the sandbox is needed for API calls.
