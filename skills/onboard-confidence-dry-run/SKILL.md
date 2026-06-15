---
description: Dry-run the Confidence onboarding flow to test UX without real API calls. Use when the user says "dry run", "test onboarding", "demo onboarding", or wants to preview the onboarding experience.
---

# Confidence Onboarding — Dry Run

This skill runs the full onboarding experience with simulated API responses. No real accounts, flags, or warehouses are created. Use it to test the UX flow, demo to stakeholders, or train new users.

## How it works

- Every API call is simulated with realistic mock responses
- The step trackers, questions, confirmations, and explanations are identical to the real skill
- Browser login is skipped — a mock token is used
- All warehouse types can be tested without needing actual AWS/GCP/Snowflake/Databricks accounts

## Commands

| Command | What it simulates |
|---------|-------------------|
| `/onboard-confidence-dry-run create-account` | Account creation flow |
| `/onboard-confidence-dry-run invite-user` | User invitation flow |
| `/onboard-confidence-dry-run create-client` | SDK client creation flow |
| `/onboard-confidence-dry-run setup-wizard` | Full setup wizard (client → flag → variants → targeting → resolve) |
| `/onboard-confidence-dry-run setup-warehouse` | Warehouse setup dispatcher |
| `/onboard-confidence-dry-run setup-warehouse-bigquery` | BigQuery warehouse setup |
| `/onboard-confidence-dry-run setup-warehouse-snowflake` | Snowflake warehouse setup |
| `/onboard-confidence-dry-run setup-warehouse-databricks` | Databricks warehouse setup |
| `/onboard-confidence-dry-run setup-warehouse-redshift` | Redshift warehouse setup |

---

## Dry Run Rules

1. **Show the exact same UX** as the real skill — same step trackers, same questions, same confirmations, same tone
2. **Display `[DRY RUN]` prefix** on every status update so the user knows it's simulated
3. **Simulate API responses** — don't make real HTTP calls. Instead, print what would happen and show mock response data
4. **Still ask the user for input** at every step (workspace name, flag name, warehouse type, etc.) — the point is to test the interaction flow
5. **Skip browser login** — use a mock token with mock claims:
   ```
   Mock token claims:
   - account_name: accounts/dry-run-demo
   - region: EU
   - org_id: org_DryRunDemo123
   - identity: identities/udryrun123
   ```
6. **Use realistic mock data** for API responses. Examples are listed in the Mock Data Reference section below.
7. **For warehouse-specific dry runs**, simulate the full flow including:
   - Snowflake: mock crypto key creation, show the ALTER USER SQL that would be generated
   - Databricks: mock S3 bucket creation, IAM role, show the trust policy that would be created
   - Redshift: mock cluster creation, show the dual trust policy, GRANT statements
   - BigQuery: mock gcloud commands that would run
8. **At the end of each dry run**, show the dry-run summary banner (see Dry Run Summary section)
9. **No sandbox overrides** — since no real network calls are made, the skill never needs `dangerouslyDisableSandbox: true`
10. **No token persistence** — never write anything to `~/.confidence/` or `$TMPDIR`

---

## Mock Data Reference

Use these mock responses when simulating API calls. Substitute user-provided values (workspace name, flag name, etc.) where indicated with `<USER_VALUE>`.

### Authentication mock

Skip all browser-based Auth0 login. Instead, tell the user:

> [DRY RUN] Skipping browser login — using mock credentials.

Mock token claims to use throughout the session:

```
account_name: accounts/dry-run-demo
region: EU
org_id: org_DryRunDemo123
identity: identities/udryrun123
email: dryrun@example.com
```

Region derived from mock token: `eu` (lowercase). All mock API URLs use `eu` prefix (e.g., `iam.eu.confidence.dev`).

### Create account response

```json
{
  "name": "accounts/dry-run-demo",
  "externalId": "org_DryRunDemo123",
  "loginId": "<USER_VALUE>",
  "displayName": "<USER_VALUE>"
}
```

### Check login ID availability

```json
{"available": true, "message": ""}
```

If the user enters `taken-name` (for testing), return:
```json
{"available": false, "message": "This workspace name is already in use."}
```

### Create client response

```json
{
  "name": "clients/dry-run-client",
  "displayName": "<USER_VALUE>"
}
```

### Client secret (mock)

```
dryrn_sk_mock1234567890abcdef
```

### Create flag response

```json
{
  "name": "flags/<USER_VALUE>",
  "schema": {}
}
```

### Update flag schema response

```json
{
  "name": "flags/<USER_VALUE>",
  "schema": {
    "schema": {
      "enabled": {"boolSchema": {}}
    }
  }
}
```

### Create variant response

```json
{
  "name": "flags/<FLAG>/variants/<VARIANT>",
  "value": {"enabled": true}
}
```

### Add flag to client response

```json
{
  "name": "flags/<FLAG>",
  "clients": ["clients/dry-run-client"]
}
```

### Create segment response

```json
{
  "name": "segments/everyone",
  "displayName": "Everyone",
  "allocation": {"proportion": {"value": "1"}}
}
```

### Create rule response

```json
{
  "name": "flags/<FLAG>/rules/rule1",
  "segment": "segments/everyone",
  "enabled": true
}
```

### Resolve response

```json
{
  "resolvedFlags": [
    {
      "flag": "flags/<FLAG>",
      "variant": "flags/<FLAG>/variants/<DEFAULT_VARIANT>",
      "value": {"enabled": true},
      "reason": "RESOLVE_REASON_MATCH"
    }
  ]
}
```

### User invitation response

```json
{
  "name": "userInvitations/dry-run-inv-001",
  "invitedEmail": "<USER_VALUE>",
  "inviter": "Dry Run Admin",
  "expirationTime": "2026-06-17T10:00:00Z",
  "invitationUri": "https://confidence.spotify.com/invite/mock-token",
  "invitationToken": "mock-invitation-token"
}
```

### Current user response

```json
{
  "user": {
    "name": "users/dry-run-user",
    "fullName": "Dry Run User",
    "email": "dryrun@example.com"
  },
  "accountMemberships": [
    {
      "account": "accounts/dry-run-demo",
      "displayName": "Dry Run Demo",
      "loginId": "dry-run-demo",
      "region": "EU"
    }
  ],
  "account": "accounts/dry-run-demo",
  "identity": {
    "name": "identities/udryrun123",
    "displayName": "Dry Run User"
  }
}
```

### Validate warehouse (BigQuery)

```json
{
  "validation": [
    {"key": "SERVICE_ACCOUNT", "description": "Service account access", "success": true},
    {"key": "PERMISSIONS", "description": "BigQuery permissions", "success": true},
    {"key": "DATASET", "description": "Dataset access", "success": true}
  ],
  "successful": true
}
```

### Validate warehouse (Snowflake)

```json
{
  "validation": [
    {"key": "AUTHENTICATION", "description": "Key-pair authentication", "success": true},
    {"key": "ROLE", "description": "Role access", "success": true},
    {"key": "WAREHOUSE", "description": "Warehouse access", "success": true},
    {"key": "DATABASE", "description": "Database access", "success": true},
    {"key": "SCHEMA", "description": "Schema access", "success": true}
  ],
  "successful": true
}
```

### Validate warehouse (Redshift)

```json
{
  "validation": [
    {"key": "CLUSTER", "description": "Cluster connectivity", "success": true},
    {"key": "IAM_ROLE", "description": "IAM role assumption", "success": true},
    {"key": "SCHEMA", "description": "Schema access", "success": true}
  ],
  "successful": true
}
```

### Create warehouse

```json
{"name": "dataWarehouses/dry-run-wh-123"}
```

### Create crypto key (Snowflake)

```json
{
  "name": "cryptoKeys/snowflake-key",
  "kind": "SNOWFLAKE",
  "publicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0mock1234567890abcd\nefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ01234567\n89mockkeydatafordryruntestingpurposes0123456789abcdefghijklmnopqrst\nuvwxyz==\n-----END PUBLIC KEY-----"
}
```

### Create flag applied connection

```json
{"name": "flagAppliedConnections/dry-run-connector", "state": "STATE_RUNNING"}
```

### Create event connection

```json
{"name": "eventConnections/dry-run-events", "state": "STATE_RUNNING"}
```

### Create assignment table

```json
{"name": "assignmentTables/dry-run-assignments", "displayName": "Assignments"}
```

### Verify pipeline — assignments

```
targeting_key | rule                              | assignment_id | assignment_time
dry-run-user  | flags/my-test-flag/rules/rule1     | on            | 2026-06-10T12:00:00Z
```

### Verify pipeline — events

```
_event_time          | user_action    | page
2026-06-10T12:00:00Z | clicked_button | homepage
```

### Publish events response

```json
{"errors": []}
```

### Learning progress response

```json
{
  "courseProgresses": [
    {"course": "courses/STATS", "completedLessons": 0, "totalLessons": 5},
    {"course": "courses/DESIGN", "completedLessons": 0, "totalLessons": 5},
    {"course": "courses/FLAGS", "completedLessons": 0, "totalLessons": 5},
    {"course": "courses/METRICS", "completedLessons": 0, "totalLessons": 5},
    {"course": "courses/COORDINATION", "completedLessons": 0, "totalLessons": 5}
  ],
  "completedCourses": 0
}
```

---

## Dry Run Summary

At the end of every sub-command dry run, display this banner:

```
═══════════════════════════════════════════════════════════════
  [DRY RUN] Complete
═══════════════════════════════════════════════════════════════

  This was a simulated run. No real resources were created.

  To run for real:
  • /onboard-confidence <subcommand>
  • /onboard-confidence:setup-warehouse-<type>

═══════════════════════════════════════════════════════════════
```

---

## Sub-command: create-account

### Step Tracker

Display at START and after EACH step completes (updating status). Prefix the title with `[DRY RUN]`.

```
───── [DRY RUN] Create Account ───────────────────────────────
  [1] Log in             ○ pending
  [2] Workspace name     ○ pending
  [3] Account details    ○ pending
  [4] Create account     ○ pending
  [5] Connect tools      ○ pending
  [6] Done               ○ pending
──────────────────────────────────────────────────────────────
```

Use `●` for completed, `▶` for in-progress, `○` for pending.

### Step 1: Log in

**Skip browser login entirely.** Display:

> [DRY RUN] Skipping browser login — using mock credentials.
> [DRY RUN] Authenticated as dryrun@example.com

Mark step 1 as `●`.

### Step 2: Workspace name

Same UX as the real skill. EDUCATE then ASK:

> Your workspace name is the unique identifier for your Confidence account.
> It appears in URLs and is used to log in.
>
> **Rules:** 3-21 characters, lowercase letters, digits, and hyphens. Must start with a letter and end with a letter or digit.

**Wait for user input.** Validate locally against regex `^[a-z][a-z0-9-]{1,19}[a-z0-9]$`. If invalid, explain and re-ask — exactly like the real skill.

Then simulate the availability check:

> [DRY RUN] Checking availability... `<workspace-name>` is available!

If the user enters `taken-name`, simulate:

> [DRY RUN] Checking availability... `taken-name` is already taken. Try another name.

### Step 3: Account details

Same UX as the real skill. Collect interactively, one field at a time:

1. **Display name** — ask, validate (3-21 chars, starts with letter).

2. **Region** — present as a choice:
   > Where should your data be stored? This **cannot be changed later**.
   > 1. EU (Europe)
   > 2. US (United States)

3. **Authentication method** — present as a choice:
   > How should users log in to your workspace?
   > 1. Google
   > 2. Email + password
   > 3. Both

4. **Admin email** — ask. Validate work email. If free email (gmail, yahoo, etc.), reject:
   > Confidence requires a work email address. Free providers like Gmail aren't allowed.

5. **Allowed login email domains** — optional. Ask if they want to restrict.

### Step 4: Create account

Display what would happen:

> [DRY RUN] Would call `POST https://onboarding.confidence.dev/v1/accounts`
> [DRY RUN] Creating workspace **<displayName>**...

Then show mock success:

> [DRY RUN] Your workspace **<displayName>** has been created!
> Workspace ID: `<loginId>`
> Region: <region>
>
> You can access it at: https://confidence.spotify.com

### Step 5: Connect tools

> [DRY RUN] Would re-authenticate with org-scoped token (browser auto-redirect).
> [DRY RUN] Skipping — mock token already has org scope.

Then suggest MCP:

> To connect Confidence tools for flag management, type `/mcp` and authenticate **confidence-flags**.

### Step 6: Done

Show the same summary as the real skill, but with `[DRY RUN]` in the banner:

```
═══════════════════════════════════════════════════════════════
  [DRY RUN] Welcome to Confidence!
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

Then show the Dry Run Summary banner.

---

## Sub-command: invite-user

### Step Tracker

```
───── [DRY RUN] Invite User ──────────────────────────────────
  [1] Authenticate       ○ pending
  [2] Target account     ○ pending
  [3] Invitation details ○ pending
  [4] Send invitation    ○ pending
──────────────────────────────────────────────────────────────
```

### Step 1: Authenticate

> [DRY RUN] Skipping browser login — using mock credentials.
> [DRY RUN] Authenticated as dryrun@example.com

> [DRY RUN] Would call `GET https://iam.eu.confidence.dev/v1/currentUser`
> [DRY RUN] Current user: Dry Run User (dryrun@example.com)

### Step 2: Target account

> [DRY RUN] Account: **Dry Run Demo** (dry-run-demo)

### Step 3: Invitation details

Same UX as the real skill. Ask for:

1. **Email address(es)** — required. Accept single or comma-separated. Validate format locally.
2. **Send invitation email?** — default yes.

### Step 4: Send invitation

For each email:

> [DRY RUN] Would call `POST https://iam.eu.confidence.dev/v1/userInvitations`

For single invite:
> [DRY RUN] Invitation sent to **<email>**!
> They'll receive an email with instructions to join.
> The invitation expires on Jun 17, 2026.

For batch invites, show a summary table:
```
[DRY RUN] Invitations sent:
  ✓ alice@example.com — expires Jun 17
  ✓ bob@example.com   — expires Jun 17
```

If any email fails local validation:
```
  ✗ charlie@invalid   — invalid email address
```

Then show the Dry Run Summary banner.

---

## Sub-command: create-client

### Step Tracker

```
───── [DRY RUN] Create Client ────────────────────────────────
  [1] Client name        ○ pending
  [2] Create client      ○ pending
  [3] Get credentials    ○ pending
──────────────────────────────────────────────────────────────
```

### Step 1: Client name

Same UX as the real skill:

> What should we call this client? (e.g., "iOS App", "Web Frontend", "Backend Service")

Wait for user input.

### Step 2: Create client

> [DRY RUN] Would call `POST https://iam.eu.confidence.dev/v1/clients`
> [DRY RUN] Client **<name>** created.

### Step 3: Get credentials

> [DRY RUN] Would call `POST https://iam.eu.confidence.dev/v1/clients/dry-run-client/credentials`

```
═══════════════════════════════════════════════════════════════
  [DRY RUN] Client Created
═══════════════════════════════════════════════════════════════

  Name:    <CLIENT_NAME>
  Secret:  dryrn_sk_mock1234567890abcdef

  Use this secret in your SDK configuration to resolve flags.
  Keep it safe — you can regenerate it, but the old one will
  stop working.

  Next: Ask me for SDK integration instructions, or run
        /onboard-confidence setup-wizard

═══════════════════════════════════════════════════════════════
```

Then show the Dry Run Summary banner.

---

## Sub-command: setup-wizard

### Step Tracker

```
───── [DRY RUN] Setup Wizard ─────────────────────────────────
  [1] Create client      ○ pending
  [2] Create flag        ○ pending
  [3] Add variants       ○ pending
  [4] Add targeting      ○ pending
  [5] Test resolve       ○ pending
  [6] Done               ○ pending
──────────────────────────────────────────────────────────────
```

### Prerequisites

> [DRY RUN] Skipping browser login — using mock credentials.
> [DRY RUN] Region: EU (from mock token)

### Step 1: Create client

> [DRY RUN] Would call `GET https://iam.eu.confidence.dev/v1/clients`
> [DRY RUN] No existing clients found. Creating one now.

Ask user for client name (same UX as real skill).

> [DRY RUN] Would call `POST https://iam.eu.confidence.dev/v1/clients`
> [DRY RUN] Client **<name>** created.
> [DRY RUN] Would call `POST https://iam.eu.confidence.dev/v1/clients/dry-run-client/credentials`
> [DRY RUN] Client secret generated.

### Step 2: Create flag

Same EDUCATE then ASK flow:

> A feature flag controls a piece of functionality. Let's create your first one.
> What should it be called? (e.g., "new-checkout-flow", "dark-mode")

Wait for user input. Validate: 4-63 chars, `[a-z0-9-]`.

> [DRY RUN] Would call `POST https://flags.eu.confidence.dev/v1/flags?flag_id=<FLAG_NAME>`
> [DRY RUN] Flag **<FLAG_NAME>** created.

### Step 3: Add variants

Same EDUCATE flow:

> Variants are the different values a flag can have. For a simple on/off flag, you'd have "on" and "off" variants.
>
> What variants should this flag have?
> 1. Simple on/off (boolean)
> 2. Custom variants (I'll name them)

Wait for user input.

> [DRY RUN] Would call `PATCH https://flags.eu.confidence.dev/v1/flags/<FLAG_NAME>` (set schema)
> [DRY RUN] Schema set.

For each variant:
> [DRY RUN] Would call `POST https://flags.eu.confidence.dev/v1/flags/<FLAG_NAME>/variants`
> [DRY RUN] Variant **<VARIANT>** created with value `<VALUE>`.

After all variants:
> [DRY RUN] Would call `POST https://flags.eu.confidence.dev/v1/flags/<FLAG_NAME>:addFlagClient`
> [DRY RUN] Flag attached to client.

### Step 4: Add targeting

Same EDUCATE flow:

> Targeting rules control who sees which variant. Let's set a default — you can add more rules later.
> Which variant should be the default?

Wait for user input.

> [DRY RUN] Would call `POST https://flags.eu.confidence.dev/v1/segments?segment_id=everyone`
> [DRY RUN] Segment "Everyone" created.
> [DRY RUN] Would call `PATCH https://flags.eu.confidence.dev/v1/segments/everyone` (set allocation)
> [DRY RUN] Would call `POST https://flags.eu.confidence.dev/v1/segments/everyone:allocate`
> [DRY RUN] Segment allocated at 100%.
> [DRY RUN] Would call `POST https://flags.eu.confidence.dev/v1/flags/<FLAG_NAME>/rules`
> [DRY RUN] Rule created — all users get variant **<DEFAULT>**.

### Step 5: Test resolve

> Let's verify the flag works by resolving it.

> [DRY RUN] Would call `POST https://resolver.eu.confidence.dev/v1/flags:resolve`
> [DRY RUN] Flag **<FLAG_NAME>** resolved to variant **<DEFAULT>** — it works!

Show mock resolve response:
```
[DRY RUN] Mock resolve result:
  Flag:    <FLAG_NAME>
  Variant: <DEFAULT>
  Value:   {"enabled": true}
  Reason:  RESOLVE_REASON_MATCH
```

### Step 6: Done

```
═══════════════════════════════════════════════════════════════
  [DRY RUN] Setup Complete!
═══════════════════════════════════════════════════════════════

  Client:   <CLIENT_NAME>
  Secret:   dryrn_sk_mock1234567890abcdef
  Flag:     <FLAG_NAME>
  Variants: <VARIANT_LIST>
  Default:  <DEFAULT_VARIANT>

  Your flag is live and resolving. Next steps:
  • Integrate the SDK: Ask me for setup instructions
  • Create more flags: Ask me or use the Confidence UI
  • Set up experiments: /onboard-confidence learn

═══════════════════════════════════════════════════════════════
```

Then show the Dry Run Summary banner.

---

## Sub-command: setup-warehouse

### Flow

Show the 4 warehouse options (same as real skill):

> Which data warehouse do you use?
> 1. BigQuery
> 2. Snowflake
> 3. Databricks
> 4. Redshift

After the user picks, run the corresponding warehouse-specific dry run below.

---

## Sub-command: setup-warehouse-bigquery

### Step Tracker

```
───── [DRY RUN] Setup Warehouse (BigQuery) ───────────────────
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
──────────────────────────────────────────────────────────────
```

### Step 1: Choose warehouse (already done)

Mark as `●`.

### Step 2: GCP Project ID

Same UX as real skill:

> What's your GCP project ID? Go to **Google Cloud Console** (console.cloud.google.com). Your project ID is shown in the top bar next to "Google Cloud". It looks like `my-company-prod` or `project-12345`.

Wait for user input.

### Step 3: Dataset name

Same UX:

> A dataset is like a folder in BigQuery where Confidence stores its tables. The default is `confidence`.
> If you don't have one yet, I can create it for you via `bq mk`.

Wait for user input (or accept default).

### Step 4: Service account

Same UX:

> A service account is a robot account that Confidence uses to write data to your BigQuery dataset.
> Go to **Google Cloud Console -> IAM & Admin -> Service Accounts**. Create one (e.g., `confidence-connector@<project>.iam.gserviceaccount.com`) or pick an existing one.
> It needs **BigQuery Data Editor** and **BigQuery Job User** roles.

Wait for user input.

### Step 5: Validate & fix

> [DRY RUN] Would call `POST https://metrics.eu.confidence.dev/v1/dataWarehouseConfig:validate`
> [DRY RUN] Validation passed! All checks succeeded:
>   - SERVICE_ACCOUNT: Service account access ✓
>   - PERMISSIONS: BigQuery permissions ✓
>   - DATASET: Dataset access ✓

Then show what gcloud commands would have been run if validation had failed:

> [DRY RUN] If validation had failed, these commands would fix it:
> ```
> # Grant Confidence access to your service account
> gcloud iam service-accounts add-iam-policy-binding <SA_EMAIL> \
>   --project=<PROJECT> \
>   --member="serviceAccount:account-dry-run-demo@spotify-confidence.iam.gserviceaccount.com" \
>   --role="roles/iam.workloadIdentityUser"
>
> # Grant BigQuery Job User
> gcloud projects add-iam-policy-binding <PROJECT> \
>   --member="serviceAccount:<SA_EMAIL>" \
>   --role="roles/bigquery.jobUser"
> ```

### Step 6: Create warehouse

> [DRY RUN] Would call `POST https://metrics.eu.confidence.dev/v1/dataWarehouses`
> [DRY RUN] Warehouse created: `dataWarehouses/dry-run-wh-123`

### Step 7: Create connectors

> [DRY RUN] Would call `POST https://connectors.eu.confidence.dev/v1/flagAppliedConnections`
> [DRY RUN] Flag assignment connector created: `flagAppliedConnections/dry-run-connector` (STATE_RUNNING)
>
> [DRY RUN] Would call `POST https://connectors.eu.confidence.dev/v1/eventConnections`
> [DRY RUN] Event connector created: `eventConnections/dry-run-events` (STATE_RUNNING)

### Step 8: Assignment table

> [DRY RUN] Would call `POST https://metrics.eu.confidence.dev/v1/assignmentTables`
> [DRY RUN] Assignment table created: `assignmentTables/dry-run-assignments`

Show the SQL that would be used:
```sql
SELECT targeting_key, rule, assignment_id, assignment_time
FROM `<PROJECT>.<DATASET>.assignments`
```

### Step 9: Verify pipeline

> [DRY RUN] Would resolve a flag and publish test events to verify data flow.

Show mock pipeline results:

```
[DRY RUN] Pipeline verification:
  ● Assignments: 1 row — data flowing
    dry-run-user -> on (2026-06-10T12:00:00Z)
  ● Events: 1 row — data flowing
    clicked_button on homepage (2026-06-10T12:00:00Z)
```

### Step 10: Done

```
═══════════════════════════════════════════════════════════════
  [DRY RUN] Data Warehouse Connected & Verified
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

Then show the Dry Run Summary banner.

---

## Sub-command: setup-warehouse-snowflake

### Step Tracker

```
───── [DRY RUN] Setup Warehouse (Snowflake) ──────────────────
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
──────────────────────────────────────────────────────────────
```

### Step 2: Account & user

Same UX as real skill. Ask for:
- **Account** — Snowflake account identifier (e.g., `zlvpqre-wr49874`)
- **User** — Snowflake user for Confidence to connect as

### Step 3: Role & warehouse

- **Role** — default `ACCOUNTADMIN`
- **Warehouse** — default `COMPUTE_WH`

### Step 4: Database & schema

- **Exposure database** — default `CONFIDENCE`
- **Exposure schema** — default `EXPOSURE`

Show the SQL that would be needed if the database/schema don't exist:
```sql
CREATE DATABASE IF NOT EXISTS <DATABASE>;
CREATE SCHEMA IF NOT EXISTS <DATABASE>.<SCHEMA>;
GRANT USAGE ON DATABASE <DATABASE> TO ROLE <ROLE>;
GRANT ALL ON SCHEMA <DATABASE>.<SCHEMA> TO ROLE <ROLE>;
```

### Step 5: Create crypto key

> [DRY RUN] Would call `POST https://iam.eu.confidence.dev/v1/cryptoKeys?crypto_key_id=snowflake-key`
> [DRY RUN] Crypto key created: `cryptoKeys/snowflake-key`
> [DRY RUN] Public key generated (mock RSA 2048-bit)

### Step 6: Register key in Snowflake

Show the ALTER USER SQL that would be generated:

> [DRY RUN] In the real flow, this SQL would be copied to your clipboard:
> ```sql
> ALTER USER <USER> SET RSA_PUBLIC_KEY='MIIBIjANBgkqhkiG9w0BAQE...mockkey...';
> ```

Ask: "Does another Confidence account share this Snowflake user?" (same as real skill). If yes, show `RSA_PUBLIC_KEY_2` variant.

### Step 7: Validate

> [DRY RUN] Would call `POST https://metrics.eu.confidence.dev/v1/dataWarehouseConfig:validate`
> [DRY RUN] Validation passed! All checks succeeded:
>   - AUTHENTICATION: Key-pair authentication ✓
>   - ROLE: Role access ✓
>   - WAREHOUSE: Warehouse access ✓
>   - DATABASE: Database access ✓
>   - SCHEMA: Schema access ✓

### Step 8: Create warehouse

> [DRY RUN] Would call `POST https://metrics.eu.confidence.dev/v1/dataWarehouses`
> [DRY RUN] Warehouse created: `dataWarehouses/dry-run-wh-123`

### Step 9: Create connectors

> [DRY RUN] Would call `POST https://connectors.eu.confidence.dev/v1/flagAppliedConnections`
> [DRY RUN] Flag assignment connector created (Snowflake -> <DATABASE>.<SCHEMA>.ASSIGNMENTS)
>
> [DRY RUN] Would call `POST https://connectors.eu.confidence.dev/v1/eventConnections`
> [DRY RUN] Event connector created (Snowflake -> <DATABASE>.<SCHEMA>.EVENTS_*)

### Step 10: Assignment table

> [DRY RUN] Would call `POST https://metrics.eu.confidence.dev/v1/assignmentTables`
> [DRY RUN] Assignment table created.

Show the SQL:
```sql
SELECT targeting_key, rule, assignment_id, assignment_time
FROM <DATABASE>.<SCHEMA>.ASSIGNMENTS
```

### Step 11: Verify pipeline

Show mock pipeline results:

```
[DRY RUN] Pipeline verification:
  ● Assignments: 1 row — data flowing
    dry-run-user -> on (2026-06-10T12:00:00Z)
  ● Events: 1 row — data flowing
    clicked_button on homepage (2026-06-10T12:00:00Z)
```

### Step 12: Done

```
═══════════════════════════════════════════════════════════════
  [DRY RUN] Data Warehouse Connected & Verified
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

Then show the Dry Run Summary banner.

---

## Sub-command: setup-warehouse-databricks

### Step Tracker

```
───── [DRY RUN] Setup Warehouse (Databricks) ─────────────────
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
──────────────────────────────────────────────────────────────
```

### Overview

Same overview as real skill:

> Setting up Databricks with Confidence requires three things:
>
> 1. **A Databricks workspace** — you need admin access to create a service principal (a robot account)
> 2. **An AWS account with an S3 bucket** — Confidence needs this as a staging area for loading data into Databricks. This is required even if your Databricks runs on GCP or Azure
> 3. **A schema in Databricks** — a place for Confidence to create tables (e.g., `confidence`)
>
> **How data flows:**
> Confidence collects your flag assignments and events internally, then writes parquet files to an S3 bucket you provide, and finally loads them into Databricks tables. This happens in batches every ~5 minutes.

### Step 2: Workspace URL

Same UX: ask for URL, extract hostname, confirm.

### Step 3: SQL Warehouse ID

Same UX: explain how to find it, ask for the ID.

### Step 4: Service principal

Same UX: explain how to create one, ask for Client ID and Secret.

For dry run, accept any values. Display:
> [DRY RUN] Service principal configured (mock credentials accepted).

### Step 5: AWS account & CLI

Same choice:
> Do you have the `aws` CLI set up, or would you prefer manual steps?
> 1. Set it up for me (requires `aws` CLI)
> 2. Show me the steps

> [DRY RUN] Skipping AWS CLI check — mock mode.

### Step 6: S3 bucket

Ask for bucket name (suggest `confidence-staging-dry-run-demo`) and region.

> [DRY RUN] Would run: `aws s3api create-bucket --bucket <BUCKET> --region <REGION>`
> [DRY RUN] S3 bucket `<BUCKET>` created in `<REGION>`.

### Step 7: IAM role

Show the trust policy that would be created:

> [DRY RUN] Would create IAM role with this trust policy:
> ```json
> {
>   "Version": "2012-10-17",
>   "Statement": [{
>     "Effect": "Allow",
>     "Principal": {"Federated": "accounts.google.com"},
>     "Action": "sts:AssumeRoleWithWebIdentity",
>     "Condition": {
>       "StringEquals": {
>         "accounts.google.com:sub": "123456789012345678901"
>       }
>     }
>   }]
> }
> ```
>
> [DRY RUN] Would create S3 access policy scoped to `<BUCKET>`.
> [DRY RUN] IAM role created: `arn:aws:iam::123456789012:role/confidence-databricks-staging`

### Step 8: Databricks schema

Same UX: ask for schema name (default `confidence`).

Show the SQL that would need to be run:

> [DRY RUN] In the real flow, this SQL would be copied to your clipboard:
> ```sql
> CREATE SCHEMA IF NOT EXISTS confidence;
> GRANT USE SCHEMA, CREATE TABLE ON SCHEMA confidence TO `<service-principal-client-id>`;
> ```

### Step 9: Create warehouse

> [DRY RUN] Note: Pre-validation is not available for Databricks.
> [DRY RUN] Would call `POST https://metrics.eu.confidence.dev/v1/dataWarehouses`
> [DRY RUN] Warehouse created: `dataWarehouses/dry-run-wh-123`

### Step 10: Create connectors

> [DRY RUN] Would call `POST https://connectors.eu.confidence.dev/v1/flagAppliedConnections`
> [DRY RUN] Flag assignment connector created (Databricks -> <SCHEMA>.assignments, S3 staging: <BUCKET>)
>
> [DRY RUN] Would call `POST https://connectors.eu.confidence.dev/v1/eventConnections`
> [DRY RUN] Event connector created (Databricks -> <SCHEMA>.events_*, S3 staging: <BUCKET>)

### Step 11: Assignment table

> [DRY RUN] Would call `POST https://metrics.eu.confidence.dev/v1/assignmentTables`
> [DRY RUN] Assignment table created.

Show the SQL:
```sql
SELECT targeting_key, rule, assignment_id, assignment_time
FROM <SCHEMA>.assignments
```

### Step 12: Verify pipeline

```
[DRY RUN] Pipeline verification:
  ● Assignments: 1 row — data flowing
    dry-run-user -> on (2026-06-10T12:00:00Z)
  ● Events: 1 row — data flowing
    clicked_button on homepage (2026-06-10T12:00:00Z)
```

### Step 13: Done

```
═══════════════════════════════════════════════════════════════
  [DRY RUN] Data Warehouse Connected & Verified
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

Then show the Dry Run Summary banner.

---

## Sub-command: setup-warehouse-redshift

### Step Tracker

```
───── [DRY RUN] Setup Warehouse (Redshift) ───────────────────
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
──────────────────────────────────────────────────────────────
```

### Overview

Same overview as real skill:

> Setting up Redshift with Confidence requires an **AWS account**. Here's what we'll set up:
>
> 1. **A Redshift cluster** — a data warehouse that stores your experiment data
> 2. **An S3 bucket** — a staging area where Confidence drops data files before loading them into Redshift
> 3. **An IAM role** — permissions that let Confidence write to S3 and load into Redshift
> 4. **A schema** — a folder inside Redshift where Confidence creates its tables
>
> **Important: Redshift Serverless won't work** — Confidence needs a provisioned cluster.

### Step 2: AWS account & CLI

Same choice as real skill. In dry run:

> [DRY RUN] Skipping AWS CLI check — mock mode.

### Step 3: Redshift cluster

Ask if they have one or want to create one. Same UX as real skill.

If creating:
> [DRY RUN] Would run:
> ```
> aws redshift create-cluster \
>   --cluster-identifier confidence-redshift-dry-run-demo \
>   --cluster-type single-node \
>   --node-type ra3.large \
>   --master-username admin \
>   --master-user-password <GENERATED> \
>   --db-name dev \
>   --region eu-west-1 \
>   --publicly-accessible
> ```
> [DRY RUN] Cluster `confidence-redshift-dry-run-demo` is running.

If using existing, ask for cluster name.

### Step 4: S3 bucket

Ask for bucket name and region (same UX).

> [DRY RUN] Would run: `aws s3api create-bucket --bucket <BUCKET> --region <REGION>`
> [DRY RUN] S3 bucket `<BUCKET>` created in `<REGION>`.

### Step 5: IAM role

Show the dual trust policy that would be created:

> [DRY RUN] Would create IAM role with dual trust policy:
> ```json
> {
>   "Version": "2012-10-17",
>   "Statement": [
>     {
>       "Effect": "Allow",
>       "Principal": {"Federated": "accounts.google.com"},
>       "Action": "sts:AssumeRoleWithWebIdentity",
>       "Condition": {
>         "StringEquals": {
>           "accounts.google.com:sub": "123456789012345678901"
>         }
>       }
>     },
>     {
>       "Effect": "Allow",
>       "Principal": {"Service": "redshift.amazonaws.com"},
>       "Action": "sts:AssumeRole"
>     }
>   ]
> }
> ```
>
> [DRY RUN] Would create S3 access policy scoped to `<BUCKET>`.
> [DRY RUN] Would create Redshift Data API policy.
> [DRY RUN] IAM role created: `arn:aws:iam::123456789012:role/confidence-redshift`

### Step 6: Attach role

> [DRY RUN] Would run:
> ```
> aws redshift modify-cluster-iam-roles \
>   --cluster-identifier <CLUSTER> \
>   --add-iam-roles arn:aws:iam::123456789012:role/confidence-redshift
> ```
> [DRY RUN] IAM role attached to cluster.

### Step 7: Schema & grants

Ask for schema name (default `confidence`).

Show the GRANT statements:

> [DRY RUN] In the real flow, these would be run against Redshift:
> ```sql
> CREATE SCHEMA IF NOT EXISTS <SCHEMA>;
> GRANT USAGE ON SCHEMA <SCHEMA> TO PUBLIC;
> GRANT CREATE ON SCHEMA <SCHEMA> TO PUBLIC;
> ```

### Step 8: Validate

> [DRY RUN] Would call `POST https://metrics.eu.confidence.dev/v1/dataWarehouseConfig:validate`
> [DRY RUN] Validation passed! All checks succeeded:
>   - CLUSTER: Cluster connectivity ✓
>   - IAM_ROLE: IAM role assumption ✓
>   - SCHEMA: Schema access ✓

### Step 9: Create warehouse

> [DRY RUN] Would call `POST https://metrics.eu.confidence.dev/v1/dataWarehouses`
> [DRY RUN] Warehouse created: `dataWarehouses/dry-run-wh-123`

### Step 10: Create connectors

> [DRY RUN] Would call `POST https://connectors.eu.confidence.dev/v1/flagAppliedConnections`
> [DRY RUN] Flag assignment connector created (Redshift -> <SCHEMA>.assignments, S3 staging: <BUCKET>)
>
> [DRY RUN] Would call `POST https://connectors.eu.confidence.dev/v1/eventConnections`
> [DRY RUN] Event connector created (Redshift -> <SCHEMA>.events_*, S3 staging: <BUCKET>)

### Step 11: Assignment table

> [DRY RUN] Would call `POST https://metrics.eu.confidence.dev/v1/assignmentTables`
> [DRY RUN] Assignment table created.

Show the SQL:
```sql
SELECT targeting_key, rule, assignment_id, assignment_time
FROM <SCHEMA>.assignments
```

### Step 12: Verify pipeline

```
[DRY RUN] Pipeline verification:
  ● Assignments: 1 row — data flowing
    dry-run-user -> on (2026-06-10T12:00:00Z)
  ● Events: 1 row — data flowing
    clicked_button on homepage (2026-06-10T12:00:00Z)
```

### Step 13: Done

```
═══════════════════════════════════════════════════════════════
  [DRY RUN] Data Warehouse Connected & Verified
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

Then show the Dry Run Summary banner.

---

## User-Facing Communication Rules

Follow the same rules as the real onboarding skill:

- **NEVER expose internal technical details** — but since this is a dry run, you DO show the mock API endpoints being "called" and mock response data. This is the point of the dry run.
- **DO show `[DRY RUN]` prefix** on every simulated action
- **DO show human-readable status updates** alongside the mock data
- **Step Tracker:** Display the step tracker at every phase transition, with `[DRY RUN]` in the title. Update it after each step completes.
- **Be conversational** — same tone as the real skill
- **Ask for real input** — workspace names, flag names, warehouse config values, etc. The user should experience the full interaction flow.

---

## Important: What NOT to do

- **Do NOT make any real HTTP calls** — no `curl`, no `open`, no `python3` auth scripts
- **Do NOT write files to disk** — no `$TMPDIR/confidence_auth.py`, no `~/.confidence/.auth_token`
- **Do NOT require `dangerouslyDisableSandbox: true`** — there are no external network calls
- **Do NOT use any MCP tools** — everything is simulated
- **Do NOT skip user input steps** — the entire point is to test the interaction flow
