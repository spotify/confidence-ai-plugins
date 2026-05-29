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
      audience definitions. For each unique `audience_id`, fetch
      `GET /audiences/{audience_id}` and record its `name` +
      `targeting_rules[]` in the plan's Segments section (Section 3b).
      These become Confidence segments — see "Reusable audiences" under
      Operator Mapping.
    - `is_default` — the default allocation supplies the "no match"
      variation; treat its `variation_weight[]` as the default value and
      do NOT emit it as a Confidence targeting rule

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

Confidence has no positive "attribute is null" criterion, and it
doesn't need one: a subject missing the attribute fails every attribute
criterion and **falls through to the flag's default value** (served
when no rule matches). The key consequence — Confidence has a *single*
default for all no-match subjects, so it can't serve "attribute is
null" subjects differently from "attribute set but no rule matched"
subjects.

So an Eppo `IS_NULL` allocation maps cleanly only when the variant it
serves is the same as the default allocation's variant — in which case
it's **redundant** (Confidence's default already serves null subjects
that variant) and is simply dropped.

| Eppo `IS_NULL` shape | Confidence strategy |
|---|---|
| `IS_NULL` is the **sole condition** of its allocation AND its variant **equals** the `is_default` allocation's variant | **Drop the allocation** — null subjects already fall through to that same default. No rule emitted. Note it in the plan. |
| `IS_NULL` is the sole condition but its variant **differs** from the default | BLOCKED — Confidence's single default can't serve null subjects differently from other unmatched subjects. |
| `IS_NULL` is **combined** (ANDed) with other conditions in the same rule | BLOCKED — "X is null AND Y = foo" can't be expressed. |

### Reusable audiences (`audiences[]`) → Confidence segments

An allocation's `audiences[]` reference reusable Eppo audiences. These
map directly onto Confidence **segments** (see "Reusable Segments" and
"Segment criteria" in the core file). For each referenced audience:

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
blocked (generic regex, combined IS_NULL) — same rules as inline
conditions.

### Eppo subject `id` targeting

`{operator: ONE_OF, attribute: "id", values: [...]}`: the special `id`
attribute targets the subject key directly. Rewrite `attribute` from
`id` to the chosen Confidence entity field name from Step 3 (e.g.
`user_id`). Use a `setRule` for multi-value lists. Eppo caps these at
50 values; Confidence handles larger sets.

### Blocked (manual review)

Only these genuinely have no clean Confidence translation:

- **Generic `MATCHES` regex** — anything that fails the decomposition
  rule above (character classes, quantifiers, wildcard `.`, backrefs,
  multiple alternation groups, etc.). Reason: `Uses a regex on
  '<attribute>' that isn't a prefix/suffix/alternation; Confidence has
  no general regex rule.`
- **`IS_NULL` combined with other conditions**, or whose variant
  differs from the existing default allocation's variant (see the
  IS_NULL table above). Reason: `IS_NULL on '<attribute>' combined with
  other conditions / serves a non-default variant; needs manual review.`
- **`SWITCHBACK` allocations** — Eppo switchback rotates variations over
  **time windows** for experiments on temporally-correlated outcomes
  (surge pricing, dispatch routing, etc.). Confidence does not model
  time-bucketed exposure; sticky assignments persist *per subject*, not
  per time window, so they don't substitute. Mark the entire **flag**
  `BLOCKED` with the reason `Contains SWITCHBACK allocation; Confidence
  has no time-windowed exposure. Migrate manually or skip.`
- **Unnormalizable version strings** — version values that aren't
  `v`-strippable into the supported 2–4-segment form (see Version
  caveats). Reason: `Version comparison on '<attribute>' uses a format
  Confidence can't parse.`

When an allocation is blocked, mark it in Section 4 (per the template).
A flag is fully blocked only when *every* non-default allocation is
blocked or it contains a SWITCHBACK allocation.

### Worked example (waterfall)

A two-allocation Eppo flag — internal users gate at 100% treatment,
then a 50/50 experiment on US/CA users — becomes TWO `addTargetingRule`
calls in order:

1. Rule 1: `email endsWith @spotify.com` → `treatment` at 100%
2. Rule 2: `country ONE_OF ["US", "CA"]` (one `setRule`) → `control`
   50%, `treatment` 50%

If an allocation referenced an audience instead (e.g. `IS_IN` the
"eu-power-users" audience), `execute` would first `createSegment`
`segments/eu-power-users` from that audience's targeting rules, then the
allocation's rule would use a segment criterion
`{ "segment": { "segment": "segments/eu-power-users" } }`.

(See the core file's worked examples for the exact JSON payload shape,
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
**Active in `<env>`:** <yes / no — if no, all rules will be added at 0% rollout and flag created in the OFF state>
**Allocations (Eppo, in order):**
  1. `<allocation name>` (`<FEATURE_GATE | EXPERIMENT>`) — <plain-English rule>, exposure <X>%, splits <variant=X%, ...> <if audience-referencing: "via segment(s) segments/<id>">
  2. ...
**Default allocation:** `<allocation name>` (is_default: true) → variation `<variant_key>`
  <if an IS_NULL allocation was demoted to the default, note it here:
   "default also covers Eppo IS_NULL allocation '<name>'">
**Segments referenced:** <none, or list of segments/<id> from Section 3b>
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
| Eppo REST API (`X-Eppo-Token`) | `GET /environments`, `GET /feature-flags`, `GET /feature-flags/{id}`, `GET /feature-flags/{id}/environments/{environmentId}`, `GET /audiences/{id}` |
