---
description: Set up Databricks as a data warehouse for Confidence. Use when the user chose Databricks for warehouse setup.
---

# Setup Warehouse: Databricks

Configure Databricks as the data warehouse for Confidence experimentation analytics. This skill handles the full end-to-end setup: collect Databricks connection details, set up an S3 staging bucket with IAM, configure the schema, create the warehouse, set up connectors, create the assignment table, and verify the pipeline.

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
- **`body: "flag_applied_connection"`** -> send the connection object directly: `{"databricks": {...}}`
- **`body: "event_connection"`** -> send the connection object directly: `{"databricks": {...}}`
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
───── Setup Warehouse (Databricks) ────────────────────────
  [1] Choose warehouse     ● done
  [2] Workspace URL        ○ pending
  [3] SQL Warehouse ID     ○ pending
  [4] Service principal    ○ pending
  [5] AWS account & CLI    ○ pending
  [6] S3 bucket            ○ pending
  [7] IAM role             ○ pending
  [8] Databricks schema    ○ pending
  [9] Create warehouse     ○ pending
  [10] Create connectors   ○ pending
  [11] Assignment table    ○ pending
  [12] Verify pipeline     ○ pending
  [13] Done                ○ pending
────────────────────────────────────────────────────────────
```

Use `●` for completed, `▶` for in-progress, `○` for pending. Re-display the full tracker after every step transition.

---

## Step 1: Choose warehouse (already done)

The user has already chosen Databricks. Mark step 1 as done.

---

## Overview

Before collecting details, explain the full picture so the user knows what they need:

> Setting up Databricks with Confidence requires three things:
>
> 1. **A Databricks workspace** -- you need admin access to create a service principal (a robot account)
> 2. **An AWS account with an S3 bucket** -- Confidence needs this as a staging area for loading data into Databricks. This is required even if your Databricks runs on GCP or Azure
> 3. **A schema in Databricks** -- a place for Confidence to create tables (e.g., `confidence`)
>
> **How data flows:**
> Confidence collects your flag assignments and events internally, then writes parquet files to an S3 bucket you provide, and finally loads them into Databricks tables. This happens in batches every ~5 minutes.
>
> ```
> Confidence (collects data) -> S3 bucket (staging) -> Databricks (tables)
> ```
>
> **Don't have an AWS account?** You'll need one for the S3 staging bucket. AWS free tier works fine. I can set it up for you if you have the `aws` CLI, or walk you through the AWS Console.

Then collect the details **one at a time**. After each answer, confirm it before moving to the next. Don't dump all questions at once.

---

## Step 2: Workspace URL (Part 1: Databricks connection)

Ask the user:
> What's your Databricks workspace URL? Just paste the URL from your browser address bar.

Extract the hostname from whatever they paste (strip `https://`, trailing paths, query params). Valid examples:
- `dbc-a1b2c3d4-e5f6.cloud.databricks.com`
- `1234567890.7.gcp.databricks.com`
- `adb-1234567890.12.azuredatabricks.net`

Confirm: "Got it -- your Databricks workspace is at `<hostname>`."

---

## Step 3: SQL Warehouse ID

Ask the user:
> I need a SQL Warehouse ID. Here's how to find it:
> 1. In Databricks, click **SQL Warehouses** in the left sidebar
> 2. Click on a warehouse name
> 3. Open the **Connection details** tab
> 4. Copy the **HTTP Path** -- the ID is the last part after `/sql/1.0/warehouses/`
>
> It looks like a hex string, e.g., `ccf7028466008a3c`
>
> **Don't have a SQL Warehouse?** Click **Create SQL Warehouse** -> name it "Confidence" -> pick **Serverless**, size **Small** -> **Create**. Then copy the ID.

Confirm: "Using warehouse `<id>`."

---

## Step 4: Service principal

Ask the user:
> I need a service principal -- this is a robot account that Confidence uses to connect to Databricks.
>
> **To create one:**
> 1. Click the **gear icon** at the top of Databricks -> **Settings**
> 2. Under **Identity and access**, click **Service principals**
> 3. Click **Add service principal -> Add new**
> 4. Name it "Confidence" -> **Add**
> 5. Click into the new service principal
> 6. Copy the **Application ID** (a UUID like `85cc292a-c1d2-...`)
> 7. Go to the **Secrets** tab -> **Generate secret**
> 8. Copy both the **Secret** (shown only once!) and the **Client ID**
>
> Paste the **Client ID** and **Secret** here.

If the user says they can't access Settings or service principals:
> You need workspace admin access for this step. Ask your Databricks admin to:
> 1. Create a service principal named "Confidence"
> 2. Generate a secret for it
> 3. Send you the Client ID and Secret

Confirm: "Service principal configured."

---

## Step 5: AWS account & CLI (Part 2: S3 staging bucket)

Explain why:
> Confidence writes parquet files to an S3 bucket, then Databricks loads them via COPY INTO. Think of it as a mailbox -- Confidence drops files there, and Databricks picks them up. **This is required even if your Databricks runs on GCP or Azure.**
>
> You need an AWS account for this. If you don't have one, I can help you set one up.

Ask the user:
> Do you have the `aws` CLI set up, or would you prefer manual steps?
> 1. Set it up for me (requires `aws` CLI)
> 2. Show me the steps

**If the user picks 1 (aws CLI):**

First check: `which aws`. If not found, offer to install: `brew install awscli` (macOS) or guide them to https://aws.amazon.com/cli/.

Then check they're logged in: `aws sts get-caller-identity`. If not, tell them:
> Run `aws configure` or `aws sso login` to log into your AWS account first.

If `aws` CLI is not configured, the skill should:
1. Open the AWS console login: `open "https://console.aws.amazon.com"`
2. Guide user to create access key: **click your name top right -> Security credentials -> Access keys -> Create access key**
3. Write the credentials directly to `~/.aws/credentials` and `~/.aws/config` (don't use interactive `aws configure`)

---

## Step 6: S3 bucket

Extract the Confidence service account and its numeric unique ID (required for AWS trust policy):
```bash
ACCOUNT_ID=$(echo "$TOKEN" | cut -d. -f2 | python3 -c "
import sys, json, base64
p = sys.stdin.read().strip()
p += '=' * (4 - len(p) % 4) if len(p) % 4 else ''
d = json.loads(base64.b64decode(p))
print(d['https://confidence.dev/account_name'].split('/')[-1])
")
CONFIDENCE_SA="account-${ACCOUNT_ID}@spotify-confidence.iam.gserviceaccount.com"
```

Ask the user for a bucket name (suggest `confidence-staging-<account_id>`) and region (suggest `eu-west-1`).

**If using aws CLI:**

```bash
# 1. Create S3 bucket
aws s3api create-bucket --bucket ${BUCKET_NAME} --region ${AWS_REGION} \
  --create-bucket-configuration LocationConstraint=${AWS_REGION}
```

**If using manual steps:**

> Go to **AWS Console** (https://console.aws.amazon.com) -> **S3 -> Create bucket**.
> - Name: something like `confidence-staging-<your-company>` (must be globally unique)
> - Region: pick the same region as your Databricks workspace (e.g., `eu-west-1` for EU)
> - Leave all other settings as default -> **Create bucket**
>
> If you already have a bucket you want to reuse, that works too -- just give me the name.

---

## Step 7: IAM role

Get the Confidence service account numeric unique ID:
```bash
# CRITICAL: AWS trust policy needs the NUMERIC unique ID, not the email.
# The email won't work -- AWS requires accounts.google.com:sub which is the numeric ID.
SA_UNIQUE_ID=$(gcloud iam service-accounts describe ${CONFIDENCE_SA} \
  --project=spotify-confidence --format="value(uniqueId)")
```

If `gcloud` can't access `spotify-confidence` project, the user needs to contact Confidence support to get the numeric service account ID.

**If using aws CLI:**

```bash
# 1. Create the trust policy file
# IMPORTANT: Use accounts.google.com:sub with the NUMERIC service account ID.
# Using :email will fail with "MalformedPolicyDocument".
# Using the email string as :sub will fail at runtime with "Not authorized to perform sts:AssumeRoleWithWebIdentity".
cat > $TMPDIR/trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Federated": "accounts.google.com"},
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "accounts.google.com:sub": "${SA_UNIQUE_ID}"
      }
    }
  }]
}
EOF

# 2. Create IAM role
aws iam create-role --role-name confidence-databricks-staging \
  --assume-role-policy-document file://$TMPDIR/trust-policy.json

# 3. Create and attach S3 access policy
cat > $TMPDIR/s3-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:ListBucket"],
    "Resource": [
      "arn:aws:s3:::${BUCKET_NAME}",
      "arn:aws:s3:::${BUCKET_NAME}/*"
    ]
  }]
}
EOF
aws iam put-role-policy --role-name confidence-databricks-staging \
  --policy-name S3Access --policy-document file://$TMPDIR/s3-policy.json

# 4. Get the role ARN
ROLE_ARN=$(aws iam get-role --role-name confidence-databricks-staging --query 'Role.Arn' --output text)
echo "ROLE_ARN: $ROLE_ARN"
```

After completion, show the user:
> AWS setup complete!
> - Bucket: `<BUCKET_NAME>` in `<REGION>`
> - Role: `<ROLE_ARN>`
>
> Continuing with connector setup...

**If using manual steps:**

> Go to **AWS Console -> IAM -> Roles -> Create role**.
> - Trusted entity: **Web identity**
> - Identity provider: select **accounts.google.com** (add it first if not listed under Identity providers)
> - Audience: `account-<YOUR_ACCOUNT_ID>@spotify-confidence.iam.gserviceaccount.com`
>   (the skill should compute the account ID from the JWT token and fill this in for the user)
> - Click **Next** -> **Create policy** -> JSON tab -> paste this:
> ```json
> {
>   "Version": "2012-10-17",
>   "Statement": [{
>     "Effect": "Allow",
>     "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:ListBucket"],
>     "Resource": ["arn:aws:s3:::<BUCKET_NAME>", "arn:aws:s3:::<BUCKET_NAME>/*"]
>   }]
> }
> ```
> - Attach the policy -> name the role (e.g., `confidence-databricks-staging`) -> **Create role**
> - Copy the **Role ARN** (looks like `arn:aws:iam::123456789012:role/confidence-databricks-staging`)
>
> **If you get "Not authorized to perform sts:AssumeRoleWithWebIdentity" later:** the trust policy is wrong -- the Confidence service account email must exactly match what's in the role's trust policy.

Collect the **AWS Region** and **IAM Role ARN** from the user.

---

## Step 8: Databricks schema (Part 3: schema)

Ask the user:
> Last thing -- where should Confidence create its tables in Databricks? I need a schema name.
> The default is `confidence`. If you already have a schema you'd like to use, let me know.

Then check if the schema exists and the service principal has access. Generate the SQL and **copy to clipboard**:

> I'll set up the schema and permissions. Here's what I'm running -- copied to your clipboard. Paste it in the **Databricks SQL Editor** (left sidebar -> SQL Editor) and run it.

For workspaces **without Unity Catalog** (hive_metastore):
```sql
CREATE SCHEMA IF NOT EXISTS confidence;
GRANT USE SCHEMA, CREATE TABLE ON SCHEMA confidence TO `<service-principal-client-id>`;
```

For workspaces **with Unity Catalog**:
```sql
CREATE CATALOG IF NOT EXISTS confidence;
CREATE SCHEMA IF NOT EXISTS confidence.confidence;
GRANT USE CATALOG ON CATALOG confidence TO `<service-principal-client-id>`;
GRANT USE SCHEMA, CREATE TABLE ON SCHEMA confidence.confidence TO `<service-principal-client-id>`;
```

**How to tell which one:** If the user sees **Catalog** in the Databricks left sidebar, they have Unity Catalog. If they only see **Data**, they're on hive_metastore.

After the user runs it, confirm: "Schema ready. Moving on to create the warehouse."

---

## Step 9: Create warehouse

**NOTE:** The validate endpoint does NOT support Databricks (returns "configuration must be set" for any field name variant). Skip validation and proceed directly to create. Tell the user:
> Pre-validation isn't available yet for Databricks. I'll create the warehouse now and we'll verify the connection works end-to-end in the pipeline test step.

**IMPORTANT:** The body is the data warehouse object directly (gRPC transcoding `body: "data_warehouse"`), NOT wrapped in a `dataWarehouse` key.

```bash
curl -s -w "\n%{http_code}" -X POST "https://metrics.${REGION}.confidence.dev/v1/dataWarehouses" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "dataBricksConfig": {
        "host": "<DATABRICKS_HOST>",
        "warehouseId": "<WAREHOUSE_ID>",
        "clientId": "<SERVICE_PRINCIPAL_CLIENT_ID>",
        "clientSecret": "<SERVICE_PRINCIPAL_SECRET>",
        "schema": "<SCHEMA_NAME>",
        "s3BucketConfig": {
          "bucket": "<S3_BUCKET_NAME>",
          "region": "<AWS_REGION>",
          "roleArn": "<IAM_ROLE_ARN>"
        }
      }
    }
  }'
```

Save the returned `name` (e.g., `dataWarehouses/...`) for reference.

---

## Step 10: Create connectors

Create both connectors. Databricks connectors use a nested `connectionConfig` for auth, require an **S3 staging bucket** for batch writes, and `batchFileConfig`.

### Flag Applied Connection (assignment data -> warehouse)

**IMPORTANT:** The body is the connection object directly (gRPC transcoding `body: "flag_applied_connection"`), NOT wrapped.

```bash
curl -s -w "\n%{http_code}" -X POST "https://connectors.${REGION}.confidence.dev/v1/flagAppliedConnections" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "databricks": {
      "databricksConfig": {
        "connectionConfig": {
          "host": "<DATABRICKS_HOST>",
          "warehouseId": "<WAREHOUSE_ID>",
          "clientId": "<SERVICE_PRINCIPAL_CLIENT_ID>",
          "clientSecret": "<SERVICE_PRINCIPAL_SECRET>"
        },
        "schema": "<SCHEMA_NAME>",
        "s3BucketConfig": {
          "bucket": "<S3_BUCKET_NAME>",
          "region": "<AWS_REGION>",
          "roleArn": "<IAM_ROLE_ARN>"
        },
        "batchFileConfig": {
          "maxFileAge": "300s"
        }
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
    "databricks": {
      "databricksConfig": {
        "connectionConfig": {
          "host": "<DATABRICKS_HOST>",
          "warehouseId": "<WAREHOUSE_ID>",
          "clientId": "<SERVICE_PRINCIPAL_CLIENT_ID>",
          "clientSecret": "<SERVICE_PRINCIPAL_SECRET>"
        },
        "schema": "<SCHEMA_NAME>",
        "s3BucketConfig": {
          "bucket": "<S3_BUCKET_NAME>",
          "region": "<AWS_REGION>",
          "roleArn": "<IAM_ROLE_ARN>"
        },
        "batchFileConfig": {
          "maxFileAge": "300s"
        }
      },
      "tablePrefix": "events_"
    }
  }'
```

---

## Step 11: Assignment table

Create an assignment table so Confidence can analyze experiment assignments.

**IMPORTANT:** The body is the assignment table object directly (gRPC transcoding `body: "assignment_table"`), NOT wrapped in an `assignmentTable` key.

```bash
curl -s -w "\n%{http_code}" -X POST "https://metrics.${REGION}.confidence.dev/v1/assignmentTables" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "Assignments",
    "sql": "SELECT targeting_key, rule, assignment_id, assignment_time FROM <SCHEMA>.assignments",
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

## Step 12: Verify data pipeline

Verify both connectors by generating test data and checking it lands in the warehouse.

### 12a. Get a client secret for testing

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

### 12b. Verify flag assignments

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

### 12c. Verify events

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

### 12d. Check data in Databricks

Use the Databricks SQL Statement API to query directly (the skill already has the service principal credentials):
```bash
DB_TOKEN=$(curl -s -X POST "https://${DATABRICKS_HOST}/oidc/v1/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&scope=all-apis" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -s -X POST "https://${DATABRICKS_HOST}/api/2.0/sql/statements" \
  -H "Authorization: Bearer $DB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "warehouse_id": "'${WAREHOUSE_ID}'",
    "statement": "SELECT targeting_key, rule, assignment_id, assignment_time FROM '${SCHEMA}'.assignments ORDER BY assignment_time DESC LIMIT 5",
    "wait_timeout": "30s"
  }'
```

**IMPORTANT:** Data is batched every ~5 minutes. If the table doesn't exist yet, wait and retry. Tell the user:
> Data delivery takes about 5 minutes. Let me check again...

If `TABLE_OR_VIEW_NOT_FOUND` after 10 minutes, check the connector logs for errors.

**Show results:**
```
  ● Assignments: <N> rows -- data flowing
    <targeting_key> -> <assignment_id> (<timestamp>)
  ● Events: <N> rows -- data flowing
    <action> on <page> (<timestamp>)
```

**If no rows after a few seconds**, tell the user:
> Data delivery can take up to 5 minutes for Databricks (batch processing). Check again shortly, or verify in the Databricks SQL Editor.

---

## Step 13: Done

```
═══════════════════════════════════════════════════════════════
  Data Warehouse Connected & Verified
═══════════════════════════════════════════════════════════════

  Warehouse:    Databricks (<host>)
  Schema:       <SCHEMA>
  S3 Bucket:    <BUCKET_NAME> (<AWS_REGION>)
  Connectors:
    ● Flag assignments -> assignments table (verified)
    ● Events -> events_* tables (running)
  Assignment:
    ● Assignment table configured (auto-updating)

  Flag assignment and event data is flowing to your
  warehouse. Experiment analysis is ready.

  Note: Data is delivered in ~5 minute batches.

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
NOTE: Databricks is NOT supported by the validate endpoint. Skip validation and proceed to create.
```

**Check warehouse exists (Bearer token):**
```
GET ${METRICS_API}/dataWarehouses:exists
-> { "exists": bool }
```

**Create data warehouse (Bearer token, body: "data_warehouse"):**
```
POST ${METRICS_API}/dataWarehouses
Body (direct object): { "config": { "dataBricksConfig": { "host": str, "warehouseId": str, "clientId": str, "clientSecret": str, "schema": str, "s3BucketConfig": { "bucket": str, "region": str, "roleArn": str } } } }
-> DataWarehouse object
```

**Create flag applied connection (Bearer token, body: "flag_applied_connection"):**
```
POST ${CONNECTORS_API}/flagAppliedConnections
Body (direct object): { "databricks": { "databricksConfig": { "connectionConfig": {...}, "schema": str, "s3BucketConfig": {...}, "batchFileConfig": {...} }, "table": "assignments" } }
-> FlagAppliedConnection object
```

**Create event connection (Bearer token, body: "event_connection"):**
```
POST ${CONNECTORS_API}/eventConnections
Body (direct object): { "databricks": { "databricksConfig": { "connectionConfig": {...}, "schema": str, "s3BucketConfig": {...}, "batchFileConfig": {...} }, "tablePrefix": "events_" } }
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

All `curl`, `open`, `python3`, `aws`, and `gcloud` commands that access external hosts (`auth.confidence.dev`, `metrics.confidence.dev`, `connectors.confidence.dev`, AWS APIs, etc.) require `dangerouslyDisableSandbox: true`. On first occurrence, briefly explain to the user that network access outside the sandbox is needed for API calls.
