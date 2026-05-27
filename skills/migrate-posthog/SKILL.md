---
description: Migrate feature flags from PostHog to Confidence SDK. Use when the user says /migrate-posthog, asks to migrate PostHog flags, or transform SDK code to Confidence.
---

# PostHog to Confidence Migration

> **Read the shared core first.** Before doing anything else, use the
> Read tool to read `skills/_shared/migration-core.md`. That file
> defines all Confidence-side conventions every migration follows —
> payload formats, the flag setup sequence, naming rules, the execute
> flow, etc. THIS file only covers what's specific to PostHog. Apply
> both together.

MCP-driven, self-sufficient migration from PostHog to Confidence.

## Commands

| Command | Description |
|---------|-------------|
| `/migrate-posthog plan flags` | Phase 1: plan flag definitions migration |
| `/migrate-posthog plan code` | Phase 2: plan code transformation |
| `/migrate-posthog execute <plan-file>` | Execute a plan interactively |

---

## Migration Overview (MUST display at start of `plan flags` or `plan code`)

**Every time** the user runs `plan flags` or `plan code`, display this
overview FIRST — before doing any work. This orients the user on where
they are in the full migration journey.

```
═══════════════════════════════════════════════════════════════
  PostHog → Confidence Migration
═══════════════════════════════════════════════════════════════

  The migration happens in two phases: flags first, then code.

  ┌─────────────────────────────────────────────────────────┐
  │  PHASE 1 — Flag Definitions                            │
  │                                                        │
  │  Move all flags from PostHog to Confidence with their  │
  │  targeting rules, rollout percentages, and variants.   │
  │                                                        │
  │  Steps:                                                │
  │    1. Scan all flags in PostHog                        │
  │    2. Choose a Confidence client (your app)            │
  │    3. Map randomization units (user_id, etc.)          │
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
  │    3. Scan codebase for PostHog usage                  │
  │    4. Generate transform rules (PostHog → Confidence)  │
  │    5. Generate plan grouped by flag                    │
  │    6. Execute: transform code flag by flag, one PR each│
  │                                                        │
  │  Result: Code uses Confidence SDK, PostHog removed     │
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

## Prerequisites: PostHog Side

(The core file documents the Confidence-side prerequisites — install
`confidence` and `confidence-docs` MCP servers.)

### PostHog MCP

Test: `mcp__posthog__feature-flag-get-all` (with limit=1)

If not available, install it:
```
claude mcp add posthog --transport http --url https://mcp-eu.posthog.com/mcp
```

The user will be prompted to authenticate via OAuth in their browser.
For US-based PostHog projects, use `https://mcp.posthog.com/mcp` instead.

---

## Step Trackers

(The core file defines the marker legend, progress-bar conventions, and
final-summary format. This section just declares the layouts specific
to this skill.)

### Plan Flags step tracker

Display at the START and after EACH step completes:

```
───── Plan Flags ──────────────────────────────────────────
  [1] Scan PostHog     ○ pending
  [2] Choose client    ○ pending
  [3] Map entities     ○ pending
  [4] Generate plan    ○ pending
────────────────────────────────────────────────────────────
```

Example after Step 1 completes:
```
───── Plan Flags ──────────────────────────────────────────
  [1] Scan PostHog     ✓ 15 flags found
  [2] Choose client    ◉ in progress
  [3] Map entities     ○ pending
  [4] Generate plan    ○ pending
────────────────────────────────────────────────────────────
```

### Execute step tracker

```
───── Execute Migration ───────────────────────────────────
  Client: test  |  Entity: user_id  |  Flags: 15
  Progress: [░░░░░░░░░░░░░░░░░░░░] 0/15
────────────────────────────────────────────────────────────
```

---

## Plan Flag: PostHog-Specific Steps

The core file defines the workflow shape (Step 1 scan, Step 2 client
selection, Step 3 randomization mapping, Step 4 generate). This
section provides the PostHog-specific implementations of steps 1 and
3, and the operator mapping table needed by step 4.

### Plan-file path

`.claude/plans/posthog-flag-migration-<date>.md`

### Step 1: Scan PostHog flags

**CRITICAL: Paginate until ALL flags are fetched.**

```
offset = 0
LOOP:
  response = mcp__posthog__feature-flag-get-all(limit=10, offset=offset)
  process response.results
  if response.next is null → STOP
  offset += 10 → continue LOOP
```

For each flag found:
```
mcp__posthog__feature-flag-get-definition flag_id: "<id>"
```

Fetch definitions in parallel batches of 10. **After each batch, write
the flag data to the plan file** — append the flag sections to Section 4.
This way if the session closes mid-scan, the flags fetched so far are
saved.

**Keep paginating until `next` is null** — do NOT stop after the first
page.

Extract from each flag:
- Key and name
- Description (if PostHog provides one, include it; otherwise leave blank)
- Targeting properties used (e.g. `plan`, `country`, `age`)
- Rollout percentage
- Variant type (boolean / multivariant)
- **Bucketing method** — determine what PostHog randomizes on:
  - `aggregation_group_type_index: null` → **per-user** bucketing (the
    default). Each individual user gets their own variant assignment.
    These flags need an entity mapping in Step 3.
  - `aggregation_group_type_index: <N>` → **per-group** bucketing (e.g.
    per company, per project). Everyone in the same group sees the same
    variant. Record the group type index. These flags will automatically
    use the corresponding group identifier in Confidence.

Group the flags by bucketing method:
- **Per-user flags** (distinct_id) — will all share the entity chosen
  in Step 3
- **Per-group flags** (aggregation_group_type_index) — will each use
  their group identifier directly

### Step 3: Map randomization units (PostHog-specific)

This step maps PostHog's bucketing identifiers to Confidence entity fields.

**EDUCATE then ASK:**

> **What is a randomization unit (entity)?**
> An entity is the "thing" that gets randomly assigned to a variant —
> usually a user. The entity field (like `user_id` or `visitor_id`) is
> the identifier Confidence uses to ensure **consistent assignment**: the
> same user always sees the same variant.
>
> In Confidence, it maps to the `targeting_key` in the evaluation context.

**For per-user flags (PostHog `distinct_id`):**

> <X> of your flags randomize per user. In PostHog, each user is
> identified by `distinct_id`. In Confidence, you need to pick which
> field represents the same user identifier.
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
> Which Confidence field represents the same user as `distinct_id`?

Same wait-for-explicit-pick rule as Step 2 in the core file. Silence is
not consent.

- If user picks existing → use it as `targetingKey` for all per-user flags
- If user wants new → ASK for name + type → `mcp__confidence__addContextField`

**For per-group flags (PostHog `aggregation_group_type_index`):**

If any flags randomize per group, inform the user:

> <Y> flags randomize per group in PostHog (e.g. everyone in the same
> company sees the same variant). These will automatically use the same
> group identifier in Confidence (e.g. `company_id`). No mapping needed
> — I'll carry them over as-is.

If the group identifier doesn't exist in the Confidence context schema,
create it with `mcp__confidence__addContextField`. Always provide an
explicit `entityReference` (e.g. `entities/company` for a field named
`company_id`) — see the Confidence Naming Rules in the core file.

### Step 4 confirmation gate

Summarize chosen client + entity and ask the standard confirm question
from the core file.

---

## Operator Mapping (PostHog → Confidence)

This is how PostHog operators map to Confidence targeting payloads. The
core file defines the Confidence payload format (criteria + expression,
criterion rules, combinators, examples). This table is the PostHog-side
half.

| PostHog | Confidence payload strategy |
|---------|----------------------------|
| `exact: "X"` | One criterion with `eqRule`, expression: `ref` |
| `is_not: "X"` | One criterion with `eqRule`, expression: `not` wrapping `ref` |
| `exact: ["A","B"]` | One criterion per value with `eqRule`, expression: `or` of `ref`s |
| `is_not: ["A","B"]` | One criterion per value with `eqRule`, expression: `and` of `not`-wrapped `ref`s |
| `gte: N` | One criterion with `rangeRule.startInclusive`, expression: `ref` |
| `gt: N` | One criterion with `rangeRule.startExclusive`, expression: `ref` |
| `lt: N` | One criterion with `rangeRule.endExclusive`, expression: `ref` |
| `lte: N` | One criterion with `rangeRule.endInclusive`, expression: `ref` |
| `regex: ^prefix.*` | One criterion with `startsWithRule { value: "prefix" }`, expression: `ref` |
| `regex: .*suffix$` | One criterion with `endsWithRule { value: "suffix" }`, expression: `ref` |

**AND / OR combinations:**
- All properties within one PostHog group are ANDed → use `and` expression
- Multiple PostHog groups are ORed → each group becomes a sub-expression,
  combined with `or` at the top level

**Blocked (manual review):** `icontains`, `is_not_set`, cohort targeting,
and any regex that is not a simple prefix anchor (`^prefix.*`) or suffix
anchor (`.*suffix$`). Surface blocked flags in the plan with an explicit
`BLOCKED` marker and a brief explanation; `execute` will refuse to
proceed until the user either resolves the block or ticks `[x] Skip`.

---

## Plan Flag: Template

```markdown
# PostHog to Confidence Flag Migration Plan

**Created:** <date>
**Scope:** Flag definitions only

---

## Generation Status

| Step | Status | Result |
|------|--------|--------|
| 1. Scan PostHog | ○ not started | |
| 2. Choose client | ○ not started | |
| 3. Map entities | ○ not started | |
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

## 2. Randomization Mapping

An entity is the "thing" being randomly assigned to a variant — usually
a user. The entity field (like `user_id` or `visitor_id`) is the
identifier Confidence uses for consistent assignment: the same user
always sees the same variant.

### Per-user flags (PostHog `distinct_id`)

PostHog's `distinct_id` (per-user identifier) is mapped to: **`<selected-entity>`**

**Available Entity Fields:** <entity fields from MCP>

### Per-group flags

| PostHog Group Type | Confidence Entity | Auto-mapped |
|--------------------|-------------------|-------------|
| <group-type-0>     | `<entity>`        | Yes / Created |

---

## 3. Context Schema

The context schema defines what fields Confidence expects in the
evaluation context when resolving flags — things like `country`,
`plan`, or `age` that targeting rules use to decide who gets what.

Below is a reconciliation of what PostHog flags need vs what already
exists in the Confidence client's schema.

### Already in Confidence

| Field | Type | Entity | PostHog Property |
|-------|------|--------|------------------|
<matching fields>

### Need to Create

| Field | Type | Entity | PostHog Property |
|-------|------|--------|------------------|
<missing fields — execute will create these>

### Confidence-only (not in PostHog)

| Field | Type | Entity |
|-------|------|--------|
<reference only, no action needed>

---

## 4. Flags to Migrate

**Migration is opt-in.** Each flag starts with both checkboxes empty.
Tick `[x] Migrate` for every flag you want to bring across, or
`[x] Skip` to drop it. Flags with neither box ticked will be refused
by `execute` — no implicit defaults.

### Flag: `<flag-name>`

**Description:** <from PostHog if available, otherwise empty>
**Rules:** <plain English description of targeting>
**Rollout:** <percentage>
**Variants:** <variant names with percentages, e.g. "control (50%), treatment (50%)">
**PostHog bucketing:** <"distinct_id (per user)" or "group type <N> (per company/group)">
**Confidence entity:** <mapped entity field from Step 3>
**Confidence rollout:** <rolloutPercentage for the rule + variant split inside the rule>
**Action:** [ ] Migrate  [ ] Skip

**MCP Commands:**
<createFlag, addTargetingRule (ONE rule with all variant assignments and their split), resolveFlag with full parameters — positive AND negative case>

---

## 5. Progress

| # | Flag | Status |
|---|------|--------|
| 1 | <flag> | :white_circle: |
```

---

## Plan Code: PostHog-Specific Steps

(Core file defines Steps 1, 2, and 5. PostHog provides Steps 3 and 4.)

### Plan-file path

`.claude/plans/posthog-code-migration-<date>.md`

### Step 3: Scan codebase for PostHog usage

```
Grep: pattern="posthog|PostHog" → Find PostHog import lines
Grep: pattern="isFeatureEnabled|getFeatureFlag|getFeatureFlagPayload" → Find evaluations
```

Common PostHog package names:
- JS/TS: `posthog-js`, `posthog-node`, `posthog-react-native`
- Python: `posthog`
- Java/Kotlin: `com.posthog:posthog-java`
- Go: `github.com/posthog/posthog-go`
- Ruby: `posthog-ruby`
- .NET: `PostHog`

Group files by **flag key** they reference. The flag key is the first
argument to `posthog.isFeatureEnabled(...)` and similar calls.

For each evaluation site, record:
- Flag key
- The `distinctId` argument (so the transform can map it to `targetingKey`)
- Any `groups` / `personProperties` / `groupProperties` arguments (so
  the transform can carry them into the evaluation context)
- The default / fallback value (carried over to the Confidence call)

### Step 4: Generate transform rules

Based on SDK guide from `confidence-docs` MCP:
- Extract install commands
- Extract initialization code
- Extract flag evaluation API
- Generate find/replace rules

**Typical mapping (PostHog → OpenFeature / Confidence):**

| PostHog call | OpenFeature call |
|--------------|------------------|
| `posthog.isFeatureEnabled('key', distinctId)` | `client.getBooleanValue('key', false, { targetingKey: distinctId })` |
| `posthog.getFeatureFlag('key', distinctId)` | `client.getStringValue('key', '', { targetingKey: distinctId })` |
| `posthog.getFeatureFlagPayload('key', distinctId)` | `client.getObjectValue('key', {}, { targetingKey: distinctId })` |

Adjust method casing per language based on the MCP-fetched SDK guide.

---

## Required MCPs

(The core file lists the Confidence-side MCPs. This skill adds:)

| MCP | Tools Used |
|-----|------------|
| `posthog` | `feature-flag-get-all`, `feature-flag-get-definition` |
