---
description: Migrate feature flags from Eppo to Confidence SDK. Use when the user says /migrate-eppo, asks to migrate Eppo flags, or transform SDK code to Confidence.
---

# Eppo to Confidence Migration

> **Read the shared core first.** Before doing anything else, use the
> Read tool to read `skills/_shared/migration-core.md`. That file
> defines all Confidence-side conventions every migration follows —
> payload formats, the flag setup sequence, naming rules, the execute
> flow, etc. THIS file only covers what's specific to Eppo. Apply
> both together.

REST-driven, self-sufficient migration from Eppo to Confidence.

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

## Prerequisites: Eppo Side

(The core file documents the Confidence-side prerequisites — install
`confidence` and `confidence-docs` MCP servers.)

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
the "never echo secrets" rule in the core file's user-facing
communication rules.)

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

(The core file defines the marker legend, progress-bar conventions, and
final-summary format. This section just declares the layouts.)

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

## Plan Flag: Eppo-Specific Steps

The core file defines the workflow shape (Step 1 scan, Step 2 client
selection, Step 3 randomization mapping, Step 4 generate). This
section provides the Eppo-specific implementations of steps 1 and 3,
and the operator mapping table needed by step 4.

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
      audience definitions; see the BLOCKED rules under Operator Mapping
    - `is_default` — the default allocation supplies the "no match"
      variation; treat its `variation_weight[]` as the default value and
      do NOT emit it as a Confidence targeting rule

**Randomization unit.** Eppo always uses `subjectKey`. Unlike PostHog
there's no per-group bucketing concept built into the flag — group-level
experiments are handled by passing a `companyId` as the `subjectKey`.
For the migration, treat every flag as per-subject; the user picks which
Confidence entity field represents that subject in Step 3.

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

Same wait-for-explicit-pick rule as Step 2 in the core file. Silence is
not consent.

- If user picks existing → use it as `targetingKey`
- If user wants new → ASK for name + type → `mcp__confidence__addContextField`
  (always provide an explicit `entityReference` — see Confidence Naming
  Rules in the core file)

**Eppo subject targeting (`id` attribute).** Eppo lets rules target the
subject directly via the special attribute `id`. When a rule references
`id`, map it to the chosen entity field's name in Confidence (the
context key for `targetingKey`). Record this substitution in Section 2
of the plan.

### Step 4 confirmation gate (Eppo-specific summary)

Summarize chosen client + entity + Eppo source environment and ask the
standard confirm question from the core file. Eppo adds one extra item
to summarize: the source environment chosen in Step 1a.

**Allocation → targeting-rule order.** Eppo allocations form a
waterfall — the first matching allocation wins. Confidence evaluates
targeting rules in declared order, so emit one `addTargetingRule`
call per Eppo allocation, in the same order.

---

## Operator Mapping (Eppo → Confidence)

This is how Eppo operators map to Confidence targeting payloads. The
core file defines the Confidence payload format (criteria + expression,
criterion rules, combinators, examples). This table is the Eppo-side
half.

Within a single Eppo rule, all `conditions` are ANDed. Across multiple
rules in the same allocation, conditions are ORed (any rule satisfying
means the allocation matches). Across allocations, each non-default
Eppo allocation becomes a **separate Confidence targeting rule** — see
the waterfall ordering note in Step 4 above. The `is_default`
allocation does NOT emit a rule; its `variation_weight[]` is set as
the flag's default value at `createFlag` time.

Eppo's operator enum (`ERuleConditionOperator`) is `LT`, `LTE`, `GT`,
`GTE`, `MATCHES`, `ONE_OF`, `NOT_ONE_OF`, `IS_NULL`. Conditions always
use array `values`, even when there's only one value.

| Eppo condition | Confidence payload strategy |
|---|---|
| `{operator: GT, values: ["N"]}` | One criterion with `rangeRule.startExclusive: N`, expression: `ref` |
| `{operator: GTE, values: ["N"]}` | One criterion with `rangeRule.startInclusive: N`, expression: `ref` |
| `{operator: LT, values: ["N"]}` | One criterion with `rangeRule.endExclusive: N`, expression: `ref` |
| `{operator: LTE, values: ["N"]}` | One criterion with `rangeRule.endInclusive: N`, expression: `ref` |
| `{operator: ONE_OF, values: ["A"]}` (singleton) | One criterion with `eqRule`, expression: `ref` |
| `{operator: ONE_OF, values: ["A","B",...]}` | One criterion per value with `eqRule`, expression: `or` of `ref`s |
| `{operator: NOT_ONE_OF, values: ["A"]}` (singleton) | One criterion with `eqRule`, expression: `not` wrapping `ref` |
| `{operator: NOT_ONE_OF, values: ["A","B",...]}` | One criterion per value with `eqRule`, expression: `and` of `not`-wrapped `ref`s |
| `{operator: MATCHES, values: ["^prefix.*"]}` | One criterion with `startsWithRule { value: "prefix" }`, expression: `ref` |
| `{operator: MATCHES, values: [".*suffix$"]}` | One criterion with `endsWithRule { value: "suffix" }`, expression: `ref` |

**Blocked (manual review):**

- **`{operator: IS_NULL}`** — Confidence has no native "attribute is
  null" rule. Mark the allocation `BLOCKED` in Section 4 with the
  reason `Uses IS_NULL on '<attribute>'; Confidence has no null-check
  rule.` The user must either change the Eppo rule to use explicit
  values, or migrate manually with a default-value strategy.
- **`{operator: MATCHES, values: ["<non-anchor regex>"]}`** — anything
  not a clean `^prefix.*` or `.*suffix$`. Confidence has no general
  regex rule. Surface in Section 4 with the BLOCKED marker.
- **SemVer-looking numeric comparisons.** Eppo's spec has no value-type
  field — numeric operators (`GT/GTE/LT/LTE`) take strings, and Eppo's
  SDK decides at evaluation time whether to compare numerically or as
  SemVer based on whether the value parses as SemVer (`X.Y.Z` or
  `X.Y.Z-suffix`). Confidence's `rangeRule` is purely numeric. If any
  `values[0]` for a numeric operator matches the regex
  `^\d+\.\d+\.\d+([.-].+)?$`, mark the allocation `BLOCKED` with the
  reason `SemVer comparison on '<attribute>'; Confidence rangeRule is
  numeric only.` Offer to convert to a numeric `appVersionMajor` /
  `appVersionMinor` context field.

**Eppo allocation `type` handling:**

- `FEATURE_GATE` and `EXPERIMENT` → migrate normally as one Confidence
  targeting rule each.
- `SWITCHBACK` → Eppo switchback allocations rotate variations over
  time windows for experiments on temporally-correlated outcomes
  (surge pricing, dispatch routing, etc.). Confidence does not model
  time-bucketed exposure. Mark the entire **flag** `BLOCKED` in
  Section 4 with the reason `Contains SWITCHBACK allocation; not
  supported in Confidence.`

**Eppo allocation `audiences[]` handling:**

- Empty `audiences[]` → no action.
- Non-empty `audiences[]` → mark the allocation `BLOCKED` with the
  reason `References Eppo audience(s) <ids>; resolve audience
  definitions to inline conditions, or migrate manually.` Audiences
  are reusable targeting definitions stored in a separate Eppo
  resource and would need to be fetched via `GET /audiences/{id}`
  and inlined; we don't do that automatically because the inversion
  semantics (`IS_IN` vs `IS_NOT_IN`) and combination with
  `targeting_rules[]` are non-trivial.

**Eppo subject `id` targeting** (`{operator: ONE_OF, attribute: "id",
values: [...]}`): the special `id` attribute targets the subject key
directly. Rewrite `attribute` from `id` to the chosen Confidence
entity field name from Step 3 (e.g. `user_id`). Lists up to ~50
values are fine; Eppo caps them at 50 but Confidence handles larger
sets.

### Worked example (waterfall)

A two-allocation Eppo flag — internal users gate at 100% treatment,
then a 50/50 experiment on US/CA users — becomes TWO `addTargetingRule`
calls in order:

1. Rule 1: `email endsWith @spotify.com` → `treatment` at 100%
2. Rule 2: `country ONE_OF ["US", "CA"]` → `control` 50%, `treatment` 50%

(See the core file's worked examples for the exact JSON payload shape.)

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
call) is mapped to: **`<selected-entity>`**

Any Eppo rules that targeted the special `id` attribute (subject-key
targeting) are rewritten to target `<selected-entity>`.

**Available Entity Fields:** <entity fields from MCP>

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

## 4. Flags to Migrate

**Migration is opt-in.** Each flag starts with both checkboxes empty.
Tick `[x] Migrate` for every flag you want to bring across, or
`[x] Skip` to drop it. Flags with neither box ticked will be refused
by `execute` — no implicit defaults.

### Flag: `<flag-key>`

**Description:** <from Eppo if available, otherwise empty>
**Variation type:** <BOOLEAN / INTEGER / JSON / NUMERIC / STRING>
**Variations:** <variant_key — value list, e.g. "control = false, treatment = true">
**Active in `<env>`:** <yes / no — if no, all rules will be added at 0% rollout and flag created in the OFF state>
**Allocations (Eppo, in order):**
  1. `<allocation name>` (`<FEATURE_GATE | EXPERIMENT>`) — <plain-English rule>, exposure <X>%, splits <variant=X%, ...>
  2. ...
**Default allocation:** `<allocation name>` (is_default: true) → variation `<variant_key>`
**Confidence entity:** <mapped entity field from Step 3>
**Confidence rules:** one targeting rule per non-default allocation, in the same order
**Action:** [ ] Migrate  [ ] Skip

If any allocation or the whole flag is BLOCKED, replace the **Action**
line with:

**Status:** BLOCKED — <one-line reason from the BLOCKED rules above>
**Action:** [ ] Skip (no migrate option available until the block is resolved)

**MCP Commands:**
<createFlag (default value = is_default allocation's variation), addFlagToClient, addTargetingRule (ONE per non-default allocation, in order, with variant assignments and their split), resolveFlag with full parameters — positive AND negative case>

---

## 5. Progress

| # | Flag | Status |
|---|------|--------|
| 1 | <flag> | :white_circle: |
```

---

## Execute: Eppo-Specific Notes

(The core file defines the execute flow and the Flag Setup Sequence.
This section adds Eppo-specific guidance.)

**Inactive-in-environment handling.** If a flag's `active` flag is
false in the source Eppo environment, surface that during execute:

> This flag is INACTIVE in Eppo (<env>). I'll create it in Confidence
> but keep the rules at 0% rollout so it stays off until you turn it on
> intentionally. Continue?

**Variation type → Confidence schema.** Use the Eppo `variation_type`
(`BOOLEAN` / `INTEGER` / `JSON` / `NUMERIC` / `STRING`) as the
Confidence schema type when calling `createFlag`. Include all Eppo
variations (`variant_key` → `value`) as Confidence variants.

**Default value.** Take the variation referenced by the allocation
with `is_default: true` (its `variation_weight[0].variation_id`,
resolved against `variations[]`) and pass that variant's value as
`createFlag`'s default. Do NOT emit a targeting rule for the default
allocation.

**Waterfall verification.** Because Eppo flags often have multiple
allocations, the core file's Flag Setup Sequence Step 4 requires you to
also resolve with a context that misses the first allocation but
matches a later one — this verifies the waterfall order is preserved.

---

## Plan Code: Eppo-Specific Steps

(Core file defines Steps 1, 2, and 5. Eppo provides Steps 3 and 4.)

### Plan-file path

`.claude/plans/eppo-code-migration-<date>.md`

### Step 3: Scan codebase for Eppo usage

```
Grep: pattern="eppo|Eppo|EppoClient" → Find Eppo imports
Grep: pattern="get_(string|boolean|numeric|integer|json)_assignment|getStringAssignment|getBooleanAssignment|getNumericAssignment|getIntegerAssignment|getJSONAssignment" → Find evaluations
```

Common Eppo package names:
- JS/TS: `@eppo/js-client-sdk`, `@eppo/node-server-sdk`, `@eppo/react-native-sdk`
- Python: `eppo-server-sdk`
- Java/Kotlin: `cloud.eppo:eppo-server-sdk`
- Go: `github.com/Eppo-exp/golang-sdk`
- Ruby: `eppo-server-sdk`
- Rust: `eppo_sdk`
- iOS: `eppo-ios-sdk`
- Android: `cloud.eppo:eppo-android-sdk`
- .NET: `Eppo.Sdk`

Group files by **flag key** they reference. The flag key is the first
argument to every Eppo `get_*_assignment` call.

For each evaluation site, record:
- Flag key
- Return type (inferred from which `get_*_assignment` variant is used)
- The `subjectKey` argument (so the transform can map it to `targetingKey`)
- The `subjectAttributes` argument (so the transform can carry them
  into the evaluation context)
- The `defaultValue` argument (carried over to the Confidence call)

### Step 4: Generate transform rules

Based on SDK guide from `confidence-docs` MCP:
- Extract install commands
- Extract initialization code
- Extract flag evaluation API
- Generate find/replace rules

**Typed assignment mapping (Eppo → OpenFeature / Confidence):**

| Eppo call | OpenFeature call |
|-----------|------------------|
| `client.get_string_assignment(k, sk, attrs, default)` | `client.getStringValue(k, default, { targetingKey: sk, ...attrs })` |
| `client.get_boolean_assignment(k, sk, attrs, default)` | `client.getBooleanValue(k, default, { targetingKey: sk, ...attrs })` |
| `client.get_numeric_assignment(k, sk, attrs, default)` | `client.getNumberValue(k, default, { targetingKey: sk, ...attrs })` |
| `client.get_integer_assignment(k, sk, attrs, default)` | `client.getNumberValue(k, default, { targetingKey: sk, ...attrs })` |
| `client.get_json_assignment(k, sk, attrs, default)` | `client.getObjectValue(k, default, { targetingKey: sk, ...attrs })` |

Adjust method casing per language based on the MCP-fetched SDK guide.

---

## Required Prerequisites

(The core file lists the Confidence-side MCPs. This skill adds the Eppo
REST API as documented in the Prerequisites section above — no MCP, just
`curl` with `X-Eppo-Token: $EPPO_API_KEY`.)

| Source | What's used |
|--------|-------------|
| Eppo REST API (`X-Eppo-Token`) | `GET /environments`, `GET /feature-flags`, `GET /feature-flags/{id}`, `GET /feature-flags/{id}/environments/{environmentId}` |
