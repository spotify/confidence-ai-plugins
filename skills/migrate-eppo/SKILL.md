---
description: Migrate feature flags from Eppo to Confidence SDK. Use when the user says /migrate-eppo, asks to migrate Eppo flags, or transform SDK code to Confidence.
---

# Eppo to Confidence Migration

REST-driven, self-sufficient migration from Eppo to Confidence.

## Migration Flow

The migration happens in two phases: **flags first, then code**.

```
Phase 1: Flag Definitions
  plan flags  →  Scan Eppo, choose client & entity, generate plan
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
| `/migrate-eppo plan flags` | Phase 1: plan flag definitions migration |
| `/migrate-eppo plan code` | Phase 2: plan code transformation |
| `/migrate-eppo execute <plan-file>` | Execute a plan interactively |

---

## Migration Overview (MUST display at start of `plan flags` or `plan code`)

**Every time** the user runs `plan flags` or `plan code`, display this
overview FIRST — before doing any work. This orients the user on where
they are in the full migration journey.

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

## SDK Preference

**ALWAYS prefer OpenFeature with local resolve.**

| Priority | Approach | When to use |
|----------|----------|-------------|
| 1st | Local resolve | Default for all new integrations |
| 2nd | Remote resolve | Only if local resolve not supported for platform |
| Avoid | Direct SDK | Being phased out |

---

## Plan Philosophy

**Plans must be self-sufficient and agent-agnostic.**

| Principle | Meaning |
|-----------|---------|
| **Self-sufficient** | Plan contains ALL information needed — no "query the API for X" |
| **Agent-agnostic** | Any agent with the prerequisites can execute without prior context |
| **Language-agnostic** | Detect framework, fetch SDK guide from MCP dynamically |

---

## Prerequisites

Before starting any workflow, check that required prerequisites are
available. If any are missing, install or configure them before
proceeding.

### Eppo API access

Eppo does not currently publish a Claude MCP server, so the migration
talks to Eppo's REST API directly using `curl` from the Bash tool.

**Required:**

1. An **Eppo API key** (NOT an SDK key). Generated in the Eppo
   dashboard under **Admin > API Keys**. The key needs read access to
   feature flags.
2. The Eppo API base URL — for most accounts this is
   `https://eppo.cloud/api/v1`. Self-hosted or region-specific
   deployments may use a different base — ask the user to confirm.

**Authentication header:** `X-Eppo-Token: <api-key>`

**ASK the user (only if not already provided):**

> To read your Eppo flags, I need an Eppo API key (Admin > API Keys
> in the Eppo dashboard — make sure it has read access to feature
> flags).
>
> Please paste it here, or set it in your shell as `EPPO_API_KEY`
> before continuing.
>
> What's your Eppo API base URL? Default is `https://eppo.cloud/api/v1`.

**Storing the key:** Once provided, store the key for the session in
the environment variable `EPPO_API_KEY` (export it in the Bash session
the agent uses) and reference it via `$EPPO_API_KEY` in every `curl`
call — never hardcode the key into the plan file, the conversation
output, or any committed file. If the user pastes a key inline, scrub
it from the plan file and only keep a placeholder like `<your-eppo-api-key>`.

**Smoke test before scanning:**

```bash
curl -sS -H "X-Eppo-Token: $EPPO_API_KEY" \
  "https://eppo.cloud/api/v1/feature-flags?page=1&per_page=1" \
  | head -c 200
```

If this returns a `401`/`403` or HTML, stop and surface the error to
the user — do not start scanning.

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

The user will be prompted to authenticate via OAuth in their browser.

---

## User-Facing Communication Rules

**NEVER expose internal technical details to the user.** The user should see
human-readable descriptions of what's happening, not internal implementation
details like targeting payload formats, rule types, or operator names.

- Do NOT say "creating plan based on eqRule / rangeRule / setRule" etc.
- Do NOT show raw targeting payloads or JSON structures in conversation
- Do NOT echo the user's Eppo API key back into the conversation or plan
- DO say things like: "Creating flag with rule: country is US or UK AND appVersion >= 28.5.0"
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
  [1] Scan Eppo        ○ pending
  [2] Choose client    ○ pending
  [3] Map subject      ○ pending
  [4] Generate plan    ○ pending
────────────────────────────────────────────────────────────
```

Status markers:
- `○ pending` — not started yet
- `◉ in progress` — currently running
- `⏸ awaiting user` — blocked on user input (e.g. picking a client, environment, or entity)
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
  [1] Scan Eppo        ✓ 12 flags found (environment: Production)
  [2] Choose client    ◉ in progress
  [3] Map subject      ○ pending
  [4] Generate plan    ○ pending
────────────────────────────────────────────────────────────
```

### Execute Step Tracker

Display this at the START and update after EACH flag:

```
───── Execute Migration ───────────────────────────────────
  Client: test  |  Subject: user_id  |  Flags: 12
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
  ✓ checkout-redesign — MATCH (treatment)
```

After a skip:
```
  ⊘ legacy-onboarding — skipped
```

### Final Summary (Execute)

At the end of execution, show a complete summary:

```
───── Migration Complete ──────────────────────────────────
  Progress: [████████████████████] 12/12 done
  Migrated: 11  |  Skipped: 1  |  Failed: 0

  ✓ checkout-redesign           50/50  user_id
  ✓ pricing-experiment          34/33/33  user_id
  ⊘ legacy-onboarding           —       skipped
  ✓ internal-tools-gate         100%    user_id
  ...
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

---

## Eppo REST Reference (agent-internal)

The migration uses these endpoints. All require `-H "X-Eppo-Token: $EPPO_API_KEY"`.
Base URL defaults to `https://eppo.cloud/api/v1`.

| Purpose | Endpoint |
|---------|----------|
| List environments | `GET /environments` |
| List feature flags | `GET /feature-flags?page=<n>&per_page=<n>` |
| Get a single flag (full definition: variations, allocations, rules) | `GET /feature-flags/{id}` |
| Get environment-specific flag state (enabled + per-env allocations) | `GET /feature-flags/{id}/environments/{environmentId}` |

The flag object includes:
- `key` — used in code (subject of `get_*_assignment` calls)
- `name`, `description`
- `variationType` — `STRING` / `BOOLEAN` / `NUMERIC` / `INTEGER` / `JSON`
- `variations[]` — each has `key`, `name`, `value`
- `allocations[]` — ordered waterfall (top wins). Each allocation has:
  - `name`, `allocationType` (`FEATURE_GATE` / `EXPERIMENT` / `AUDIENCE`)
  - `targetingRules[]` — each rule is `{ conditions: [{ attribute, operator, value }] }`
  - `variationWeightsByKey` or `variationWeights[]` — split among variations
  - `trafficExposure` (0–1) — fraction of matched subjects that enter the allocation
- `environments[]` — per-environment state (enabled flag, env-specific allocations)

**Always paginate** until the response returns fewer items than `per_page` or
an empty page. Eppo's API uses page-based pagination, not cursors.

---

## Plan Code: Workflow

### Resume Check (MUST do first)

Same as Plan Flag: check for existing `.claude/plans/eppo-code-migration-*.md`.
If found with incomplete `Generation Status`, resume from the last
incomplete step. If complete, ask user if they want to start fresh.
If not found, start fresh.

The plan file uses the same progressive pattern: created at Step 1,
updated after each step, with a `## Generation Status` section.

### Step 1: Detect Language & Framework

```
Grep: pattern="eppo|Eppo|EppoClient|get_.*_assignment|getStringAssignment|getBooleanAssignment" -> Find Eppo usage
Glob: pattern="package.json" or "build.gradle" or "Cargo.toml" or "pyproject.toml" etc
Read: dependency file -> Determine language/framework
```

The Eppo package names to look for:
- JS/TS: `@eppo/js-client-sdk`, `@eppo/node-server-sdk`, `@eppo/react-native-sdk`
- Python: `eppo-server-sdk`
- Java/Kotlin: `cloud.eppo:eppo-server-sdk`
- Go: `github.com/Eppo-exp/golang-sdk`
- Ruby: `eppo-server-sdk`
- Rust: `eppo_sdk`
- Swift / iOS: `eppo-ios-sdk`
- Android: `cloud.eppo:eppo-android-sdk`
- DotNet: `Eppo.Sdk`

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

### Step 3: Scan Codebase for Eppo Usage

```
Grep: pattern="<eppo-import-pattern>" -> Find all imports
Grep: pattern="get_(string|boolean|numeric|integer|json)_assignment|getStringAssignment|getBooleanAssignment|getNumericAssignment|getIntegerAssignment|getJSONAssignment" -> Find evaluations
```

Group files by **flag key** they reference. The flag key is the first
argument to every Eppo `get_*_assignment` call.

For each evaluation site, record:
- Flag key
- Return type (inferred from which `get_*_assignment` variant is used)
- The `subjectKey` argument (so the transform can map it to `targetingKey`)
- The `subjectAttributes` argument (so the transform can carry them into
  the evaluation context)
- The `defaultValue` argument (carried over to the Confidence call)

### Step 4: Generate Transform Rules

Based on SDK guide from MCP:
- Extract install commands
- Extract initialization code
- Extract flag evaluation API
- Generate find/replace rules matching Eppo → Confidence patterns

**Typed assignment mapping (Eppo → OpenFeature / Confidence):**

| Eppo call | OpenFeature call |
|-----------|------------------|
| `client.get_string_assignment(k, sk, attrs, default)` | `client.getStringValue(k, default, { targetingKey: sk, ...attrs })` |
| `client.get_boolean_assignment(k, sk, attrs, default)` | `client.getBooleanValue(k, default, { targetingKey: sk, ...attrs })` |
| `client.get_numeric_assignment(k, sk, attrs, default)` | `client.getNumberValue(k, default, { targetingKey: sk, ...attrs })` |
| `client.get_integer_assignment(k, sk, attrs, default)` | `client.getNumberValue(k, default, { targetingKey: sk, ...attrs })` |
| `client.get_json_assignment(k, sk, attrs, default)` | `client.getObjectValue(k, default, { targetingKey: sk, ...attrs })` |

(Adjust method casing per language — `getStringValue` in JS/TS, `get_string_value`
in Python, `getValue<String>` in Kotlin, etc. — based on the MCP-fetched
SDK guide.)

### Step 5: Generate Plan

Save to `.claude/plans/eppo-code-migration-<date>.md`

---

## Plan Code: Template

```markdown
# Eppo to Confidence Code Migration Plan

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

**Must match Eppo API surface:**

| Method | Signature |
|--------|-----------|
<detected from Eppo client wrapper, if any>

---

## 2. Transform Rules

### Source Files

| Find | Replace |
|------|---------|
| <Eppo import> | <Confidence import> |
| `client.get_string_assignment(k, sk, attrs, default)` | `client.getStringValue(k, default, { targetingKey: sk, ...attrs })` |
| <other Eppo usage> | <Confidence usage> |

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

## Plan Flag: Workflow

### Resume Check (MUST do first)

Before starting, check for an existing in-progress plan:

```
Glob: .claude/plans/eppo-flag-migration-*.md
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

**File path:** `.claude/plans/eppo-flag-migration-<date>.md`

The plan file MUST include a `## Generation Status` section at the top
(right after the title) that tracks which steps are done:

```markdown
## Generation Status

| Step | Status | Result |
|------|--------|--------|
| 1. Scan Eppo | ✓ complete | 12 flags |
| 2. Choose client | ✓ complete | test |
| 3. Map subject | ○ not started | |
| 4. Generate rules | ○ not started | |
```

Status values: `✓ complete`, `◉ in progress`, `○ not started`

**After each step completes**, update the status table AND write that
step's data to the plan file. Do NOT wait until the end to write.

### Step 1: Scan Eppo Flags

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
page = 1
LOOP:
  response = curl GET /feature-flags?page=<page>&per_page=50
  process response items
  if response items < 50 OR response is empty → STOP
  page += 1 → continue LOOP
```

```bash
curl -sS -H "X-Eppo-Token: $EPPO_API_KEY" \
  "https://eppo.cloud/api/v1/feature-flags?page=1&per_page=50"
```

**Step 1c — fetch each flag's full definition (in batches of 5).**

```bash
curl -sS -H "X-Eppo-Token: $EPPO_API_KEY" \
  "https://eppo.cloud/api/v1/feature-flags/<id>"
```

And the environment-specific state for the chosen environment:

```bash
curl -sS -H "X-Eppo-Token: $EPPO_API_KEY" \
  "https://eppo.cloud/api/v1/feature-flags/<id>/environments/<environmentId>"
```

**After each batch of 5**, write the flag data to the plan file —
append the flag sections to Section 4. This way if the session closes
mid-scan, the flags fetched so far are saved.

Skip flags that are **archived** in Eppo unless the user opts in (ask
once up-front: "Include archived flags too? Default: no").

Extract from each flag:

- `key` and `name`
- `description` (if Eppo provides one, include it; otherwise leave blank)
- `variationType` and the list of `variations` (key + value)
- For the chosen environment:
  - `enabled` state — flags that are disabled in the chosen environment
    still migrate, but with rollout 0% so they don't activate
    accidentally; surface this clearly in the plan
  - Ordered list of `allocations` with:
    - `allocationType` (Feature Gate, Experiment, or Audience)
    - `trafficExposure` (0–1)
    - `targetingRules[]` (`conditions: [{ attribute, operator, value }]`)
    - `variationWeightsByKey` — the split among variations
- The default variation (what subjects see when no allocation matches)

**Determine the randomization unit:** Eppo always uses `subjectKey`.
Unlike PostHog there's no per-group bucketing concept built into the
flag — group-level experiments are handled by passing a `companyId` as
the `subjectKey`. For the migration, treat every flag as per-subject;
the user will pick which Confidence entity field represents that subject
in Step 3.

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
stop. A re-run of `/migrate-eppo`, an empty message, or any reply
that is not a number from the list / `new <name>` is **not** consent —
NEVER infer the recommendation from silence. If the reply is ambiguous,
re-ask, listing the choices again.

- If user picks existing -> use it
- If user wants new -> ASK for name -> `mcp__confidence__createClient`

**After client selected:** Write Section 1 (Default Client) to plan
file and update Generation Status step 2 to `✓ complete`.

### Step 3: Map Subject Key to a Confidence Entity Field

```
mcp__confidence__getContextSchema clientName: "<selected-client>"
```

Show the user entity fields (fields marked as entity in the schema).

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

**Wait for an explicit pick.** Same rule as Step 2 — set the step to
`⏸ awaiting user` and stop. Silence, a re-run, or any non-listed reply
is **not** consent. Re-ask if the reply is ambiguous.

- If user picks existing -> use it as `targetingKey`
- If user wants new -> ASK for name + type -> `mcp__confidence__addContextField`
  (always provide an explicit `entityReference` — see Confidence Naming Rules)

**Eppo subject targeting (`id` attribute).** Eppo lets rules target the
subject directly via the special attribute `id`. When a rule references
`id`, map it to the chosen entity field's name in Confidence (the
context key for `targetingKey`). Record this substitution in Section 2
of the plan.

**Step 3 only creates the entity field** (the subject's entity).
Attribute fields used in targeting rules (`country`, `plan`, `device`,
`appVersion`, etc.) MUST NOT be created here. Record them in Section 3
"Need to Create" and let `execute` create them — that way, if the user
later skips a flag, no orphan schema fields are left in Confidence.

**After entity mapped:** Write Section 2 (Subject Mapping) to plan
file, reconcile and write Section 3 (Context Schema), and update
Generation Status step 3 to `✓ complete`.

### Step 4: Generate MCP Commands

**Confirmation gate (MUST pass before generating).** Before writing
Section 4, summarize chosen client + entity + Eppo environment in chat
and ask:

> Plan will assume client `<client>`, Eppo source environment
> `<env>`, and randomization entity `<entity>`. All flags will be
> defaulted to `[ ] Migrate  [ ] Skip` (neither pre-checked) — you'll
> opt each one in during review.
> Confirm or change?

Set the step to `⏸ awaiting user` and stop. Only proceed on an
explicit `yes` / `confirm` / equivalent. A re-run or ambiguous reply
is **not** confirmation.

For each flag in Section 4, generate the MCP command payloads
(createFlag, addFlagToClient, addTargetingRule, resolveFlag) using the
Operator Mapping Reference (below). Write them into each flag's section.

**Allocation → targeting-rule order.** Eppo allocations form a
waterfall — the first matching allocation wins. Confidence evaluates
targeting rules in declared order, so emit one `addTargetingRule`
call per Eppo allocation, in the same order. Rules added later sit
below earlier rules.

**After all commands generated:** Update Generation Status step 4 to
`✓ complete` and set the overall status to `complete`. Write the
Progress table (Section 5).

**Tell the user:**
> Plan generated! Review it at `.claude/plans/eppo-flag-migration-<date>.md`
>
> Migration is **opt-in**: every flag starts with both checkboxes
> empty. Tick `[x] Migrate` or `[x] Skip` for each flag — `execute`
> will refuse any flag with neither box set.
> When you're ready, run: `/migrate-eppo execute <plan-file>`

---

## Operator Mapping Reference (agent-internal, do NOT show to user)

This is how Eppo operators map to Confidence targeting payloads.
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

| Confidence Rule | Form |
|---|---|
| String eq | `"eqRule": { "value": { "stringValue": "X" } }` |
| Number eq | `"eqRule": { "value": { "numberValue": N } }` |
| Bool eq | `"eqRule": { "value": { "boolValue": true } }` |
| `>=` | `"rangeRule": { "startInclusive": { "numberValue": N } }` |
| `>` | `"rangeRule": { "startExclusive": { "numberValue": N } }` |
| `<` | `"rangeRule": { "endExclusive": { "numberValue": N } }` |
| `<=` | `"rangeRule": { "endInclusive": { "numberValue": N } }` |
| starts with | `"startsWithRule": { "value": "prefix" }` |
| ends with | `"endsWithRule": { "value": "suffix" }` |

### Expression Combinators

| Pattern | Expression |
|---------|-----------|
| Single condition | `{ "ref": "ref-0" }` |
| AND | `{ "and": { "operands": [{ "ref": "ref-0" }, { "ref": "ref-1" }] } }` |
| OR | `{ "or": { "operands": [{ "ref": "ref-0" }, { "ref": "ref-1" }] } }` |
| NOT | `{ "not": { "ref": "ref-0" } }` |
| NOT IN (list) | `{ "and": { "operands": [{ "not": { "ref": "ref-0" } }, { "not": { "ref": "ref-1" } }] } }` |

### Eppo Operator Mapping

Within a single Eppo rule, all `conditions` are ANDed. Across multiple
rules in the same allocation, conditions are ORed (any rule satisfying
means the allocation matches).

| Eppo operator (typical JSON values: `GT`, `LT`, `GTE`, `LTE`, `MATCHES`, `ONE_OF`, `NOT_ONE_OF`) | Confidence Payload Strategy |
|---|---|
| `GT` / `>` | One criterion with `rangeRule.startExclusive`, expression: `ref` |
| `GTE` / `>=` | One criterion with `rangeRule.startInclusive`, expression: `ref` |
| `LT` / `<` | One criterion with `rangeRule.endExclusive`, expression: `ref` |
| `LTE` / `<=` | One criterion with `rangeRule.endInclusive`, expression: `ref` |
| `ONE_OF ["A"]` (single value) | One criterion with `eqRule`, expression: `ref` |
| `ONE_OF ["A","B",...]` | One criterion per value with `eqRule`, expression: `or` of `ref`s |
| `NOT_ONE_OF ["A"]` (single value) | One criterion with `eqRule`, expression: `not` wrapping `ref` |
| `NOT_ONE_OF ["A","B",...]` | One criterion per value with `eqRule`, expression: `and` of `not`-wrapped `ref`s |
| `MATCHES "^prefix.*"` | One criterion with `startsWithRule { value: "prefix" }` |
| `MATCHES ".*suffix$"` | One criterion with `endsWithRule { value: "suffix" }` |

**Blocked (manual review):**
- `MATCHES` regex that is not a simple prefix/suffix anchor — Confidence
  has no general regex rule. Surface the flag in Section 4 with an
  explicit `BLOCKED` marker and a brief explanation; the user must
  either rewrite the rule using set membership / starts-with / ends-with
  or migrate manually.
- SemVer comparisons — Eppo can compare SemVer strings numerically.
  Confidence's `rangeRule` is purely numeric. If the attribute type is
  SemVer, mark the rule `BLOCKED` and ask the user whether to convert
  the comparison to a numeric `appVersionMajor` / `appVersionMinor`
  context field, or migrate manually.
- `id` (subject-key) ONE_OF lists of more than ~50 values — Eppo caps
  these at 50 but Confidence is fine with larger sets; not blocked,
  just noted.

### AND / OR Combinations

**Within a rule:** `conditions[]` are ANDed. Create one criterion per
condition and combine them with an `and` expression.

**Across rules in one allocation:** any rule matching is enough. Create
criteria for each rule, combine each rule's sub-expression, then OR the
rule expressions together at the top level.

**Across allocations:** these are NOT ORed inside one Confidence rule.
Each Eppo allocation becomes a **separate Confidence targeting rule**,
in the same waterfall order.

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

**ONE_OF (country IN [US, UK]):**
```json
{
  "criteria": {
    "ref-0": { "attribute": { "attributeName": "country", "eqRule": { "value": { "stringValue": "US" } } } },
    "ref-1": { "attribute": { "attributeName": "country", "eqRule": { "value": { "stringValue": "UK" } } } }
  },
  "expression": { "or": { "operands": [{ "ref": "ref-0" }, { "ref": "ref-1" }] } }
}
```

**NOT_ONE_OF (country NOT IN [DE, FR]):**
```json
{
  "criteria": {
    "ref-0": { "attribute": { "attributeName": "country", "eqRule": { "value": { "stringValue": "DE" } } } },
    "ref-1": { "attribute": { "attributeName": "country", "eqRule": { "value": { "stringValue": "FR" } } } }
  },
  "expression": { "and": { "operands": [{ "not": { "ref": "ref-0" } }, { "not": { "ref": "ref-1" } }] } }
}
```

**AND within a rule (plan = "pro" AND country ONE_OF [US, UK]):**
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

**Subject targeting (`id` ONE_OF ["user-1", "user-2"], mapped to `user_id`):**
```json
{
  "criteria": {
    "ref-0": { "attribute": { "attributeName": "user_id", "eqRule": { "value": { "stringValue": "user-1" } } } },
    "ref-1": { "attribute": { "attributeName": "user_id", "eqRule": { "value": { "stringValue": "user-2" } } } }
  },
  "expression": { "or": { "operands": [{ "ref": "ref-0" }, { "ref": "ref-1" }] } }
}
```

**Two-allocation waterfall (internal users gate, then 50/50 experiment):**

This becomes TWO separate `addTargetingRule` calls, in order:
1. Rule 1 — `email endsWith @spotify.com` → assigns `treatment` at 100%.
2. Rule 2 — `country ONE_OF ["US", "CA"]` → assigns `control` 50%, `treatment` 50%.

### Multivariant A/B Split Handling

**CRITICAL:** A single Confidence targeting rule CAN assign multiple
variants at different split percentages. Use ONE rule per Eppo
allocation, listing all variants and their shares in that rule.

**How to map Eppo splits to Confidence rules:**

For a Feature Gate allocation (all matched subjects get one variation):
- Add ONE rule with one variant assignment at 100%.

For an Experiment allocation with variation weights (e.g. control 50% /
treatment 50%):
- Add ONE rule with two variant assignments:
  control at 50%, treatment at 50%.

For 3+ variants (e.g. control 34% / A 33% / B 33%):
- Add ONE rule with three variant assignments:
  control at 34%, A at 33%, B at 33%.

**Traffic exposure → rule rollout.** Eppo's `trafficExposure` (0–1) on
an allocation maps to the `rolloutPercentage` of the Confidence rule:
e.g. `trafficExposure: 0.5` → `rolloutPercentage: 50`. Subjects who
match the targeting conditions but fall outside the exposure continue
down the waterfall (next rule) in Confidence too. Variant percentages
within the rule control the split among the subjects who DO enter.

**Do NOT create separate rules per variant.** One targeting rule =
one set of targeting conditions, with the variant split defined
inside that rule.

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

Below is a reconciliation of what Eppo flags need vs what already
exists in the Confidence client's schema.

### Already in Confidence

These fields are already defined in the `<client>` client and match
Eppo targeting attributes. No action needed.

| Field | Type | Entity | Eppo Attribute |
|-------|------|--------|----------------|
<matching fields from getContextSchema + Eppo scan>

### Need to Create

These fields are used in Eppo targeting rules but don't exist yet
in the Confidence client. They will be created during execution using
`addContextField`.

| Field | Type | Entity | Eppo Attribute |
|-------|------|--------|----------------|
<missing fields that Eppo rules need but Confidence doesn't have>

### Confidence-only (not in Eppo)

These fields exist in Confidence but aren't used by any Eppo flag.
Listed for reference — no action needed.

| Field | Type | Entity |
|-------|------|--------|
<fields in Confidence schema not referenced by any Eppo flag>

---

## 4. Flags to Migrate

Below are the flags we're planning to migrate, along with their
allocations described in plain language.

**Migration is opt-in.** Each flag starts with both checkboxes empty.
Tick `[x] Migrate` for every flag you want to bring across, or
`[x] Skip` to drop it. Flags with neither box ticked will be refused
by `execute` — no implicit defaults.

During execution, each flag will be created one by one, interactively.

### Flag: `<flag-key>`

**Description:** <from Eppo if available, otherwise empty>
**Variation type:** <STRING / BOOLEAN / NUMERIC / INTEGER / JSON>
**Variations:** <variant key — value list, e.g. "control = false, treatment = true">
**Enabled in `<env>`:** <yes / no — if no, all rules will be added at 0% rollout and flag created in the OFF state>
**Allocations (Eppo, in order):**
  1. `<allocation name>` (`<FEATURE_GATE | EXPERIMENT>`) — <plain-English rule>, exposure <X>%, splits <variant=X%, ...>
  2. ...
**Default value (no allocation matches):** <variation key>
**Confidence entity:** <mapped entity field from Step 3>
**Confidence rules:** one targeting rule per allocation (see waterfall in Step 4)
**Action:** [ ] Migrate  [ ] Skip

**MCP Commands:**
<createFlag, addFlagToClient, addTargetingRule (ONE per allocation, in order, with all variant assignments and their split), resolveFlag with full parameters>
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
   g. Create PR with title: "feat: migrate <flag-key> from Eppo to Confidence"
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
   - Subject entity (randomization unit) is already in the plan
   - Eppo source environment is already in the plan
   - REFUSE TO PROCEED if any flag has neither `[x] Migrate` nor
     `[x] Skip` ticked. List those flags back to the user and ask
     them to tick a box for each before re-running execute. Migration
     is opt-in — never assume a default.
   - REFUSE TO PROCEED if any flag is marked `BLOCKED` and the user
     hasn't either resolved the block (rewrote the rule) or ticked
     `[x] Skip`. Surface the BLOCKED flags and the reason for each.
2. FOR EACH FLAG marked [x] Migrate:
   - Show flag name, description, and allocations in plain English
   - If the flag is disabled in the source environment, surface that:
     "This flag is OFF in Eppo (<env>). I'll create it in Confidence
     but keep the rules at 0% rollout. Continue?"
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
  → Use the variation type from Eppo (STRING/BOOLEAN/NUMERIC/INTEGER/JSON)
    as the Confidence schema type.
  → Include all variants from Eppo as Confidence variants.
  → If flag already exists, check the response for which clients
    it's enabled on.

STEP 2: Ensure flag is active and on the correct client
  → If createFlag response does NOT list the target client:
    a. Try addFlagToClient
    b. If that fails with "Cannot update an archived flag":
       → unarchiveFlag first, then retry addFlagToClient
  → If createFlag response lists the target client: proceed

STEP 3: addTargetingRule — ONE per Eppo allocation, in waterfall order
  → Add the targeting rules from the plan, in the same order as the
    Eppo allocations. Confidence evaluates rules top-down — order is
    semantically significant.
  → IMPORTANT: targeting rules added while a flag is archived OR
    immediately after unarchiving may become inactive. Always complete
    steps 1-2 fully (createFlag, unarchive, addFlagToClient) BEFORE
    calling addTargetingRule. Do NOT add rules between createFlag and
    unarchiveFlag — they will be inactive and you'll have to re-add.

STEP 4: resolveFlag (verification)
  → Only NOW resolve to verify the flag works.
  → MUST test BOTH positive AND negative cases:
    a. Resolve with a context that SHOULD match the FIRST allocation
       → Verify the expected variant is returned
    b. Resolve with a context that SHOULD NOT match any allocation
       → Verify the default variation / no variant is returned
  → If the flag has multiple allocations, also resolve with a context
    that misses the first allocation but matches a later one — this
    verifies the waterfall order is correct.
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
- **Preserve allocation order** -- one Confidence rule per Eppo
  allocation, in the same order
- **PR checkpoints** -- offer to create PR after each flag or batch
- **Resumable** -- update Progress table in plan file after each step

---

## Required Prerequisites Summary

### For `plan flags`

| Source | What's used |
|--------|-------------|
| Eppo REST API (`X-Eppo-Token`) | `GET /environments`, `GET /feature-flags`, `GET /feature-flags/{id}`, `GET /feature-flags/{id}/environments/{environmentId}` |
| `confidence` MCP | `listClients`, `getContextSchema`, `createFlag`, `addFlagToClient`, `addContextField`, `addTargetingRule`, `resolveFlag` |

### For `plan code`

| Source | What's used |
|--------|-------------|
| `confidence-docs` MCP | `getCodeSnippetAndSdkIntegrationTips`, `searchDocumentation`, `getFullSource` |
