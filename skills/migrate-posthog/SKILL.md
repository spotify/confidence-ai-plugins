---
description: Migrate feature flags from PostHog to Confidence SDK. Use when the user says /migrate-posthog, asks to migrate PostHog flags, or transform SDK code to Confidence.
---

# PostHog to Confidence Migration

MCP-driven, self-sufficient migration from PostHog to Confidence.

## Migration Flow

The migration happens in two phases: **flags first, then code**.

```
Phase 1: Flag Definitions
  plan flags  →  Scan PostHog, choose client & entity, generate plan
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

### PostHog MCP

Test: `mcp__posthog__feature-flag-get-all` (with limit=1)

If not available, install it:
```
claude mcp add posthog --transport http --url https://mcp-eu.posthog.com/mcp
```

The user will be prompted to authenticate via OAuth in their browser.
For US-based PostHog projects, use `https://mcp.posthog.com/mcp` instead.

### Confidence MCP

Test: `mcp__confidence__listClients`

If not available, install it:
```
claude mcp add confidence --transport http --url https://mcp.confidence.dev/mcp/flags
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
  [1] Scan PostHog     ○ pending
  [2] Choose client    ○ pending
  [3] Map entities     ○ pending
  [4] Generate plan    ○ pending
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
  [1] Scan PostHog     ✓ 15 flags found
  [2] Choose client    ◉ in progress
  [3] Map entities     ○ pending
  [4] Generate plan    ○ pending
────────────────────────────────────────────────────────────
```

### Execute Step Tracker

Display this at the START and update after EACH flag:

```
───── Execute Migration ───────────────────────────────────
  Client: test  |  Entity: user_id  |  Flags: 15
  Progress: [░░░░░░░░░░░░░░░░░░░░] 0/15
────────────────────────────────────────────────────────────
```

Update the progress bar as flags are processed. Use `█` for completed
and `░` for remaining. The bar should be 20 characters wide.

Examples at various stages:
```
  Progress: [██████░░░░░░░░░░░░░░] 5/15 (1 skipped)
  Current:  complex-deployment-and-version
```

```
  Progress: [████████████████████] 15/15 done
  Result:   14 migrated, 1 skipped
```

After each flag completes, show:
```
  ✓ simple-usage-limit — MATCH (enabled)
```

After a skip:
```
  ⊘ simple-new-onboarding — skipped
```

### Final Summary (Execute)

At the end of execution, show a complete summary:

```
───── Migration Complete ──────────────────────────────────
  Progress: [████████████████████] 15/15 done
  Migrated: 14  |  Skipped: 1  |  Failed: 0

  ✓ simple-usage-limit          100%  user_id
  ✓ simple-ai-features          100%  user_id
  ⊘ simple-new-onboarding       —     skipped
  ✓ simple-dark-mode             25%  user_id
  ...
────────────────────────────────────────────────────────────
```

---

## Confidence Naming Rules

- **Flag names:** lowercase letters, digits, and hyphens only (`[a-z0-9-]`)
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

Same as Plan Flag: check for existing `.claude/plans/posthog-code-migration-*.md`.
If found with incomplete `Generation Status`, resume from the last
incomplete step. If complete, ask user if they want to start fresh.
If not found, start fresh.

The plan file uses the same progressive pattern: created at Step 1,
updated after each step, with a `## Generation Status` section.

### Step 1: Detect Language & Framework

```
Grep: pattern="posthog|PostHog" -> Find PostHog usage
Glob: pattern="package.json" or "build.gradle" or "Cargo.toml" etc
Read: dependency file -> Determine language/framework
```

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

### Step 3: Scan Codebase for PostHog Usage

```
Grep: pattern="<posthog-import-pattern>" -> Find all usages
```

Group files by flag constant they reference.

### Step 4: Generate Transform Rules

Based on SDK guide from MCP:
- Extract install commands
- Extract initialization code
- Extract flag evaluation API
- Generate find/replace rules matching PostHog -> Confidence patterns

### Step 5: Generate Plan

Save to `.claude/plans/posthog-code-migration-<date>.md`

---

## Plan Code: Template

```markdown
# PostHog to Confidence Code Migration Plan

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

**Must match PostHog API surface:**

| Method | Signature |
|--------|-----------|
<detected from PostHog store>

---

## 2. Transform Rules

### Source Files

| Find | Replace |
|------|---------|
| <PostHog import> | <Confidence import> |
| <PostHog usage> | <Confidence usage> |

### Test Files

| Find | Replace |
|------|---------|
| <PostHog mock> | <Confidence mock> |

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
Glob: .claude/plans/posthog-flag-migration-*.md
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

**File path:** `.claude/plans/posthog-flag-migration-<date>.md`

The plan file MUST include a `## Generation Status` section at the top
(right after the title) that tracks which steps are done:

```markdown
## Generation Status

| Step | Status | Result |
|------|--------|--------|
| 1. Scan PostHog | ✓ complete | 15 flags |
| 2. Choose client | ✓ complete | test |
| 3. Map entities | ○ not started | |
| 4. Generate rules | ○ not started | |
```

Status values: `✓ complete`, `◉ in progress`, `○ not started`

**After each step completes**, update the status table AND write that
step's data to the plan file. Do NOT wait until the end to write.

### Step 1: Scan PostHog Flags

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

**After scan completes:** Update Generation Status step 1 to `✓ complete`.

### Step 2: Select Confidence Client

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
stop. A re-run of `/migrate-posthog`, an empty message, or any reply
that is not a number from the list / `new <name>` is **not** consent —
NEVER infer the recommendation from silence. If the reply is ambiguous,
re-ask, listing the choices again.

- If user picks existing -> use it
- If user wants new -> ASK for name -> `mcp__confidence__createClient`

**After client selected:** Write Section 1 (Default Client) to plan
file and update Generation Status step 2 to `✓ complete`.

### Step 3: Map Randomization Units

```
mcp__confidence__getContextSchema clientName: "<selected-client>"
```

Show the user entity fields (fields marked as entity in the schema).

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

**Wait for an explicit pick.** Same rule as Step 2 — set the step to
`⏸ awaiting user` and stop. Silence, a re-run, or any non-listed reply
is **not** consent. Re-ask if the reply is ambiguous.

- If user picks existing -> use it as `targetingKey` for all per-user flags
- If user wants new -> ASK for name + type -> `mcp__confidence__addContextField`

**For per-group flags (PostHog `aggregation_group_type_index`):**

If any flags randomize per group, inform the user:

> <Y> flags randomize per group in PostHog (e.g. everyone in the same
> company sees the same variant). These will automatically use the same
> group identifier in Confidence (e.g. `company_id`). No mapping needed
> — I'll carry them over as-is.

If the group identifier doesn't exist in the Confidence context schema,
create it with `mcp__confidence__addContextField`. See **Confidence
Naming Rules** above — always provide an explicit `entityReference`
(e.g. `entities/company` for a field named `company_id`).

**Step 3 only creates entity fields** (the per-user entity, plus any
group identifiers from per-group flags). Attribute fields used in
targeting rules (`plan`, `country`, `age`, etc.) MUST NOT be created
here. Record them in Section 3 "Need to Create" and let `execute`
create them — that way, if the user later skips a flag, no orphan
schema fields are left in Confidence.

**After entity mapped:** Write Section 2 (Randomization Mapping) to
plan file, reconcile and write Section 3 (Context Schema), and update
Generation Status step 3 to `✓ complete`.

### Step 4: Generate MCP Commands

**Confirmation gate (MUST pass before generating).** Before writing
Section 4, summarize chosen client + entity in chat and ask:

> Plan will assume client `<client>` with randomization entity
> `<entity>`. All flags will be defaulted to `[ ] Migrate  [ ] Skip`
> (neither pre-checked) — you'll opt each one in during review.
> Confirm or change?

Set the step to `⏸ awaiting user` and stop. Only proceed on an
explicit `yes` / `confirm` / equivalent. A re-run or ambiguous reply
is **not** confirmation.

For each flag in Section 4, generate the MCP command payloads
(createFlag, addFlagToClient, addTargetingRule, resolveFlag) using the
Operator Mapping Reference (below). Write them into each flag's section.

**After all commands generated:** Update Generation Status step 4 to
`✓ complete` and set the overall status to `complete`. Write the
Progress table (Section 5).

**Tell the user:**
> Plan generated! Review it at `.claude/plans/posthog-flag-migration-<date>.md`
>
> Migration is **opt-in**: every flag starts with both checkboxes
> empty. Tick `[x] Migrate` or `[x] Skip` for each flag — `execute`
> will refuse any flag with neither box set.
> When you're ready, run: `/migrate-posthog execute <plan-file>`

---

## Operator Mapping Reference (agent-internal, do NOT show to user)

This is how PostHog operators map to Confidence targeting payloads.
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

| PostHog | Confidence Criterion |
|---------|---------------------|
| `exact: "X"` | `"eqRule": { "value": { "stringValue": "X" } }` |
| `exact: N` (number) | `"eqRule": { "value": { "numberValue": N } }` |
| `exact: true/false` | `"eqRule": { "value": { "boolValue": true } }` |
| `gte: N` | `"rangeRule": { "startInclusive": { "numberValue": N } }` |
| `gt: N` | `"rangeRule": { "startExclusive": { "numberValue": N } }` |
| `lt: N` | `"rangeRule": { "endExclusive": { "numberValue": N } }` |
| `lte: N` | `"rangeRule": { "endInclusive": { "numberValue": N } }` |
| `regex: ^prefix.*` | `"startsWithRule": { "value": "prefix" }` |
| `regex: .*suffix$` | `"endsWithRule": { "value": "suffix" }` |

### Expression Combinators

| Pattern | Expression |
|---------|-----------|
| Single condition | `{ "ref": "ref-0" }` |
| AND | `{ "and": { "operands": [{ "ref": "ref-0" }, { "ref": "ref-1" }] } }` |
| OR | `{ "or": { "operands": [{ "ref": "ref-0" }, { "ref": "ref-1" }] } }` |
| NOT | `{ "not": { "ref": "ref-0" } }` |
| NOT IN (list) | `{ "and": { "operands": [{ "not": { "ref": "ref-0" } }, { "not": { "ref": "ref-1" } }] } }` |

### PostHog Operator Mapping

| PostHog | Confidence Payload Strategy |
|---------|---------------------------|
| `exact: "X"` | One criterion with `eqRule`, expression: `ref` |
| `is_not: "X"` | One criterion with `eqRule`, expression: `not` wrapping `ref` |
| `exact: ["A","B"]` | One criterion per value with `eqRule`, expression: `or` of `ref`s |
| `is_not: ["A","B"]` | One criterion per value with `eqRule`, expression: `and` of `not`-wrapped `ref`s |
| `gte: N` | One criterion with `rangeRule`, expression: `ref` |
| `regex: ^prefix.*` | One criterion with `startsWithRule`, expression: `ref` |
| `regex: .*suffix$` | One criterion with `endsWithRule`, expression: `ref` |

**Blocked (manual review):** `icontains`, `is_not_set`, cohort targeting

### AND / OR Combinations

**AND conditions:** All properties within one PostHog group are ANDed.
Create one criterion per condition, combine with `and` expression.

**Multiple groups (OR):** PostHog groups are ORed. Create criteria for
each group, combine group expressions with `or`.

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

**IN operator (country IN [US, UK]):**
```json
{
  "criteria": {
    "ref-0": { "attribute": { "attributeName": "country", "eqRule": { "value": { "stringValue": "US" } } } },
    "ref-1": { "attribute": { "attributeName": "country", "eqRule": { "value": { "stringValue": "UK" } } } }
  },
  "expression": { "or": { "operands": [{ "ref": "ref-0" }, { "ref": "ref-1" }] } }
}
```

**NOT IN (country NOT IN [DE, FR]):**
```json
{
  "criteria": {
    "ref-0": { "attribute": { "attributeName": "country", "eqRule": { "value": { "stringValue": "DE" } } } },
    "ref-1": { "attribute": { "attributeName": "country", "eqRule": { "value": { "stringValue": "FR" } } } }
  },
  "expression": { "and": { "operands": [{ "not": { "ref": "ref-0" } }, { "not": { "ref": "ref-1" } }] } }
}
```

**AND (plan = "pro" AND country IN [US, UK]):**
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

**Range (age >= 30):**
```json
{
  "criteria": {
    "ref-0": { "attribute": { "attributeName": "age", "rangeRule": { "startInclusive": { "numberValue": 30 } } } }
  },
  "expression": { "ref": "ref-0" }
}
```

**Ends with (email ends with @spotify.com OR @gmail.com):**
```json
{
  "criteria": {
    "ref-0": { "attribute": { "attributeName": "email", "endsWithRule": { "value": "@spotify.com" } } },
    "ref-1": { "attribute": { "attributeName": "email", "endsWithRule": { "value": "@gmail.com" } } }
  },
  "expression": { "or": { "operands": [{ "ref": "ref-0" }, { "ref": "ref-1" }] } }
}
```

**Starts with (utm_source starts with "email-"):**
```json
{
  "criteria": {
    "ref-0": { "attribute": { "attributeName": "utm_source", "startsWithRule": { "value": "email-" } } }
  },
  "expression": { "ref": "ref-0" }
}
```

### Multivariant A/B Split Handling

**CRITICAL:** A single Confidence targeting rule CAN assign multiple
variants at different split percentages. Use ONE rule per targeting
condition, listing all variants and their shares in that rule.

**How to map PostHog splits to Confidence rules:**

For a 2-variant flag (e.g. control 50% / treatment 50%):
- Add ONE rule with two variant assignments:
  control at 50%, treatment at 50%.

For a 3+ variant flag (e.g. control 34% / A 33% / B 33%):
- Add ONE rule with three variant assignments:
  control at 34%, A at 33%, B at 33%.

**Do NOT create separate rules per variant.** One targeting rule =
one set of targeting conditions, with the variant split defined
inside that rule. The `rolloutPercentage` on the rule controls
what fraction of users who match the targeting conditions enter the
rule at all (use 100% unless you want a partial rollout on top of
the targeting). The variant percentages within the rule control the
split among those who enter.

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

These fields are already defined in the `<client>` client and match
PostHog targeting properties. No action needed.

| Field | Type | Entity | PostHog Property |
|-------|------|--------|------------------|
<matching fields from getContextSchema + PostHog scan>

### Need to Create

These fields are used in PostHog targeting rules but don't exist yet
in the Confidence client. They will be created during execution using
`addContextField`.

| Field | Type | Entity | PostHog Property |
|-------|------|--------|------------------|
<missing fields that PostHog rules need but Confidence doesn't have>

### Confidence-only (not in PostHog)

These fields exist in Confidence but aren't used by any PostHog flag.
Listed for reference — no action needed.

| Field | Type | Entity |
|-------|------|--------|
<fields in Confidence schema not referenced by any PostHog flag>

---

## 4. Flags to Migrate

Below are the flags we're planning to migrate, along with their
targeting rules described in plain language.

**Migration is opt-in.** Each flag starts with both checkboxes empty.
Tick `[x] Migrate` for every flag you want to bring across, or
`[x] Skip` to drop it. Flags with neither box ticked will be refused
by `execute` — no implicit defaults.

During execution, each flag will be created one by one, interactively.

### Flag: `<flag-name>`

**Description:** <from PostHog if available, otherwise empty>
**Rules:** <plain English description of targeting>
**Rollout:** <percentage>
**Variants:** <variant names with percentages, e.g. "control (50%), treatment (50%)">
**PostHog bucketing:** <"distinct_id (per user)" or "group type <N> (per company/group)">
**Confidence entity:** <mapped entity field from Step 3>
**Confidence rollout:** <rolloutPercentage for the rule + variant split inside the rule — see Multivariant A/B Split Handling>
**Action:** [ ] Migrate  [ ] Skip

**MCP Commands:**
<createFlag, addTargetingRule (ONE rule with all variant assignments and their split), resolveFlag with full parameters>
<resolveFlag MUST include both a positive-case and negative-case test>

---

## 5. Progress

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
   g. Create PR with title: "feat: migrate <flag-key> from PostHog to Confidence"
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
   - For flags where PostHog's bucketing_identifier is NOT distinct_id:
     use whatever PostHog uses as the targetingKey for that flag
     (e.g. if PostHog uses company_id, use company_id in Confidence too)
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

- **NEVER auto-continue** -- always wait for user at each checkpoint
- **Flag-by-flag** -- each flag is one unit (its files + tests)
- **PR checkpoints** -- offer to create PR after each flag or batch
- **Resumable** -- update Progress table in plan file after each step

---

## Required MCPs

### For `plan code`

| MCP | Tools Used |
|-----|------------|
| `confidence-docs` | `getCodeSnippetAndSdkIntegrationTips`, `searchDocumentation`, `getFullSource` |

### For `plan flag`

| MCP | Tools Used |
|-----|------------|
| `posthog` | `feature-flag-get-all`, `feature-flag-get-definition` |
| `confidence` | `listClients`, `getContextSchema`, `createFlag`, `addTargetingRule`, `resolveFlag` |
