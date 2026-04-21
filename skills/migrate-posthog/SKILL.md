---
name: migrate-posthog
description: Migrate feature flags from PostHog to Confidence SDK
argument-hint: [plan flag | plan code | execute <plan-file>]
---

# PostHog to Confidence Migration

MCP-driven, self-sufficient migration plans for PostHog to Confidence.

## Commands

| Command | Description |
|---------|-------------|
| `/migrate-posthog plan flag` | Create plan for flag definitions only |
| `/migrate-posthog plan code` | Create plan for code transformation only |
| `/migrate-posthog execute <plan-file>` | Execute a plan interactively |

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

**Breadcrumbs:** At the start of any multi-step workflow, tell the user what
steps they will go through. At each step, tell them what just completed and
what comes next.

---

## Plan Code: Workflow

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

**Tell the user at the start:**
> This will go through 4 steps:
> 1. Scan PostHog for all your feature flags
> 2. Choose a Confidence client (where flags will live)
> 3. Choose a randomization unit (how users get assigned)
> 4. Generate the migration plan
>
> Let's start!

### Step 1: Scan PostHog Flags

```
mcp__posthog__feature-flag-get-all (paginate with limit=10, offset=0,10,20...)
```

For each flag found:
```
mcp__posthog__feature-flag-get-definition flag_id: "<id>"
```

**Write flag data to the plan file continuously** as definitions are fetched
(don't wait until all are fetched). Paginate 10 at a time.

Extract from each flag:
- Key and name
- Description (if PostHog provides one, include it; otherwise leave blank)
- Targeting properties used (e.g. `plan`, `country`, `age`)
- Rollout percentage
- Variant type (boolean / multivariant)
- `bucketing_identifier` — check if it's `distinct_id` (default) or something
  else (e.g. a group type like `company_id`). If not `distinct_id`, record it
  separately — this flag needs a different randomization unit.

Collect the set of all targeting properties across all flags — these become
the context schema fields for Confidence.

**Tell the user:**
> Found <N> flags. Step 1 done. Next: choosing a Confidence client.

### Step 2: Select Confidence Client

```
mcp__confidence-flags__listClients
```

**ASK the user (numbered list):**
> Which Confidence client should I use as the default for all flags?
> You can always change and rearrange them later.
>
> 1. <client-1>
> 2. <client-2>
> ...
> N. Create a new client

- If user picks existing -> use it
- If user wants new -> ASK for name -> `mcp__confidence-flags__createClient`

**Tell the user:**
> Client selected. Step 2 done. Next: choosing how users get randomly assigned.

### Step 3: Select Randomization Unit

```
mcp__confidence-flags__getContextSchema clientName: "<selected-client>"
```

Show the user entity fields (fields marked as entity in the schema).

**ASK the user (numbered list):**
> What should users be randomly assigned by? This is the field Confidence
> uses to decide which variant someone gets (e.g. user_id, visitor_id).
>
> 1. <entity-field-1>
> 2. <entity-field-2>
> ...
> N. Create a new field

- If user picks existing -> use it for `targetingKey` in all rules
- If user wants new -> ASK for name + type -> `mcp__confidence-flags__addContextField`

**Tell the user:**
> Randomization unit selected. Step 3 done. Next: generating the migration plan.

### Step 4: Generate Plan

Convert all PostHog targeting rules to Confidence format using the
Operator Mapping Reference (below). Write the plan file.

Save to `.claude/plans/posthog-flag-migration-<date>.md`

**Tell the user:**
> Plan generated! Review it at `.claude/plans/posthog-flag-migration-<date>.md`
>
> You can mark flags to skip by changing `[x] Migrate` to `[ ] Skip`.
> When you're ready, run: `/migrate-posthog execute <plan-file>`

---

## Operator Mapping Reference (agent-internal, do NOT show to user)

This is how PostHog operators map to Confidence targeting payloads.
Use this when generating `addTargetingRule` payloads in the plan file.

| PostHog | Confidence Payload |
|---------|-------------------|
| `exact: "X"` | `eqRule` with `stringValue` |
| `is_not: "X"` | NOT expression wrapping `eqRule` |
| `exact: ["A","B"]` | `or` expression with one `eqRule` per value |
| `is_not: ["A","B"]` | NOT wrapping `or` of `eqRule` per value |
| `gte: N` | `rangeRule` with `startInclusive` |
| `gt: N` | `rangeRule` with `startExclusive` |
| `lt: N` | `rangeRule` with `endExclusive` |
| `lte: N` | `rangeRule` with `endInclusive` |
| `regex: ^prefix.*` | `startsWithRule` |
| `regex: .*suffix$` | `endsWithRule` |

**Blocked (manual review):** `icontains`, `is_not_set`, cohort targeting

**Boolean values:** Use `eqRule` with `boolValue` (true/false).

**AND conditions:** All properties within one PostHog group are ANDed.
Use `and` expression with `operands` array.

**Multiple groups (OR):** PostHog groups are ORed. Use `or` expression.

---

## Plan Flag: Template

```markdown
# PostHog to Confidence Flag Migration Plan

**Created:** <date>
**Scope:** Flag definitions only

---

## 1. Default Client

These are the defaults that will be used for all flags. You can change
and rearrange individual flags later in the Confidence UI.

**Available Clients:** <list from MCP>

**Selected:** `<client>`

---

## 2. Randomization Unit

This is the field Confidence uses to randomly assign users to variants.
All flags will use this as their default targeting key.

**Available Entity Fields:** <entity fields from MCP>

**Selected:** `<entity>`

---

## 3. Context Schema

These fields were found in PostHog flag targeting rules. They will be
added to Confidence as context fields so they appear in the UI as
targeting options.

| Field | Type | Entity |
|-------|------|--------|
<fields from MCP + PostHog scan>

---

## 4. Flags to Migrate

Below are the flags we're planning to migrate, along with their
targeting rules described in plain language.

Review each flag. You can mark any flag to skip by changing
`[x] Migrate` to `[ ] Skip`.

During execution, each flag will be created one by one, interactively.

### Flag: `<flag-name>`

**Description:** <from PostHog if available, otherwise empty>
**Rules:** <plain English description of targeting>
**Rollout:** <percentage>
**Randomization:** <"default" if distinct_id, otherwise note the different unit>
**Action:** [x] Migrate  [ ] Skip

**MCP Commands:**
<createFlag, addTargetingRule, resolveFlag with full parameters>

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

```
1. READ the plan file
2. SDK SETUP (Section 1 of plan)
   - Show install command from plan
   - ASK: "Install SDK now? [Yes / Skip / I already did]"
   - If Yes -> run install command
   - Show wrapper file path + API surface from plan
   - ASK: "Create the Confidence wrapper now? [Yes / Skip / I already did]"
   - If Yes -> create the file using plan's API reference
3. FOR EACH FLAG in the files list:
   - Show flag name + all files using it
   - ASK: "Transform this flag's files? [Yes / Skip / Pause]"
   - If Yes -> apply transform rules from plan to all files for this flag
   - CHECKPOINT: "Flag done. [Create PR / Continue / Pause]?"
   - Wait for user response
4. COMPLETION
   - Show summary: migrated vs skipped
   - List any PRs created
```

### For Flag Plans

```
1. READ the plan file
   - Client is already in the plan — use it, do NOT re-ask
   - Entity (randomization unit) is already in the plan as the default
   - For flags where PostHog's bucketing_identifier is NOT distinct_id:
     use whatever PostHog uses as the targetingKey for that flag
     (e.g. if PostHog uses company_id, use company_id in Confidence too)
2. FOR EACH FLAG marked [x] Migrate:
   - Show flag name, description, and rules in plain English
   - ASK: "Create this flag in Confidence? [Yes / Skip / Pause]"
   - If Yes -> run MCP commands from plan (createFlag, addTargetingRule)
   - If the flag has more than one targeting rule:
     ASK: "This flag has multiple rules. Want me to resolve/test each one?"
     If Yes -> run resolveFlag for each rule
   - Else -> run resolveFlag once
   - CHECKPOINT: "Flag done. [Continue / Pause]?"
   - Wait for user response
3. COMPLETION
   - Show summary: created vs skipped
```

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
| `confidence-flags` | `listClients`, `getContextSchema`, `createFlag`, `addTargetingRule`, `resolveFlag` |
