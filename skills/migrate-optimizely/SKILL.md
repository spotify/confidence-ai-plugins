---
description: Migrate feature flags from Optimizely to Confidence SDK. Use when the user says /migrate-optimizely, asks to migrate Optimizely flags, or transform SDK code to Confidence.
---

# Optimizely to Confidence Migration

MCP-driven, self-sufficient migration from Optimizely to Confidence.

## Migration Flow

The migration happens in two phases: **flags first, then code**.

```
Phase 1: Flag Definitions
  plan flags  →  Scan Optimizely, choose environment & client & entity, generate plan
  execute     →  Create each flag in Confidence with targeting rules

Phase 2: Code Transformation
  plan code   →  Scan codebase, fetch SDK guide, generate transform rules
  execute     →  Transform code flag by flag, each flag = one PR
```

**Why flags first?** The flags need to exist in Confidence before the
code can resolve them. Once flags are live in Confidence, you migrate
the code that evaluates them — one flag at a time, one PR at a time.

**Each code PR is scoped to a single flag.** This keeps PRs small,
reviewable, and independently shippable. If one flag's migration has
issues, it doesn't block the others.

## Commands

| Command | Description |
|---------|-------------|
| `/migrate-optimizely plan flags` | Phase 1: plan flag definitions migration |
| `/migrate-optimizely plan code` | Phase 2: plan code transformation |
| `/migrate-optimizely execute <plan-file>` | Execute a plan interactively |

---

## Migration Overview (MUST display at start of `plan flags` or `plan code`)

**Every time** the user runs `plan flags` or `plan code`, display this
overview FIRST — before doing any work. This orients the user on where
they are in the full migration journey.

```
═══════════════════════════════════════════════════════════════
  Optimizely → Confidence Migration
═══════════════════════════════════════════════════════════════

  The migration happens in two phases: flags first, then code.

  ┌─────────────────────────────────────────────────────────┐
  │  PHASE 1 — Flag Definitions                            │
  │                                                        │
  │  Move all flags from Optimizely to Confidence with     │
  │  their targeting rules, rollout percentages, variants,  │
  │  and variables.                                        │
  │                                                        │
  │  Steps:                                                │
  │    1. Scan all flags in Optimizely                     │
  │    2. Choose which Optimizely environment to migrate   │
  │    3. Choose a Confidence client (your app)            │
  │    4. Map randomization units (user_id, etc.)          │
  │    5. Generate migration plan with targeting rules     │
  │    6. Execute: create each flag in Confidence          │
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
  │    3. Scan codebase for Optimizely usage               │
  │    4. Generate transform rules (Optimizely→Confidence) │
  │    5. Generate plan grouped by flag                    │
  │    6. Execute: transform code flag by flag, one PR each│
  │                                                        │
  │  Result: Code uses Confidence SDK, Optimizely removed  │
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

## SDK Preference

**ALWAYS prefer OpenFeature with local resolve.**

| Priority | Approach | When to use |
|----------|----------|-------------|
| 1st | Local resolve | Default for all new integrations |
| 2nd | Remote resolve | Only if local resolve not supported for platform |
| Avoid | Direct SDK | Being phased out |

---

## Plan Philosophy

**Plans must be MCP-boxed, self-sufficient, and agent-agnostic.**

| Principle | Meaning |
|-----------|---------|
| **MCP-boxed** | Every external data fetch uses explicit MCP tool calls |
| **Self-sufficient** | Plan contains ALL information needed - no "query MCP for X" |
| **Agent-agnostic** | Any agent with MCPs can execute without prior context |
| **Language-agnostic** | Detect framework, fetch SDK guide from MCP dynamically |

---

## Prerequisites

Before starting any workflow, check that required MCP servers are available.
Try calling a simple tool from each. If it fails, install the missing MCP.

### Optimizely MCP

The Optimizely Feature Experimentation MCP server provides tools to list
projects, flags, experiments, environments, audiences, and manage them.

**Discovery:** The exact tool names depend on the MCP server version. After
installing, use ToolSearch to discover available tools matching `optimizely`.
Common patterns: list projects, list flags, get flag, list environments,
list audiences, get ruleset.

If not available, install it:
```
claude mcp add optimizely-exp --transport http --url https://exp.mcp.opal.optimizely.com/mcp
```

The user will be prompted to authenticate via Opti ID (OAuth) in their browser.

### Confidence MCP

Test: `mcp__confidence-flags__listClients`

If not available, install it:
```
claude mcp add confidence-flags --transport http --url https://mcp.confidence.dev/mcp/flags
```

The user will be prompted to authenticate via OAuth in their browser.

### Confidence Docs MCP (for `plan code` only)

Test: `mcp__confidence-docs__searchDocumentation`

If not available, install it:
```
claude mcp add confidence-docs --transport http --url https://mcp.confidence.dev/mcp/docs
```

---

## User-Facing Communication Rules

**NEVER expose internal technical details to the user.** The user should see
human-readable descriptions of what's happening, not internal implementation
details like targeting payload formats, rule types, or operator names.

- Do NOT say "creating plan based on eqRule / rangeRule / setRule" etc.
- Do NOT show raw targeting payloads or JSON structures in conversation
- DO say things like: "Creating flag with rule: plan equals 'pro' AND country is US or UK"
- DO describe rules in plain English: "age between 18 and 65", "plan is not free"
- The plan FILE may contain MCP command payloads (for machine execution),
  but conversation output must be human-friendly

**Step Tracker:** Display a visual step tracker at every phase transition.
The tracker shows all phases, marks completed ones, highlights the current
one, and shows remaining ones. Update and re-display it each time you move
to a new phase.

### Plan Flags Step Tracker

Display this at the START and after EACH step completes (updating status):

```
───── Plan Flags ──────────────────────────────────────────
  [1] Scan Optimizely   ○ pending
  [2] Choose environment ○ pending
  [3] Choose client      ○ pending
  [4] Map entities       ○ pending
  [5] Generate plan      ○ pending
────────────────────────────────────────────────────────────
```

Status markers:
- `○ pending` — not started yet
- `◉ in progress` — currently running
- `⏸ awaiting user` — blocked on user input (e.g. picking a client or entity)
- `✓ done` — completed (add brief user-facing result)
- `⊘ skipped` — skipped by user

Use `⏸ awaiting user` whenever the workflow has asked a question and is
waiting for an explicit reply. This makes "I'm blocked on you" visible
to both agent and user, and prevents the agent from drifting into
auto-progression while a question is open.

**IMPORTANT:** Never expose internal/technical details in the tracker.
No pagination info, no API page counts, no internal field names.
Show only what matters to the user.

Example after Step 1 completes:
```
───── Plan Flags ──────────────────────────────────────────
  [1] Scan Optimizely   ✓ 12 flags found
  [2] Choose environment ◉ in progress
  [3] Choose client      ○ pending
  [4] Map entities       ○ pending
  [5] Generate plan      ○ pending
────────────────────────────────────────────────────────────
```

### Execute Step Tracker

Display this at the START and update after EACH flag:

```
───── Execute Migration ───────────────────────────────────
  Client: test  |  Entity: user_id  |  Flags: 12
  Progress: [░░░░░░░░░░░░░░░░░░░░] 0/12
────────────────────────────────────────────────────────────
```

Update the progress bar as flags are processed. Use `█` for completed
and `░` for remaining. The bar should be 20 characters wide.

Examples at various stages:
```
  Progress: [██████░░░░░░░░░░░░░░] 4/12 (1 skipped)
  Current:  checkout-redesign
```

```
  Progress: [████████████████████] 12/12 done
  Result:   11 migrated, 1 skipped
```

After each flag completes, show:
```
  ✓ checkout-redesign — MATCH (enabled)
```

After a skip:
```
  ⊘ legacy-banner — skipped
```

### Final Summary (Execute)

At the end of execution, show a complete summary:

```
───── Migration Complete ──────────────────────────────────
  Progress: [████████████████████] 12/12 done
  Migrated: 11  |  Skipped: 1  |  Failed: 0

  ✓ checkout-redesign           100%  user_id
  ✓ pricing-experiment          50/50 user_id
  ⊘ legacy-banner               —     skipped
  ✓ dark-mode                    25%  user_id
  ...
────────────────────────────────────────────────────────────
```

---

## Confidence Naming Rules

- **Flag names:** lowercase letters, digits, and hyphens only (`[a-z0-9-]`)
- **Optimizely flag keys** may contain underscores — convert them to hyphens
  when creating in Confidence (e.g. `product_sort` → `product-sort`)
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

---

## Plan Code: Workflow

### Resume Check (MUST do first)

Same as Plan Flag: check for existing `.claude/plans/optimizely-code-migration-*.md`.
If found with incomplete `Generation Status`, resume from the last
incomplete step. If complete, ask user if they want to start fresh.
If not found, start fresh.

The plan file uses the same progressive pattern: created at Step 1,
updated after each step, with a `## Generation Status` section.

### Step 1: Detect Language & Framework

```
Grep: pattern="optimizely|Optimizely" -> Find Optimizely usage
Glob: pattern="package.json" or "build.gradle" or "Cargo.toml" etc
Read: dependency file -> Determine language/framework
```

**Optimizely SDK packages to detect:**

| Language | Package/Import |
|----------|---------------|
| JS/TS (Node) | `@optimizely/optimizely-sdk` |
| React | `@optimizely/react-sdk` |
| React Native | `@optimizely/react-native-sdk` |
| Python | `optimizely` (PyPI: `optimizely-sdk`) |
| Java | `com.optimizely.ab:core-api` or `com.optimizely.ab.*` |
| Go | `github.com/optimizely/go-sdk` or `github.com/optimizely/go-sdk/v2` |
| Ruby | `optimizely-sdk` (gem) |
| PHP | `optimizely/php-sdk` |
| C# | `Optimizely.Sdk` |
| Swift | `OptimizelySwiftSdk` |
| Android | `com.optimizely.ab:android-sdk` |
| Flutter | `optimizely_flutter_sdk` |

### Step 2: Fetch SDK Guide from MCP

**Query confidence-docs MCP based on detected language:**

```
mcp__confidence-docs__getCodeSnippetAndSdkIntegrationTips
  sdk: "<detected>"
```

```
mcp__confidence-docs__searchDocumentation
  query: "OpenFeature local resolve <detected-language>"
```

```
mcp__confidence-docs__getFullSource
  source: "https://confidence.spotify.com/docs/sdks/server/<language>"
```

**CRITICAL:** Include the ACTUAL response in the plan, not a reference to fetch it.

### Step 3: Scan Codebase for Optimizely Usage

```
Grep: pattern="<optimizely-import-pattern>" -> Find all usages
```

**Must detect BOTH modern and legacy Optimizely API patterns:**

**Modern API (recommended — `decide` method):**

| Pattern | Language |
|---------|----------|
| `createInstance(` | JS/TS |
| `createUserContext(` | All languages |
| `.decide(` / `user.decide(` | All languages |
| `decision.enabled` | All languages |
| `decision.variationKey` / `decision.variation_key` | JS / Python |
| `decision.variables` | All languages |
| `user.trackEvent(` / `user.track_event(` | All languages |
| `OptimizelyProvider` | React |
| `useDecision(` | React |

**Legacy API (deprecated but still common):**

| Pattern | Modern equivalent |
|---------|------------------|
| `isFeatureEnabled(flagKey, userId, attrs)` | `user.decide(flagKey).enabled` |
| `activate(experimentKey, userId, attrs)` | `user.decide(flagKey).variationKey` |
| `getVariation(experimentKey, userId, attrs)` | `user.decide(flagKey).variationKey` |
| `getFeatureVariableString(flagKey, varKey, userId, attrs)` | `user.decide(flagKey).variables[varKey]` |
| `getFeatureVariableInteger(...)` | `user.decide(flagKey).variables[varKey]` |
| `getFeatureVariableBoolean(...)` | `user.decide(flagKey).variables[varKey]` |
| `getFeatureVariableDouble(...)` | `user.decide(flagKey).variables[varKey]` |
| `getFeatureVariableJSON(...)` | `user.decide(flagKey).variables[varKey]` |
| `getAllFeatureVariables(flagKey, userId, attrs)` | `user.decide(flagKey).variables` |
| `track(eventKey, userId, attrs)` | `user.trackEvent(eventKey)` |

Group files by flag key they reference.

### Step 4: Generate Transform Rules

Based on SDK guide from MCP:
- Extract install commands
- Extract initialization code
- Extract flag evaluation API
- Generate find/replace rules matching Optimizely → Confidence patterns

### Step 5: Generate Plan

Save to `.claude/plans/optimizely-code-migration-<date>.md`

---

## Plan Code: Template

```markdown
# Optimizely to Confidence Code Migration Plan

**Created:** <date>
**Scope:** Code transformation only
**Language:** <detected>
**Framework:** <detected>

---

## 1. SDK Setup

### Install

<install commands from MCP response>

### API Reference (from MCP: confidence-docs)

<code examples from MCP response>

### Create Confidence Wrapper

**File:** <appropriate path for detected framework>

**Must match Optimizely API surface:**

| Method | Signature |
|--------|-----------|
<detected from Optimizely usage>

---

## 2. Transform Rules

### Source Files

| Find | Replace |
|------|---------|
| <Optimizely import> | <Confidence import> |
| <Optimizely usage> | <Confidence usage> |

### Test Files

| Find | Replace |
|------|---------|
| <Optimizely mock> | <Confidence mock> |

---

## 3. Files to Transform

<list from codebase scan, grouped by flag>

---

## 4. Progress

| # | Item | Status |
|---|------|--------|
| 0 | SDK Setup | :white_circle: |

```

---

## Plan Flag: Workflow

### Resume Check (MUST do first)

Before starting, check for an existing in-progress plan:

```
Glob: .claude/plans/optimizely-flag-migration-*.md
```

If a plan file exists, read its `## Generation Status` section:
- If status is `complete` → tell user a plan already exists, ask if
  they want to start fresh or use the existing one
- If status is NOT `complete` → **resume from the last incomplete step**
  Tell the user: "Found an in-progress plan. Resuming from step <N>."
- If no plan file exists → start fresh

### Progressive Plan File

The plan file is created at the START (Step 1) and updated after EACH
step. This means if the session closes, the file has partial progress
that can be resumed.

**File path:** `.claude/plans/optimizely-flag-migration-<date>.md`

The plan file MUST include a `## Generation Status` section at the top
(right after the title) that tracks which steps are done:

```markdown
## Generation Status

| Step | Status | Result |
|------|--------|--------|
| 1. Scan Optimizely | ✓ complete | 12 flags |
| 2. Choose environment | ✓ complete | production |
| 3. Choose client | ✓ complete | test |
| 4. Map entities | ○ not started | |
| 5. Generate rules | ○ not started | |
```

Status values: `✓ complete`, `◉ in progress`, `○ not started`

**After each step completes**, update the status table AND write that
step's data to the plan file. Do NOT wait until the end to write.

### Step 1: Scan Optimizely Flags

Use the Optimizely MCP to list all flags in the project.

**Discovery:** Use ToolSearch to find available Optimizely MCP tools.
Look for tools that list flags/features in a project. Typical patterns:
- List all flags in a project
- Get flag details (variations, variables)
- List environments
- List audiences
- Get ruleset for a flag in an environment

**CRITICAL: Paginate until ALL flags are fetched.** If the MCP supports
pagination, keep fetching until all flags are returned.

For each flag found, gather:
- Flag key and name/description
- Variations (names, keys, variable overrides)
- Variables (name, type, default value)
- Available environments

**After scan completes:** Write the flag data to the plan file and
update Generation Status step 1 to `✓ complete`.

### Step 2: Choose Optimizely Environment

Optimizely flags have different rules per environment (e.g. production,
development, staging). The user must choose which environment's rules
to migrate.

**EDUCATE then ASK the user:**

> **What is an environment?**
> In Optimizely, each flag can have different targeting rules and rollout
> percentages per environment. For example, a flag might be 100% rolled
> out in development but only 10% in production.
>
> Which environment's rules should I migrate?
>
> Your environments:
> 1. production
> 2. development
> 3. <other environments...>

**Wait for an explicit pick.** Set the step to `⏸ awaiting user` and
stop. A re-run of `/migrate-optimizely`, an empty message, or any reply
that is not a valid choice is **not** consent — NEVER infer from silence.
If the reply is ambiguous, re-ask.

After the user picks an environment, fetch the ruleset for each flag
in that environment. For each flag, extract:
- Rule type: **Targeted Delivery** (rollout) or **A/B Test** (experiment)
- Audience conditions (targeting rules)
- Traffic allocation (variant percentages)
- Whether the ruleset is enabled

**After environment selected and rulesets fetched:** Write Section 1b
(Environment & Rules) to plan file and update Generation Status step 2
to `✓ complete`.

### Step 3: Select Confidence Client

```
mcp__confidence-flags__listClients
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
stop. A re-run of `/migrate-optimizely`, an empty message, or any reply
that is not a number from the list / `new <name>` is **not** consent —
NEVER infer the recommendation from silence. If the reply is ambiguous,
re-ask, listing the choices again.

- If user picks existing → use it
- If user wants new → ASK for name → `mcp__confidence-flags__createClient`

**After client selected:** Write Section 1 (Default Client) to plan
file and update Generation Status step 3 to `✓ complete`.

### Step 4: Map Randomization Units

```
mcp__confidence-flags__getContextSchema clientName: "<selected-client>"
```

Show the user entity fields (fields marked as entity in the schema).

This step maps Optimizely's `userId` to Confidence entity fields.

**EDUCATE then ASK:**

> **What is a randomization unit (entity)?**
> An entity is the "thing" that gets randomly assigned to a variant —
> usually a user. The entity field (like `user_id` or `visitor_id`) is
> the identifier Confidence uses to ensure **consistent assignment**: the
> same user always sees the same variant.
>
> In Confidence, it maps to the `targeting_key` in the evaluation context.

> All of your flags randomize per user. In Optimizely, each user is
> identified by `userId` (passed to `createUserContext`). In Confidence,
> you need to pick which field represents the same user identifier.
>
> Common choices:
> - **user_id** — if your flags target authenticated users
> - **visitor_id** — if targeting anonymous visitors (auto-generated by
>   Confidence client SDKs)
>
> Your client's existing entity fields:
> 1. <entity-field-1>
> 2. <entity-field-2>
> ...
> N. Create a new field
>
> Which Confidence field represents the same user as Optimizely's `userId`?

**Wait for an explicit pick.** Same rule as Step 3 — set the step to
`⏸ awaiting user` and stop. Silence, a re-run, or any non-listed reply
is **not** consent. Re-ask if the reply is ambiguous.

- If user picks existing → use it as `targetingKey` for all flags
- If user wants new → ASK for name + type → `mcp__confidence-flags__addContextField`

**Note on Optimizely group experiments:** Optimizely does not have native
group bucketing like PostHog's `aggregation_group_type_index`. If an
Optimizely project uses group-level experiments (passing a group ID as
`userId`), the user should create a separate entity field for that group
identifier. Flag the user if any flags appear to use non-user IDs.

**Step 4 only creates entity fields.** Attribute fields used in
targeting rules (`country`, `plan`, `age`, etc.) MUST NOT be created
here. Record them in Section 3 "Need to Create" and let `execute`
create them — that way, if the user later skips a flag, no orphan
schema fields are left in Confidence.

**After entity mapped:** Write Section 2 (Randomization Mapping) to
plan file, reconcile and write Section 3 (Context Schema), and update
Generation Status step 4 to `✓ complete`.

### Step 5: Generate MCP Commands

**Confirmation gate (MUST pass before generating).** Before writing
Section 4, summarize chosen environment, client + entity in chat and ask:

> Plan will migrate rules from Optimizely environment `<env>` to
> Confidence client `<client>` with randomization entity `<entity>`.
> All flags will be defaulted to `[ ] Migrate  [ ] Skip`
> (neither pre-checked) — you'll opt each one in during review.
> Confirm or change?

Set the step to `⏸ awaiting user` and stop. Only proceed on an
explicit `yes` / `confirm` / equivalent. A re-run or ambiguous reply
is **not** confirmation.

For each flag in Section 4, generate the MCP command payloads
(createFlag, addFlagToClient, addTargetingRule, resolveFlag) using the
Operator Mapping Reference (below). Write them into each flag's section.

**After all commands generated:** Update Generation Status step 5 to
`✓ complete` and set the overall status to `complete`. Write the
Progress table (Section 6).

**Tell the user:**
> Plan generated! Review it at `.claude/plans/optimizely-flag-migration-<date>.md`
>
> Migration is **opt-in**: every flag starts with both checkboxes
> empty. Tick `[x] Migrate` or `[x] Skip` for each flag — `execute`
> will refuse any flag with neither box set.
> When you're ready, run: `/migrate-optimizely execute <plan-file>`

---

## Optimizely Concepts Reference (agent-internal, do NOT show to user)

### Optimizely Flag Structure

Each Optimizely flag has:
- **Key:** Alphanumeric + hyphens/underscores (max 64 chars)
- **Variations:** Named variants with keys and variable overrides
- **Variables:** Typed config values (string, integer, double, boolean, JSON)
  with defaults and per-variation overrides
- **Rules per environment:** Ordered list of Targeted Delivery or A/B Test rules
- **Audiences:** Reusable targeting definitions with boolean conditions

### Optimizely Traffic Allocation

Optimizely uses a 0-10,000 bucket range (basis points):
- `endOfRange: 5000` = 50% of traffic
- Buckets are assigned via MurmurHash3 on `(userId + experimentId)`
- If total allocation < 10,000, remaining users are excluded

**Conversion to Confidence:** Divide by 100 to get percentage. For
non-round percentages, round to nearest integer (Confidence uses
whole percentages that must sum to 100).

### Optimizely Audience Conditions Format

Conditions use a nested list format:
```json
["and",
  {"type": "custom_attribute", "name": "country", "match": "exact", "value": "US"},
  {"type": "custom_attribute", "name": "age", "match": "gt", "value": 18}
]
```

Combinators: `"and"`, `"or"`, `"not"` as first element of a list.

Individual condition:
```json
{
  "type": "custom_attribute",
  "name": "<attribute_name>",
  "match": "<match_type>",
  "value": <value>
}
```

Match type defaults: `exact` if a value is provided, `exists` if no value.

---

## Operator Mapping Reference (agent-internal, do NOT show to user)

This is how Optimizely operators map to Confidence targeting payloads.
Use this when generating `addTargetingRule` payloads in the plan file.

**CRITICAL: Confidence Targeting Payload Format**

The payload uses a `criteria` + `expression` pattern. Criteria are named
references (`ref-0`, `ref-1`, ...) that define individual conditions.
The `expression` combines them with boolean logic (`and`, `or`, `not`, `ref`).

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
(matching ALL contexts) due to `ignoringUnknownFields()` in the proto parser.

### Criterion Rules

| Optimizely Match | Confidence Criterion |
|-----------------|---------------------|
| `exact: "X"` (string) | `"eqRule": { "value": { "stringValue": "X" } }` |
| `exact: N` (number) | `"eqRule": { "value": { "numberValue": N } }` |
| `exact: true/false` | `"eqRule": { "value": { "boolValue": true } }` |
| `ge: N` | `"rangeRule": { "startInclusive": { "numberValue": N } }` |
| `gt: N` | `"rangeRule": { "startExclusive": { "numberValue": N } }` |
| `lt: N` | `"rangeRule": { "endExclusive": { "numberValue": N } }` |
| `le: N` | `"rangeRule": { "endInclusive": { "numberValue": N } }` |

### Expression Combinators

| Pattern | Expression |
|---------|-----------|
| Single condition | `{ "ref": "ref-0" }` |
| AND | `{ "and": { "operands": [{ "ref": "ref-0" }, { "ref": "ref-1" }] } }` |
| OR | `{ "or": { "operands": [{ "ref": "ref-0" }, { "ref": "ref-1" }] } }` |
| NOT | `{ "not": { "ref": "ref-0" } }` |

### Optimizely Operator Mapping

| Optimizely | Confidence Payload Strategy |
|-----------|---------------------------|
| `exact: "X"` | One criterion with `eqRule`, expression: `ref` |
| `NOT` + `exact: "X"` | One criterion with `eqRule`, expression: `not` wrapping `ref` |
| `exact: "A"` OR `exact: "B"` | One criterion per value with `eqRule`, expression: `or` of `ref`s |
| `ge: N` | One criterion with `rangeRule` (startInclusive), expression: `ref` |
| `gt: N` | One criterion with `rangeRule` (startExclusive), expression: `ref` |
| `lt: N` | One criterion with `rangeRule` (endExclusive), expression: `ref` |
| `le: N` | One criterion with `rangeRule` (endInclusive), expression: `ref` |

**Blocked (manual review required):**

| Optimizely Match | Reason |
|-----------------|--------|
| `substring` | No Confidence equivalent (contains/substring not supported) |
| `exists` | No Confidence equivalent (field-presence check not supported) |
| Semver comparisons | No Confidence equivalent (version type not supported) |

When a flag uses a blocked operator, mark it in the plan with a warning:
> ⚠ This flag uses `substring` matching which has no Confidence equivalent.
> Manual review required — consider converting to `startsWith`/`endsWith`
> if the pattern allows, or implement in application code.

### AND / OR Combinations

**AND conditions:** Optimizely `["and", cond1, cond2]`.
Create one criterion per condition, combine with `and` expression.

**OR conditions:** Optimizely `["or", cond1, cond2]`.
Create one criterion per condition, combine with `or` expression.

**Nested combinations:** Optimizely supports arbitrary nesting:
`["and", cond1, ["or", cond2, cond3]]`. Map directly to nested
Confidence expressions.

### Complete Examples

**Single equality (country = "US"):**
```json
{
  "criteria": {
    "ref-0": { "attribute": { "attributeName": "country", "eqRule": { "value": { "stringValue": "US" } } } }
  },
  "expression": { "ref": "ref-0" }
}
```

**AND (plan = "pro" AND country = "US"):**
```json
{
  "criteria": {
    "ref-0": { "attribute": { "attributeName": "plan", "eqRule": { "value": { "stringValue": "pro" } } } },
    "ref-1": { "attribute": { "attributeName": "country", "eqRule": { "value": { "stringValue": "US" } } } }
  },
  "expression": { "and": { "operands": [{ "ref": "ref-0" }, { "ref": "ref-1" }] } }
}
```

**OR (country = "US" OR country = "UK"):**
```json
{
  "criteria": {
    "ref-0": { "attribute": { "attributeName": "country", "eqRule": { "value": { "stringValue": "US" } } } },
    "ref-1": { "attribute": { "attributeName": "country", "eqRule": { "value": { "stringValue": "UK" } } } }
  },
  "expression": { "or": { "operands": [{ "ref": "ref-0" }, { "ref": "ref-1" }] } }
}
```

**NOT (country != "DE"):**
```json
{
  "criteria": {
    "ref-0": { "attribute": { "attributeName": "country", "eqRule": { "value": { "stringValue": "DE" } } } }
  },
  "expression": { "not": { "ref": "ref-0" } }
}
```

**Range (age >= 18):**
```json
{
  "criteria": {
    "ref-0": { "attribute": { "attributeName": "age", "rangeRule": { "startInclusive": { "numberValue": 18 } } } }
  },
  "expression": { "ref": "ref-0" }
}
```

**Nested AND/OR (plan = "pro" AND (country = "US" OR country = "UK")):**
```json
{
  "criteria": {
    "ref-0": { "attribute": { "attributeName": "plan", "eqRule": { "value": { "stringValue": "pro" } } } },
    "ref-1": { "attribute": { "attributeName": "country", "eqRule": { "value": { "stringValue": "US" } } } },
    "ref-2": { "attribute": { "attributeName": "country", "eqRule": { "value": { "stringValue": "UK" } } } }
  },
  "expression": { "and": { "operands": [{ "ref": "ref-0" }, { "or": { "operands": [{ "ref": "ref-1" }, { "ref": "ref-2" }] } }] } }
}
```

### Multivariant A/B Split Handling

**CRITICAL:** A single Confidence targeting rule CAN assign multiple
variants at different split percentages. Use ONE rule per targeting
condition, listing all variants and their shares in that rule.

**How to map Optimizely traffic allocation to Confidence rules:**

Optimizely uses 0-10,000 basis points. Convert to percentages:

For a 2-variant experiment (e.g. endOfRange: 5000, 10000):
- Variation 1: 5000/10000 = 50%
- Variation 2: (10000-5000)/10000 = 50%
- Add ONE rule with: variation-1 at 50%, variation-2 at 50%

For partial rollout (e.g. endOfRange: 2500, 5000 out of 10000):
- Variation 1: 2500/10000 = 25%
- Variation 2: (5000-2500)/10000 = 25%
- Remaining: 50% unallocated
- Add ONE rule with appropriate variant allocations

**Do NOT create separate rules per variant.** One targeting rule =
one set of targeting conditions, with the variant split defined
inside that rule. The `rolloutPercentage` on the rule controls
what fraction of users who match the targeting conditions enter the
rule at all (use 100% unless you want a partial rollout on top of
the targeting). The variant percentages within the rule control the
split among those who enter.

### Variable Mapping to Confidence Schema

Optimizely typed variables map to Confidence flag schema:

| Optimizely Type | Confidence Schema Type |
|----------------|----------------------|
| `string` | `"string"` |
| `integer` | `"integer"` |
| `double` | `"double"` |
| `boolean` | `"boolean"` |
| `json` | Flatten to individual fields or use `"string"` |

When creating a flag with variables, use `schemaObject` to define the
schema and include variable values in each variant's `value` object.

Example: Optimizely flag with variables `sort_method` (string) and
`items_per_page` (integer):

```
createFlag
  flagName: "product-sort"
  schemaObject: {"sort_method": "string", "items_per_page": "integer"}
  variants: [
    {"name": "control", "value": {"sort_method": "relevance", "items_per_page": 20}},
    {"name": "treatment", "value": {"sort_method": "popularity", "items_per_page": 30}}
  ]
```

---

## Plan Flag: Template

```markdown
# Optimizely to Confidence Flag Migration Plan

**Created:** <date>
**Scope:** Flag definitions only
**Optimizely Project:** <project name/id>

---

## Generation Status

| Step | Status | Result |
|------|--------|--------|
| 1. Scan Optimizely | ○ not started | |
| 2. Choose environment | ○ not started | |
| 3. Choose client | ○ not started | |
| 4. Map entities | ○ not started | |
| 5. Generate rules | ○ not started | |

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

## 1b. Optimizely Environment

In Optimizely, each flag has different rules per environment. This plan
migrates the rules from a single environment.

**Available Environments:** <list from Optimizely>

**Selected:** `<environment>`

---

## 2. Randomization Mapping

An entity is the "thing" being randomly assigned to a variant — usually
a user. The entity field (like `user_id` or `visitor_id`) is the
identifier Confidence uses for consistent assignment: the same user
always sees the same variant.

### Per-user flags (Optimizely `userId`)

Optimizely's `userId` (per-user identifier) is mapped to: **`<selected-entity>`**

**Available Entity Fields:** <entity fields from MCP>

---

## 3. Context Schema

The context schema defines what fields Confidence expects in the
evaluation context when resolving flags — things like `country`,
`plan`, or `age` that targeting rules use to decide who gets what.

Below is a reconciliation of what Optimizely flags need vs what already
exists in the Confidence client's schema.

### Already in Confidence

These fields are already defined in the `<client>` client and match
Optimizely targeting attributes. No action needed.

| Field | Type | Entity | Optimizely Attribute |
|-------|------|--------|---------------------|
<matching fields from getContextSchema + Optimizely scan>

### Need to Create

These fields are used in Optimizely audience conditions but don't exist
yet in the Confidence client. They will be created during execution
using `addContextField`.

| Field | Type | Entity | Optimizely Attribute |
|-------|------|--------|---------------------|
<missing fields that Optimizely rules need but Confidence doesn't have>

### Confidence-only (not in Optimizely)

These fields exist in Confidence but aren't used by any Optimizely flag.
Listed for reference — no action needed.

| Field | Type | Entity |
|-------|------|--------|
<fields in Confidence schema not referenced by any Optimizely flag>

---

## 4. Flags to Migrate

Below are the flags we're planning to migrate, along with their
targeting rules described in plain language.

**Migration is opt-in.** Each flag starts with both checkboxes empty.
Tick `[x] Migrate` for every flag you want to bring across, or
`[x] Skip` to drop it. Flags with neither box ticked will be refused
by `execute` — no implicit defaults.

During execution, each flag will be created one by one, interactively.

### Flag: `<flag-key>`

**Description:** <from Optimizely if available>
**Optimizely key:** <original key (may differ from Confidence name if underscores were converted)>
**Rule type:** <Targeted Delivery / A/B Test>
**Rules:** <plain English description of audience conditions>
**Rollout:** <percentage>
**Variants:** <variant names with percentages>
**Variables:** <variable names, types, and default values>
**Confidence entity:** <mapped entity field>
**Action:** [ ] Migrate  [ ] Skip

**MCP Commands:**
<createFlag with schema + variants, addTargetingRule with full parameters, resolveFlag>
<resolveFlag MUST include both a positive-case and negative-case test>

---

## 5. Blocked Flags

Flags using Optimizely features that cannot be automatically migrated.

| Flag | Blocked Reason | Recommendation |
|------|---------------|----------------|
<flags with substring, exists, semver operators>

---

## 6. Progress

| # | Flag | Status |
|---|------|--------|
| 1 | <flag> | :white_circle: |

```

---

## Execute: How It Works

**`execute <plan-file>` walks through the plan interactively, step by step.**

### For Code Plans

**Each flag = one PR.** The code migration creates a separate pull
request for each flag, keeping changes small and reviewable.

```
1. READ the plan file
2. SDK SETUP (Section 1 of plan) — one-time, before any flag
   - Show install command from plan
   - ASK: "Install SDK now? [Yes / Skip / I already did]"
   - If Yes -> run install command
   - Show wrapper file path + API surface from plan
   - ASK: "Create the Confidence wrapper now? [Yes / Skip / I already did]"
   - If Yes -> create the file using plan's API reference
3. FOR EACH FLAG in the files list:
   a. Create a branch: `migrate/<flag-key>-to-confidence`
   b. Show flag name + all files using it
   c. ASK: "Transform this flag's files? [Yes / Skip / Pause]"
   d. If Yes -> apply transform rules from plan to all files for this flag
   e. Run lint + typecheck on changed files
   f. Commit changes
   g. Create PR with title: "feat: migrate <flag-key> from Optimizely to Confidence"
   h. Show PR link
   i. CHECKPOINT: "PR created. [Continue to next flag / Pause]?"
   j. Wait for user response
4. COMPLETION
   - Show summary: migrated vs skipped
   - List all PRs created with links
```

### For Flag Plans

```
1. READ the plan file
   - Client is already in the plan — use it, do NOT re-ask
   - Entity (randomization unit) is already in the plan as the default
   - REFUSE TO PROCEED if any flag has neither `[x] Migrate` nor
     `[x] Skip` ticked. List those flags back to the user and ask
     them to tick a box for each before re-running execute. Migration
     is opt-in — never assume a default.
2. FOR EACH FLAG marked [x] Migrate:
   - Show flag name, description, and rules in plain English
   - ASK: "Create this flag in Confidence? [Yes / Skip / Pause]"
   - If Yes -> run the flag setup sequence (see below)
   - CHECKPOINT: "Flag done. [Continue / Pause]?"
   - Wait for user response
3. COMPLETION
   - Show summary: created vs skipped
```

**Flag Setup Sequence (MUST complete all steps before resolving):**

Each flag MUST go through these steps in order. Do NOT call
`resolveFlag` until ALL prior steps succeed.

```
STEP 0: addContextField (if needed)
  → Create any attribute fields required by this flag's targeting rules
    that don't yet exist in Confidence (from Section 3 "Need to Create")

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
  → Add the targeting rule from the plan
  → IMPORTANT: targeting rules added while a flag is archived OR
    immediately after unarchiving may become inactive. Always complete
    steps 1-2 fully (createFlag, unarchive, addFlagToClient) BEFORE
    calling addTargetingRule. Do NOT add rules between createFlag and
    unarchiveFlag — they will be inactive and you'll have to re-add.

STEP 4: resolveFlag (verification)
  → Only NOW resolve to verify the flag works
  → MUST test BOTH positive AND negative cases:
    a. Resolve with a context that SHOULD match the targeting rule
       → Verify the expected variant is returned
    b. Resolve with a context that SHOULD NOT match
       → Verify no variant / default is returned
  → For attribute-based targeting (country, plan, etc.), the resolve
    call MUST include those attributes in the evaluation context.
    Without them, the targeting conditions cannot be evaluated and
    may appear to match when they wouldn't in production.
  → If resolve fails with "No active flags found":
    something went wrong in steps 1-2 — diagnose, don't skip
  → If all rules show "Rule is inactive" / no match:
    targeting rules were likely added while flag was archived.
    Re-add the targeting rule now that the flag is active.
  → Do NOT report a flag as successfully migrated until both
    positive and negative resolve tests pass.
```

**Why this matters:** Confidence flags can be in states that
`createFlag` won't fix: archived, or enabled for a different client
only. The setup sequence handles all edge cases so resolves never
fail for avoidable reasons.

### Rules

- **NEVER auto-continue** — always wait for user at each checkpoint
- **Flag-by-flag** — each flag is one unit (its files + tests)
- **PR checkpoints** — offer to create PR after each flag or batch
- **Resumable** — update Progress table in plan file after each step

---

## Required MCPs

### For `plan code`

| MCP | Tools Used |
|-----|------------|
| `confidence-docs` | `getCodeSnippetAndSdkIntegrationTips`, `searchDocumentation`, `getFullSource` |

### For `plan flag`

| MCP | Tools Used |
|-----|------------|
| `optimizely-exp` | List flags, get flag details, list environments, list audiences, get rulesets |
| `confidence-flags` | `listClients`, `getContextSchema`, `createFlag`, `addTargetingRule`, `resolveFlag` |
