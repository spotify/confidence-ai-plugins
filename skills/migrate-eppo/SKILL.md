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
allocation becomes the **catch-all final rule**: Confidence has no
server-side flag default (see "Default value" in the core file), so
its variation must be emitted as a last `addTargetingRule` with
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
"Existence / null checks" in the core file for the proof (resolver
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
"Default value" in the core file for why this is required.

**Waterfall verification.** Because Eppo flags often have multiple
allocations, the core file's Flag Setup Sequence Step 4 requires you to
also resolve with a context that misses the first allocation but
matches a later one — this verifies the waterfall order is preserved.

---

## Plan Code: Eppo-Specific Steps

(Core file defines Steps 1, 2, and 5. Eppo provides Steps 3 and 4.)

### Source resolve mode (Eppo) — feeds the core's Step 2b signal

**Eppo always evaluates locally — but "local" means different things on
server vs client.** Every Eppo SDK downloads the flag configuration
(Universal Flag Configuration) and computes assignments without a
per-assignment network call. Map it to the core's two "local" source
modes by surface:

- **Eppo backend SDK → source mode = in-process eval.**
- **Eppo client SDK (Android/iOS/JS browser) → source mode = on-device
  eval** (the device holds the full ruleset and evaluates it locally).
- **Eppo precomputed (server→client, Next.js/React) → source mode =
  server-precomputed.** The server evaluates the ruleset locally for a
  bound subject and ships only resolved values to the client, which reads
  them offline — no client-side ruleset, no per-read network call.

Then the core's Step 2b transitions apply:

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
PascalCase (`GetBoolAssignment`); Java uses `getDoubleAssignment` for
numeric and `getJSONStringAssignment` (returns a serialized string) for
JSON; JS shortens boolean to `getBoolAssignment` and JSON to
`getJsonAssignment`; Python is snake_case. The grep above is the union —
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

---

## Required Prerequisites

(The core file lists the Confidence-side MCPs. This skill adds the Eppo
REST API as documented in the Prerequisites section above — no MCP, just
`curl` with `X-Eppo-Token: $EPPO_API_KEY`.)

| Source | What's used |
|--------|-------------|
| Eppo REST API (`X-Eppo-Token`) | `GET /environments`, `GET /feature-flags`, `GET /feature-flags/{id}`, `GET /feature-flags/{id}/environments/{environmentId}`, `GET /audiences/{id}` |
