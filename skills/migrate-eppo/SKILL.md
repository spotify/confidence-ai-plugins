---
description: Migrate feature flags from Eppo to Confidence SDK. Use when the user says /migrate-eppo, asks to migrate Eppo flags, or transform SDK code to Confidence.
---

# Eppo to Confidence Migration

REST-driven, self-sufficient migration from Eppo to Confidence. This
skill is fully self-contained: it defines both the Eppo-specific
migration logic AND all the Confidence-side conventions it relies on
(payload formats, naming rules, the flag setup sequence, the execute
flow, etc.).

## SDK Preference

**ALWAYS prefer OpenFeature with local resolve.**

| Priority | Approach | When to use |
|----------|----------|-------------|
| 1st | Local resolve | Default for all new integrations |
| 2nd | Remote resolve | Only if local resolve not supported for platform |
| Avoid | Direct SDK | Being phased out |

## Plan Philosophy

**Plans must be self-sufficient and agent-agnostic.**

| Principle | Meaning |
|-----------|---------|
| **Source-boxed** | Every external data fetch uses one explicit channel (the Eppo REST API with curl, the Confidence MCP) — no ad-hoc browsing |
| **Self-sufficient** | Plan contains ALL information needed — no "query the source for X" at execute time |
| **Agent-agnostic** | Any agent with the prerequisites can execute the plan without prior context |
| **Language-agnostic** | Detect framework, fetch SDK guide from `confidence-docs` MCP dynamically |

## Commands

| Command | Description |
|---------|-------------|
| `/migrate-eppo plan flags` | Phase 1: plan flag definitions migration |
| `/migrate-eppo plan code` | Phase 2: plan code transformation |
| `/migrate-eppo execute <plan-file>` | Execute a plan interactively |

---

## Migration Overview (MUST display at start of `plan flags` or `plan code`)

**Every time** the user runs `plan flags` or `plan code`, display this
overview FIRST — before doing any work.

```
═══════════════════════════════════════════════════════════════
  Eppo → Confidence Migration
═══════════════════════════════════════════════════════════════

  The migration happens in two phases: flags first, then code.

  ┌─────────────────────────────────────────────────────────┐
  │  PHASE 1 — Flag Definitions                            │
  │                                                        │
  │  Move all flags from Eppo to Confidence with their     │
  │  allocations, targeting rules, and variation splits.   │
  │                                                        │
  │  Steps:                                                │
  │    1. Pick Eppo environment & scan all flags           │
  │    2. Choose a Confidence client (your app)            │
  │    3. Map subjectKey to a Confidence entity field      │
  │    4. Generate migration plan with targeting rules     │
  │    5. Execute: create each flag in Confidence          │
  │                                                        │
  │  Result: All flags live in Confidence, ready to resolve│
  ├─────────────────────────────────────────────────────────┤
  │  PHASE 2 — Code Transformation                         │
  │                                                        │
  │  Once flags exist in Confidence, migrate the code that │
  │  evaluates them. Each flag = one PR.                   │
  │                                                        │
  │  Steps:                                                │
  │    1. Detect language & framework                      │
  │    2. Fetch Confidence SDK guide                       │
  │    3. Scan codebase for Eppo usage                     │
  │    4. Generate transform rules (Eppo → Confidence)     │
  │    5. Generate plan grouped by flag                    │
  │    6. Execute: transform code flag by flag, one PR each│
  │                                                        │
  │  Result: Code uses Confidence SDK, Eppo removed        │
  └─────────────────────────────────────────────────────────┘

  Why flags first?
  Flags must exist in Confidence before code can resolve them.

  Why one PR per flag?
  Keeps changes small, reviewable, and independently shippable.
  If one flag's migration has issues, it doesn't block the others.

═══════════════════════════════════════════════════════════════
```

After displaying the overview, indicate which phase the user is about
to enter:

- For `plan flags`: "Starting **Phase 1** — Flag Definitions"
- For `plan code`: "Starting **Phase 2** — Code Transformation.
  Make sure Phase 1 (flag definitions) is complete first — the flags
  need to exist in Confidence before the code can resolve them."

Then proceed with the normal workflow for that phase.

---

## Prerequisites: Confidence Side

### Confidence MCP

Test: `mcp__confidence__listClients`

If not available, install it:
```
claude mcp add confidence --transport http --url https://mcp.confidence.dev/mcp/flags
```

The user will be prompted to authenticate via OAuth in their browser.

### Confidence Docs MCP (required for `plan code` only)

Test: `mcp__confidence-docs__searchDocumentation`

If not available, install it:
```
claude mcp add confidence-docs --transport http --url https://mcp.confidence.dev/mcp/docs
```

The user will be prompted to authenticate via OAuth in their browser.

## User-Facing Communication Rules

**NEVER expose internal technical details to the user.** The user should
see human-readable descriptions of what's happening, not internal
implementation details like targeting payload formats, rule types, or
operator names.

- Do NOT say "creating plan based on eqRule / rangeRule / setRule" etc.
- Do NOT show raw targeting payloads or JSON structures in conversation
- Do NOT echo any user-provided secret (API keys, tokens) back into the
  conversation or write them to the plan file — store them only as
  environment variables for the session
- DO say things like: "Creating flag with rule: plan equals 'pro' AND country is US or UK"
- DO describe rules in plain English: "age between 18 and 65", "plan is not free"
- The plan FILE may contain MCP command payloads (for machine execution),
  but conversation output must be human-friendly

## Prerequisites: Eppo Side

Eppo does not currently publish a Claude MCP server, so the migration
talks to Eppo's REST API directly using `curl` from the Bash tool.

### Required

1. An **Eppo API key** (NOT an SDK key). Generated in the Eppo
   dashboard under **Admin > API Keys**. The key needs read access to
   feature flags.
2. The Eppo API base URL — for most accounts this is
   `https://eppo.cloud/api/v1`. Self-hosted or region-specific
   deployments may use a different base — ask the user to confirm.

**Authentication header:** `X-Eppo-Token: <api-key>`

### ASK the user (only if not already provided)

> To read your Eppo flags, I need an Eppo API key (Admin > API Keys
> in the Eppo dashboard — make sure it has read access to feature
> flags).
>
> Please paste it here, or set it in your shell as `EPPO_API_KEY`
> before continuing.
>
> What's your Eppo API base URL? Default is `https://eppo.cloud/api/v1`.

### Storing the key

Once provided, store the key for the session in the environment
variable `EPPO_API_KEY` (export it in the Bash session the agent uses)
and reference it via `$EPPO_API_KEY` in every `curl` call — never
hardcode the key into the plan file, the conversation output, or any
committed file. If the user pastes a key inline, scrub it from the plan
file and only keep a placeholder like `<your-eppo-api-key>`. (See also
the "never echo secrets" rule in the User-Facing Communication Rules
above.)

### Smoke test before scanning

```bash
curl -sS -H "X-Eppo-Token: $EPPO_API_KEY" \
  "https://eppo.cloud/api/v1/feature-flags?offset=0&limit=1" \
  | head -c 200
```

If this returns a `401`/`403` or HTML, stop and surface the error to
the user — do not start scanning.

### Local testing (no Eppo account needed)

For development and CI smoke tests, this skill ships with a fake Eppo
server under `skills/migrate-eppo/test-fixtures/`. It implements the
four read endpoints with curated fixture flags that exercise every
operator-mapping branch. See that directory's `README.md` for usage —
short version is `python3 server.py`, then point this skill at
`http://127.0.0.1:3000/api/v1` when prompted for the base URL.

---

## Eppo REST Reference

The migration uses these endpoints. All require `-H "X-Eppo-Token: $EPPO_API_KEY"`.
Base URL defaults to `https://eppo.cloud/api/v1`.

> **Source of truth.** Field names and shapes here are taken directly from
> Eppo's OpenAPI 3.0 spec, embedded at
> <https://eppo.cloud/api/docs/swagger-ui-init.js> (public, no auth). Refer
> back to it if you encounter a field that isn't documented below.

| Purpose | Endpoint |
|---------|----------|
| List environments | `GET /environments` |
| List feature flags | `GET /feature-flags?offset=<n>&limit=<n>` |
| Get a single flag (full definition: variations, allocations, rules) | `GET /feature-flags/{id}` |
| Get environment-specific flag state (active + per-env allocations) | `GET /feature-flags/{id}/environments/{environmentId}` |
| Get a single audience (reusable targeting definition) | `GET /audiences/{id}` |
| List audiences (bare array; filters `name_search`/`status`, no offset/limit) | `GET /audiences` |

**Audiences (`PublicApiAudience`).** An audience is Eppo's reusable
targeting definition (the analogue of a Confidence segment). An
allocation references audiences via its `audiences[]` array of
`{ audience_id, type }` where `type` is `IS_IN` or `IS_NOT_IN`. Fetch
the definition with `GET /audiences/{audience_id}`; it returns:
- `id` (number), `name`, `description`, `is_archived`
- `targeting_rules[]` — **identical shape to a flag allocation's
  `targeting_rules[]`**: each rule is `{ id, conditions: [{ operator,
  attribute, values: [...] }] }`. Within a rule, conditions are ANDed;
  across rules, they are ORed. This means the **same operator-mapping
  table** below applies unchanged to audience conditions.

**Convention.** All field names are `snake_case`. All IDs are integers
(numeric Eppo Object IDs). All condition `values` are arrays even when
the operator only consumes a single value.

The flag object (`PublicApiFeatureFlag`) includes:
- `id` (number), `key` (string used in code as the first arg to
  `get_*_assignment`), `name`, `description`
- `is_archived` (boolean)
- `variation_type` — `BOOLEAN` / `INTEGER` / `JSON` / `NUMERIC` / `STRING`
- `variations[]` — each has `id` (number), `name`, `variant_key`
- `allocations[]` — ordered waterfall (top wins). Each allocation has:
  - `id`, `key`, `name`
  - `type` — `FEATURE_GATE` / `EXPERIMENT` / `SWITCHBACK`
  - `targeting_rules[]` — each rule is `{ conditions: [{ operator, attribute, values: [...] }] }`
  - `variation_weight[]` — array of `{ variation_id, weight }` referencing variations by numeric `id`
  - `audiences[]` — array of `{ audience_id, type }` where `type` is `IS_IN` or `IS_NOT_IN`
  - `percent_exposure` (0–100) — fraction of matched subjects that enter the allocation
  - `is_default` (boolean) — the default allocation sits at the bottom of the waterfall and supplies the "no match" variation
  - `experiment` — the linked Eppo experiment object, or `null` for non-experiment allocations
  - `environment_id` — only set on the env-scoped endpoint
- `environments[]` — per-environment state (`PublicApiFeatureFlagEnvironment`: `id`, `name`, `active`, `is_production`); allocations are NOT included here, only env status

The env-scoped endpoint (`GET /feature-flags/{id}/environments/{environmentId}`)
returns a `PublicApiFeatureFlagEnvironmentWithAllocation`: the env status
fields above PLUS `allocations[]` for that environment. This is the
canonical place to read the per-env waterfall.

**Default value lives on the allocation marked `is_default: true`**, not
on the flag. The default allocation has empty `targeting_rules[]` and
`audiences[]` and matches everyone; its `variation_weight[]` decides what
unmatched subjects see.

**Pagination.** Eppo uses `offset` + `limit` (both numbers), not cursors
and not page numbers. Loop:

```
offset = 0
LOOP:
  items = GET /feature-flags?offset=<offset>&limit=50
  process items
  if len(items) < 50 OR items is empty → STOP
  offset += 50 → continue LOOP
```

The list endpoint returns a **bare JSON array**, no wrapper object.

---

## Step Trackers

### Status markers

- `○ pending` — not started yet
- `◉ in progress` — currently running
- `⏸ awaiting user` — blocked on user input (e.g. picking a client or entity)
- `✓ done` — completed (add brief user-facing result)
- `⊘ skipped` — skipped by user

Use `⏸ awaiting user` whenever the workflow has asked a question and is
waiting for an explicit reply. This makes "I'm blocked on you" visible
to both agent and user, and prevents drifting into auto-progression
while a question is open.

**Never expose internal/technical details in the tracker.** No
pagination info, no API page counts, no internal field names. Show only
what matters to the user. **Update and re-display the tracker** at the
start and after each step completes.

### Execute progress bar

The execute step tracker includes a progress bar. Use `█` for completed
and `░` for remaining, 20 characters wide.

```
  Progress: [██████░░░░░░░░░░░░░░] 5/15 (1 skipped)
  Current:  complex-deployment-and-version
```

After each flag completes, show one of:

```
  ✓ flag-key — MATCH (variant-name)
  ⊘ flag-key — skipped
```

### Final summary (Execute)

At the end of execution, show a complete summary:

```
───── Migration Complete ──────────────────────────────────
  Progress: [████████████████████] 15/15 done
  Migrated: 14  |  Skipped: 1  |  Failed: 0

  ✓ flag-key-1                100%   user_id
  ✓ flag-key-2                50/50  user_id
  ⊘ flag-key-3                —      skipped
  ...
────────────────────────────────────────────────────────────
```

### Plan Flags step tracker

```
───── Plan Flags ──────────────────────────────────────────
  [1] Scan Eppo        ○ pending
  [2] Choose client    ○ pending
  [3] Map subject      ○ pending
  [4] Generate plan    ○ pending
────────────────────────────────────────────────────────────
```

Example after Step 1 completes:
```
───── Plan Flags ──────────────────────────────────────────
  [1] Scan Eppo        ✓ 12 flags found (environment: Production)
  [2] Choose client    ◉ in progress
  [3] Map subject      ○ pending
  [4] Generate plan    ○ pending
────────────────────────────────────────────────────────────
```

### Execute step tracker

```
───── Execute Migration ───────────────────────────────────
  Client: test  |  Subject: user_id  |  Flags: 12
  Progress: [░░░░░░░░░░░░░░░░░░░░] 0/12
────────────────────────────────────────────────────────────
```

---

## Confidence Naming Rules

- **Flag names:** lowercase letters, digits, and hyphens only (`[a-z0-9-]`).
  Eppo flag keys often already follow this convention; if not, normalize
  (e.g. `Checkout_Redesign` → `checkout-redesign`) and record the mapping
  in the plan so the code phase can find the right replacement.
- **Entity references:** Confidence entity names do NOT support underscores.
  The entity reference (e.g. `entities/company`) is separate from the context
  field name (e.g. `company_id`). When creating entity fields with
  `addContextField`, always provide an explicit `entityReference` with a
  clean name (no underscores). If omitted, the tool auto-generates one from
  the field name which will fail.

  | Field name | Entity reference | Works? |
  |------------|-----------------|--------|
  | `user_id` | `entities/user` | Yes |
  | `company_id` | `entities/company` | Yes |
  | `visitor_id` | `entities/visitor` | Yes |
  | `company_id` | *(omitted — auto: `entities/company_id`)* | **No** |

## Plan Files: Resume Check & Progressive Updates

Both plan flags and plan code use a progressive plan file. Created at
Step 1, updated after each step, so a closed session can resume.

### Resume check (MUST do first)

Before starting any plan workflow, check for an existing in-progress
plan:

- `plan flags` → `.claude/plans/eppo-flag-migration-*.md`
- `plan code`  → `.claude/plans/eppo-code-migration-*.md`

If a plan file exists, read its `## Generation Status` section:

- If status is `complete` → tell user a plan already exists, ask if
  they want to start fresh or use the existing one
- If status is NOT `complete` → **resume from the last incomplete step**.
  Tell the user: "Found an in-progress plan. Resuming from step <N>."
- If no plan file exists → start fresh

### Generation Status table

Every plan file MUST include a `## Generation Status` section at the
top that tracks which steps are done. Status values: `✓ complete`,
`◉ in progress`, `○ not started`. **After each step completes**, update
the status table AND write that step's data to the plan file. Do NOT
wait until the end to write.

## Plan Flag: Steps

The migration follows a 4-step plan flow: Step 1 scan Eppo, Step 2
choose a Confidence client, Step 3 map the randomization unit, Step 4
generate the MCP commands.

### Plan-file path

`.claude/plans/eppo-flag-migration-<date>.md`

### Step 1: Scan Eppo flags

**Step 1a — pick the source environment.**

Eppo's flag state (enabled, per-environment allocations) is scoped to
an environment. The user MUST choose which environment to migrate from.

```bash
curl -sS -H "X-Eppo-Token: $EPPO_API_KEY" \
  "https://eppo.cloud/api/v1/environments"
```

Show the user the list and ASK:

> Eppo configures flags per environment (Production, Staging, etc.).
> Which environment should I migrate flag definitions from?
>
> Your environments:
> 1. <env-1>
> 2. <env-2>
> ...
>
> Pick a number. (Production is usually the right answer for a real
> rollout migration.)

Set the step to `⏸ awaiting user` and wait for an explicit pick.

**Step 1b — list all flags. CRITICAL: paginate until exhausted.**

```
offset = 0
LOOP:
  items = curl GET /feature-flags?offset=<offset>&limit=50
  process items (bare array, no wrapper)
  if len(items) < 50 OR items is empty → STOP
  offset += 50 → continue LOOP
```

```bash
curl -sS -H "X-Eppo-Token: $EPPO_API_KEY" \
  "https://eppo.cloud/api/v1/feature-flags?offset=0&limit=50"
```

**Step 1c — fetch each flag's environment-scoped definition (in batches of 5).**

```bash
curl -sS -H "X-Eppo-Token: $EPPO_API_KEY" \
  "https://eppo.cloud/api/v1/feature-flags/<id>/environments/<environmentId>"
```

This is the env-scoped endpoint — it returns the flag's per-env
`active` state AND the full `allocations[]` for that environment in
one shot, which is everything Step 4 needs. You don't also need
`GET /feature-flags/{id}` unless you need cross-environment data.

**After each batch of 5**, write the flag data to the plan file —
append the flag sections to Section 4. This way if the session closes
mid-scan, the flags fetched so far are saved.

Skip flags that are **archived** in Eppo unless the user opts in. Ask
once up-front: "Include archived flags too? Default: no". The list
endpoint defaults to excluding archived; pass `include_archived=true`
in the query string if the user opted in.

Extract from each flag:

- `key`, `name`, `description` (if Eppo provides a description, include
  it; otherwise leave blank)
- `variation_type` and `variations[]` (each: `id`, `name`, `variant_key`)
- For the chosen environment (from the env-scoped endpoint):
  - `active` — flags inactive in the chosen environment still migrate,
    but with rollout 0% so they don't activate accidentally; surface
    this clearly in the plan
  - Ordered list of `allocations[]`. For each:
    - `type` (`FEATURE_GATE`, `EXPERIMENT`, or `SWITCHBACK`)
    - `percent_exposure` (0–100) → maps to Confidence rule `rolloutPercentage`
    - `targeting_rules[]` (`conditions: [{ operator, attribute, values: [...] }]`)
    - `variation_weight[]` — array of `{ variation_id, weight }`. Look up
      each `variation_id` against the flag's `variations[]` to recover
      `variant_key`
    - `audiences[]` — if non-empty, this allocation references reusable
      audience definitions. For each unique `audience_id`, fetch
      `GET /audiences/{audience_id}` and record its `name` +
      `targeting_rules[]` in the plan's Segments section (Section 3b).
      These become Confidence segments — see "Reusable audiences" under
      Operator Mapping.
    - `is_default` — the default allocation supplies the "no match"
      variation; emit it as the **final catch-all** Confidence targeting
      rule (no payload, 100% → its variation), since Confidence has no
      server-side flag default

**Step 1d — fetch referenced audiences (once per unique id).** While
scanning allocations, collect every `audiences[].audience_id` seen
across all migrated flags. For each unique id:

```bash
curl -sS -H "X-Eppo-Token: $EPPO_API_KEY" \
  "https://eppo.cloud/api/v1/audiences/<audienceId>"
```

Record each audience's `name` and `targeting_rules[]` in the plan so
`execute` can create one Confidence segment per audience and reuse it
across every flag that references it.

**Randomization unit.** Eppo always uses `subjectKey`. There's no
per-group bucketing concept built into the flag — group-level
experiments are handled by passing a `companyId` as the `subjectKey`.
For the migration, treat every flag as per-subject; the user picks which
Confidence entity field represents that subject in Step 3.

**After scan completes:** Update Generation Status step 1 to `✓ complete`.

### Step 2: Select Confidence client

```
mcp__confidence__listClients
```

**EDUCATE then ASK the user:**

> **What is a client?**
> A client represents the application that resolves flags — your website,
> backend service, or mobile app. Each client has its own secret for
> authentication and can be scoped to environments (dev, staging, prod).
> Flags are associated with one or more clients, so Confidence knows which
> application should receive which flags.
>
> Think of it like: "Where will these flags be evaluated?"
>
> Your existing clients:
> 1. <client-1>
> 2. <client-2>
> ...
> N. Create a new client
>
> Which client should I use as the default for all flags?
> You can always rearrange them later in the Confidence UI.

**Wait for an explicit pick.** Set the step to `⏸ awaiting user` and
stop. A re-run of the migration command, an empty message, or any reply
that is not a number from the list / `new <name>` is **not** consent —
NEVER infer the recommendation from silence. If the reply is ambiguous,
re-ask, listing the choices again.

- If user picks existing → use it
- If user wants new → ASK for name → `mcp__confidence__createClient`

**After client selected:** Write the "Default Client" section to the
plan file and update Generation Status step 2 to `✓ complete`.

### Step 3: Map Subject Key (Eppo-specific)

This step maps Eppo's `subjectKey` to a Confidence entity field.

**EDUCATE then ASK:**

> **What is a randomization unit (entity)?**
> An entity is the "thing" that gets randomly assigned to a variant —
> usually a user. The entity field (like `user_id` or `visitor_id`) is
> the identifier Confidence uses to ensure **consistent assignment**: the
> same user always sees the same variant.
>
> In Confidence, it maps to the `targetingKey` in the evaluation context.
>
> In Eppo, every assignment call passes a `subjectKey`. In your code I
> see calls like `get_string_assignment(flagKey, <subjectKey>, ...)` —
> the second argument. Which Confidence entity field is the same thing?
>
> Common choices:
> - **user_id** — if your flags target authenticated users
> - **visitor_id** — if targeting anonymous visitors (auto-generated by
>   Confidence client SDKs)
> - **company_id** — if your Eppo subject was a company / org / tenant
>
> Your client's existing entity fields:
> 1. <entity-field-1>
> 2. <entity-field-2>
> ...
> N. Create a new field
>
> Which Confidence field represents the same identifier as `subjectKey`?

Same wait-for-explicit-pick rule as Step 2 above. Silence is not
consent.

- If user picks existing → use it as `targetingKey`
- If user wants new → ASK for name + type → `mcp__confidence__addContextField`
  (always provide an explicit `entityReference` — see Confidence Naming
  Rules above)

**Eppo subject targeting (`id` attribute).** Eppo lets rules target the
subject directly via the special attribute `id`. When a rule references
`id`, map it to the chosen entity field's name in Confidence (the
context key for `targetingKey`). Record this substitution in Section 2
of the plan.

### Step 4: Generate MCP commands

**Confirmation gate (MUST pass before generating).** Before writing the
Flags to Migrate section, summarize the choices made in earlier steps
(client, randomization entity, AND the Eppo source environment chosen in
Step 1a) and ask:

> Plan will assume client `<client>` with randomization entity
> `<entity>`, migrating from Eppo environment `<env>`. All flags will be
> defaulted to `[ ] Migrate  [ ] Skip` (neither pre-checked) — you'll opt
> each one in during review. Confirm or change?

Set the step to `⏸ awaiting user` and stop. Only proceed on an explicit
`yes` / `confirm` / equivalent. A re-run or ambiguous reply is **not**
confirmation.

For each flag, generate the MCP command payloads (`createFlag`,
`addFlagToClient`, `addTargetingRule`, `resolveFlag`) using the Operator
Mapping table together with the Confidence Targeting Payload Format
(below). Write them into each flag's section in the plan.

**After all commands generated:** Update Generation Status step 4 to
`✓ complete`, set the overall status to `complete`, and tell the user:

> Plan generated! Review it at `.claude/plans/eppo-flag-migration-<date>.md`
>
> Migration is **opt-in**: every flag starts with both checkboxes empty.
> Tick `[x] Migrate` or `[x] Skip` for each flag — `execute` will refuse
> any flag with neither box set. When ready, run:
> `/migrate-eppo execute <plan-file>`

**Allocation → targeting-rule order.** Eppo allocations form a
waterfall — the first matching allocation wins. Confidence evaluates
targeting rules in declared order, so emit one `addTargetingRule`
call per Eppo allocation, in the same order.

---

## Confidence Targeting Payload Format

This is how Confidence targeting rules are structured. Use this when
generating `addTargetingRule` payloads.

**CRITICAL:** The payload uses a `criteria` + `expression` pattern.
Criteria are named references (`ref-0`, `ref-1`, ...) that define
individual conditions. The `expression` combines them with boolean
logic (`and`, `or`, `not`, `ref`).

```json
{
  "criteria": {
    "ref-0": {
      "attribute": {
        "attributeName": "<field>",
        "<rule>": { ... }
      }
    }
  },
  "expression": { "ref": "ref-0" }
}
```

**DO NOT use nested rule objects like `{"or": {"operands": [{"eqRule": ...}]}}`
at the top level.** That format is silently parsed as empty targeting
(matching ALL contexts) due to `ignoringUnknownFields()` in the proto
parser.

### Criterion rules

These mirror the canonical `Targeting` proto in the open-source
resolver (`spotify/confidence-resolver`,
`protos/confidence/flags/types/v1/target.proto`). The JSON wire form is
proto3 → JSON (camelCase keys).

| Match | Form |
|---|---|
| String eq | `"eqRule": { "value": { "stringValue": "X" } }` |
| Number eq | `"eqRule": { "value": { "numberValue": N } }` |
| Bool eq | `"eqRule": { "value": { "boolValue": true } }` |
| Version eq | `"eqRule": { "value": { "versionValue": { "version": "1.2.3" } } }` |
| String set (in) | `"setRule": { "values": [{ "stringValue": "A" }, { "stringValue": "B" }] }` |
| `>=` | `"rangeRule": { "startInclusive": { "numberValue": N } }` |
| `>` | `"rangeRule": { "startExclusive": { "numberValue": N } }` |
| `<` | `"rangeRule": { "endExclusive": { "numberValue": N } }` |
| `<=` | `"rangeRule": { "endInclusive": { "numberValue": N } }` |
| Version `>=` | `"rangeRule": { "startInclusive": { "versionValue": { "version": "2.0.0" } } }` |
| Version `<` | `"rangeRule": { "endExclusive": { "versionValue": { "version": "3.0.0" } } }` |
| Timestamp `>=` | `"rangeRule": { "startInclusive": { "timestampValue": "2022-11-17T15:16:17Z" } }` |
| starts with | `"startsWithRule": { "value": "prefix" }` |
| ends with | `"endsWithRule": { "value": "suffix" }` |
| attribute is set (exists) | `{ "attribute": { "attributeName": "X" } }` (attribute criterion with **no** inner rule) |
| segment membership | `{ "segment": { "segment": "segments/<id>" } }` (a whole criterion, not an `attribute` rule) |

**Value types.** A `Value` is a oneof: `boolValue`, `numberValue`,
`stringValue`, `timestampValue` (RFC-3339 string), `versionValue`
(`{ "version": "X.Y.Z" }`), or `listValue`. Equality (`==`, `!=`, set
membership) is defined for all types; comparison (`<`, `<=`, `>`, `>=`
via `rangeRule`) is defined for **number, timestamp, and version**.

**Version semantics.** The resolver parses version strings with 2–4
numeric segments (`1.2`, `1.2.3`, `1.2.3.4`), strips any pre-release
suffix after `-` (`1.2.3-beta` compares as `1.2.3`), and rejects
non-numeric or `v`-prefixed strings (`v1.0.0` → does not parse).
Send the version in the evaluation context as a plain string; the
`versionValue` criterion makes Confidence compare it as a version
rather than lexically.

**Set rule vs OR-of-eq.** `setRule` with multiple values is the native
"is one of" and is preferred over an `or` of `eqRule`s when realizing
list membership. Both resolve identically.

**Existence / null checks.** An attribute criterion with **no inner
rule** — just `{ "attribute": { "attributeName": "X" } }` — is a
presence check: it matches when attribute `X` is set. The resolver
compiles a ruleless attribute criterion to an existence test
(`spotify/confidence-resolver`, `ir_builder.rs`: the `_ =>` arm emits
`I64Neqz`), and the resolver's own spec fixtures include a bare
`{ "attributeName": "country" }` criterion. The admin API accepts it on
create (`epx-flags-admin` `TargetingValidator` does no structural
validation for `ATTRIBUTE` criteria). To express **"attribute is
null/absent"**, reference that criterion under `not`:

```json
{
  "criteria": {
    "ref-0": { "attribute": { "attributeName": "country" } }
  },
  "expression": { "not": { "ref": "ref-0" } }
}
```

Because it composes like any other criterion, "X is null AND Y = foo"
is expressible: `and(not(ref-x), ref-y)`. Note: the web segment editor
may not render a control for a ruleless criterion, so a null rule can
look empty in the UI even though it resolves correctly — call this out
in the plan when you emit one.

### Segment criteria

A criterion can reference a reusable **segment** instead of an inline
attribute rule. This is how you map an Eppo audience onto Confidence:
create the segment once with `createSegment`, then reference it from
each flag's targeting via a segment criterion.

```json
{
  "criteria": {
    "ref-0": { "segment": { "segment": "segments/eu-power-users" } }
  },
  "expression": { "ref": "ref-0" }
}
```

A segment criterion composes in the `expression` exactly like an
attribute criterion: wrap it in `not` to invert (membership exclusion),
or combine several with `and` / `or`.

### Default value (no server-side default → emit a catch-all rule)

Confidence has **no server-side flag default**. The `Flag` resource
carries variants and an ordered list of rules but no default-value
field (`createFlag` accepts none), and the resolver's contract is
explicit: *"each rule is tried in order; the first match assigns a
variant; if no rule matches, no variant is assigned."* When no rule
matches, the SDK returns **the default the caller passed at the call
site** (`getBoolValue(flag, false)`) — a `ClientDefaultAssignment`.

So Eppo's configured default variation (the value served when nothing
else matches) does **not** map to any flag-level field. To preserve it
faithfully, emit it as an explicit **catch-all final rule**:

- `addTargetingRule` with `variantAllocations` = `{ "<defaultVariant>": 100 }`
  and **no `payload`** (an omitted/empty payload targets all contexts).
- Add it **last**, after every specific rule, so it only catches
  subjects that matched nothing above it.

Without this rule, every no-match subject falls back to whatever default
the application code happens to pass — which the migration cannot
control — instead of Eppo's configured default.

### Expression combinators

| Pattern | Expression |
|---------|-----------|
| Single condition | `{ "ref": "ref-0" }` |
| AND | `{ "and": { "operands": [{ "ref": "ref-0" }, { "ref": "ref-1" }] } }` |
| OR | `{ "or": { "operands": [{ "ref": "ref-0" }, { "ref": "ref-1" }] } }` |
| NOT | `{ "not": { "ref": "ref-0" } }` |
| NOT IN (list) | Prefer one `setRule` criterion wrapped in `not`: `{ "not": { "ref": "ref-0" } }`. |
| attribute IS null | `not`-wrap a ruleless presence criterion: `{ "not": { "ref": "ref-0" } }` where `ref-0` is `{ "attribute": { "attributeName": "X" } }` |

### Worked examples

**Single equality (country = "US"):**
```json
{
  "criteria": {
    "ref-0": { "attribute": { "attributeName": "country", "eqRule": { "value": { "stringValue": "US" } } } }
  },
  "expression": { "ref": "ref-0" }
}
```

**IS null combined (country is not set AND plan = "free"):**
```json
{
  "criteria": {
    "ref-0": { "attribute": { "attributeName": "country" } },
    "ref-1": { "attribute": { "attributeName": "plan", "eqRule": { "value": { "stringValue": "free" } } } }
  },
  "expression": { "and": { "operands": [{ "not": { "ref": "ref-0" } }, { "ref": "ref-1" }] } }
}
```

**Version range (appVersion >= 2.0.0):**
```json
{
  "criteria": {
    "ref-0": { "attribute": { "attributeName": "appVersion", "rangeRule": { "startInclusive": { "versionValue": { "version": "2.0.0" } } } } }
  },
  "expression": { "ref": "ref-0" }
}
```

**Set membership (country in [US, UK, SE]):**
```json
{
  "criteria": {
    "ref-0": { "attribute": { "attributeName": "country", "setRule": { "values": [{ "stringValue": "US" }, { "stringValue": "UK" }, { "stringValue": "SE" }] } } }
  },
  "expression": { "ref": "ref-0" }
}
```

**Segment membership (in segment, AND country = US):**
```json
{
  "criteria": {
    "ref-0": { "segment": { "segment": "segments/beta-testers" } },
    "ref-1": { "attribute": { "attributeName": "country", "eqRule": { "value": { "stringValue": "US" } } } }
  },
  "expression": { "and": { "operands": [{ "ref": "ref-0" }, { "ref": "ref-1" }] } }
}
```

## Reusable Segments (createSegment)

When an Eppo audience is referenced by multiple flags, map it to a
Confidence **segment** rather than inlining its conditions into every
flag. A segment is created once and referenced from many flags' targeting
via a segment criterion (see "Segment criteria" above).

```
mcp__confidence__createSegment
  segmentId: "<clean-id>"            ← [a-z0-9-], 4–63 chars
  displayName: "<human name>"
  targeting: { "criteria": { ... }, "expression": { ... } }
```

This yields a segment named `segments/<clean-id>`, which you then
reference from each flag via `{ "segment": { "segment": "segments/<clean-id>" } }`.

**De-duplicate.** If several flags reference the same audience, create
the segment **once** and reuse its name everywhere. Maintain an
`audience_id → segments/<clean-id>` map in the plan file so `execute`
reuses the segment instead of recreating it. Before creating, check
whether the segment already exists (`listSegments` / `getSegment` if
available) and skip creation if so.

**Allocation/proportion.** A segment created for targeting reuse should
be allocated at 100% (it defines *who is eligible*, not a rollout
percentage). Rollout percentages belong on the flag's targeting rule.

## Multivariant A/B Split Handling

**CRITICAL:** A single Confidence targeting rule CAN assign multiple
variants at different split percentages. Use ONE rule per Eppo
allocation, listing all variants and their shares in that rule.

- Single-variant assignment (feature gate, kill switch): ONE rule with
  one variant at 100%.
- 2-variant flag (control 50% / treatment 50%): ONE rule with two
  variant assignments.
- 3+ variant flag (control 34% / A 33% / B 33%): ONE rule with three
  variant assignments.

**Do NOT create separate rules per variant.** One targeting rule = one
set of targeting conditions, with the variant split defined inside that
rule. The `rolloutPercentage` on the rule controls what fraction of
subjects who match the targeting conditions enter the rule at all (use
100% unless you want a partial rollout on top of the targeting). The
variant percentages within the rule control the split among those who
enter.

Eppo's `percent_exposure` maps to the rule's `rolloutPercentage`.
Subjects who match the targeting conditions but fall outside that
percentage continue down the waterfall to the next rule.

## Operator Mapping (Eppo → Confidence)

This is how Eppo operators map to the Confidence targeting payloads
defined above (criteria + expression, criterion rules, combinators,
examples). This table is the Eppo-side half.

Within a single Eppo rule, all `conditions` are ANDed. Across multiple
rules in the same allocation, conditions are ORed (any rule satisfying
means the allocation matches). Across allocations, each non-default
Eppo allocation becomes a **separate Confidence targeting rule** — see
the waterfall ordering note in Step 4 above. The `is_default`
allocation becomes the **catch-all final rule**: Confidence has no
server-side flag default (see "Default value" above), so its variation
must be emitted as a last `addTargetingRule` with
`variantAllocations { <defaultVariant>: 100 }` and no payload, placed
after every specific rule.

Eppo's operator enum (`ERuleConditionOperator`) is `LT`, `LTE`, `GT`,
`GTE`, `MATCHES`, `ONE_OF`, `NOT_ONE_OF`, `IS_NULL`. Conditions always
use array `values`, even when there's only one value.

### Numeric vs version comparisons (`GT` / `GTE` / `LT` / `LTE`)

Eppo's spec has no value-type field — comparison operators take string
`values`, and Eppo decides at evaluation time whether to compare
numerically or as a SemVer based on whether the value parses as a
version. Confidence supports **both** via the `Value` oneof, so detect
which one applies per condition:

- If `values[0]` matches `^\d+(\.\d+){1,3}(-.+)?$` (2–4 numeric
  segments, optional pre-release suffix) → treat as a **version
  comparison**: use `rangeRule` with `versionValue: { version: "<v>" }`.
- Otherwise, if `values[0]` parses as a plain number → **numeric
  comparison**: use `rangeRule` with `numberValue`.

| Eppo condition | Confidence payload strategy |
|---|---|
| `{operator: GT, values: ["N"]}` (numeric) | `rangeRule.startExclusive: { numberValue: N }`, expression: `ref` |
| `{operator: GTE, values: ["N"]}` (numeric) | `rangeRule.startInclusive: { numberValue: N }`, expression: `ref` |
| `{operator: LT, values: ["N"]}` (numeric) | `rangeRule.endExclusive: { numberValue: N }`, expression: `ref` |
| `{operator: LTE, values: ["N"]}` (numeric) | `rangeRule.endInclusive: { numberValue: N }`, expression: `ref` |
| `{operator: GTE, values: ["1.2.3"]}` (version) | `rangeRule.startInclusive: { versionValue: { version: "1.2.3" } }`, expression: `ref` |
| `{operator: LT, values: ["2.0.0"]}` (version) | `rangeRule.endExclusive: { versionValue: { version: "2.0.0" } }`, expression: `ref` |
| (GT / LTE version forms mirror the numeric rows, swapping `numberValue` → `versionValue`) | |

**Version caveats.** Confidence parses 2–4 numeric segments and strips
a `-suffix` pre-release tag (so `1.2.3-beta` compares as `1.2.3`). It
does **not** parse `v`-prefixed strings (`v1.2.3`) or build metadata
(`1.2.3+build`). If a version value is `v`-prefixed, strip the `v`
during translation and note it in the plan. If it can't be normalized
to the supported form, fall back to BLOCKED for that condition. The
context field must send the version as a plain string at resolve time;
the `versionValue` criterion is what makes Confidence compare it as a
version rather than lexically.

### Set membership (`ONE_OF` / `NOT_ONE_OF`)

| Eppo condition | Confidence payload strategy |
|---|---|
| `{operator: ONE_OF, values: ["A"]}` (singleton) | One criterion with `eqRule`, expression: `ref` |
| `{operator: ONE_OF, values: ["A","B",...]}` | One criterion with `setRule { values: [...] }`, expression: `ref` |
| `{operator: NOT_ONE_OF, values: ["A"]}` (singleton) | One criterion with `eqRule`, expression: `not` wrapping `ref` |
| `{operator: NOT_ONE_OF, values: ["A","B",...]}` | One criterion with `setRule { values: [...] }`, expression: `not` wrapping `ref` |

(`setRule` is the native "is one of" — prefer it over an `or`/`and` of
per-value `eqRule`s. They resolve identically; the set rule is just
fewer criteria.)

### Regex (`MATCHES`)

Confidence has no general regex rule, but `startsWithRule` /
`endsWithRule` cover the anchored prefix/suffix patterns that make up
the overwhelming majority of real Eppo `MATCHES` rules — including
alternation, which decomposes into an `or` of literal prefixes/suffixes.

| Eppo `MATCHES` value | Confidence payload strategy |
|---|---|
| `^prefix.*` / `^prefix` | One `startsWithRule { value: "prefix" }`, expression: `ref` |
| `.*suffix$` / `suffix$` | One `endsWithRule { value: "suffix" }`, expression: `ref` |
| `^(a\|b\|c).*` (prefix alternation) | One `startsWithRule` criterion **per branch**, expression: `or` of `ref`s |
| `.*@(test\|qa)\.com$` (suffix alternation) | Expand each branch to a literal suffix (`@test.com`, `@qa.com`), one `endsWithRule` per branch, expression: `or` of `ref`s |

**Decomposition rule.** A `MATCHES` value is auto-migratable when, after
stripping anchors (`^`/`$`) and any leading/trailing `.*`, the remainder
is **literal text containing at most one alternation group** `(x|y|...)`
and no other regex metacharacters (no `[]`, `+`, `?`, `{}`, `\d`, `\w`,
`.` used as wildcard, etc.; escaped literals like `\.` count as the
literal char). Enumerate the alternation to produce literal
prefixes/suffixes and emit one `startsWithRule`/`endsWithRule` per
branch, OR'd together. Anything else is BLOCKED (see below).

### Null checks (`IS_NULL`)

Confidence **does** have a null/existence check. An attribute criterion
with no inner rule — `{ "attribute": { "attributeName": "X" } }` — is a
presence test ("X is set"); wrap it in `not` for "X is null/absent". See
"Existence / null checks" above for the proof (resolver
`ir_builder.rs` existence arm, resolver spec fixtures, and
`epx-flags-admin` `TargetingValidator` accepting ruleless attribute
criteria on create).

So `IS_NULL(attr)` translates directly: emit a ruleless presence
criterion on `attr` and reference it under `not` in the expression.

| Eppo `IS_NULL` shape | Confidence strategy |
|---|---|
| `IS_NULL` is the **sole condition** of its allocation | Criterion `ref-0 = { "attribute": { "attributeName": "<attr>" } }`, expression `{ "not": { "ref": "ref-0" } }`, assigned to the allocation's variant. |
| `IS_NULL` **combined** (ANDed) with other conditions in the same rule | Emit the presence criterion plus the other criteria, e.g. `and(not(ref-null), ref-other)`. Each non-null condition uses its normal mapping. |
| `IS_NULL` as one branch of an OR across rules | Same — `not(ref-null)` becomes one operand of the allocation's `or`. |

Caveat: the web segment editor may not render a control for a ruleless
criterion, so a migrated null rule can look empty in the UI even though
it resolves correctly. Note this in the plan whenever you emit one.

### Reusable audiences (`audiences[]`) → Confidence segments

An allocation's `audiences[]` reference reusable Eppo audiences. These
map directly onto Confidence **segments** (see "Reusable Segments" and
"Segment criteria" above). For each referenced audience:

1. Fetch `GET /audiences/{audience_id}` (once per unique id; cache it).
2. Translate the audience's `targeting_rules[]` using **this same
   operator table** (the shapes are identical) into a `criteria` +
   `expression` payload.
3. Create a Confidence segment (`createSegment`) named after the
   audience, allocated at 100%. De-duplicate: if several flags reference
   the same audience, create the segment once and reuse its name (track
   the `audience_id → segments/<id>` map in the plan).
4. In the allocation's targeting rule, add a **segment criterion**
   `{ "segment": { "segment": "segments/<id>" } }` and compose it into
   the expression:
   - `type: IS_IN` → reference the segment criterion directly (`ref`)
   - `type: IS_NOT_IN` → wrap the segment ref in `not`
   - Multiple audiences and/or inline `targeting_rules[]` on the same
     allocation → AND all the parts together in the expression.

An audience is BLOCKED only if one of *its* conditions is itself
blocked (generic regex) — same rules as inline
conditions.

### Eppo subject `id` targeting

`{operator: ONE_OF, attribute: "id", values: [...]}`: the special `id`
attribute targets the subject key directly. Rewrite `attribute` from
`id` to the chosen Confidence entity field name from Step 3 (e.g.
`user_id`). Use a `setRule` for multi-value lists. Eppo caps these at
50 values; Confidence handles larger sets.

### Blocked (manual review)

Only these genuinely have no clean Confidence translation (a ruleless
presence criterion covers null checks, so IS_NULL is no longer here):

- **Generic `MATCHES` regex** — anything that fails the decomposition
  rule above (character classes, quantifiers, wildcard `.`, backrefs,
  multiple alternation groups, etc.). Reason: `Uses a regex on
  '<attribute>' that isn't a prefix/suffix/alternation; Confidence has
  no general regex rule.`
- **`SWITCHBACK` allocations** — Eppo switchback deliberately rotates a
  *single subject* through *different* variations across consecutive
  **time windows**, for experiments on temporally-correlated outcomes
  (surge pricing, dispatch routing, etc.). The blocker is the
  time-window rotation specifically: Confidence has no time-bucketed
  exposure primitive — its assignment model is the opposite, keeping a
  subject on one variant. (Note this is *not* a sticky-assignment gap:
  Confidence supports consistent per-subject assignment natively, and
  goes further with a materialization API. Switchback just isn't that.)
  Mark the entire **flag** `BLOCKED` with the reason `Contains SWITCHBACK
  allocation; Confidence has no time-windowed exposure. Migrate manually
  or skip.`
- **Unnormalizable version strings** — version values that aren't
  `v`-strippable into the supported 2–4-segment form (see Version
  caveats). Reason: `Version comparison on '<attribute>' uses a format
  Confidence can't parse.`

When an allocation is blocked, mark it in Section 4 (per the template).
A flag is fully blocked only when *every* non-default allocation is
blocked or it contains a SWITCHBACK allocation.

### Worked example (waterfall)

A three-allocation Eppo flag — internal users gate at 100% treatment,
then a 50/50 experiment on US/CA users, then an `is_default` allocation
serving `control` — becomes THREE `addTargetingRule` calls in order:

1. Rule 1: `email endsWith @spotify.com` → `treatment` at 100%
2. Rule 2: `country ONE_OF ["US", "CA"]` (one `setRule`) → `control`
   50%, `treatment` 50%
3. Rule 3 (catch-all default): no payload → `control` at 100%. This
   reproduces the `is_default` allocation, since Confidence has no
   server-side flag default; it MUST come last.

If an allocation referenced an audience instead (e.g. `IS_IN` the
"eu-power-users" audience), `execute` would first `createSegment`
`segments/eu-power-users` from that audience's targeting rules, then the
allocation's rule would use a segment criterion
`{ "segment": { "segment": "segments/eu-power-users" } }`.

(See the worked examples above for the exact JSON payload shape,
including version, set, and segment criteria.)

---

## Plan Flag: Template

```markdown
# Eppo to Confidence Flag Migration Plan

**Created:** <date>
**Scope:** Flag definitions only
**Eppo source environment:** <chosen-environment>

---

## Generation Status

| Step | Status | Result |
|------|--------|--------|
| 1. Scan Eppo | ○ not started | |
| 2. Choose client | ○ not started | |
| 3. Map subject | ○ not started | |
| 4. Generate rules | ○ not started | |

**Overall:** in progress

---

## 1. Default Client

A client represents the application that resolves flags (e.g. your
website, backend service, or mobile app). Each client authenticates
with its own secret and can be scoped to environments (dev, staging,
prod). Flags are associated with clients so Confidence knows which
application receives which flags.

**Available Clients:** <list from MCP>

**Selected:** `<client>`

---

## 2. Subject Mapping

An entity is the "thing" being randomly assigned to a variant — usually
a user. The entity field (like `user_id` or `visitor_id`) is the
identifier Confidence uses for consistent assignment: the same subject
always sees the same variant.

Eppo's `subjectKey` (the second argument to every `get_*_assignment`
call) maps to one Confidence entity field.

**Available Entity Fields:** <entity fields from MCP>

**Selected:** `<selected-entity>`

Any Eppo rules that targeted the special `id` attribute (subject-key
targeting) are rewritten to target `<selected-entity>`.

---

## 3. Context Schema

The context schema defines what fields Confidence expects in the
evaluation context when resolving flags — things like `country`,
`plan`, or `appVersion` that targeting rules use to decide who gets
what.

### Already in Confidence

| Field | Type | Entity | Eppo Attribute |
|-------|------|--------|----------------|
<matching fields>

### Need to Create

| Field | Type | Entity | Eppo Attribute |
|-------|------|--------|----------------|
<missing fields — execute will create these>

### Confidence-only (not in Eppo)

| Field | Type | Entity |
|-------|------|--------|
<reference only, no action needed>

---

## 3b. Segments (from Eppo audiences)

Reusable Eppo audiences referenced by any migrated flag's allocations.
Each becomes ONE Confidence segment, created once and reused across all
flags that reference it. `execute` creates these BEFORE the flags that
reference them.

| Eppo audience id | Audience name | Confidence segment | Targeting (plain English) | Status |
|------------------|---------------|--------------------|---------------------------|--------|
| <id> | <name> | `segments/<clean-id>` | <conditions> | <OK / BLOCKED: reason> |

**Segment MCP commands** (per audience, in dependency order):
<createSegment payload with criteria + expression translated from the audience's targeting_rules; allocation 100%>

If there are no audiences, this section reads "None — no flags reference
Eppo audiences."

---

## 4. Flags to Migrate

**Migration is opt-in.** Each flag starts with both checkboxes empty.
Tick `[x] Migrate` for every flag you want to bring across, or
`[x] Skip` to drop it. Flags with neither box ticked will be refused
by `execute` — no implicit defaults.

### Flag: `<flag-key>`

**Description:** <from Eppo if available, otherwise empty>
**Variation type:** <BOOLEAN / INTEGER / JSON / NUMERIC / STRING>
**Variations:** <variant_key — value list, e.g. "control = false, treatment = true">
**Confidence resolve path:** `<flag-key>.<property>` (Phase 2 reads this; e.g. `<flag-key>.enabled` for BOOLEAN, `<flag-key>.value` for other scalars — see "Variation type → Confidence schema")
**Active in `<env>`:** <yes / no — if no, all rules will be added at 0% rollout and flag created in the OFF state>
**Allocations (Eppo, in order):**
  1. `<allocation name>` (`<FEATURE_GATE | EXPERIMENT>`) — <plain-English rule>, exposure <X>%, splits <variant=X%, ...> <if audience-referencing: "via segment(s) segments/<id>">
  2. ...
**Default allocation:** `<allocation name>` (is_default: true) → variation `<variant_key>`
**Segments referenced:** <none, or list of segments/<id> from Section 3b>
**Null rules emitted:** <none, or "IS_NULL on '<attr>' → ruleless presence criterion under `not`; may render empty in the segment editor">
**Confidence entity:** <mapped entity field from Step 3>
**Confidence rules:** one targeting rule per non-default allocation, in the same order, plus a final catch-all rule (no payload, 100% → default variant) for the `is_default` allocation
**Action:** [ ] Migrate  [ ] Skip

If any allocation or the whole flag is BLOCKED, replace the **Action**
line with:

**Status:** BLOCKED — <one-line reason from the BLOCKED rules above>
**Action:** [ ] Skip (no migrate option available until the block is resolved)

**MCP Commands:**
<createFlag, addFlagToClient, addTargetingRule (ONE per non-default allocation, in order, with variant assignments and their split) THEN a final catch-all addTargetingRule (no payload, 100% → is_default allocation's variation), resolveFlag with full parameters — positive AND negative case (negative must land on the catch-all and return the default variation)>

---

## 5. Progress

| # | Flag | Status |
|---|------|--------|
| 1 | <flag> | :white_circle: |
```

---

## Execute: How It Works

`execute <plan-file>` walks through the plan interactively, step by step.

### For flag plans

```
1. READ the plan file
   - Client is already in the plan — use it, do NOT re-ask
   - Randomization entity and the Eppo source environment are in the plan
   - REFUSE TO PROCEED if any flag has neither `[x] Migrate` nor
     `[x] Skip` ticked. List those flags back and ask the user to tick a
     box for each. Migration is opt-in — never assume a default.
   - REFUSE TO PROCEED if any flag is marked `BLOCKED` and the user
     hasn't either resolved the block or ticked `[x] Skip`. Surface the
     BLOCKED flags and the reason for each.
2. FOR EACH FLAG marked [x] Migrate:
   - Show flag name, description, and rules in plain English
   - ASK: "Create this flag in Confidence? [Yes / Skip / Pause]"
   - If Yes → run the Flag Setup Sequence (below)
   - CHECKPOINT: "Flag done. [Continue / Pause]?"
   - Wait for user response
3. COMPLETION
   - Show summary: created vs skipped
```

### For code plans

**Each flag = one PR.** The code migration creates a separate pull
request for each flag, keeping changes small and reviewable.

```
1. READ the plan file
2. SDK SETUP (Section 1 of plan) — one-time, before any flag
   - Show install command from plan
   - ASK: "Install SDK now? [Yes / Skip / I already did]"
   - Show wrapper file path + API surface from plan
   - ASK: "Create the Confidence wrapper now? [Yes / Skip / I already did]"
3. FOR EACH FLAG in the files list:
   a. Create a branch: `migrate/<flag-key>-to-confidence`
   b. Show flag name + all files using it
   c. ASK: "Transform this flag's files? [Yes / Skip / Pause]"
   d. If Yes → apply transform rules from plan to all files for this flag
   e. Run lint + typecheck on changed files
   f. Commit changes
   g. Create PR titled: "feat: migrate <flag-key> from Eppo to Confidence"
   h. CHECKPOINT: "PR created. [Continue to next flag / Pause]?"
4. COMPLETION — show summary + list all PRs created
```

### Flag Setup Sequence (MUST complete all steps before resolving)

Each flag MUST go through these steps in order. Do NOT call
`resolveFlag` until ALL prior steps succeed.

```
STEP 1: createFlag
  → If flag already exists, check the response for which clients
    it's enabled on.

STEP 2: Ensure flag is active and on the correct client
  → If createFlag response does NOT list the target client:
    a. Try addFlagToClient
    b. If that fails with "Cannot update an archived flag":
       → unarchiveFlag first, then retry addFlagToClient
  → If createFlag response lists the target client: proceed

STEP 3: addTargetingRule
  → Add the targeting rule(s) from the plan. Emit one addTargetingRule
    call per Eppo allocation in the SAME ORDER (Confidence evaluates
    rules top-down — order is semantically significant).
  → Add Eppo's is_default allocation LAST as a catch-all rule:
    addTargetingRule with variantAllocations { <defaultVariant>: 100 }
    and NO payload (empty payload = targets all contexts). Confidence has
    no flag-level default (see "Default value" above), so this is the
    only way to reproduce it. It MUST come after every specific rule.
  → IMPORTANT: targeting rules added while a flag is archived OR
    immediately after unarchiving may become inactive. Always complete
    steps 1-2 fully BEFORE calling addTargetingRule.

STEP 4: resolveFlag (verification)
  → MUST test BOTH positive AND negative cases:
    a. Resolve with a context that SHOULD match → verify expected variant
    b. Resolve with a context that SHOULD NOT match any specific rule →
       verify it lands on the catch-all and returns Eppo's default variant
  → For multi-rule flags, also resolve with a context that misses the
    first rule but matches a later one — verifies waterfall order.
  → For attribute-based targeting, the resolve call MUST include those
    attributes in the evaluation context.
  → Do NOT report a flag as successfully migrated until both positive and
    negative resolve tests pass.
```

### Rules

- **NEVER auto-continue** — always wait for user at each checkpoint
- **Flag-by-flag** — each flag is one unit (its files + tests)
- **Preserve source order** — one Confidence rule per Eppo allocation, in
  the same order
- **Resumable** — update the Progress table in the plan file after each step

## Execute: Eppo-Specific Notes

**Create segments first (Section 3b).** Before processing any flag,
create the Confidence segments listed in Section 3b — flags reference
them by name, so they must exist first. For each audience-derived
segment:
1. If a `listSegments`/`getSegment` lookup shows the segment already
   exists, skip creation (idempotent re-runs).
2. Otherwise `createSegment` with the translated `criteria` +
   `expression` from the plan, allocation 100%.
3. Record the `audience_id → segments/<id>` mapping so every flag that
   references the audience uses the same segment. Skip any segment
   marked BLOCKED — and skip/flag the flags that depend on it.

**Inactive-in-environment handling.** If a flag's `active` flag is
false in the source Eppo environment, surface that during execute:

> This flag is INACTIVE in Eppo (<env>). I'll create it in Confidence
> but keep the rules at 0% rollout so it stays off until you turn it on
> intentionally. Continue?

**Variation type → Confidence schema (and the resolve-path handoff to
Phase 2).** A Confidence flag is a struct, not a bare scalar, so each
flag needs a named **property** that holds the migrated value. Use the
Eppo `variation_type` to pick the property type, and a deterministic
property name so Phase 2 can reconstruct the resolve path without
guessing:

| Eppo `variation_type` | Confidence schema (`schemaObject`) | Resolve path |
|-----------------------|------------------------------------|--------------|
| `BOOLEAN` | `{ "enabled": "boolean" }` (the `createFlag` default) | `<flag>.enabled` |
| `STRING` | `{ "value": "string" }` | `<flag>.value` |
| `INTEGER` | `{ "value": "integer" }` | `<flag>.value` |
| `NUMERIC` | `{ "value": "double" }` | `<flag>.value` |
| `JSON` | the variation object's own shape (nested struct) | `<flag>.<prop>` per field |

Include all Eppo variations as Confidence variants, wrapping each Eppo
`value` under the chosen property — e.g. a boolean flag's
`control = false` becomes `{ "name": "control", "value": { "enabled": false } }`.
Record the resolve path on the flag's plan entry (the **Confidence
resolve path** line) — Phase 2's code transform reads it verbatim.

**Default value → catch-all rule.** Take the variation referenced by
the allocation with `is_default: true` (its
`variation_weight[0].variation_id`, resolved against `variations[]`).
`createFlag` has no default field, so emit this variation as the
**final** `addTargetingRule` with `variantAllocations
{ <defaultVariant>: 100 }` and **no payload** (empty payload targets
all contexts). It MUST be added after every non-default allocation's
rule so it only catches subjects that matched nothing above. See
"Default value" above for why this is required.

**Waterfall verification.** Because Eppo flags often have multiple
allocations, the Flag Setup Sequence Step 4 (above) requires you to
also resolve with a context that misses the first allocation but
matches a later one — this verifies the waterfall order is preserved.

---

## Plan Code: Steps

The code phase has 5 steps: Step 1 detect language/framework, Step 2
fetch the Confidence SDK guide (and signal any resolve-mode change),
Step 3 scan the codebase for Eppo usage, Step 4 generate transform
rules, Step 5 generate the plan.

### Step 1: Detect language & framework

```
Grep: pattern="<Eppo import/symbol patterns from Step 3>"  → Find Eppo usage
Glob: pattern="package.json" or "build.gradle" or "Cargo.toml" or "pyproject.toml" etc
Read: dependency file  → Determine language/framework
```

### Step 2: Fetch SDK guide from `confidence-docs` MCP

**Step 2a — pick the target resolve mode.** Confidence has FOUR modes,
not a local/remote binary. Pick from the language/framework detected in
Step 1, honoring the "prefer local resolve" policy (see "SDK
Preference"):

| Target mode | Confidence SDKs | How evaluation works | Network profile |
|-------------|-----------------|----------------------|-----------------|
| **In-process** (local resolve) | backend **Java, Go, JS/Node, Rust** | Periodically fetch the resolver **state** (full ruleset); evaluate locally via WASM | No per-eval network call; network only for state refresh + sticky/materialization |
| **Cached client** | **Android, iOS, web/browser JS, React, React Native** | Backend resolves; device **prefetches and caches resolved VALUES** (not the ruleset). Reads are local + offline. Context change triggers a refetch | Network on init / context change / refresh — NOT per read |
| **Server-precomputed** | server-rendered React/Next.js (RSC) | Server resolves for a bound subject; client reads resolved values offline. No client-side ruleset | Resolution on the server; client reads are offline |
| **Remote** (per-call) | backend **Python, Ruby, .NET** | Each resolve is a service call to Confidence | One call per resolve (with default-value fallback on failure) |

Routing:

- Backend **and** language ∈ {Java, Go, JS/Node, Rust} → **in-process**.
  Fetch the local-resolve guide (server-only; the JS WASM provider is
  **not** for browsers — large bundle + it exposes all rules):

  ```
  mcp__confidence-docs__getLocalResolveIntegrationGuide
    sdk: "JAVA" | "GO" | "JS" | "RUST"
  ```

- Client app (mobile / browser / React Native) → **cached client**.
  Backend **Python / Ruby / .NET** → **remote**. Either way fetch:

  ```
  mcp__confidence-docs__getCodeSnippetAndSdkIntegrationTips
    sdk: "<detected>"
  ```

- **Server-rendered React / Next.js (RSC)** where Eppo precomputes
  assignments on the server and the client reads them offline →
  **server-precomputed**. Use Confidence's React local-resolve provider
  (`<ConfidenceProvider>` + `useFlag`); see the React mapping in Step 4.
  Fetch `getLocalResolveIntegrationGuide sdk: "JS"`. Do NOT bucket this
  as cached client — there is no per-device value cache.

**CRITICAL:** Include the ACTUAL MCP response in the plan, not a
reference to fetch it. Plans are self-sufficient.

**Step 2b — signal any resolve-mode CHANGE.** Compare the source mode
(defined in "Source resolve mode (Eppo)" below) to the target mode from
2a and, if it shifts, tell the user precisely what changes. Record the
decision and any change notice in the plan's SDK Setup section and
re-surface it at execute time before touching code. If unchanged, state
that explicitly so the user knows it was considered.

### Source resolve mode (Eppo) — feeds the Step 2b signal

**Eppo always evaluates locally — but "local" means different things on
server vs client.** Every Eppo SDK downloads the flag configuration
(Universal Flag Configuration) and computes assignments without a
per-assignment network call. Map it to two "local" source modes by
surface:

- **Eppo backend SDK → source mode = in-process eval.**
- **Eppo client SDK (Android/iOS/JS browser) → source mode = on-device
  eval** (the device holds the full ruleset and evaluates it locally).
- **Eppo precomputed (server→client, Next.js/React) → source mode =
  server-precomputed.** The server evaluates the ruleset locally for a
  bound subject and ships only resolved values to the client, which reads
  them offline — no client-side ruleset, no per-read network call.

Then the Step 2b transitions apply:

- Eppo backend → Confidence **in-process** (Java/Go/JS/Rust): unchanged.
- Eppo backend → Confidence **remote** (Python/Ruby/.NET): ⚠️ in-process
  → remote — each resolve becomes a service call.
- Eppo client → Confidence **cached client** (mobile/web): ⚠️ on-device →
  cached client. Reads stay local/offline and fast (NOT per-call
  network), but evaluation moves to the backend: the device caches
  resolved values instead of the ruleset, targeting changes apply on the
  next fetch, a cold first run may return defaults, and the full ruleset
  is no longer shipped to the client (a security/payload win over Eppo's
  on-device config).
- Eppo precomputed → Confidence React **local-resolve** provider
  (`<ConfidenceProvider>` + `useFlag`): ✅ architecture PRESERVED —
  server-side resolution with client-side offline reads is kept as-is, so
  this is server-precomputed → server-precomputed, NOT a remote/local
  change. Surface it as "no resolve-mode change" rather than a warning.

### Plan-file path

`.claude/plans/eppo-code-migration-<date>.md`

### Step 3: Scan codebase for Eppo usage

```
Grep: pattern="eppo|Eppo|EppoClient" → Find Eppo imports
Grep: pattern="[Gg]et(String|Boolean|Bool|Numeric|Integer|Int|Double|Float|JSON|Json)(String)?Assignment|get_(string|boolean|numeric|integer|double|json)_assignment" → Find typed evaluations
Grep: pattern="get_assignment|getAssignment|GetAssignment" → Find LEGACY untyped evaluations (older SDKs)
Grep: pattern="getPrecomputedConfiguration|offlinePrecomputedInit|getPrecomputedInstance" → Find the PRECOMPUTED pattern (JS/React)
Grep: pattern="getBanditAction|BanditResult|getBandit" → Find BANDITS (BLOCKED — no Confidence equivalent)
```

**Scan case-insensitively, and don't assume one spelling per type.** The
assignment method name varies by language AND by value type. Go exports
PascalCase (`GetBooleanAssignment`); Java uses `getDoubleAssignment` for
numeric and `getJSONStringAssignment` (returns a serialized string) for
JSON; JS shortens boolean to `getBooleanAssignment` and JSON to
`getJSONAssignment`; Python is snake_case. The grep above is the union —
run it case-insensitively (`rg -i` / `Grep -i`). Map whatever you find to
a value TYPE, not a fixed spelling:

| Value type | Source spellings seen | Confidence accessor (by target lang) |
|------------|----------------------|--------------------------------------|
| boolean | `getBoolean/getBool/GetBool…`, `get_boolean_…` | JS/Java `getBooleanValue`, Go `BooleanValue`, Python `get_boolean_value` |
| string | `getString/GetString…`, `get_string_…` | JS/Java `getStringValue`, Go `StringValue`, Python `get_string_value` |
| integer | `getInteger/GetInteger/GetInt…`, `get_integer_…` | JS/Java `getIntegerValue`, Go `IntValue`, Python `get_integer_value` |
| numeric/float | `getNumeric/GetNumeric…`, **Java `getDoubleAssignment`** | JS `getNumberValue`, Java `getDoubleValue`, Go `FloatValue`, **Python `get_float_value`** |
| JSON/object | `getJSON/getJson/GetJSON…`, **Java `getJSONStringAssignment`** | JS/Java `getObjectValue`, Go `ObjectValue`, Python `get_object_value` |

**Legacy `get_assignment` API.** Older Eppo SDKs expose a single untyped
`get_assignment(subjectKey, flagKey)` / `getAssignment(subjectKey, flagKey)`
instead of the typed `get_*_assignment` family. Two things differ and the
transform MUST account for both:
- **Argument order is INVERTED** — legacy is `(subjectKey, flagKey)`, typed
  is `(flagKey, subjectKey, …)`. Read the flag key from the SECOND arg for
  legacy calls.
- **Return type is untyped** (string-ish). Infer the Confidence accessor
  from how the result is used (compared to a bool, parsed as a number,
  read as an object) or fall back to `getStringValue` and flag it for
  human review in the plan.

**Classify the SDK as client-side or server-side** — this decides the
evaluation-context model in Step 4. Determine it from the detected Eppo
package:

| Eppo package | Side |
|--------------|------|
| `@eppo/js-client-sdk`, `@eppo/react-native-sdk`, `cloud.eppo:android-sdk`, `eppo-ios-sdk` | **client** |
| `@eppo/node-server-sdk`, `eppo-server-sdk` (Python/Ruby), `cloud.eppo:eppo-server-sdk` (Java), `github.com/Eppo-exp/golang-sdk`, `eppo_sdk` (Rust), `Eppo.Sdk` (.NET) | **server** |

**Detect the PRECOMPUTED (server→client) pattern** — common in Next.js /
React. If the second grep above hit `getPrecomputedConfiguration`,
`offlinePrecomputedInit`, or `getPrecomputedInstance`, this repo bakes
assignments on the server and hydrates them on the client. It is NOT the
plain client/server model and uses a DIFFERENT call shape:

- **Server** binds the subject once: `node-server-sdk`
  `getInstance().getPrecomputedConfiguration(subjectKey, attrs)` → a
  serialized string (often inside a `'use server'` action / Server
  Component).
- **Client** hydrates from that string: `offlinePrecomputedInit({ precomputedConfiguration })`,
  then reads with `getPrecomputedInstance().get<Type>Assignment(flagKey, default)`
  — **2 args, NO subjectKey/attrs** (they were baked in server-side).

When you see this pattern, record the **subject + attrs from the SERVER
`getPrecomputedConfiguration` call** (not the client reads), tag the file
as server/client/RSC-boundary, and use the **React mapping in Step 4** —
not the plain client/server tables.

Group files by **flag key** they reference (the first arg for typed calls,
the SECOND arg for legacy calls; for precomputed client reads the flag key
is the first — and only non-default — arg).

For each evaluation site, record:
- Flag key
- **Client vs server side** (from the table above)
- Return type (inferred from which `get_*_assignment` variant is used; for
  legacy `get_assignment`, inferred from usage)
- Whether it uses the **legacy** untyped API (inverted arg order)
- The `subjectKey` argument (so the transform can map it to `targetingKey`)
- The `subjectAttributes` argument (so the transform can carry them
  into the evaluation context)
- The `defaultValue` argument (carried over to the Confidence call)
- The **Confidence resolve path** (`<flag-key>.<property>`) — Confidence
  flags are structs, so code reads a property, never the bare key. Take
  the property from the Phase 1 plan's "Confidence resolve path" line for
  that flag. If Phase 1 used the `createFlag` default schema, the property
  is `enabled` for boolean flags and `value` for other scalar flags. If
  the flag is NOT in the Phase 1 plan, flag it: the code references a flag
  that was never migrated — surface it and do not invent a path.

### Step 4: Generate transform rules

Based on SDK guide from `confidence-docs` MCP:
- Extract install commands
- Extract initialization code
- Extract flag evaluation API
- Generate find/replace rules

**Two things are NOT 1:1 line replacements — get them right first:**

1. **Flag key → resolve path.** Confidence flags are structs; every read
   uses a dot-path `<flag-key>.<property>` (see Step 3). Use the resolve
   path from the Phase 1 plan everywhere the bare Eppo flag key appeared.
2. **Evaluation-context model depends on client vs server** (from Step 3):
   - **Server SDKs** pass context **per call** — fold `subjectKey` +
     attributes into the evaluation-context argument of each resolve.
   - **Client SDKs** use **ambient** context — there is no per-call
     context argument. Hoist `subjectKey` + attributes ONCE into a
     `setEvaluationContext`/`setEvaluationContextAndWait` call (at init, or
     wherever the subject becomes known), and the per-call site becomes a
     bare `get<Type>Value(path, default)`.

**Server-target mapping (per-call context):**

| Eppo call | OpenFeature call |
|-----------|------------------|
| `client.get_string_assignment(k, sk, attrs, default)` | `client.getStringValue("k.prop", default, { targetingKey: sk, ...attrs })` |
| `client.get_boolean_assignment(k, sk, attrs, default)` | `client.getBooleanValue("k.prop", default, { targetingKey: sk, ...attrs })` |
| `client.get_numeric_assignment(k, sk, attrs, default)` | `client.getNumberValue("k.prop", default, { targetingKey: sk, ...attrs })` |
| `client.get_integer_assignment(k, sk, attrs, default)` | `client.getNumberValue("k.prop", default, { targetingKey: sk, ...attrs })` |
| `client.get_json_assignment(k, sk, attrs, default)` | `client.getObjectValue("k.prop", default, { targetingKey: sk, ...attrs })` |

The accessor name AND signature shape are language-specific (use the
Step 2 SDK guide for the exact form):
- **Go**: PascalCase, no `get` prefix, context-LAST, `ctx` first:
  `client.BooleanValue(ctx, "k.enabled", default, evalCtx)` where
  `evalCtx := openfeature.NewEvaluationContext(sk, attrsMap)`. Numeric →
  `FloatValue`, integer → `IntValue`, JSON → `ObjectValue`.
- **Java**: build a `MutableContext(sk)` + `ctx.add(...)` and pass it last:
  `client.getDoubleValue("k.value", default, ctx)` (numeric),
  `client.getObjectValue("k", default, ctx)` (JSON). Note Eppo's
  `getJSONStringAssignment` returns a serialized **String** — Confidence
  `getObjectValue` returns a structured value, so DROP any
  `gson.fromJson(...)` re-parse the source did on the result.
- **Python (REMOTE target)**: snake_case `get_<type>_value`, numeric →
  `get_float_value`, JSON → `get_object_value`, context last:
  `client.get_string_value("k.value", default, EvaluationContext(targeting_key=sk, attributes=attrs))`.
  Init differs from local-resolve providers — there is no provider STATE to
  await, so use `api.set_provider(ConfidenceOpenFeatureProvider(Confidence(client_secret=...)))`
  (NOT `set_provider_and_wait`) and delete Eppo's `wait_for_initialization()`.

**Client-target mapping (ambient context):** the per-call site drops its
`sk`/`attrs` arguments; emit a one-time context setup instead.

| Eppo call | Confidence client call | Plus, once |
|-----------|------------------------|------------|
| `client.getBooleanAssignment(k, sk, attrs, default)` | `getBooleanValue("k.prop", default)` | `setEvaluationContext({ targetingKey: sk, ...attrs })` |
| `client.getStringAssignment(k, sk, attrs, default)` | `getStringValue("k.prop", default)` | (same — set once) |
| (numeric/integer → `getNumberValue`, json → `getObjectValue`) | | |

**Legacy `get_assignment(sk, k)` (untyped, inverted args):** map to the
typed accessor inferred in Step 3 (default `getStringValue`), reading the
flag key from the second argument and the subject from the first. Apply
the same client/server context rule as above.

**Precomputed (server→client) target — React/Next.js.** When Step 3
flagged the precomputed pattern, do NOT use the client ambient mapping.
Confidence's JS local-resolve provider ships a Next.js/RSC integration
that is the direct analogue (fetch the `JS` local-resolve guide in Step 2;
imports from `@spotify-confidence/openfeature-server-provider-local/react-server`
and `/react-client`). Map the three layers:

| Eppo (precomputed) | Confidence (React local-resolve) |
|--------------------|----------------------------------|
| Server: `EppoSDK.init({apiKey, assignmentLogger})` + `getInstance()` | Server: `createConfidenceServerProvider({ flagClientSecret })` + `OpenFeature.setProviderAndWait(provider)` |
| Server: `getPrecomputedConfiguration(subjectKey, attrs)` → string passed to the client provider | Wrap the subtree in `<ConfidenceProvider>` (from `/react-server`) with the evaluation context `{ targetingKey: subjectKey, ...attrs }`; resolution happens on the server |
| Client: `offlinePrecomputedInit({ precomputedConfiguration })` | (no client init — the `<ConfidenceProvider>` boundary replaces it; delete `EppoRandomizationProvider`/`offlinePrecomputedInit`) |
| Client: `getPrecomputedInstance().get<Type>Assignment(k, default)` | Client: `useFlag("k.prop", default)` (hook from `/react-client`) |

Notes:
- The subject/attrs move from the Eppo `getPrecomputedConfiguration` call
  to the `<ConfidenceProvider>` context — they are NOT re-passed at each
  `useFlag` site.
- `assignmentLogger` and any custom exposure plumbing (e.g. a
  `window.dispatchEvent('eppo-assignment', …)` bridge) have no Confidence
  equivalent — Confidence logs exposure automatically. Delete them.
- `useFlag` is a React hook: reads must be inside a component render. Code
  that read Eppo flags imperatively outside React needs a small
  restructure (lift to a hook, or resolve server-side via `getFlag`).

**Bandits are BLOCKED.** Eppo contextual bandits
(`getBanditAction`, `BanditResult`, `BanditActions`/`ContextAttributes`)
have no Confidence equivalent. Do NOT attempt to map them — surface each
bandit call site in the plan as BLOCKED with a note that the team must
redesign it (e.g. as a standard flag/experiment) before migrating, and
leave the code untouched.

**Remove Eppo-side readiness scaffolding (server AND client).** Eppo
examples gate the first evaluation behind a manual wait: clients use e.g.
Android `Handler.postDelayed(…, 1000)`; servers use a readiness signal
like Go's `<-client.Initialized()` channel wait or Java's blocking
`buildAndInit()`. Confidence's
`setProviderAndWait` / `fetchAndActivate` / `setEvaluationContextAndWait`
already block until flags are ready, so delete the hand-rolled delay
rather than porting it.

Adjust method casing per language based on the MCP-fetched SDK guide
(`getBooleanValue` in JS/TS/Kotlin, `get_boolean_value` in Python, etc.).

### Step 5: Generate plan

Save the plan to `.claude/plans/eppo-code-migration-<date>.md` using the
template below.

**Two Confidence-wide truths every code transform must honor:**

- **Flags are structs — read a property, not the bare key.** Confidence
  flag values are always accessed by a dot-path `<flag>.<property>`.
  Phase 1 records each flag's resolve path so Phase 2 uses
  `<flag>.<property>` instead of `<flag>`.
- **Client SDKs use ambient context; server SDKs pass it per call.**
  Confidence client SDKs read a single evaluation context set via
  `setEvaluationContext`/`setEvaluationContextAndWait` — `get<Type>Value`
  takes NO context argument. Server SDKs accept context per resolve.

## Plan Code: Template

```markdown
# Eppo to Confidence Code Migration Plan

**Created:** <date>
**Scope:** Code transformation only
**Language:** <detected>
**Framework:** <detected>

---

## Generation Status

| Step | Status | Result |
|------|--------|--------|
| 1. Detect language | ○ not started | |
| 2. Fetch SDK guide | ○ not started | |
| 3. Scan codebase | ○ not started | |
| 4. Transform rules | ○ not started | |
| 5. Group by flag | ○ not started | |

**Overall:** in progress

---

## 1. SDK Setup

### Resolve mode

| | |
|---|---|
| **Source mode** | <in-process eval / on-device eval / server-precomputed — per surface> |
| **Target mode** | <in-process / cached client / server-precomputed / remote — from Step 2a> |
| **Change** | <unchanged / ⚠️ in-process → remote / ⚠️ on-device → cached client / … — see notice> |

<If changed: one-paragraph notice of what actually shifts — where
evaluation happens, per-read latency (cached client = local/offline, NOT
per-call network), freshness/refetch behavior, cold-start defaults,
ruleset exposure. If unchanged: "Resolve mode is preserved.">

### Install

<install commands from MCP response>

### API Reference (from MCP: confidence-docs)

<code examples from MCP response>

### Create Confidence Wrapper

**File:** <appropriate path for detected framework>

**Must match source API surface:**

| Method | Signature |
|--------|-----------|
<detected from source SDK usage>

---

## 2. Transform Rules

### Source Files

| Find | Replace |
|------|---------|
| <Eppo import> | <Confidence import> |
| <Eppo usage> | <Confidence usage> |

### Test Files

| Find | Replace |
|------|---------|
| <Eppo mock> | <Confidence mock> |

---

## 3. Files to Transform

<list from codebase scan, grouped by flag key>

---

## 4. Progress

| # | Item | Status |
|---|------|--------|
| 0 | SDK Setup | :white_circle: |
```

---

## Required Prerequisites

This skill needs the Confidence-side MCPs listed in "Prerequisites:
Confidence Side" above (`confidence` for `plan flags`/`execute`,
`confidence-docs` for `plan code`), plus the Eppo REST API — no MCP,
just `curl` with `X-Eppo-Token: $EPPO_API_KEY`.

| Source | What's used |
|--------|-------------|
| Confidence MCP | `listClients`, `createClient`, `getContextSchema`, `addContextField`, `createFlag`, `addFlagToClient`, `unarchiveFlag`, `addTargetingRule`, `resolveFlag`, plus (for audiences) `createSegment` and, if available, `listSegments` / `getSegment` |
| Confidence Docs MCP (`plan code`) | `getLocalResolveIntegrationGuide`, `getCodeSnippetAndSdkIntegrationTips`, `searchDocumentation`, `getFullSource` |
| Eppo REST API (`X-Eppo-Token`) | `GET /environments`, `GET /feature-flags`, `GET /feature-flags/{id}`, `GET /feature-flags/{id}/environments/{environmentId}`, `GET /audiences/{id}` |
