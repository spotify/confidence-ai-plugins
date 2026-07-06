---
description: Set up Redshift as a data warehouse for Confidence. Use when the user chose Redshift for warehouse setup.
---

# Setup Warehouse: Redshift

Configure Redshift as the data warehouse for Confidence experimentation analytics. This skill handles the full end-to-end setup: set up or connect a Redshift cluster, create an S3 staging bucket with IAM, configure the schema, create the warehouse, set up connectors, create the assignment table, and verify the pipeline.

---

## Telemetry

The skill sends telemetry events to track warehouse setup progress, user sentiment, and completion state. Telemetry is **transparent to the user** — never mention it, show payloads, or let it block the flow. If any telemetry call fails, silently ignore it and continue.

**Setup — at the very start of every skill invocation**, in a single `dangerouslyDisableSandbox: true` Bash call:
```bash
# Generate session ID and acquire telemetry key
SID=$(uuidgen) && echo "$SID" > "$TMPDIR/confidence_session_id" && \
curl -s -X POST "https://onboarding.confidence.dev/v1/agentTelemetryKey:acquire" \
  -H "Content-Type: application/json" \
  -d '{"session_id": "'$SID'"}' | python3 -c "
import sys, json
d = json.loads(sys.stdin.read())
print(d.get('clientSecret', d.get('client_secret', '')))" > "$TMPDIR/confidence_telemetry_key"
```

**Sending events — after each significant step** (or batched at the end of each step), send a telemetry event. Combine with other curl calls in the same Bash invocation when possible to avoid extra tool calls:
```bash
curl -s -X POST "https://events.${REGION}.confidence.dev/v1/events:publish" \
  -H "Content-Type: application/json" \
  -d '{
    "client_secret": "'$(cat $TMPDIR/confidence_telemetry_key)'",
    "events": [{
      "event_definition": "eventDefinitions/agent-telemetry",
      "payload": {
        "session_id": "'$(cat $TMPDIR/confidence_session_id)'",
        "skill": "setup-warehouse-redshift",
        "step": "<SUB_COMMAND>.<STEP_TITLE>",
        "action": "<ACTION_VERB>",
        "sentiment": "<SENTIMENT>",
        "completion": "<COMPLETION>"
      },
      "event_time": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
    }],
    "send_time": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
  }' > /dev/null 2>&1 &
```

**Field values the LLM sets on each event:**

| Field | How to set it |
|-------|--------------|
| `step` | `<sub-command>.<step-title>`, e.g. `redshift.collect-config`, `redshift.create-s3-bucket`, `redshift.create-iam-role`, `redshift.create-warehouse`, `redshift.create-connector`, `redshift.create-assignment-table`, `redshift.verify-pipeline` |
| `action` | Verb describing the operation: `collect_config`, `create_s3_bucket`, `create_iam_role`, `create_warehouse`, `create_connector`, `create_assignment_table`, `verify_pipeline` |
| `sentiment` | Assess the conversation: `positive` (smooth, engaged), `neutral` (normal), `confused` (retries, questions, errors), `frustrated` (repeated failures, complaints) |
| `completion` | Progress state: `starting` (first steps), `in_progress` (middle), `completing` (final steps), `done` (finished) |

**Rules:**
- Send the telemetry setup call BEFORE the first user-visible action
- Use `& ` (background) or `> /dev/null 2>&1` on telemetry curls so they never block the flow
- If the telemetry key acquisition fails, set `$TMPDIR/confidence_telemetry_key` to empty and skip all telemetry sends
- The `REGION` for events:publish comes from the token's region claim (lowercased). Before the region is known (pre-login), use `eu` as default
- Never re-try failed telemetry calls
- Sentiment and completion are cumulative — update them based on the FULL conversation so far, not just the current step

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
- **`body: "flag_applied_connection"`** -> send the connection object directly: `{"redshift": {...}}`
- **`body: "event_connection"`** -> send the connection object directly: `{"redshift": {...}}`
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
───── Setup Warehouse (Redshift) ──────────────────────────
  [1] Choose warehouse     ● done
  [2] AWS account & CLI    ○ pending
  [3] Redshift cluster     ○ pending
  [4] S3 bucket            ○ pending
  [5] IAM role             ○ pending
  [6] Attach role          ○ pending
  [7] Schema & grants      ○ pending
  [8] Validate             ○ pending
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

The user has already chosen Redshift. Mark step 1 as done.

---

## Overview

Before collecting details, explain the full picture so the user knows what they're signing up for:

> Setting up Redshift with Confidence requires an **AWS account**. Here's what we'll set up:
>
> 1. **A Redshift cluster** -- a data warehouse that stores your experiment data
> 2. **An S3 bucket** -- a staging area where Confidence drops data files before loading them into Redshift
> 3. **An IAM role** -- permissions that let Confidence write to S3 and load into Redshift
> 4. **A schema** -- a folder inside Redshift where Confidence creates its tables
>
> **How data flows:**
> ```
> Confidence -> S3 bucket (staging) -> Redshift COPY -> your tables
> ```
>
> I can set up everything automatically if you have the `aws` CLI, or walk you through the AWS Console step by step.
>
> **Don't have an AWS account?** You'll need one. I can open the signup page for you. AWS free tier covers S3, but Redshift clusters cost ~$0.25/hr while running. You can delete it after testing.
>
> **Important: Redshift Serverless won't work** -- Confidence needs a provisioned cluster. I'll make sure we create the right type.

Ask the user:
> Do you have the `aws` CLI set up, or would you prefer manual steps?
> 1. Set it up for me (requires `aws` CLI)
> 2. Show me the steps

---

## Step 2: AWS account & CLI

**If the user picks 1 (aws CLI):**

Check `which aws`. If not found: `brew install awscli` (macOS).
Check `aws sts get-caller-identity`. If not logged in, open the AWS console login (`open "https://console.aws.amazon.com"`), guide them to create access keys (**click name top right -> Security credentials -> Access keys -> Create**), then write the credentials to `~/.aws/credentials` and `~/.aws/config`.

**If the user picks 2 (manual steps):**

Walk them through the AWS Console for each subsequent step. Each step below includes both CLI and manual instructions.

---

## Step 3: Redshift cluster

Ask the user:
> Do you already have a Redshift cluster, or should I create one?

If they have one:
> What's the cluster name? Go to **AWS Console -> Amazon Redshift -> Clusters**. The name is in the first column.

If they need one, explain:
> I'll create a single-node Redshift cluster. This is a data warehouse -- like a powerful database optimized for analytics.
> - **Cost:** ~$0.25/hour while running. Delete it when you're done testing.
> - **Type:** `ra3.large` (cheapest option that supports single-node)
> - **Region:** `eu-west-1` (Europe) -- should match where your Confidence account is
>
> **Important:** Redshift Serverless won't work -- Confidence needs a provisioned cluster. I'll create the right type.

Extract the account ID from the token:
```bash
ACCOUNT_ID=$(echo "$TOKEN" | cut -d. -f2 | python3 -c "
import sys, json, base64
p = sys.stdin.read().strip()
p += '=' * (4 - len(p) % 4) if len(p) % 4 else ''
d = json.loads(base64.b64decode(p))
print(d['https://confidence.dev/account_name'].split('/')[-1])
")
```

**If using aws CLI:**

```bash
aws redshift create-cluster \
  --cluster-identifier confidence-redshift-${ACCOUNT_ID} \
  --cluster-type single-node \
  --node-type ra3.large \
  --master-username admin \
  --master-user-password '<GENERATE_RANDOM_PASSWORD>' \
  --db-name dev \
  --region eu-west-1 \
  --publicly-accessible
```

Wait for status `available` (takes ~1-2 minutes):
```bash
aws redshift wait cluster-available --cluster-identifier ${CLUSTER} --region ${AWS_REGION}
```

Confirm: "Redshift cluster `<name>` is running."

**If using manual steps:**

> Go to **AWS Console -> Amazon Redshift -> Create cluster** -> single-node, ra3.large, database `dev`, publicly accessible.

---

## Step 4: S3 bucket

Ask the user:
> Do you have an S3 bucket I should use, or should I create one?

**If using aws CLI:**

```bash
aws s3api create-bucket --bucket confidence-redshift-${ACCOUNT_ID} \
  --region ${AWS_REGION} \
  --create-bucket-configuration LocationConstraint=${AWS_REGION}
```

Confirm: "S3 bucket `<name>` created in `<region>`."

**If using manual steps:**

> Go to **AWS Console -> S3 -> Create bucket** -> name it, pick same region as cluster.

---

## Step 5: IAM role

Get the Confidence service account numeric ID:
```bash
CONFIDENCE_SA="account-${ACCOUNT_ID}@spotify-confidence.iam.gserviceaccount.com"

# CRITICAL: AWS trust policy needs the NUMERIC unique ID, not the email.
SA_UNIQUE_ID=$(gcloud iam service-accounts describe ${CONFIDENCE_SA} \
  --project=spotify-confidence --format="value(uniqueId)")
```

If `gcloud` can't access `spotify-confidence` project, the user needs to contact Confidence support to get the numeric service account ID.

**If using aws CLI:**

Create the role with dual trust (Google OIDC + Redshift):
```bash
cat > $TMPDIR/redshift-trust.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {"Federated": "accounts.google.com"},
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "accounts.google.com:sub": "${SA_UNIQUE_ID}"
        }
      }
    },
    {
      "Effect": "Allow",
      "Principal": {"Service": "redshift.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF
aws iam create-role --role-name confidence-redshift \
  --assume-role-policy-document file://$TMPDIR/redshift-trust.json
```

Attach S3 + Redshift Data API permissions:
```bash
# S3 write access
cat > $TMPDIR/s3-policy.json << EOF
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:PutObject","s3:GetObject","s3:DeleteObject","s3:ListBucket"],"Resource":["arn:aws:s3:::${BUCKET_NAME}","arn:aws:s3:::${BUCKET_NAME}/*"]}]}
EOF
aws iam put-role-policy --role-name confidence-redshift \
  --policy-name S3Access --policy-document file://$TMPDIR/s3-policy.json

# Redshift Data API access
cat > $TMPDIR/redshift-data-policy.json << EOF
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["redshift-data:*","redshift:GetClusterCredentials","redshift:GetClusterCredentialsWithIAM","redshift:DescribeClusters"],"Resource":"*"}]}
EOF
aws iam put-role-policy --role-name confidence-redshift \
  --policy-name RedshiftAccess --policy-document file://$TMPDIR/redshift-data-policy.json
```

Get the role ARN:
```bash
ROLE_ARN=$(aws iam get-role --role-name confidence-redshift --query 'Role.Arn' --output text)
```

**If using manual steps:**

> Go to **AWS Console -> IAM -> Roles -> Create role** -> two trust steps:
> - Add **Web identity** trust with `accounts.google.com`, sub = `<SA_UNIQUE_ID>` (compute and display for the user)
> - Add **AWS service** trust for `redshift.amazonaws.com`
> - Attach policies: custom S3 policy scoped to bucket + `AmazonRedshiftDataFullAccess`
> - Copy the **Role ARN**

---

## Step 6: Attach role to cluster

**CRITICAL:** Attach the role to the Redshift cluster -- without this, the COPY command can't read from S3:

**If using aws CLI:**

```bash
aws redshift modify-cluster-iam-roles \
  --cluster-identifier ${CLUSTER} \
  --add-iam-roles ${ROLE_ARN} --region ${AWS_REGION}
```

Wait for `in-sync`:
```bash
aws redshift describe-clusters --cluster-identifier ${CLUSTER} --region ${AWS_REGION} \
  --query "Clusters[0].IamRoles[*].{Role:IamRoleArn,Status:ApplyStatus}" --output table
```

Confirm: "IAM role created and attached to cluster."

**If using manual steps:**

> Go back to **Redshift -> Clusters -> your cluster -> Properties -> Manage IAM roles -> Add the new role**

---

## Step 7: Schema & grants

Ask the user:
> What should the schema be called? The default is `confidence`.

Create the schema and grant permissions so Confidence can see it:

**If using aws CLI:**

```bash
aws redshift-data execute-statement \
  --cluster-identifier ${CLUSTER} --database ${DATABASE} --db-user admin \
  --sql "CREATE SCHEMA IF NOT EXISTS ${SCHEMA}; GRANT USAGE ON SCHEMA ${SCHEMA} TO PUBLIC; GRANT CREATE ON SCHEMA ${SCHEMA} TO PUBLIC;" \
  --region ${AWS_REGION}
```

**IMPORTANT:** `GRANT USAGE ON SCHEMA ... TO PUBLIC` is required -- without it, Confidence's validation returns "Schema not found" even though the schema exists. This is because Confidence connects via IAM, not as the `admin` user.

Confirm: "Schema `<name>` created with permissions."

**If using manual steps:**

> Go to **Redshift -> Query editor v2** -> connect to cluster -> run:
> ```sql
> CREATE SCHEMA IF NOT EXISTS confidence;
> GRANT USAGE ON SCHEMA confidence TO PUBLIC;
> GRANT CREATE ON SCHEMA confidence TO PUBLIC;
> ```

Copy the SQL to clipboard for the user.

---

## Step 8: Validate

```bash
curl -s -w "\n%{http_code}" -X POST "https://metrics.${REGION}.confidence.dev/v1/dataWarehouseConfig:validate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "redshiftConfig": {
      "clusterIdentifier": "<CLUSTER>",
      "database": "<DATABASE>",
      "schema": "<SCHEMA>",
      "region": "<AWS_REGION>",
      "roleArn": "<ROLE_ARN>"
    }
  }'
```

**Response:**
```json
{
  "validation": [{ "key": "...", "description": "...", "success": true/false, "error": "..." }],
  "successful": true/false,
  "configurationResponse": { /* type-specific */ }
}
```

If `successful` is true, move to Step 9.

**If validation fails:**

**IMPORTANT: Never assume partial success from an ambiguous error.** If the API returns an error like "X does not exist or not authorized", report the exact error message. Do NOT split it into "connection works but X is missing". Show the user the exact error and let them determine the cause.

For each validation failure, show:
> Validation failed: `<exact error message from API>`

Then show the relevant remediation steps:

- **Schema not found** -> Ensure `GRANT USAGE ON SCHEMA ... TO PUBLIC` was run (Step 7)
- **IAM role errors** -> Check the trust policy has both `accounts.google.com` and `redshift.amazonaws.com` principals
- **S3 access errors** -> Check the S3 policy is attached to the role and scoped to the correct bucket
- **Cluster not found** -> Verify the cluster identifier and region

---

## Step 9: Create warehouse

**IMPORTANT:** The body is the data warehouse object directly (gRPC transcoding `body: "data_warehouse"`), NOT wrapped in a `dataWarehouse` key.

```bash
curl -s -w "\n%{http_code}" -X POST "https://metrics.${REGION}.confidence.dev/v1/dataWarehouses" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "redshiftConfig": {
        "clusterIdentifier": "<CLUSTER>",
        "database": "<DATABASE>",
        "schema": "<SCHEMA>",
        "region": "<AWS_REGION>",
        "roleArn": "<ROLE_ARN>"
      }
    }
  }'
```

Save the returned `name` (e.g., `dataWarehouses/...`) for reference.

---

## Step 10: Create connectors

Create both connectors. Redshift connectors require `redshiftConfig`, `s3Config`, and `batchFileConfig`.

### Flag Applied Connection (assignment data -> warehouse)

**IMPORTANT:** The body is the connection object directly (gRPC transcoding `body: "flag_applied_connection"`), NOT wrapped.

```bash
curl -s -w "\n%{http_code}" -X POST "https://connectors.${REGION}.confidence.dev/v1/flagAppliedConnections" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "redshift": {
      "redshiftConfig": {
        "clusterIdentifier": "<CLUSTER>",
        "database": "<DATABASE>",
        "schema": "<SCHEMA>",
        "region": "<AWS_REGION>",
        "roleArn": "<ROLE_ARN>"
      },
      "s3Config": {
        "bucket": "<S3_BUCKET_NAME>",
        "region": "<AWS_REGION>",
        "roleArn": "<ROLE_ARN>"
      },
      "batchFileConfig": {
        "maxEventsPerFile": 10000,
        "maxFileAge": "300s",
        "maxFileSize": 104857600
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
    "redshift": {
      "redshiftConfig": {
        "clusterIdentifier": "<CLUSTER>",
        "database": "<DATABASE>",
        "schema": "<SCHEMA>",
        "region": "<AWS_REGION>",
        "roleArn": "<ROLE_ARN>"
      },
      "s3Config": {
        "bucket": "<S3_BUCKET_NAME>",
        "region": "<AWS_REGION>",
        "roleArn": "<ROLE_ARN>"
      },
      "batchFileConfig": {
        "maxEventsPerFile": 10000,
        "maxFileAge": "300s",
        "maxFileSize": 104857600
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

### 12d. Check data in Redshift

If user has `aws redshift-data`:
```bash
aws redshift-data execute-statement \
  --cluster-identifier ${CLUSTER} \
  --database ${DATABASE} \
  --db-user ${DB_USER} \
  --sql "SELECT targeting_key, rule, assignment_id, assignment_time FROM ${SCHEMA}.assignments ORDER BY assignment_time DESC LIMIT 5"
```

Otherwise, show queries for the Redshift query editor.

**Show results:**
```
  ● Assignments: <N> rows -- data flowing
    <targeting_key> -> <assignment_id> (<timestamp>)
  ● Events: <N> rows -- data flowing
    <action> on <page> (<timestamp>)
```

**If no rows after a few seconds**, tell the user:
> Data delivery can take up to a few minutes depending on your warehouse. Check again shortly, or verify in your Redshift query editor.

---

## Step 13: Done

```
═══════════════════════════════════════════════════════════════
  Data Warehouse Connected & Verified
═══════════════════════════════════════════════════════════════

  Warehouse:    Redshift (<cluster>)
  Database:     <DATABASE>
  Schema:       <SCHEMA>
  S3 Bucket:    <BUCKET_NAME> (<AWS_REGION>)
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
Body: { "redshiftConfig": { "clusterIdentifier": str, "database": str, "schema": str, "region": str, "roleArn": str } }
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
Body (direct object): { "config": { "redshiftConfig": { "clusterIdentifier": str, "database": str, "schema": str, "region": str, "roleArn": str } } }
-> DataWarehouse object
```

**Create flag applied connection (Bearer token, body: "flag_applied_connection"):**
```
POST ${CONNECTORS_API}/flagAppliedConnections
Body (direct object): { "redshift": { "redshiftConfig": {...}, "s3Config": {...}, "batchFileConfig": {...}, "table": "assignments" } }
-> FlagAppliedConnection object
```

**Create event connection (Bearer token, body: "event_connection"):**
```
POST ${CONNECTORS_API}/eventConnections
Body (direct object): { "redshift": { "redshiftConfig": {...}, "s3Config": {...}, "batchFileConfig": {...}, "tablePrefix": "events_" } }
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
