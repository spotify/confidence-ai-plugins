---
description: Migrate feature flags from Statsig to Confidence SDK. Use when the user says /migrate-statsig, asks to migrate Statsig gates/configs/experiments, or transform SDK code to Confidence.
---

# Statsig to Confidence Migration

REST-driven, self-sufficient migration from Statsig to Confidence. This
skill is fully self-contained: it defines both the Statsig-specific
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
| **Source-boxed** | Every external data fetch uses one explicit channel (the Statsig Console API with curl, the Confidence MCP) — no ad-hoc browsing |
| **Self-sufficient** | Plan contains ALL information needed — no "query the source for X" at execute time |
| **Agent-agnostic** | Any agent with the prerequisites can execute the plan without prior context |
| **Language-agnostic** | Detect framework, fetch SDK guide from `confidence-docs` MCP dynamically |

## Commands

| Command | Description |
|---------|-------------|
| `/migrate-statsig plan flags` | Phase 1: plan flag definitions migration |
| `/migrate-statsig plan code` | Phase 2: plan code transformation |
| `/migrate-statsig execute <plan-file>` | Execute a plan interactively |

---

## Migration Overview (MUST display at start of `plan flags` or `plan code`)

**Every time** the user runs `plan flags` or `plan code`, display this
overview FIRST — before doing any work.

```
═══════════════════════════════════════════════════════════════
  Statsig → Confidence Migration
═══════════════════════════════════════════════════════════════

  The migration happens in two phases: flags first, then code.

  ┌─────────────────────────────────────────────────────────┐
  │  PHASE 1 — Flag Definitions                            │
  │                                                        │
  │  Move all gates, dynamic configs, and experiments from │
  │  Statsig to Confidence with their rules, rollout       │
  │  percentages, return values, and variant splits.       │
  │                                                        │
  │  Steps:                                                │
  │    1. Scan Statsig (gates, configs, experiments)       │
  │    2. Choose a Confidence client (your app)            │
  │    3. Map the unit ID (idType) to an entity field      │
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
  │    3. Scan codebase for Statsig usage                  │
  │    4. Generate transform rules (Statsig → Confidence)  │
  │    5. Generate plan grouped by flag                    │
  │    6. Execute: transform code flag by flag, one PR each│
  │                                                        │
  │  Result: Code uses Confidence SDK, Statsig removed     │
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

### Confidence REST API token (OPTIONAL — for full-fidelity Phase 1)

The MCP `createFlag`/`addTargetingRule` tools cover the common cases but
**cannot** express a few Statsig constructs faithfully: partial
experiment allocation, reusable/materialized segments, layer mutual
exclusion, and holdouts (see "Two execution backends" below). To migrate
those faithfully, the skill uses the Confidence **management REST API**
(`https://flags.confidence.dev/v1`), which needs a short-lived access
token obtained via the client-credentials flow.

Only ask for this if the scan finds features that need it (the plan
flags them). To set it up:

1. In Confidence, go to **Admin > API Clients**, create a client, and
   copy its **client ID** and **client secret**.
2. Exchange them for an access token (valid ~1h):
   ```bash
   curl -sS -X POST "https://iam.confidence.dev/v1/oauth/token" \
     -H "Content-Type: application/json" \
     -d '{"grantType":"client_credentials","clientId":"<id>","clientSecret":"<secret>"}'
   # → { "accessToken": "eyJ...", "expiresIn": "86400" }
   ```
3. Store the token for the session as `CONFIDENCE_TOKEN` and send it as
   `Authorization: Bearer $CONFIDENCE_TOKEN`. Never write the token or
   the client secret to the plan file (same secret-handling rule as the
   Statsig key).

## Two execution backends (MCP vs REST)

Phase 1 has two ways to write to Confidence. Pick per flag based on what
the flag needs — the plan records which backend each flag uses.

| Backend | Use when | Auth | Limitations |
|---------|----------|------|-------------|
| **MCP** (default) | Gates, dynamic configs, and fully-allocated (`allocation` 100) experiments with inline targeting | OAuth (`mcp__confidence__*`) | No partial allocation, no reusable/materialized segments, no exclusivity, no holdbacks |
| **REST** (full-fidelity) | Anything needing partial experiment `allocation`, reusable or `id_list` segments, layer mutual exclusion, or holdouts | Bearer token (above) | BigQuery required for materialized segments |

The MCP backend is the tested default. Reach for REST only for the
specific constructs listed; the operator/handling sections below point to
the matching REST recipe ("Full-Fidelity Phase 1 via the Confidence REST
API") wherever it applies.

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
- DO describe rules in plain English: "app version is at least 1.2.0", "country is US or CA"
- The plan FILE may contain MCP command payloads (for machine execution),
  but conversation output must be human-friendly

## Prerequisites: Statsig Side

Statsig does not currently publish a Claude MCP server, so the migration
talks to Statsig's **Console API** directly using `curl` from the Bash
tool.

### Required

1. A **Statsig Console API key** (NOT a server/client SDK key). Created
   in the Statsig console under **Project Settings > API Keys**
   (`console.statsig.com/api_keys`). The key needs read access to gates,
   dynamic configs, and experiments. Console API keys start with
   `console-`.
2. The Console API base URL is `https://statsigapi.net`. This is the
   same for all projects (Statsig is multi-tenant; the key scopes you to
   a project).

**Authentication headers:**
- `STATSIG-API-KEY: <console-api-key>`
- `STATSIG-API-VERSION: 20240601` (the only published version; optional
  today, required in future — always send it)

### ASK the user (only if not already provided)

> To read your Statsig gates, configs, and experiments, I need a Statsig
> **Console API key** (Project Settings > API Keys in the Statsig
> console — make sure it has read access). It starts with `console-`.
>
> Please paste it here, or set it in your shell as `STATSIG_API_KEY`
> before continuing.

### Storing the key

Once provided, store the key for the session in the environment variable
`STATSIG_API_KEY` (export it in the Bash session the agent uses) and
reference it via `$STATSIG_API_KEY` in every `curl` call — never
hardcode the key into the plan file, the conversation output, or any
committed file. If the user pastes a key inline, scrub it from the plan
file and only keep a placeholder like `<your-statsig-console-api-key>`.
(See also the "never echo secrets" rule in the User-Facing Communication
Rules above.)

### Smoke test before scanning

```bash
curl -sS -H "STATSIG-API-KEY: $STATSIG_API_KEY" \
  -H "STATSIG-API-VERSION: 20240601" \
  "https://statsigapi.net/console/v1/gates?limit=1&page=1" \
  | head -c 200
```

If this returns a `401`/`403` or an HTML error page, stop and surface
the error to the user — do not start scanning.

### Local testing (no Statsig account needed)

For development and CI smoke tests, this skill ships with a fake Statsig
Console API server under `skills/migrate-statsig/test-fixtures/`. It
implements the read endpoints with curated fixtures that exercise every
operator-mapping branch. See that directory's `README.md` for usage —
short version is `python3 server.py`, then point this skill at
`http://127.0.0.1:4000` when prompted for the base URL.

---

## Statsig Console API Reference

The migration uses these endpoints. All require both
`-H "STATSIG-API-KEY: $STATSIG_API_KEY"` and
`-H "STATSIG-API-VERSION: 20240601"`. Base URL is
`https://statsigapi.net`.

> **Source of truth.** Field names and shapes here are taken directly
> from Statsig's published OpenAPI 3.0 spec at
> <https://api.statsig.com/openapi/20240601.json> (public, no auth).
> Refer back to it if you encounter a field that isn't documented below.

| Purpose | Endpoint |
|---------|----------|
| List feature gates | `GET /console/v1/gates?limit=<n>&page=<n>` |
| Get one gate (full definition: rules, conditions) | `GET /console/v1/gates/{id}` |
| List dynamic configs | `GET /console/v1/dynamic_configs?limit=<n>&page=<n>` |
| Get one dynamic config (rules, return values, default value) | `GET /console/v1/dynamic_configs/{id}` |
| List experiments | `GET /console/v1/experiments?limit=<n>&page=<n>` |
| Get one experiment (groups, allocation, targeting) | `GET /console/v1/experiments/{id}` |
| Get one segment (rule_based: conditions) | `GET /console/v1/segments/{id}` |

**Convention.** Field names are `camelCase`. IDs are strings (e.g.
`a_gate`). Condition `targetValue` is sometimes a scalar and sometimes an
array — normalize to an array when translating. Verified against the
live Console API: a single value comes back as a **scalar** (and numeric
comparisons carry **numbers**, e.g. `28` not `"28"`), multiple values as
an array; `passes_gate` / `passes_segment` / `fails_segment` conditions
have **no `operator` key at all**.

### Statsig's three configurable types

Statsig has three distinct entity types. All three become Confidence
flags, but they map differently:

| Statsig type | What it is | Confidence flag shape |
|--------------|-----------|----------------------|
| **Feature Gate** | Boolean on/off with a rule waterfall | Boolean flag (`{ enabled }`); each rule → one targeting rule |
| **Dynamic Config** | Returns a JSON value object; rules pick which value | Struct flag; each rule's `returnValue` → a variant; `defaultValue` → catch-all |
| **Experiment** | A/B/n test with weighted groups | Struct flag; each `group` → a variant, split by `size` in `variantAllocations` (see allocation<100 note) |

> **Layers.** A Statsig **layer** groups several experiments that share a
> parameter namespace and an allocation budget, making them mutually
> exclusive. Migrate each experiment in the layer as its own Confidence
> flag. The mutual exclusion maps to a Confidence **exclusivity group**
> via segment coordination on the **REST** backend — see "Layer mutual
> exclusion" under "Full-Fidelity Phase 1 via the Confidence REST API".
> On the MCP backend, mutual exclusion can't be reproduced; record the
> shared `layerID` as a note and surface the gap.

### The Feature Gate object (`ExternalGateDto`)

- `id` (string used in code as the gate name), `name`, `description`
- `idType` — the **unit ID** the gate randomizes on (`userID`,
  `stableID`, or a custom ID name). Maps to the Confidence entity / the
  rule's `targetingKey`.
- `isEnabled` (boolean) — when `false`, the gate is OFF; migrate it but
  keep rules at 0% so it stays off.
- `status` — `In Progress` / `Launched` / `Disabled` / `Archived`
- `rules[]` — **ordered waterfall (top wins)**. Each rule has:
  - `name`
  - `passPercentage` (0–100) — of the users matching this rule's
    conditions, what percent PASS (return `true`). The rest FAIL
    (return `false`).
  - `conditions[]` — ANDed within a rule (each `{ type, operator,
    targetValue, field, customID }`)
  - `environments[]` — environments the rule is enabled for (or null =
    all)

A gate has **no explicit default value**: if no rule matches (or a
matched rule's `passPercentage` doesn't pass), the gate returns `false`.

### The Dynamic Config object (`DynamicConfigDto`)

- `id`, `name`, `description`, `idType`, `isEnabled`
- `defaultValue` — the value returned when **no rule matches** (a real
  server-side default; map it to the catch-all rule's variant)
- `rules[]` — ordered waterfall. Each rule has `name`, `passPercentage`,
  `conditions[]`, and a `returnValue` (the value object served to users
  who match and pass).
- `schema` — optional value schema

### The Experiment object (`ExternalExperimentDto`)

- `id`, `name`, `description`, `idType`
- `status` — `active` / `setup` / `decision_made` / `abandoned` /
  `archived` / `experiment_stopped` / `assignment_stopped`
- `groups[]` — the variants. Each: `name`, `size` (0–100, the percent of
  allocated users in this group), `parameterValues` (the value object for
  the group). Group sizes sum to 100 across the experiment.
- `allocation` (0–100) — percent of eligible users entering the
  experiment at all. The MCP `addTargetingRule` has no rollout knob, so
  `allocation` < 100 needs the REST backend's segment `proportion` —
  see "Experiment `allocation` < 100".
- `controlGroupID` — which group is control (informational)
- `targetingGateID` — restrict the experiment to users who pass this
  gate. **This is how the modern Statsig console expresses experiment
  targeting** (inline rules are legacy; the Console API can't even write
  them). Treat it exactly like a `passes_gate` condition: fetch the
  referenced gate and **inline its conditions** into the experiment's
  Confidence targeting (or share it as a segment on the REST backend).
  Only block if the referenced gate is itself unmigratable.
- `inlineTargetingRules[]` — inline targeting (same rule/condition shape
  as gates). Combine with `allocation`.
- `layerID` — if set, the experiment belongs to a layer (see Layers
  note above).
- `holdoutIDs[]` — holdouts applied to this entity (also present on gates
  and dynamic configs). Each holds a fixed random subset of users out of
  the entity. Maps to a Confidence **holdback** — see "Holdouts (item 5)"
  under "Full-Fidelity Phase 1 via the Confidence REST API". Record any
  holdouts in the plan; they need a (mostly manual) surface step.

**Pagination.** Statsig uses `page` (1-based) + `limit`. The list
response wraps results under `data` with a `pagination` object:

```
page = 1
LOOP:
  resp = GET /console/v1/gates?limit=50&page=<page>
  process resp.data
  if resp.pagination.nextPage is null OR resp.data is empty → STOP
  page += 1 → continue LOOP
```

Repeat the loop for `gates`, `dynamic_configs`, AND `experiments`.

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
  Current:  pricing-experiment
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
  [1] Scan Statsig     ○ pending
  [2] Choose client    ○ pending
  [3] Map unit ID      ○ pending
  [4] Generate plan    ○ pending
────────────────────────────────────────────────────────────
```

Example after Step 1 completes:
```
───── Plan Flags ──────────────────────────────────────────
  [1] Scan Statsig     ✓ 8 gates, 3 configs, 4 experiments
  [2] Choose client    ◉ in progress
  [3] Map unit ID      ○ pending
  [4] Generate plan    ○ pending
────────────────────────────────────────────────────────────
```

### Execute step tracker

```
───── Execute Migration ───────────────────────────────────
  Client: test  |  Unit: user_id  |  Flags: 15
  Progress: [░░░░░░░░░░░░░░░░░░░░] 0/15
────────────────────────────────────────────────────────────
```

---

## Confidence Naming Rules

- **Flag names:** lowercase letters, digits, and hyphens only (`[a-z0-9-]`).
  Statsig gate/config/experiment IDs often use `snake_case`
  (`new_checkout_flow`); normalize to hyphens (`new-checkout-flow`) and
  record the mapping in the plan so the code phase can find the right
  replacement.
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

- `plan flags` → `.claude/plans/statsig-flag-migration-*.md`
- `plan code`  → `.claude/plans/statsig-code-migration-*.md`

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

The migration follows a 4-step plan flow: Step 1 scan Statsig, Step 2
choose a Confidence client, Step 3 map the unit ID, Step 4 generate the
MCP commands.

### Plan-file path

`.claude/plans/statsig-flag-migration-<date>.md`

### Step 1: Scan Statsig

**Step 1a — list all gates, configs, and experiments. CRITICAL:
paginate until exhausted, for ALL THREE types.**

```
for type in [gates, dynamic_configs, experiments]:
  page = 1
  LOOP:
    resp = curl GET /console/v1/<type>?limit=50&page=<page>
    process resp.data
    if resp.pagination.nextPage is null OR resp.data empty → STOP
    page += 1 → continue LOOP
```

```bash
curl -sS -H "STATSIG-API-KEY: $STATSIG_API_KEY" \
  -H "STATSIG-API-VERSION: 20240601" \
  "https://statsigapi.net/console/v1/gates?limit=50&page=1"
```

Ask once up-front: "Include archived gates/configs/experiments too?
Default: no". Skip items whose `status` is `Archived` / `archived` unless
the user opts in.

**Step 1b — fetch each item's full definition (in batches of 5).** The
list endpoints already return rules for gates/configs, but fetch the
single-item endpoint to be sure you have the complete `rules[]` /
`groups[]` / `defaultValue`:

```bash
curl -sS -H "STATSIG-API-KEY: $STATSIG_API_KEY" \
  -H "STATSIG-API-VERSION: 20240601" \
  "https://statsigapi.net/console/v1/gates/<id>"
```

**After each batch of 5**, write the data to the plan file — append the
sections to Section 4. This way if the session closes mid-scan, the
items fetched so far are saved.

Extract from each item:

- `id`, `name`, `description`
- **Type** (gate / dynamic config / experiment) — determines the
  Confidence flag shape (see "Statsig's three configurable types")
- `idType` — the unit ID (becomes the Confidence entity in Step 3)
- `isEnabled` — disabled items still migrate, but with rollout 0% so
  they don't activate accidentally; surface this clearly in the plan
- For **gates / dynamic configs**: the ordered `rules[]`. For each rule:
  `passPercentage`, `conditions[]`, and (configs only) `returnValue`
- For **experiments**: `groups[]` (`name`, `size`, `parameterValues`),
  `allocation`, `controlGroupID`, `targetingGateID` (fetch the referenced
  gate — its conditions get inlined; see the Experiment object notes),
  `inlineTargetingRules[]` (legacy), `layerID`
- `holdoutIDs[]` (gates/configs/experiments) → record each holdout; it
  maps to a Confidence holdback (a surface step — see "Holdouts (item 5)").
  **Dedupe the list** — the live Console API returns duplicated entries
  (one attached holdout can appear twice).
- Any `passes_segment` / `fails_segment` / `in_segment_list` /
  `not_in_segment_list` conditions → record the referenced segment id;
  fetch it in Step 1c
- Whether the item needs the **REST backend** (partial `allocation`,
  reusable/`id_list` segments, a `layerID`, or any `holdoutIDs`) — record
  the backend on the flag's plan entry so `execute` knows which path to
  take

**Step 1c — fetch referenced segments (once per unique id).** While
scanning conditions, collect every segment id referenced by a
`passes_segment` / `fails_segment` condition. For each unique id:

```bash
curl -sS -H "STATSIG-API-KEY: $STATSIG_API_KEY" \
  -H "STATSIG-API-VERSION: 20240601" \
  "https://statsigapi.net/console/v1/segments/<id>"
```

- A **`rule_based`** segment has `rules[]` / `conditions[]` with the same
  shape as gates. Translate those conditions with the operator table and
  **inline** them into each referencing flag's targeting (the Confidence
  MCP in this plugin has no `createSegment` tool — see "Segments").
- An **`id_list`** / `user_store_id_list` segment is a literal list of
  unit IDs. If small (≤ ~50), inline as a `setRule` on the entity field.
  If large, mark the referencing condition BLOCKED (see "Blocked").
- An **`analysis_list`** segment is an analysis-only audience with no
  targeting rules — it has no Confidence targeting equivalent. Mark the
  referencing condition BLOCKED for manual review.

**Unit ID.** Statsig randomizes on the entity named by `idType`
(`userID`, `stableID`, or a custom ID). Record each item's `idType`; the
user maps it to a Confidence entity field in Step 3. If different items
use different `idType`s, the plan carries the per-item unit and Step 3
maps each distinct one.

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

### Step 3: Map Unit ID (Statsig-specific)

This step maps Statsig's `idType` (unit ID) to a Confidence entity field.

**EDUCATE then ASK:**

> **What is a randomization unit (entity)?**
> An entity is the "thing" that gets randomly assigned to a variant —
> usually a user. The entity field (like `user_id` or `visitor_id`) is
> the identifier Confidence uses to ensure **consistent assignment**: the
> same user always sees the same variant.
>
> In Confidence, it maps to the `targetingKey` in the evaluation context.
>
> In Statsig, every gate/config/experiment randomizes on a **unit ID**
> (its `idType`). Your items use: <list distinct idTypes found>.
>
> Common choices:
> - **user_id** — for `userID` (authenticated users)
> - **visitor_id** — for `stableID` (anonymous visitors; auto-generated
>   by Confidence client SDKs)
> - **company_id** — for a custom company/org/tenant unit
>
> Your client's existing entity fields:
> 1. <entity-field-1>
> 2. <entity-field-2>
> ...
> N. Create a new field
>
> Which Confidence field represents the same identifier as `<idType>`?

Same wait-for-explicit-pick rule as Step 2 above. Silence is not
consent. Map each distinct `idType` to one Confidence entity.

- If user picks existing → use it as `targetingKey`
- If user wants new → ASK for name + type → `mcp__confidence__addContextField`
  (always provide an explicit `entityReference` — see Confidence Naming
  Rules above)

**Statsig unit targeting (`user_id` / `unit_id` conditions).** Statsig
lets a rule target the unit directly via a `user_id` or `unit_id`
condition (an allowlist/blocklist of IDs). Map the condition's `field`
to the chosen entity field name in Confidence. Record this substitution
in Section 2 of the plan.

### Step 4: Generate MCP commands

**Confirmation gate (MUST pass before generating).** Before writing the
Flags to Migrate section, summarize the choices made in earlier steps
(client, unit-ID → entity mapping) and ask:

> Plan will assume client `<client>` with unit `<idType>` → entity
> `<entity>`. All flags will be defaulted to `[ ] Migrate  [ ] Skip`
> (neither pre-checked) — you'll opt each one in during review. Confirm
> or change?

Set the step to `⏸ awaiting user` and stop. Only proceed on an explicit
`yes` / `confirm` / equivalent. A re-run or ambiguous reply is **not**
confirmation.

For each item, generate the MCP command payloads (`createFlag`,
`addFlagToClient`, `addTargetingRule`, `resolveFlag`) using the Operator
Mapping table together with the Confidence Targeting Payload Format
(below). Write them into each flag's section in the plan.

**After all commands generated:** Update Generation Status step 4 to
`✓ complete`, set the overall status to `complete`, and tell the user:

> Plan generated! Review it at `.claude/plans/statsig-flag-migration-<date>.md`
>
> Migration is **opt-in**: every flag starts with both checkboxes empty.
> Tick `[x] Migrate` or `[x] Skip` for each flag — `execute` will refuse
> any flag with neither box set. When ready, run:
> `/migrate-statsig execute <plan-file>`

**Rule → targeting-rule order.** Statsig rules form a waterfall — the
first matching rule wins. Confidence evaluates targeting rules in
declared order, so emit one `addTargetingRule` call per Statsig rule, in
the same order.

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
| list attr: any item matches | `"anyRule": { "rule": { "setRule": { "values": [...] } } }` (inner rule may be `eqRule`/`setRule`/`rangeRule`/`startsWithRule`/`endsWithRule`; no match on empty/missing list) |
| list attr: every item matches | `"allRule": { "rule": { ... } }` (same inner rules; matches on empty/missing list) |
| attribute is set (exists) | `{ "attribute": { "attributeName": "X" } }` (attribute criterion with **no** inner rule) |

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
presence check: it matches when attribute `X` is set. To express
**"attribute is null/absent"**, reference that criterion under `not`:

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

### Default value (no server-side default → emit a catch-all rule)

Confidence has **no server-side flag default**. The `Flag` resource
carries variants and an ordered list of rules but no default-value
field. The resolver's contract is explicit: *"each rule is tried in
order; the first match assigns a variant; if no rule matches, no variant
is assigned."* When no rule matches, the SDK returns **the default the
caller passed at the call site** (e.g. `checkGate` defaults to `false`).

So a Statsig default — a gate's implicit `false`, or a dynamic config's
`defaultValue` — does **not** map to any flag-level field. To preserve
it faithfully, emit it as an explicit **catch-all final rule**:

- `addTargetingRule` with `variantAllocations` = `{ "<defaultVariant>": 100 }`
  and **no `payload`** (an omitted/empty payload targets all contexts).
- Add it **last**, after every specific rule, so it only catches
  subjects that matched nothing above it.

For a **gate**, the catch-all variant is `disabled` (`false`) — reached
only by users who matched **no** rule (remember each gate rule already
captures its own fail share as `disabled` inside `variantAllocations`,
per "Multivariant / Group Split Handling"). For a **dynamic config**,
the catch-all variant carries `defaultValue`. For an **experiment**,
emit a catch-all serving the **control** group's value (users outside
the targeting, or — when approximating `allocation` < 100 — the
non-entrants).

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

**Suffix alternation (email ends with @test.com OR @qa.com):**
```json
{
  "criteria": {
    "ref-0": { "attribute": { "attributeName": "email", "endsWithRule": { "value": "@test.com" } } },
    "ref-1": { "attribute": { "attributeName": "email", "endsWithRule": { "value": "@qa.com" } } }
  },
  "expression": { "or": { "operands": [{ "ref": "ref-0" }, { "ref": "ref-1" }] } }
}
```

## Segments

Confidence **has** reusable segments, but the **MCP** backend in this
plugin exposes no `createSegment` tool. So the handling depends on the
backend:

- **REST backend (preferred for reuse):** create one Confidence segment
  per Statsig segment and reference it from every flag that uses it — see
  "Segments (items 2 & 3)" under "Full-Fidelity Phase 1 via the
  Confidence REST API". This preserves reuse/de-duplication and supports
  `id_list` segments via materialized segments (BigQuery).
- **MCP backend (inline fallback):** with no `createSegment` tool,
  **inline** the segment's conditions into each referencing flag:
  - **`rule_based` segment** (`passes_segment` / `fails_segment`): fetch
    its definition, translate its `conditions[]` with the operator table,
    and inline into the flag's `criteria` + `expression`. For
    `passes_segment` reference the segment's expression directly; for
    `fails_segment` wrap it in `not`. Repeat the inlined criteria in each
    referencing flag (no de-dup without a segment primitive — note in the
    plan).
  - **`id_list` segment** (`in_segment_list` / `not_in_segment_list`):
    if small (≤ ~50 ids), inline as a `setRule` on the entity field
    (wrapped in `not` for `not_in`). If large, use a REST materialized
    segment, or mark the condition BLOCKED.
  - **`analysis_list` segment**: analysis-only, no targeting rules to
    inline and no Confidence equivalent on either backend — mark the
    condition BLOCKED for manual review.

## Multivariant / Group Split Handling

**CRITICAL — there is no separate `rolloutPercentage` knob.** The
Confidence `addTargetingRule` tool takes only `variantAllocations` (a
map of variant → percent that **must sum to exactly 100**), `payload`,
and `targetingKey`. Encode the entire pass/fail or group split *inside*
`variantAllocations` — do NOT expect a rule-level rollout field.

**CRITICAL — Statsig captures matched users; there is no fall-through.**
In Statsig, *"as soon as a user qualifies based on the condition in a
given rule, Statsig doesn't evaluate subsequent rules for this user"* —
the matched user is then placed in the rule's Pass or Fail group right
there. So a matched-but-failed user does **not** continue down the
waterfall. Fold the fail share into the same Confidence rule:

- **Gate rule** (boolean): ONE rule with the rule's conditions as
  `payload` and `variantAllocations` =
  `{ "enabled": <passPercentage>, "disabled": <100 − passPercentage> }`.
  A pure feature gate (passPercentage 100) is `{ "enabled": 100 }`; a
  25% rollout is `{ "enabled": 25, "disabled": 75 }`. A `public`
  ("Everyone") rule is the same but with **no payload** (targets all).
- **Dynamic config rule**: ONE rule per config rule, conditions as
  `payload`, `variantAllocations` =
  `{ "<variant-for-this-returnValue>": <passPercentage>, "<defaultVariant>": <100 − passPercentage> }`.
  When `passPercentage` is 100 (the common case) it's just
  `{ "<variant>": 100 }`.
- **Experiment**: ONE rule (conditions from `inlineTargetingRules` as
  `payload`, or no payload) with `variantAllocations` = each group's
  `name` → its `size` (e.g. `{ "control": 50, "treatment": 50 }`).

**Do NOT create separate rules per variant.** One targeting rule = one
set of targeting conditions, with the variant split defined inside that
rule via `variantAllocations`.

### Experiment `allocation` < 100

A fully-allocated experiment (`allocation` 100) is exact on the **MCP**
backend — just use the group sizes as `variantAllocations`.

For `allocation` < 100 (only part of eligible users enter, the rest get
control), the MCP backend can't be exact (`variantAllocations` must sum
to 100, no rollout knob). **Prefer the REST backend**, which represents
it exactly via a segment `allocation.proportion` + group bucket ranges —
see "Partial experiment allocation" under "Full-Fidelity Phase 1 via the
Confidence REST API". If REST isn't available, fall back to the MCP
approximation: each entering group gets `round(size × allocation / 100)`
and the leftover (`100 − Σ`) goes to **control** — record that it's
approximate in the plan.

## Operator Mapping (Statsig → Confidence)

This is how Statsig conditions map to the Confidence targeting payloads
defined above. Within a single Statsig rule, all `conditions` are ANDed.
Across rules in a gate/config, the waterfall means each rule becomes a
**separate Confidence targeting rule** in the same order.

A Statsig condition is `{ type, operator, targetValue, field, customID }`.
The **`type`** selects the attribute; the **`operator`** selects the
rule shape. `targetValue` may be a scalar or array — normalize to an
array.

### Condition `type` → Confidence attribute

| Statsig `type` | Confidence attribute name | Notes |
|---|---|---|
| `public` | (none) | "Everyone" — emit a rule with **no payload**; put the pass/fail split in `variantAllocations` (e.g. `{ enabled: 25, disabled: 75 }` for a 25% pass) |
| `user_id` | the chosen entity field | unit allowlist/blocklist; use entity field name |
| `unit_id` (+ `customID`) | the entity field for that custom unit | |
| `email` | `email` | |
| `country` | `country` | 2-letter code (Statsig derives from IP if absent — Confidence needs it in context) |
| `app_version` | `appVersion` | version-typed |
| `os_name` | `os` | |
| `os_version` | `osVersion` | version-typed |
| `browser_name` | `browserName` | |
| `browser_version` | `browserVersion` | version-typed |
| `locale` | `locale` | |
| `ip_address` | `ipAddress` | |
| `device_model` | `deviceModel` | |
| `user_agent` | `userAgent` | |
| `url` | `url` | |
| `time` | `time` | timestamp |
| `environment_tier` | — | Confidence scopes environments via clients, not targeting; record as a note, usually drop or map to a `tier` attribute |
| `custom_field` (+ `field`) | `field` value | the custom attribute name |
| `passes_segment` / `fails_segment` | — | reusable segment (REST) or inline (MCP) — see "Segments" |
| `passes_gate` / `fails_gate` | — | inline the referenced gate's conditions (or a shared segment); see "Blocked" |
| `experiment_group` | — | **BLOCKED** (depends on experiment assignment) |
| `javascript` | — | **BLOCKED** (arbitrary JS) |
| `target_app` | — | record as a note; usually handled by client scoping |

### Operator → Confidence rule shape

Statsig operators: `any`, `none`, `any_case_sensitive`,
`none_case_sensitive`, `gt`, `gte`, `lt`, `lte`, `version_gt`,
`version_gte`, `version_lt`, `version_lte`, `version_eq`, `version_neq`,
`str_starts_with_any`, `str_ends_with_any`, `str_contains_any`,
`str_contains_none`, `str_matches`, `eq`, `neq`, `before`, `after`,
`on`, `in_segment_list`, `not_in_segment_list`, array operators
(`array_contains_any`, `array_contains_none`, `array_contains_all`,
`not_array_contains_all`), plus null checks (`is null` / `is not null`).

**Per-type operator validity (verified against the live Console API).**
Statsig validates operators per condition `type`, and the practical
operator sets are narrower than the union above. Notably,
`str_starts_with_any` / `str_ends_with_any` are **rejected** for
`email`, `custom_field`, `url`, `locale`, `user_agent`, and
`browser_name` — prefix/suffix matching on those types arrives as an
anchored `str_matches` regex (decompose it per the regex rule below →
`startsWithRule` / `endsWithRule`) or as `str_contains_any` (BLOCKED —
see the workaround). `custom_field` additionally accepts numeric,
version, time, and the array operators.

| Statsig operator | Confidence payload strategy |
|---|---|
| `any` / `any_case_sensitive` (single value) | one criterion `eqRule`, expression `ref` |
| `any` / `any_case_sensitive` (multi value) | one criterion `setRule { values }`, expression `ref` |
| `none` / `none_case_sensitive` | same as `any`, expression wraps `ref` in `not` |
| `eq` | one criterion `eqRule`, expression `ref` |
| `neq` | one criterion `eqRule`, expression `not` wrapping `ref` |
| `gt` | `rangeRule.startExclusive: { numberValue: N }` |
| `gte` | `rangeRule.startInclusive: { numberValue: N }` |
| `lt` | `rangeRule.endExclusive: { numberValue: N }` |
| `lte` | `rangeRule.endInclusive: { numberValue: N }` |
| `version_gt` | `rangeRule.startExclusive: { versionValue: { version } }` |
| `version_gte` | `rangeRule.startInclusive: { versionValue: { version } }` |
| `version_lt` | `rangeRule.endExclusive: { versionValue: { version } }` |
| `version_lte` | `rangeRule.endInclusive: { versionValue: { version } }` |
| `version_eq` | `eqRule.value.versionValue: { version }` |
| `version_neq` | `eqRule` version, expression `not` wrapping `ref` |
| `str_starts_with_any` | one `startsWithRule` per value, expression `or` of `ref`s |
| `str_ends_with_any` | one `endsWithRule` per value, expression `or` of `ref`s |
| `before` (time) | `rangeRule.endExclusive: { timestampValue }` |
| `after` (time) | `rangeRule.startExclusive: { timestampValue }` |
| `on` (time) | `eqRule.value.timestampValue` |
| `in_segment_list` | small list → `setRule` on entity; large → REST materialized segment (BigQuery) |
| `not_in_segment_list` | small list → `setRule` on entity wrapped in `not`; large → REST materialized segment, referenced under `not` |
| `array_contains_any` | one criterion `anyRule { rule: { setRule { values } } }` on the list attribute, expression `ref` |
| `array_contains_none` | same `anyRule` criterion, expression `not` wrapping `ref` |
| `array_contains_all` | one criterion `anyRule { rule: { eqRule v } }` **per target value**, expression `and` of `ref`s (each value must be present; Confidence `allRule` means "every input item matches" — NOT the same thing) |
| `not_array_contains_all` | the `array_contains_all` construction, expression wrapped in `not` |
| `is null` | ruleless presence criterion under `not`: `{ "attribute": { "attributeName": "X" } }`, expression `not` wrapping `ref` |
| `is not null` | ruleless presence criterion, expression `ref` |
| `str_matches` (regex) | decompose like below; else BLOCKED |
| `str_contains_any` / `str_contains_none` | **BLOCKED** (Confidence has no substring/contains rule) |

**Case sensitivity caveat.** Statsig's `any`/`none` are
case-INsensitive; `any_case_sensitive`/`none_case_sensitive` are
case-sensitive. Confidence string equality is case-sensitive. For
case-insensitive Statsig conditions, note in the plan that the
evaluation context value must be normalized (e.g. lowercased) to match,
or surface it for review if exact case parity matters.

### Regex (`str_matches`)

Confidence has no general regex rule, but `startsWithRule` /
`endsWithRule` cover the anchored prefix/suffix patterns that make up
the majority of real Statsig `str_matches` rules — including
alternation, which decomposes into an `or` of literal prefixes/suffixes.

| Statsig `str_matches` value | Confidence payload strategy |
|---|---|
| `^prefix.*` / `^prefix` | one `startsWithRule { value: "prefix" }`, expression `ref` |
| `.*suffix$` / `suffix$` | one `endsWithRule { value: "suffix" }`, expression `ref` |
| `^(a\|b\|c).*` (prefix alternation) | one `startsWithRule` per branch, expression `or` |
| `.*@(test\|qa)\.com$` (suffix alternation) | one `endsWithRule` per branch (`@test.com`, `@qa.com`), expression `or` |

**Decomposition rule.** A `str_matches` value is auto-migratable when,
after stripping anchors (`^`/`$`) and any leading/trailing `.*`, the
remainder is **literal text containing at most one alternation group**
`(x|y|...)` and no other regex metacharacters (no `[]`, `+`, `?`, `{}`,
`\d`, `\w`, `.` used as wildcard; escaped literals like `\.` count as
the literal char). Anything else is BLOCKED.

### Blocked (manual review)

These genuinely have no clean Confidence translation on **any** backend:

- **`str_contains_any` / `str_contains_none`** — Confidence has no
  substring/contains rule. Reason: `Uses a 'contains' match on
  '<attribute>'; Confidence has no substring rule.` (Workaround: change
  the context field to send a list of strings and use set matching.)
- **Generic `str_matches` regex** — anything that fails the
  decomposition rule above (character classes, quantifiers, wildcard
  `.`, etc.). Reason: `Uses a regex on '<attribute>' that isn't a
  prefix/suffix/alternation; Confidence has no general regex rule.`
- **`experiment_group`** — depends on another experiment's assignment.
  Reason: `Depends on experiment-group assignment; migrate manually.`
- **`javascript`** — arbitrary JS expression. Reason: `Uses a custom
  JavaScript condition; no Confidence equivalent.`
- **Version *range* comparisons on an un-normalizable format** — only
  `version_gt/gte/lt/lte`, and only when the value can't be reduced to
  the supported 2–4 numeric segments. `v`-prefix and `+build` metadata
  ARE normalizable: strip them on **both** the criterion and the runtime
  context value (the skill strips them; the app must send the cleaned
  value too). Truly blocked only for non-numeric schemes (date/calendar
  versions, git hashes, named releases). Two escape hatches before
  blocking: (a) **version equality/set** (`version_eq` / `version_neq` /
  `any` / `none`) needs no parsing — use an `eqRule`/`setRule` on the raw
  strings; (b) for ranges, send a **numeric build number** in context and
  use a numeric `rangeRule`. Reason (last resort): `Version range on
  '<attribute>' uses a non-numeric format; use exact match or a numeric
  build number instead.`

These are **not** blocked outright — they downgrade gracefully:

- **`passes_gate` / `fails_gate` / experiment `targetingGateID`** —
  Confidence has no flag-to-flag dependency, but the referenced gate's
  conditions can be **inlined** (or turned into a shared segment on the
  REST backend) and composed with `and` / `not`. Only block if the
  referenced gate is itself unmigratable. Note the inlining in the plan
  (it won't auto-update if the source gate changes).
- **Large `id_list` segments** — use a **REST materialized segment**
  (BigQuery). Only block (`References an id_list segment too large to
  inline`) if the REST backend / BigQuery isn't available.

When a rule/condition is blocked, mark it in Section 4 (per the
template). A flag is fully blocked only when *every* non-default rule is
blocked.

### Worked example (gate waterfall)

A three-rule Statsig gate — internal users force-on at 100%, then a 50%
pass to US/CA, then "Everyone" at 0% — becomes `addTargetingRule` calls
plus a catch-all (the split lives entirely in `variantAllocations`;
there is no separate rollout field):

1. Rule 1: `email str_matches ".*@spotify\.com$"` (suffix regex — how
   email suffix targeting actually arrives; see per-type validity) →
   decomposes to payload `endsWithRule "@spotify.com"`,
   `variantAllocations { "enabled": 100 }`
2. Rule 2: `country any ["US","CA"]` (passPercentage 50) → payload
   `setRule [US, CA]`, `variantAllocations { "enabled": 50, "disabled": 50 }`
   — the 50% fail share is captured **in this rule** as `disabled`, NOT
   left to fall through (Statsig capture semantics)
3. Rule 3 (`public`, passPercentage 0) → 0% pass contributes nothing;
   omit it and rely on the catch-all
4. Catch-all (default): no payload → `disabled` at 100%. Reproduces the
   gate's implicit `false`; MUST come last.

---

## Full-Fidelity Phase 1 via the Confidence REST API

Use this path for the constructs the MCP can't express: partial
experiment `allocation`, reusable / `id_list` segments, layer mutual
exclusion, and holdouts. It needs the `CONFIDENCE_TOKEN` from
"Prerequisites: Confidence Side". Base URL `https://flags.confidence.dev/v1`;
every call sends `-H "Authorization: Bearer $CONFIDENCE_TOKEN"`.

### The REST rule model (different from the MCP model)

A REST flag rule does **not** carry an inline payload + `variantAllocations`.
Instead it references a **segment** (which holds the targeting + the
allocation proportion) and assigns variants by **bucket ranges**:

```bash
curl -sS -X POST "https://flags.confidence.dev/v1/flags/<flag>/rules" \
  -H "Authorization: Bearer $CONFIDENCE_TOKEN" -H "Content-Type: application/json" \
  -d '{
  "segment": "segments/<segment-id>",
  "assignmentSpec": {
    "bucketCount": 100,
    "assignments": [
      { "variant": { "variant": "flags/<flag>/variants/control" }, "bucketRanges": [{"lower":0,"upper":34}] },
      { "variant": { "variant": "flags/<flag>/variants/variant-a" }, "bucketRanges": [{"lower":34,"upper":67}] },
      { "variant": { "variant": "flags/<flag>/variants/variant-b" }, "bucketRanges": [{"lower":67,"upper":100}] }
    ]
  },
  "targetingKeySelector": "user_id"
}'
```

Key facts:
- **Targeting lives in the segment**, not the rule. The rule picks the
  segment + the variant split (bucket ranges over `bucketCount`).
- **Allocation/rollout = the segment's `allocation.proportion`** (0.0–1.0):
  the fraction of the matched audience that is *in* the segment. Users
  not in the segment fall through to the next rule.
- Special assignments: `{"fallthrough":{}}` (matched → continue to next
  rule) and `{"clientDefault":{}}` (serve the caller's default).
- **Rules start disabled.** Enable each with
  `PATCH /v1/flags/<flag>/rules/<ruleId>?updateMask=enabled` body
  `{"enabled":true}`. Order via the `priority` field (lower = first).
- Flags/variants still need to exist first — you can create them with the
  MCP `createFlag` (recommended, since it also wires the client) or via
  `POST /v1/flags`. Either way the REST rules then reference
  `flags/<flag>/variants/<variant>`.

### Segments (items 2 & 3 — reusable + id_list)

Create once, allocate, reference from many flag rules:

```bash
# rule_based segment from a Statsig segment / inline audience
curl -sS -X POST "https://flags.confidence.dev/v1/segments?segmentId=<id>" \
  -H "Authorization: Bearer $CONFIDENCE_TOKEN" -H "Content-Type: application/json" \
  -d '{ "displayName": "<name>",
        "targeting": { "criteria": { ... }, "expression": { ... } },
        "allocation": { "proportion": { "value": "1.0" } } }'
# segments MUST be allocated before use in a rule:
curl -sS -X POST "https://flags.confidence.dev/v1/segments/<id>:allocate" \
  -H "Authorization: Bearer $CONFIDENCE_TOKEN"
```

- The `targeting` uses the **same** `criteria` + `expression` payload as
  the MCP path (the Operator Mapping table is unchanged — only the
  transport differs).
- **De-duplicate:** a Statsig `rule_based` segment referenced by N flags
  becomes ONE Confidence segment, referenced N times. Track the
  `statsig-segment-id → segments/<id>` map in the plan.
- **Composing segments (e.g. `passes_segment` AND `fails_segment` in one
  Statsig rule):** a REST flag rule references exactly ONE segment, but
  segment targeting supports **segment criteria** — create a wrapper
  segment whose expression combines the reusable ones (verified live):

  ```json
  "targeting": {
    "criteria": { "s0": { "segment": { "segment": "segments/premium-users" } },
                   "s1": { "segment": { "segment": "segments/internal-staff" } } },
    "expression": { "and": { "operands": [ { "ref": "s0" }, { "not": { "ref": "s1" } } ] } }
  }
  ```
- **`id_list` segments → materialized segments** (BigQuery only): export
  the id list to a BigQuery table, then
  `POST /v1/materializedSegments?materializationId=<id>` and a load job
  whose `sql` selects the unit-id column. If BigQuery isn't available and
  the list is large, keep the condition BLOCKED.

### Partial experiment allocation (item 1)

An experiment with `allocation` < 100 maps exactly:

1. Create a segment for the experiment's targeting
   (`inlineTargetingRules`, or empty `targeting: {}` for "all"), with
   `allocation.proportion = allocation / 100` (e.g. `"0.5"` for 50%).
2. Allocate the segment.
3. Add a flag rule referencing it whose `assignmentSpec` splits the
   **groups** across the full `0–100` bucket range by `size`
   (e.g. control `0–34`, variant-a `34–67`, variant-b `67–100`).
4. Add a trailing catch-all rule (segment with `proportion 1.0`, or the
   MCP catch-all) serving the **control** group's value — this catches
   the `1 − proportion` of users who weren't allocated into the
   experiment.

This reproduces "50% enter, split 34/33/33, the rest get control"
faithfully, which the MCP `variantAllocations` (sum-to-100, no rollout
knob) cannot.

### Layer mutual exclusion (item 4)

Statsig **layers** make their experiments mutually exclusive. Map each
layer to a Confidence **exclusivity group** via segment coordination:
every experiment in layer `L` gets a segment whose `allocation` carries
matching coordination tags:

```json
"allocation": { "proportion": { "value": "0.5" },
                "exclusivityTags": ["<layer-id>"],
                "exclusiveTo": ["<layer-id>"] }
```

Segments sharing an `exclusivityTags`/`exclusiveTo` group never overlap —
no user lands in two of the layer's experiments. The sum of proportions
across a coordination group must fit in 100% (allocation can fail
otherwise — surface that to the user). Record the
`layer-id → exclusivity tag` mapping in the plan.

### Holdouts (item 5)

Statsig **holdouts** (`holdoutIDs`) hold a fixed random subset of users
out of a set of experiments. The Confidence analogue is a **holdback**,
configured as a **surface setting** (Admin → Surfaces), not a flag-API
object. So holdouts are migrated as a **manual surface step**, not an
automated API call:

- Record each distinct Statsig holdout in the plan with its size and the
  experiments it covers.
- During execute, instruct the user to create a matching holdback on the
  relevant surface (proportion = the holdout's size) and attach it to the
  migrated experiments.
- Approximation without surfaces: model the held-out population as a
  shared segment and **exclude** it (`not` the segment criterion) from
  each covered experiment's targeting. Note this lacks the holdback's
  cross-experiment reuse guarantees.

### Verification

REST-created flags resolve through the same client. Verify with the MCP
`resolveFlag` (positive + negative + waterfall) exactly as the MCP path
does — the resolve behavior is identical regardless of which backend
wrote the rules.

---

## Plan Flag: Template

```markdown
# Statsig to Confidence Flag Migration Plan

**Created:** <date>
**Scope:** Flag definitions only

---

## Generation Status

| Step | Status | Result |
|------|--------|--------|
| 1. Scan Statsig | ○ not started | |
| 2. Choose client | ○ not started | |
| 3. Map unit ID | ○ not started | |
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

## 2. Unit ID Mapping

An entity is the "thing" being randomly assigned to a variant — usually
a user. The entity field (like `user_id` or `visitor_id`) is the
identifier Confidence uses for consistent assignment: the same subject
always sees the same variant.

Statsig's unit ID (`idType`) maps to one Confidence entity field.

| Statsig `idType` | Confidence entity field |
|------------------|-------------------------|
| <userID / stableID / custom> | `<selected-entity>` |

Any Statsig rules that targeted `user_id` / `unit_id` directly are
rewritten to target `<selected-entity>`.

---

## 3. Context Schema

The context schema defines what fields Confidence expects in the
evaluation context when resolving flags — things like `country`,
`plan`, or `appVersion` that targeting rules use.

> Note: Statsig auto-derives some attributes server-side (country from
> IP; browser/OS/version from the user agent). Confidence needs these
> passed explicitly in the evaluation context — Phase 2 must supply them.

### Already in Confidence

| Field | Type | Entity | Statsig condition |
|-------|------|--------|-------------------|
<matching fields>

### Need to Create

| Field | Type | Entity | Statsig condition |
|-------|------|--------|-------------------|
<missing fields — execute will create these>

### Confidence-only (not in Statsig)

| Field | Type | Entity |
|-------|------|--------|
<reference only, no action needed>

---

## 4. Flags to Migrate

**Migration is opt-in.** Each flag starts with both checkboxes empty.
Tick `[x] Migrate` for every flag you want to bring across, or
`[x] Skip` to drop it. Flags with neither box ticked will be refused
by `execute` — no implicit defaults.

### Flag: `<flag-key>`

**Statsig type:** <Feature Gate / Dynamic Config / Experiment>
**Description:** <from Statsig if available, otherwise empty>
**Backend:** <MCP (default) / REST — REST is required for partial allocation, reusable or id_list segments, layer exclusivity, or holdouts>
**Confidence schema:** <e.g. `{ enabled: boolean }` for a gate; the value shape for a config/experiment>
**Variants:** <variant list — e.g. "enabled, disabled" for a gate; group names for an experiment>
**Confidence resolve path:** `<flag-key>.<property>` (Phase 2 reads this; `.enabled` for gates, `.<param>` per config/experiment parameter)
**Unit:** <idType> → entity `<entity>`
**Enabled in Statsig:** <yes / no — if no, set every rule's pass share to 0 (gate rules become `variantAllocations { disabled: 100 }`) so the flag stays OFF until intentionally enabled>
**Rules (Statsig, in order):**
  1. `<rule name>` — <plain-English condition>, pass <X>%, <variant split>
  2. ...
**Default:** <gate: disabled (no-match catch-all); config: defaultValue → variant; experiment: control catch-all>
**Rollout/split:** <how passPercentage / group size / allocation are encoded — variantAllocations (MCP) or segment proportion + bucketRanges (REST)>
**Segments:** <none, or list of Confidence segments created (REST) / inlined (MCP) with the statsig-segment-id → segments/<id> mapping>
**Layer / exclusivity:** <none, or layerID → exclusivity tag (REST)>
**Holdouts:** <none, or holdout ids → holdback surface step>
**Null rules emitted:** <none, or "is null on '<attr>' → ruleless presence criterion under `not`; may render empty in the segment editor">
**Confidence rules:** one targeting rule per Statsig rule, in the same order, plus a final catch-all rule for the default
**Action:** [ ] Migrate  [ ] Skip

If any rule or the whole flag is BLOCKED, replace the **Action** line
with:

**Status:** BLOCKED — <one-line reason from the BLOCKED rules above>
**Action:** [ ] Skip (no migrate option available until the block is resolved)

**Commands:**
<For MCP backend: createFlag, addFlagToClient, addTargetingRule (ONE per Statsig rule, in order) THEN a final catch-all addTargetingRule (no payload, 100% → default variant). For REST backend: createFlag (MCP, to wire the client), then per segment a POST /v1/segments + :allocate, then POST /v1/flags/<flag>/rules (segment + assignmentSpec) + PATCH enabled=true, in order. Finish with resolveFlag (MCP) — positive AND negative case (negative must land on the catch-all and return the default variant)>

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
   - Unit-ID → entity mapping is in the plan
   - REFUSE TO PROCEED if any flag has neither `[x] Migrate` nor
     `[x] Skip` ticked. List those flags back and ask the user to tick a
     box for each. Migration is opt-in — never assume a default.
   - REFUSE TO PROCEED if any flag is marked `BLOCKED` and the user
     hasn't either resolved the block or ticked `[x] Skip`. Surface the
     BLOCKED flags and the reason for each.
2. FOR EACH FLAG marked [x] Migrate:
   - Show flag name, type, description, and rules in plain English
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
   g. Create PR titled: "feat: migrate <flag-key> from Statsig to Confidence"
   h. CHECKPOINT: "PR created. [Continue to next flag / Pause]?"
4. COMPLETION — show summary + list all PRs created
```

### Flag Setup Sequence (MUST complete all steps before resolving)

**Pick the backend from the flag's `Backend` field first.** The sequence
below is the **MCP** path (the default). For a flag marked `Backend: REST`,
use the **REST sequence** instead (next subsection), then verify with the
same `resolveFlag` step 4. Either way, do NOT call `resolveFlag` until all
prior steps succeed.

#### MCP sequence

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
    call per Statsig rule in the SAME ORDER (Confidence evaluates rules
    top-down — order is semantically significant).
  → Add the default LAST as a catch-all rule: addTargetingRule with
    variantAllocations { <defaultVariant>: 100 } and NO payload (empty
    payload = targets all contexts). Confidence has no flag-level default
    (see "Default value" above), so this is the only way to reproduce a
    gate's implicit false / a config's defaultValue. It MUST come after
    every specific rule.
  → IMPORTANT: targeting rules added while a flag is archived OR
    immediately after unarchiving may become inactive. Always complete
    steps 1-2 fully BEFORE calling addTargetingRule.

STEP 4: resolveFlag (verification)
  → Resolver state propagates asynchronously: a resolveFlag immediately
    after flag/rule creation can fail with "No active flags found for
    the client" even though the flag is ACTIVE and wired (observed
    live). Wait a few seconds and retry before treating it as an error.
  → MUST test BOTH positive AND negative cases:
    a. Resolve with a context that SHOULD match → verify expected variant
    b. Resolve with a context that SHOULD NOT match any specific rule →
       verify it lands on the catch-all and returns the default variant
  → For multi-rule flags, also resolve with a context that misses the
    first rule but matches a later one — verifies waterfall order.
  → For attribute-based targeting, the resolve call MUST include those
    attributes in the evaluation context.
  → Do NOT report a flag as successfully migrated until both positive and
    negative resolve tests pass.
```

#### REST sequence (Backend: REST)

For flags needing partial allocation, reusable/`id_list` segments, layer
exclusivity, or holdouts. Requires `CONFIDENCE_TOKEN` (confirm it's set;
if not, prompt the user — see prerequisites). Follow the recipes in
"Full-Fidelity Phase 1 via the Confidence REST API".

```
STEP 1: createFlag + client  (MCP createFlag — also wires the client and variants)
STEP 2: For each segment this flag needs (in the plan's Segments list):
  → POST /v1/segments?segmentId=<id>  (targeting + allocation.proportion
    + exclusivityTags/exclusiveTo for layered experiments)
  → POST /v1/segments/<id>:allocate   (MUST allocate before use)
  → For id_list: POST /v1/materializedSegments + a load job instead
  → Reuse already-created segments (check the plan's segment map) — do
    not recreate
STEP 3: For each Statsig rule, in order:
  → POST /v1/flags/<flag>/rules  (segment + assignmentSpec bucketRanges
    + targetingKeySelector)
  → PATCH /v1/flags/<flag>/rules/<ruleId>?updateMask=enabled  {enabled:true}
  → Set priority so order matches the Statsig waterfall (lower = first)
  → Add the trailing catch-all rule LAST (default variant)
STEP 4: Holdouts (if any): instruct the user to create the matching
  holdback on the relevant surface and attach it (manual surface step).
STEP 5: resolveFlag (verification) — identical to the MCP sequence's
  STEP 4 (positive + negative + waterfall).
```

### Rules

- **NEVER auto-continue** — always wait for user at each checkpoint
- **Flag-by-flag** — each flag is one unit (its files + tests)
- **Preserve source order** — one Confidence rule per Statsig rule, in
  the same order
- **Resumable** — update the Progress table in the plan file after each step

## Execute: Statsig-Specific Notes

**Segments first.** REST-backend flags: create + allocate every segment
the flag references **before** adding its rules (rules reference segments
by name), reusing any already-created segment per the plan's segment map.
MCP-backend flags: the `rule_based` segment conditions are already inlined
into the flag's payload in the plan, so no separate step is needed — apply
the payload as written.

**Disabled-in-Statsig handling.** If an item's `isEnabled` is false,
surface that during execute:

> This <gate/config/experiment> is DISABLED in Statsig. I'll create it in
> Confidence but keep it OFF (every rule's pass share set to 0 — gate
> rules become `variantAllocations { disabled: 100 }`) until you turn it
> on intentionally. Continue?

**Type → Confidence schema (and the resolve-path handoff to Phase 2).**
A Confidence flag is a struct, not a bare scalar, so each flag needs a
named **property** that holds the migrated value. Pick the property by
Statsig type so Phase 2 can reconstruct the resolve path:

| Statsig type | Confidence schema (`schemaObject`) | Resolve path |
|--------------|------------------------------------|--------------|
| **Feature Gate** | `{ "enabled": "boolean" }` (the `createFlag` default) | `<flag>.enabled` |
| **Dynamic Config** | the value object's shape (one property per key) | `<flag>.<key>` per parameter |
| **Experiment** | the group `parameterValues` shape (one property per parameter) | `<flag>.<param>` per parameter |

For gates, variants are `enabled` (`{ enabled: true }`) and `disabled`
(`{ enabled: false }`). For configs, create one variant per distinct
`returnValue` plus one for `defaultValue`. For experiments, create one
variant per `group`, each carrying its `parameterValues`. Record the
resolve path on the flag's plan entry — Phase 2's code transform reads
it verbatim.

**Waterfall verification.** Because Statsig items often have multiple
rules, the Flag Setup Sequence Step 4 (above) requires you to also
resolve with a context that misses the first rule but matches a later
one — this verifies the waterfall order is preserved.

---

## Plan Code: Steps

The code phase has 5 steps: Step 1 detect language/framework, Step 2
fetch the Confidence SDK guide (and signal any resolve-mode change),
Step 3 scan the codebase for Statsig usage, Step 4 generate transform
rules, Step 5 generate the plan.

### Step 1: Detect language & framework

```
Grep: pattern="<Statsig import/symbol patterns from Step 3>"  → Find Statsig usage
Glob: pattern="package.json" or "build.gradle" or "go.mod" or "requirements.txt" etc
Read: dependency file  → Determine language/framework
```

### Step 2: Fetch SDK guide from `confidence-docs` MCP

**Step 2a — pick the target resolve mode.** Confidence has FOUR modes,
not a local/remote binary. Pick from the language/framework detected in
Step 1, honoring the "prefer local resolve" policy (see "SDK
Preference"):

| Target mode | Confidence SDKs | How evaluation works | Network profile |
|-------------|-----------------|----------------------|-----------------|
| **In-process** (local resolve) | backend **Java, Go, JS/Node, Rust, Python** | Periodically fetch the resolver **state** (full ruleset); evaluate locally via WASM | No per-eval network call; network only for state refresh |
| **Cached client** | **Android, iOS, web/browser JS, React, React Native** | Backend resolves; device **prefetches and caches resolved VALUES**. Reads are local + offline. Context change triggers a refetch | Network on init / context change / refresh — NOT per read |
| **Server-precomputed** | server-rendered React/Next.js (RSC) | Server resolves for a bound subject; client reads resolved values offline | Resolution on the server; client reads are offline |
| **Remote** (per-call) | backend **Ruby, .NET** (and Python only if you can't use the local-resolve provider) | Each resolve is a service call to Confidence | One call per resolve (with default-value fallback on failure) |

> **Python now has a local-resolve provider** (`confidence-openfeature-provider`,
> alpha — from `spotify/confidence-resolver`). Prefer it for Python backends
> (in-process, no per-eval network call); fall back to the remote provider only
> if the alpha provider isn't acceptable. The `getLocalResolveIntegrationGuide`
> MCP tool currently only enumerates `JAVA/GO/JS/RUST`, so fetch the Python
> provider details from PyPI / the repo README rather than that tool.

Routing:

- Backend **and** language ∈ {Java, Go, JS/Node, Rust} → **in-process**.
  Fetch the local-resolve guide (server-only):

  ```
  mcp__confidence-docs__getLocalResolveIntegrationGuide
    sdk: "JAVA" | "GO" | "JS" | "RUST"
  ```

- Backend **Python** → **in-process** via the local-resolve provider
  `confidence-openfeature-provider` (alpha). Get its API from PyPI / the
  `spotify/confidence-resolver` Python provider README (not the
  `getLocalResolveIntegrationGuide` tool, which omits Python).
- Client app (mobile / browser / React Native) → **cached client**.
  Backend **Ruby / .NET** (or Python if the alpha provider is unacceptable)
  → **remote**. Either way fetch:

  ```
  mcp__confidence-docs__getCodeSnippetAndSdkIntegrationTips
    sdk: "<detected>"
  ```

**CRITICAL:** Include the ACTUAL MCP response in the plan, not a
reference to fetch it. Plans are self-sufficient.

**Step 2b — signal any resolve-mode CHANGE.** Compare the source mode
(defined in "Source resolve mode (Statsig)" below) to the target mode
from 2a and, if it shifts, tell the user precisely what changes. Record
the decision and any change notice in the plan's SDK Setup section and
re-surface it at execute time. If unchanged, state that explicitly.

### Source resolve mode (Statsig) — feeds the Step 2b signal

Map the Statsig SDK in use to a source mode by surface:

- **Statsig server SDK** (`statsig-node` v3+, Server Core
  `@statsig/statsig-node-core`, `statsig` Python/Ruby, Java/Go/.NET) →
  source mode = **in-process eval** (the SDK downloads the project config
  and evaluates locally, no per-check network call).
- **Statsig client SDK** (`@statsig/js-client`, `@statsig/react-bindings`,
  Android/iOS) → **precomputed/cached values**: the server precomputes
  per-user values that the client reads locally (with `updateUser`
  triggering a refetch).
- **Statsig on-device evaluation client SDK**
  (`@statsig/js-on-device-eval-client`) → **on-device eval** (the client
  downloads the ruleset and evaluates locally).

Then the Step 2b transitions apply:

- Statsig server → Confidence **in-process** (Java/Go/JS/Rust, and
  **Python** via the alpha local-resolve provider): unchanged.
- Statsig server → Confidence **remote** (Ruby/.NET, or Python only if not
  using the local-resolve provider): ⚠️ in-process → remote — each resolve
  becomes a service call.
- Statsig client (precomputed) → Confidence **cached client**: ✅ similar
  model — backend resolves, client reads cached values offline; reads
  stay local/fast.
- Statsig on-device eval → Confidence **cached client**: ⚠️ on-device →
  cached client. Reads stay local/offline, but evaluation moves to the
  backend; the device caches resolved values instead of the ruleset (a
  payload/security win — the full ruleset is no longer shipped to the
  client).

### Plan-file path

`.claude/plans/statsig-code-migration-<date>.md`

### Step 3: Scan codebase for Statsig usage

```
Grep: pattern="statsig|Statsig|StatsigClient|StatsigUser" → Find Statsig imports
Grep: pattern="checkGate|check_gate" → boolean gate checks
Grep: pattern="getConfig|get_config|getDynamicConfig|get_dynamic_config" → dynamic configs
Grep: pattern="getExperiment|get_experiment" → experiments
Grep: pattern="getLayer|get_layer" → layers
Grep: pattern="useGateValue|useFeatureGate|useExperiment|useLayer|useDynamicConfig|useStatsigClient" → React hooks
```

**Scan case-insensitively.** Method names vary by language and SDK
generation (legacy vs Server Core). Map whatever you find to an
evaluation TYPE, not a fixed spelling:

| Statsig call | What it returns | Confidence accessor (by value type) |
|--------------|-----------------|-------------------------------------|
| `checkGate(user, "g")` / `client.checkGate("g")` | boolean | `getBooleanValue("g.enabled", false, ctx)` |
| `getConfig(user, "c").get("p", d)` | typed param | `get<Type>Value("c.p", d, ctx)` |
| `getDynamicConfig(user, "c").get("p", d)` | typed param | `get<Type>Value("c.p", d, ctx)` |
| `getExperiment(user, "e").get("p", d)` | typed param | `get<Type>Value("e.p", d, ctx)` |
| `getLayer(user, "l").get("p", d)` | typed param | `get<Type>Value("<exp>.p", d, ctx)` — the layer param resolves through its backing experiment flag |
| `.getValue()` / `.value` (whole config object) | object | `getObjectValue("c", {}, ctx)` |

**Classify the SDK as client-side or server-side** — this decides the
evaluation-context model in Step 4:

| Statsig package | Side |
|-----------------|------|
| `@statsig/js-client`, `@statsig/react-bindings`, `@statsig/react-native-bindings`, Android/iOS client SDK | **client** |
| `@statsig/js-on-device-eval-client` | **client (on-device eval)** |
| `statsig-node`, `@statsig/statsig-node-core`, `statsig` (Python/Ruby), Java/Go/.NET server SDK | **server** |

Group files by the **gate/config/experiment name** they reference (the
string argument). For each evaluation site, record:
- The Statsig name and TYPE (gate / config / experiment / layer)
- **Client vs server side** (from the table above)
- The value type (boolean for gates; inferred from the `.get(param, default)`
  call or `default` literal for configs/experiments)
- The `StatsigUser` argument (so the transform can map `userID`/`custom`
  to `targetingKey` + attributes)
- The `default` argument (carried over to the Confidence call)
- The **Confidence resolve path** (`<flag-key>.<property>`) from the
  Phase 1 plan's "Confidence resolve path" line. For gates the property
  is `enabled`. If the item is NOT in the Phase 1 plan, flag it — the
  code references a flag that was never migrated; do not invent a path.

### Step 4: Generate transform rules

**Two things are NOT 1:1 line replacements — get them right first:**

1. **Name → resolve path.** Confidence flags are structs; every read
   uses a dot-path `<flag-key>.<property>`. Use the resolve path from the
   Phase 1 plan everywhere the bare Statsig name appeared. A
   `getConfig("c").get("p")` becomes `getXValue("c.p", default)` — the
   parameter folds INTO the path.
2. **Evaluation-context model depends on client vs server:**
   - **Server SDKs** pass the `StatsigUser` **per call** — fold
     `user.userID` → `targetingKey` and `user.custom` / top-level fields
     → attributes into the evaluation-context argument of each resolve.
   - **Client SDKs** use **ambient** context — no per-call user argument.
     Hoist `userID` + attributes ONCE into a
     `setEvaluationContext`/`setEvaluationContextAndWait` call (at init or
     where the user becomes known, replacing Statsig's
     `updateUser` / init user), and the per-call site becomes a bare
     `get<Type>Value(path, default)`.

**StatsigUser → evaluation context.** Statsig's user object
(`{ userID, email, country, appVersion, custom: {...}, customIDs: {...} }`)
maps to a Confidence evaluation context: `userID` → `targetingKey`;
top-level reserved fields and `custom` entries → attributes of the same
name; `customIDs` → the corresponding entity fields. Statsig auto-derives
country/browser/OS/version server-side — in Confidence you MUST pass
these explicitly, so add them to the context where targeting needs them.

**Omit `undefined` attributes (verified).** OpenFeature's
`EvaluationContext` (at least the TypeScript `@openfeature/server-sdk`)
rejects `undefined` values under strict typing. When the source reads
optional `StatsigUser` fields, build the context by **adding present
attributes conditionally** — do NOT emit `{ email: user.email }` when
`email` may be `undefined`. (Confirmed by typechecking the
`phase2-examples/node-server` fixture against the real provider.)

**Server-target mapping (per-call context), JS/TS example:**

| Statsig call | OpenFeature call |
|--------------|------------------|
| `statsig.checkGate(user, "g")` | `client.getBooleanValue("g.enabled", false, { targetingKey: user.userID, ...attrs })` |
| `statsig.getConfig(user, "c").get("p", d)` | `client.get<Type>Value("c.p", d, { targetingKey: user.userID, ...attrs })` |
| `statsig.getExperiment(user, "e").get("p", d)` | `client.get<Type>Value("e.p", d, { targetingKey: user.userID, ...attrs })` |

The accessor name and signature are language-specific (use the Step 2
SDK guide):
- **Go**: PascalCase, context-LAST, `ctx` first:
  `client.BooleanValue(ctx, "g.enabled", false, evalCtx)` where
  `evalCtx := openfeature.NewEvaluationContext(user.UserID, attrsMap)`.
- **Java**: build a `MutableContext(userID)` + `ctx.add(...)`:
  `client.getBooleanValue("g.enabled", false, ctx)`.
- **Python (in-process, local-resolve — preferred)**: snake_case
  `get_<type>_value`, context last:
  `client.get_boolean_value("g.enabled", False, EvaluationContext(targeting_key=user_id, attributes=attrs))`.
  Init with `from confidence import ConfidenceProvider` +
  `api.set_provider_and_wait(ConfidenceProvider(client_secret=...))`, then
  `api.get_client()`; delete Statsig's `statsig.initialize()` wait.
  (Verified against `confidence-openfeature-provider==0.7.1` in
  `phase2-examples/python-server`.)
- **Python (REMOTE target — fallback only)**: same getters, but init with the
  remote provider via `api.set_provider(...)` (NOT `set_provider_and_wait`).

**Client-target mapping (ambient context):** the per-call site drops its
user argument; emit a one-time context setup instead.

| Statsig call | Confidence client call | Plus, once |
|--------------|------------------------|------------|
| `client.checkGate("g")` | `getBooleanValue("g.enabled", false)` | `setEvaluationContext({ targetingKey: userID, ...attrs })` |
| `client.getExperiment("e").get("p", d)` | `get<Type>Value("e.p", d)` | (same — set once) |

**React mapping.** Statsig `@statsig/react-bindings` hooks map to
Confidence's React `useFlag`. **Prefer the local-resolve React integration**
(server-precomputed / RSC) — the standalone Confidence React SDK
(`@spotify-confidence/react`) is being phased out. Imports come from
`@spotify-confidence/openfeature-server-provider-local/react-server`
(the `<ConfidenceProvider context flags>` RSC component + `getFlag`) and
`/react-client` (`useFlag`/`useFlagDetails`). Register the provider once on
the server with `createConfidenceServerProvider` + `OpenFeature.setProviderAndWait`
(as in the server case). (Validated in `phase2-examples/react-client` against
provider `0.14.2` + React 19.)

| Statsig (React) | Confidence (React, local-resolve) |
|-----------------|-----------------------------------|
| `<StatsigProvider sdkKey user>` | server `<ConfidenceProvider context={{ targetingKey: userID, ...attrs }} flags={[...]}>` (from `/react-server`); the user becomes the context, resolution happens server-side |
| `useGateValue("g")` / `useFeatureGate("g").value` | `useFlag("g.enabled", false)` (from `/react-client`) |
| `useDynamicConfig("c").get("p", d)` | `useFlag("c.p", d)` |
| `useExperiment("e").get("p", d)` / `.value.p` | `useFlag("e.p", d)` |
| `useLayer("l").get("p", d)` | `useFlag("<exp>.p", d)` |
| `useStatsigClient().checkGate("g")` | `useFlag("g.enabled", false)` (or `getFlag` server-side) |

⚠️ **Resolve-mode shift:** Statsig React (client-precomputed) → Confidence
**server-precomputed**. Client reads stay local/offline, but resolution moves
to the server, so this needs an RSC server (e.g. Next.js App Router). For a
pure SPA with no server, fall back to the (deprecated) cached-client web SDK
`@spotify-confidence/react` (`ConfidenceProvider` + `useFlag` on top of
`@spotify-confidence/sdk`).

**Remove Statsig readiness scaffolding.** Statsig examples gate the
first check behind `await statsig.initialize(...)` /
`await client.initializeAsync()` / `StatsigProvider`'s loading state.
Confidence's `setProviderAndWait` / `setEvaluationContextAndWait` already
block until flags are ready — delete the hand-rolled wait rather than
porting it. Drop Statsig's `disableExposureLog` plumbing and manual
exposure logging (`logEvent` for exposures) — Confidence logs exposure
automatically.

**Layers caveat.** A Statsig `getLayer("l").get("p", d)` reads a
parameter that, in Statsig, is owned by whichever experiment is
currently allocated in that layer. Confidence has no layer; resolve the
param through the specific experiment flag the Phase 1 plan created for
it. If a layer parameter is shared across multiple experiments, surface
it for review rather than guessing which flag owns it.

### Step 5: Generate plan

Save the plan to `.claude/plans/statsig-code-migration-<date>.md` using
the template below.

**Two Confidence-wide truths every code transform must honor:**

- **Flags are structs — read a property, not the bare name.** Always use
  `<flag>.<property>` (gates → `.enabled`; configs/experiments →
  `.<param>`).
- **Client SDKs use ambient context; server SDKs pass it per call.**

## Plan Code: Template

```markdown
# Statsig to Confidence Code Migration Plan

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
| **Source mode** | <in-process eval / precomputed-cached / on-device eval — per surface> |
| **Target mode** | <in-process / cached client / server-precomputed / remote — from Step 2a> |
| **Change** | <unchanged / ⚠️ in-process → remote / ⚠️ on-device → cached client / … — see notice> |

<If changed: one-paragraph notice of what actually shifts. If unchanged: "Resolve mode is preserved.">

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
| <Statsig import> | <Confidence import> |
| <Statsig usage> | <Confidence usage> |

### Test Files

| Find | Replace |
|------|---------|
| <Statsig mock> | <Confidence mock> |

---

## 3. Files to Transform

<list from codebase scan, grouped by gate/config/experiment name>

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
`confidence-docs` for `plan code`), plus the Statsig Console API — no
MCP, just `curl` with `STATSIG-API-KEY: $STATSIG_API_KEY` and
`STATSIG-API-VERSION: 20240601`.

| Source | What's used |
|--------|-------------|
| Confidence MCP | `listClients`, `createClient`, `getContextSchema`, `addContextField`, `createFlag`, `addFlagToClient`, `unarchiveFlag`, `addTargetingRule`, `resolveFlag` |
| Confidence Docs MCP (`plan code`) | `getLocalResolveIntegrationGuide`, `getCodeSnippetAndSdkIntegrationTips`, `searchDocumentation`, `getFullSource` |
| Confidence REST API (`CONFIDENCE_TOKEN`, OPTIONAL — full-fidelity Phase 1) | `POST /v1/segments` + `:allocate`, `POST /v1/materializedSegments` (+ load jobs), `POST /v1/flags/{flag}/rules` + `PATCH …?updateMask=enabled`; token via `POST https://iam.confidence.dev/v1/oauth/token` |
| Statsig Console API (`STATSIG-API-KEY`) | `GET /console/v1/gates`, `GET /console/v1/gates/{id}`, `GET /console/v1/dynamic_configs[/{id}]`, `GET /console/v1/experiments[/{id}]`, `GET /console/v1/segments/{id}` |
