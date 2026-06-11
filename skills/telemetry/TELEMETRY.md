# Telemetry Reference

Shared reference for all onboarding skills. This is NOT a skill — it has no frontmatter description and is never invoked directly.

## Overview

The onboarding telemetry system uses a dual-layer architecture:

- **Layer 1: Skill-Embedded Events (semantic)** — Curl calls in SKILL.md instructions emitted at each step transition. Captures *what* happened: step names, user choices, outcomes, timing. Works in all AI coding clients (Claude Code, Cursor, Codex, Gemini).

- **Layer 2: Claude Code Hooks (structural)** — `PostToolUse` hooks that fire automatically on every Bash tool call. Captures *how* it happened: API calls to confidence.dev, HTTP status codes. Acts as a reliability backstop. Claude Code only — hooks are not supported in other clients.

Both layers share a `session_id` for correlation.

### Telemetry Endpoint

```
POST https://onboarding.confidence.dev/v1/telemetry:publish
Authorization: Bearer $TOKEN  (or anonymous if no token available)
Content-Type: application/json
```

Events are fire-and-forget. The endpoint may not exist yet — that is fine. Curl calls will silently fail and never block the user.

---

## Opt-In / Consent

Controlled by the `CONFIDENCE_TELEMETRY` environment variable:

| Value | Behavior |
|-------|----------|
| `1` | Telemetry enabled |
| `0` | Telemetry disabled — no events emitted |
| unset | Show one-time consent prompt per session |

### Consent Prompt

When `CONFIDENCE_TELEMETRY` is unset, show this prompt once at the start of the session:

> Confidence collects anonymous usage data to improve onboarding. No secrets or personal details. Help us improve? (yes/no)

Based on the response:
- **yes** -> `TELEMETRY_ENABLED=true`
- **no** -> `TELEMETRY_ENABLED=false`

To set the variable for the session:

```bash
export CONFIDENCE_TELEMETRY=1   # enable
export CONFIDENCE_TELEMETRY=0   # disable
```

---

## Session ID

Generate once per skill invocation (at the start of each onboarding flow). Reuse across all events in that session.

```bash
SESSION_ID=$(python3 -c "import uuid; print(uuid.uuid4())")
```

Pass `SESSION_ID` through all events and export it so hooks can read it:

```bash
export SESSION_ID
```

---

## Emit Helper

Skills should use this exact pattern to emit a telemetry event. Copy-paste and fill in `<EVENT_TYPE>` and `<PROPERTIES>`.

```bash
if [ "$TELEMETRY_ENABLED" = "true" ]; then
  curl -s -X POST "https://onboarding.confidence.dev/v1/telemetry:publish" \
    -H "Content-Type: application/json" \
    ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
    -d '{
      "session_id": "'$SESSION_ID'",
      "events": [{
        "event_type": "<EVENT_TYPE>",
        "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
        "properties": {<PROPERTIES>}
      }]
    }' > /dev/null 2>&1 &
fi
```

Key details:
- `> /dev/null 2>&1 &` — fire-and-forget, never blocks the user flow
- `${TOKEN:+-H "Authorization: Bearer $TOKEN"}` — includes auth header only if TOKEN is set (anonymous otherwise)
- Always use UTC timestamps via `date -u`

---

## Event Catalog

| Event | When | Key Properties |
|-------|------|----------------|
| `onboarding.session_started` | Skill begins | `skill`, `subcommand`, `is_dry_run`, `plugin_version` |
| `onboarding.step_started` | Step tracker updates to in-progress | `step_number`, `step_name` |
| `onboarding.step_completed` | Step tracker updates to done | `step_number`, `step_name`, `duration_ms` |
| `onboarding.step_failed` | Step encounters an error | `step_number`, `step_name`, `error_category` (NOT raw message) |
| `onboarding.user_choice` | User picks an option | `choice_key`, `choice_value` (from allowlist only) |
| `onboarding.session_completed` | Flow finishes successfully | `total_duration_ms`, `steps_completed` |
| `warehouse.type_selected` | User picks a warehouse type | `warehouse_type` |
| `warehouse.validation_result` | Validation endpoint returns | `successful`, `failed_checks` |
| `warehouse.connector_created` | Connector is created | `connector_type` |
| `warehouse.pipeline_verified` | Pipeline verification completes | `assignments_ok`, `events_ok` |
| `onboarding.identity_linked` | After re-auth gives org-scoped token (create-account Step 5) | `org_id`, `account_name`, `region` — ties anonymous pre-account events to the new account |
| `onboarding.sentiment` | After each step, LLM self-assessment of user tone | `step_name`, `sentiment` (`frustrated`, `confused`, `satisfied`), `confidence` (`high`, `medium`) — only emit when signal is clear, skip neutral |
| `onboarding.session_sentiment` | At session_completed | `overall` (`positive`, `mixed`, `negative`), `frustrated_steps`, `satisfied_steps`, `confused_steps` |
| `onboarding.feedback` | End of completed flow, user rates experience | `rating` (1-4), `rating_label` (`easy`, `okay`, `hard`, `broken`), `subcommand` |
| `onboarding.feedback_text` | Optional free-text follow-up for ratings 3-4 | `text` (volunteered by user, exception to no-freeform rule), `subcommand` |
| `onboarding.session_abandoned` | SessionEnd hook fires without session_completed | `last_step_number`, `last_step_name`, `total_duration_ms` |
| `tool.api_call` | Hook detects curl to confidence.dev | `api_path`, `http_method`, `http_status` |

### Event Properties Reference

Common properties included in every event:

```json
{
  "skill": "onboard-confidence",
  "subcommand": "create-account",
  "plugin_version": "0.2.3",
  "is_dry_run": false
}
```

### Error Categories (allowlist)

Use these category strings in `error_category` — never log raw error messages:

- `auth_expired` — token expired or invalid
- `auth_failed` — authentication failed
- `validation_failed` — input or permission validation failed
- `server_error` — 5xx from the API
- `network_error` — connection timeout or DNS failure
- `conflict` — resource already exists (409)
- `not_found` — resource not found (404)
- `rate_limited` — too many requests (429)
- `unknown` — unrecognized error

### User Choice Keys (allowlist)

Only these `choice_key` / `choice_value` pairs may be logged:

| `choice_key` | Allowed `choice_value` values |
|--------------|-------------------------------|
| `region` | `eu`, `us` |
| `warehouse_type` | `bigquery`, `snowflake`, `databricks`, `redshift` |
| `auth_method` | `google`, `email`, `sso` |
| `variant_type` | `boolean`, `string`, `integer`, `double`, `struct` |
| `existing_client` | `yes`, `no` |

---

## Sentiment Detection

After each step completes, **silently assess the user's tone** from their messages during that step. Do NOT ask the user about their mood — just observe.

Emit `onboarding.sentiment` ONLY when the signal is clear:

| Sentiment | Signals | Examples |
|-----------|---------|----------|
| `frustrated` | Short angry messages, retries, confusion | "why?!", "doesn't work", "again?!", expletives |
| `confused` | Asking for clarification, wrong input repeatedly | "I don't understand", "what do you mean", long pauses |
| `satisfied` | Smooth progression, positive language | "great", "nice", "thanks", "easy", "perfect" |
| neutral | No clear signal | **Do not emit** — only emit when the signal is clear |

At `session_completed`, also emit `onboarding.session_sentiment` with counts of frustrated/confused/satisfied steps and an overall assessment.

## Identity Linking (create-account only)

During `create-account`, the user has no token for Steps 1-4 (account doesn't exist yet). Events are emitted anonymously with only `session_id`.

At Step 5 (re-auth), after obtaining the org-scoped token, emit `onboarding.identity_linked` to tie the anonymous session to the new account:

```bash
# After re-auth in create-account Step 5
emit_event "onboarding.identity_linked" 5 "connect_tools" \
  '"org_id": "'$ORG_ID'", "account_name": "'$ACCOUNT_ID'", "region": "'$REGION'"'
```

The backend stitches all events with the same `session_id` — before and after the identity link.

## Feedback Prompt

At the end of every **completed** flow (after the Done summary), ask:

> How was this experience?
> 1. Easy — worked great
> 2. Okay — got there eventually
> 3. Hard — needed help
> 4. Broken — something didn't work

Emit `onboarding.feedback` with the rating.

For ratings 3 ("hard") or 4 ("broken"), ask an optional follow-up:

> What was the hardest part? (optional, press Enter to skip)

If the user provides text, emit `onboarding.feedback_text`. This is the one exception to the "no freeform input" privacy rule — the user explicitly volunteered the feedback.

## Session Abandonment (Claude Code only)

The `SessionEnd` hook checks if `SESSION_ID` is set but `SESSION_COMPLETED` is not. If so, it emits `onboarding.session_abandoned` with the last known step. This is handled by `hooks/session_end_telemetry.py`.

---

## Privacy Rules

**NEVER log any of the following:**
- Tokens, secrets, passwords, API keys
- Email addresses or personal identifiers
- Full API response bodies
- Full shell commands
- Workspace names, flag names, or other freeform user input

**DO log:**
- Error categories from the allowlist above (not raw messages)
- User choices from the allowlist above (not freeform input)
- Step numbers and step names from the registry below
- Timing data (duration in milliseconds)
- Boolean outcomes (successful/failed, assignments_ok/events_ok)

---

## Step Name Registry

Canonical step names for each skill/subcommand. Use these exact strings in `step_name` properties.

### create-account (6 steps)

| Step | Name |
|------|------|
| 1 | `login` |
| 2 | `workspace_name` |
| 3 | `account_details` |
| 4 | `create_account` |
| 5 | `connect_tools` |
| 6 | `done` |

### invite-user (4 steps)

| Step | Name |
|------|------|
| 1 | `authenticate` |
| 2 | `target_account` |
| 3 | `invitation_details` |
| 4 | `send_invitation` |

### create-client (3 steps)

| Step | Name |
|------|------|
| 1 | `client_name` |
| 2 | `create_client` |
| 3 | `get_credentials` |

### setup-wizard (6 steps)

| Step | Name |
|------|------|
| 1 | `create_client` |
| 2 | `create_flag` |
| 3 | `add_variants` |
| 4 | `add_targeting` |
| 5 | `test_resolve` |
| 6 | `done` |

### setup-warehouse dispatcher (1 step)

| Step | Name |
|------|------|
| 1 | `choose_warehouse` |

### setup-warehouse-bigquery (10 steps)

| Step | Name |
|------|------|
| 1 | `choose_warehouse` |
| 2 | `gcp_project_id` |
| 3 | `dataset_name` |
| 4 | `service_account` |
| 5 | `validate_and_fix` |
| 6 | `create_warehouse` |
| 7 | `create_connectors` |
| 8 | `assignment_table` |
| 9 | `verify_pipeline` |
| 10 | `done` |

### setup-warehouse-snowflake (12 steps)

| Step | Name |
|------|------|
| 1 | `choose_warehouse` |
| 2 | `account_and_user` |
| 3 | `role_and_warehouse` |
| 4 | `database_and_schema` |
| 5 | `create_crypto_key` |
| 6 | `register_key_in_sf` |
| 7 | `validate` |
| 8 | `create_warehouse` |
| 9 | `create_connectors` |
| 10 | `assignment_table` |
| 11 | `verify_pipeline` |
| 12 | `done` |

### setup-warehouse-databricks (13 steps)

| Step | Name |
|------|------|
| 1 | `choose_warehouse` |
| 2 | `workspace_url` |
| 3 | `sql_warehouse_id` |
| 4 | `service_principal` |
| 5 | `aws_account_and_cli` |
| 6 | `s3_bucket` |
| 7 | `iam_role` |
| 8 | `databricks_schema` |
| 9 | `create_warehouse` |
| 10 | `create_connectors` |
| 11 | `assignment_table` |
| 12 | `verify_pipeline` |
| 13 | `done` |

### setup-warehouse-redshift (13 steps)

| Step | Name |
|------|------|
| 1 | `choose_warehouse` |
| 2 | `aws_account_and_cli` |
| 3 | `redshift_cluster` |
| 4 | `s3_bucket` |
| 5 | `iam_role` |
| 6 | `attach_role` |
| 7 | `schema_and_grants` |
| 8 | `validate` |
| 9 | `create_warehouse` |
| 10 | `create_connectors` |
| 11 | `assignment_table` |
| 12 | `verify_pipeline` |
| 13 | `done` |
