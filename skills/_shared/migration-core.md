# Migration Core (Shared)

> **This is not a standalone skill.** It is shared content read by every
> platform-specific migration skill in this plugin (`migrate-posthog`,
> `migrate-eppo`, ...). It defines the **Confidence-side** conventions
> that all migrations follow. Each platform skill defines what's
> specific to its source system (PostHog, Eppo, etc.).
>
> When the agent is invoked for a migration command, it MUST read both
> this file AND the relevant `skills/migrate-<platform>/SKILL.md`, then
> apply them together. The platform skill says what to do; this file
> says how to talk to Confidence.

---

## How These Files Compose

Every migration has the same structure:

```
Phase 1: Flag Definitions
  plan flags  →  Scan <source>, choose client & entity, generate plan
  execute     →  Create each flag in Confidence with targeting rules

Phase 2: Code Transformation
  plan code   →  Scan codebase, fetch SDK guide, generate transform rules
  execute     →  Transform code flag by flag, each flag = one PR
```

**Why flags first?** Flags must exist in Confidence before code can
resolve them. Once flags are live in Confidence, the code that
evaluates them is migrated — one flag at a time, one PR at a time.

**Each code PR is scoped to a single flag.** Small, reviewable, and
independently shippable. If one flag's migration has issues, it
doesn't block the others.

Platform skills implement the platform-specific parts of each phase
(scan the source, map randomization concepts, build the operator
table, scan the source SDK in code). This file implements the
platform-agnostic parts (talk to Confidence, manage the plan file,
run execute).

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
| **Source-boxed** | Every external data fetch uses one explicit channel the platform skill defines (an MCP server, a REST API with curl, etc.) — no ad-hoc browsing |
| **Self-sufficient** | Plan contains ALL information needed — no "query the source for X" at execute time |
| **Agent-agnostic** | Any agent with the prerequisites can execute the plan without prior context |
| **Language-agnostic** | Detect framework, fetch SDK guide from `confidence-docs` MCP dynamically |

---

## Prerequisites: Confidence Side

Every platform skill requires these. The platform skill is responsible
for documenting its own source-system prerequisites (PostHog MCP, Eppo
API key, etc.) in addition to these.

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

---

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

---

## Step Tracker Conventions

Platform skills define the **layout** of their step trackers (which
steps appear, what columns). This file defines the **markers** and the
**rules** for using them.

### Status markers

- `○ pending` — not started yet
- `◉ in progress` — currently running
- `⏸ awaiting user` — blocked on user input (e.g. picking a client or entity)
- `✓ done` — completed (add brief user-facing result)
- `⊘ skipped` — skipped by user

### Rules

Use `⏸ awaiting user` whenever the workflow has asked a question and is
waiting for an explicit reply. This makes "I'm blocked on you" visible
to both agent and user, and prevents the agent from drifting into
auto-progression while a question is open.

**Never expose internal/technical details in the tracker.** No
pagination info, no API page counts, no internal field names. Show only
what matters to the user.

**Update and re-display the tracker** at the start and after each step
completes.

### Execute progress bar

The execute step tracker includes a progress bar. Use `█` for completed
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

---

## Confidence Naming Rules

- **Flag names:** lowercase letters, digits, and hyphens only (`[a-z0-9-]`).
  Source flag keys often already follow this convention; if not, normalize
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

## Plan Files: Resume Check & Progressive Updates

Both plan flags and plan code use a progressive plan file. Created at
Step 1, updated after each step, so a closed session can resume.

### Resume check (MUST do first)

Before starting any plan workflow, check for an existing in-progress
plan. Each platform defines the file glob:

- `migrate-posthog plan flags` → `.claude/plans/posthog-flag-migration-*.md`
- `migrate-posthog plan code`  → `.claude/plans/posthog-code-migration-*.md`
- `migrate-eppo plan flags`    → `.claude/plans/eppo-flag-migration-*.md`
- `migrate-eppo plan code`     → `.claude/plans/eppo-code-migration-*.md`

If a plan file exists, read its `## Generation Status` section:

- If status is `complete` → tell user a plan already exists, ask if
  they want to start fresh or use the existing one
- If status is NOT `complete` → **resume from the last incomplete step**.
  Tell the user: "Found an in-progress plan. Resuming from step <N>."
- If no plan file exists → start fresh

### Generation Status table

Every plan file MUST include a `## Generation Status` section at the
top (right after the title) that tracks which steps are done:

```markdown
## Generation Status

| Step | Status | Result |
|------|--------|--------|
| 1. Scan <source> | ✓ complete | 15 flags |
| 2. Choose client | ✓ complete | test |
| 3. Map randomization | ○ not started | |
| 4. Generate rules | ○ not started | |
```

Status values: `✓ complete`, `◉ in progress`, `○ not started`

**After each step completes**, update the status table AND write that
step's data to the plan file. Do NOT wait until the end to write.

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
proto3 → JSON (camelCase keys); the examples below are taken from the
resolver's own spec fixtures (`test-payloads/resolver-spec/state.json`).

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
list membership. Use whichever the platform mapping specifies; both
resolve identically.

### Segment criteria

A criterion can reference a reusable **segment** instead of an
inline attribute rule. This is how you map a source platform's reusable
audience / cohort concept (e.g. an Eppo audience) onto Confidence:
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

### Expression combinators

| Pattern | Expression |
|---------|-----------|
| Single condition | `{ "ref": "ref-0" }` |
| AND | `{ "and": { "operands": [{ "ref": "ref-0" }, { "ref": "ref-1" }] } }` |
| OR | `{ "or": { "operands": [{ "ref": "ref-0" }, { "ref": "ref-1" }] } }` |
| NOT | `{ "not": { "ref": "ref-0" } }` |
| NOT IN (list) | Prefer one `setRule` criterion wrapped in `not`: `{ "not": { "ref": "ref-0" } }`. (An `and` of `not`-wrapped per-value `eqRule`s is equivalent if you didn't use a set rule.) |

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

**IN (country IN [US, UK]):**
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

**Set exclusion (country NOT in [DE, FR]):**
```json
{
  "criteria": {
    "ref-0": { "attribute": { "attributeName": "country", "setRule": { "values": [{ "stringValue": "DE" }, { "stringValue": "FR" }] } } }
  },
  "expression": { "not": { "ref": "ref-0" } }
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

**Segment exclusion (NOT in segment):**
```json
{
  "criteria": {
    "ref-0": { "segment": { "segment": "segments/internal-staff" } }
  },
  "expression": { "not": { "ref": "ref-0" } }
}
```

---

## Reusable Segments (createSegment)

When a source platform has a **reusable audience / cohort** that
multiple flags reference, map it to a Confidence **segment** rather than
inlining its conditions into every flag. A segment is created once and
referenced from many flags' targeting via a segment criterion (see
"Segment criteria" above).

**Create a segment** with the standard MCP call. The `targeting` payload
uses the exact same `criteria` + `expression` format as a flag's
targeting rule:

```
mcp__confidence__createSegment
  segmentId: "<clean-id>"            ← [a-z0-9-], 4–63 chars
  displayName: "<human name>"
  targeting: { "criteria": { ... }, "expression": { ... } }
```

This yields a segment named `segments/<clean-id>`, which you then
reference from each flag via `{ "segment": { "segment": "segments/<clean-id>" } }`.

**De-duplicate.** If several source flags reference the same audience,
create the segment **once** and reuse its name everywhere. Maintain a
source-audience-id → `segments/<clean-id>` map in the plan file so
`execute` reuses the segment instead of recreating it. Before creating,
the platform skill should check whether the segment already exists
(`listSegments` / `getSegment` if available) and skip creation if so.

**Allocation/proportion.** A segment created for targeting reuse should
be allocated at 100% (it defines *who is eligible*, not a rollout
percentage). Rollout percentages belong on the flag's targeting rule,
not the segment.

---

## Platform Operator Mapping Contract

Each platform skill MUST provide an "Operator Mapping" section that
maps the source platform's operators to Confidence payload strategies
expressed in the format above. The table columns are:

| Source operator | Confidence payload strategy |

Each row should describe a single source-side operator and how to
realize it using the criterion rules and expression combinators in
this file. When an operator has no clean mapping (e.g. arbitrary
regex, set membership in cohorts, "is set"/"is not set" semantics),
the platform skill MUST list it under a **Blocked** subsection with
guidance on what the user should do (rewrite the rule, migrate the
flag manually, or skip).

---

## Multivariant A/B Split Handling

**CRITICAL:** A single Confidence targeting rule CAN assign multiple
variants at different split percentages. Use ONE rule per source-side
targeting unit (PostHog filter group, Eppo allocation, etc.), listing
all variants and their shares in that rule.

**How to map source-side splits to Confidence rules:**

For a single-variant assignment (e.g. feature gate, kill switch):
- Add ONE rule with one variant assignment at 100%.

For a 2-variant flag (e.g. control 50% / treatment 50%):
- Add ONE rule with two variant assignments:
  control at 50%, treatment at 50%.

For a 3+ variant flag (e.g. control 34% / A 33% / B 33%):
- Add ONE rule with three variant assignments:
  control at 34%, A at 33%, B at 33%.

**Do NOT create separate rules per variant.** One targeting rule =
one set of targeting conditions, with the variant split defined
inside that rule. The `rolloutPercentage` on the rule controls
what fraction of subjects who match the targeting conditions enter
the rule at all (use 100% unless you want a partial rollout on top of
the targeting). The variant percentages within the rule control the
split among those who enter.

**Source-side "traffic exposure" / "rollout percentage"** maps to the
rule's `rolloutPercentage`. Subjects who match the targeting conditions
but fall outside that percentage continue down the waterfall to the
next rule.

---

## Plan Flags: Standard Workflow

Platform skills follow the same 4-step plan flow. This section defines
the steps that are identical across platforms (steps 2 and 4) and
declares the contract for steps that platforms implement themselves
(steps 1 and 3).

### Step 1: Scan the source platform *(platform-specific)*

Each platform skill defines how to:
- Discover flags in the source (REST, MCP, etc.)
- Paginate until all flags are fetched
- Extract per-flag: key, name, description, variation type, variations,
  targeting rules with operators, rollout percentages, randomization
  concept (per-subject, per-group, etc.)
- Skip archived flags by default unless the user opts in
- Write flag data to the plan file in batches so progress survives
  session loss

**After scan completes:** Update Generation Status step 1 to `✓ complete`.

### Step 2: Select Confidence client *(shared)*

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

### Step 3: Map randomization concepts *(platform-specific)*

Each platform skill defines how its randomization concepts (PostHog
`distinct_id` and `aggregation_group_type_index`, Eppo `subjectKey`,
etc.) map to Confidence entity fields.

**Standard MCP call** for showing the user available entity fields:

```
mcp__confidence__getContextSchema clientName: "<selected-client>"
```

**Standard creation call** when a new entity field is needed:

```
mcp__confidence__addContextField
  clientName: "<selected-client>"
  fieldName: "<chosen>"
  type: "<chosen>"
  entityReference: "entities/<clean-name>"  ← MUST be set, see Confidence Naming Rules
```

**Standard rule for entity-vs-attribute separation.** Step 3 only
creates **entity** fields (the randomization identifiers). Attribute
fields used in targeting rules (`plan`, `country`, `age`, etc.) MUST
NOT be created here. Record them in the "Need to Create" subsection
of the Context Schema section and let `execute` create them — that
way, if the user later skips a flag, no orphan schema fields are left
in Confidence.

**After randomization mapped:** Write the platform's Subject/Randomization
Mapping section, reconcile and write the Context Schema section, and
update Generation Status step 3 to `✓ complete`.

### Step 4: Generate MCP commands *(shared scaffolding, platform-specific operators)*

**Confirmation gate (MUST pass before generating).** Before writing the
Flags to Migrate section, summarize the choices made in earlier steps
in chat and ask:

> Plan will assume client `<client>` with randomization entity
> `<entity>` [and any other platform-specific selections, e.g. source
> environment]. All flags will be defaulted to `[ ] Migrate  [ ] Skip`
> (neither pre-checked) — you'll opt each one in during review.
> Confirm or change?

Set the step to `⏸ awaiting user` and stop. Only proceed on an
explicit `yes` / `confirm` / equivalent. A re-run or ambiguous reply
is **not** confirmation.

For each flag, generate the MCP command payloads (`createFlag`,
`addFlagToClient`, `addTargetingRule`, `resolveFlag`) using the
platform skill's Operator Mapping table together with this file's
Confidence Targeting Payload Format. Write them into each flag's
section in the plan.

**After all commands generated:** Update Generation Status step 4 to
`✓ complete` and set the overall status to `complete`. Write the
Progress table.

**Tell the user:**

> Plan generated! Review it at `.claude/plans/<platform>-flag-migration-<date>.md`
>
> Migration is **opt-in**: every flag starts with both checkboxes
> empty. Tick `[x] Migrate` or `[x] Skip` for each flag — `execute`
> will refuse any flag with neither box set.
> When you're ready, run: `/migrate-<platform> execute <plan-file>`

---

## Plan Code: Standard Workflow

### Step 1: Detect language & framework *(shared scaffolding, platform-specific imports)*

```
Grep: pattern="<platform-import-or-symbol-pattern>"  → Find source usage
Glob: pattern="package.json" or "build.gradle" or "Cargo.toml" or "pyproject.toml" etc
Read: dependency file  → Determine language/framework
```

The platform skill provides the exact patterns to grep for (package
names, function names, import lines).

### Step 2: Fetch SDK guide from `confidence-docs` MCP *(shared)*

Query the `confidence-docs` MCP based on detected language:

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

**CRITICAL:** Include the ACTUAL response in the plan, not a reference
to fetch it. Plans are self-sufficient.

### Step 3: Scan codebase for source-platform usage *(platform-specific)*

Each platform skill defines:
- The grep patterns to find SDK calls
- Which information to extract from each call site (flag key,
  randomization identifier argument, attributes argument, default value)
- How to group files by flag key

### Step 4: Generate transform rules *(platform-specific)*

Each platform skill defines the source SDK API surface and how it maps
to OpenFeature / Confidence. The output is a find/replace rule set
written into the plan's "Transform Rules" section.

(Adjust method casing per language — `getStringValue` in JS/TS,
`get_string_value` in Python, `getValue<String>` in Kotlin, etc. —
based on the MCP-fetched SDK guide.)

### Step 5: Generate plan *(shared template)*

Save the plan to `.claude/plans/<platform>-code-migration-<date>.md`
using the template below.

---

## Plan Code: Template

```markdown
# <Source> to Confidence Code Migration Plan

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
| <source import> | <Confidence import> |
| <source usage> | <Confidence usage> |

### Test Files

| Find | Replace |
|------|---------|
| <source mock> | <Confidence mock> |

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

## Execute: How It Works

`execute <plan-file>` walks through the plan interactively, step by
step. Both code and flag execute flows follow the same conventions
below; the platform skill may add platform-specific guidance (e.g. a
warning when a flag is disabled in the source environment).

### For code plans

**Each flag = one PR.** The code migration creates a separate pull
request for each flag, keeping changes small and reviewable.

```
1. READ the plan file
2. SDK SETUP (Section 1 of plan) — one-time, before any flag
   - Show install command from plan
   - ASK: "Install SDK now? [Yes / Skip / I already did]"
   - If Yes → run install command
   - Show wrapper file path + API surface from plan
   - ASK: "Create the Confidence wrapper now? [Yes / Skip / I already did]"
   - If Yes → create the file using plan's API reference
3. FOR EACH FLAG in the files list:
   a. Create a branch: `migrate/<flag-key>-to-confidence`
   b. Show flag name + all files using it
   c. ASK: "Transform this flag's files? [Yes / Skip / Pause]"
   d. If Yes → apply transform rules from plan to all files for this flag
   e. Run lint + typecheck on changed files
   f. Commit changes
   g. Create PR with title: "feat: migrate <flag-key> from <source> to Confidence"
   h. Show PR link
   i. CHECKPOINT: "PR created. [Continue to next flag / Pause]?"
   j. Wait for user response
4. COMPLETION
   - Show summary: migrated vs skipped
   - List all PRs created with links
```

### For flag plans

```
1. READ the plan file
   - Client is already in the plan — use it, do NOT re-ask
   - Randomization entity is already in the plan
   - Any platform-specific selections (e.g. Eppo source environment)
     are already in the plan
   - REFUSE TO PROCEED if any flag has neither `[x] Migrate` nor
     `[x] Skip` ticked. List those flags back to the user and ask
     them to tick a box for each before re-running execute. Migration
     is opt-in — never assume a default.
   - REFUSE TO PROCEED if any flag is marked `BLOCKED` and the user
     hasn't either resolved the block or ticked `[x] Skip`. Surface
     the BLOCKED flags and the reason for each.
2. FOR EACH FLAG marked [x] Migrate:
   - Show flag name, description, and rules in plain English
   - ASK: "Create this flag in Confidence? [Yes / Skip / Pause]"
   - If Yes → run the Flag Setup Sequence (below)
   - CHECKPOINT: "Flag done. [Continue / Pause]?"
   - Wait for user response
3. COMPLETION
   - Show summary: created vs skipped
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
  → Add the targeting rule(s) from the plan. If the source has multiple
    ordered targeting units (e.g. an Eppo allocation waterfall, ordered
    PostHog filter groups), emit one addTargetingRule call per unit in
    the SAME ORDER. Confidence evaluates rules top-down — order is
    semantically significant.
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
  → For multi-rule flags, also resolve with a context that misses the
    first rule but matches a later one — this verifies the waterfall
    order is correct.
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
- **Preserve source order** — one Confidence rule per source-side
  targeting unit, in the same order
- **PR checkpoints** — offer to create PR after each flag or batch
- **Resumable** — update Progress table in plan file after each step

---

## Required MCPs (Confidence side)

Every migration needs these. Platform skills add their own source-side
prerequisites.

### For `plan code`

| MCP | Tools Used |
|-----|------------|
| `confidence-docs` | `getCodeSnippetAndSdkIntegrationTips`, `searchDocumentation`, `getFullSource` |

### For `plan flag` and `execute`

| MCP | Tools Used |
|-----|------------|
| `confidence` | `listClients`, `createClient`, `getContextSchema`, `addContextField`, `createFlag`, `addFlagToClient`, `unarchiveFlag`, `addTargetingRule`, `resolveFlag`, plus (when the source has reusable audiences) `createSegment` and, if available, `listSegments` / `getSegment` for de-duplication |
