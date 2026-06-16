---
description: Migrate feature flags from Optimizely to Confidence SDK. Use when the user says /migrate-optimizely, asks to migrate Optimizely flags/rollouts/experiments, or transform Optimizely SDK code to Confidence.
---

# Optimizely to Confidence Migration

REST-driven, self-sufficient migration from Optimizely Feature
Experimentation to Confidence. This skill is fully self-contained: it
defines both the Optimizely-specific migration logic AND all the
Confidence-side conventions it relies on (payload formats, naming rules,
the flag setup sequence, the execute flow, etc.).

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
| **Source-boxed** | Every external data fetch uses one explicit channel (the Optimizely REST API with curl, the Confidence MCP) — no ad-hoc browsing |
| **Self-sufficient** | Plan contains ALL information needed — no "query the source for X" at execute time |
| **Agent-agnostic** | Any agent with the prerequisites can execute the plan without prior context |
| **Language-agnostic** | Detect framework, fetch SDK guide from `confidence-docs` MCP dynamically |

## Commands

| Command | Description |
|---------|-------------|
| `/migrate-optimizely plan flags` | Phase 1: plan flag definitions migration |
| `/migrate-optimizely plan code` | Phase 2: plan code transformation |
| `/migrate-optimizely execute <plan-file>` | Execute a plan interactively |

---

## Migration Overview (MUST display at start of `plan flags` or `plan code`)

**Every time** the user runs `plan flags` or `plan code`, display this
overview FIRST — before doing any work.

```
═══════════════════════════════════════════════════════════════
  Optimizely → Confidence Migration
═══════════════════════════════════════════════════════════════

  The migration happens in two phases: flags first, then code.

  ┌─────────────────────────────────────────────────────────┐
  │  PHASE 1 — Flag Definitions                            │
  │                                                        │
  │  Move all flags, targeted-delivery rollouts, and A/B   │
  │  tests from Optimizely to Confidence with their        │
  │  audiences, traffic allocation, variations, and        │
  │  variable values.                                      │
  │                                                        │
  │  Steps:                                                │
  │    1. Scan Optimizely (flags, rulesets, audiences)     │
  │    2. Choose a Confidence client (your app)            │
  │    3. Map the bucketing ID to an entity field          │
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
**cannot** express a few Optimizely constructs faithfully: partial
traffic allocation with true fall-through (a rollout or A/B test whose
non-included traffic should continue to the next rule rather than be
served the default), reusable audiences shared across many flags, and
mutual-exclusion groups. To migrate those faithfully, the skill uses the
Confidence **management REST API** (`https://flags.confidence.dev/v1`),
which needs a short-lived access token obtained via the
client-credentials flow.

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
   Optimizely token).

## Two execution backends (MCP vs REST)

Phase 1 has two ways to write to Confidence. Pick per flag based on what
the flag needs — the plan records which backend each flag uses.

| Backend | Use when | Auth | Limitations |
|---------|----------|------|-------------|
| **MCP** (default) | Flags whose rules are 100%-allocated, with inline audience targeting | OAuth (`mcp__confidence__*`) | No partial allocation with fall-through, no reusable audiences/segments, no exclusivity groups |
| **REST** (full-fidelity) | Anything needing partial traffic allocation with fall-through, reusable audiences shared across flags, or exclusion-group mutual exclusion | Bearer token (above) | More verbose; segments must be allocated before use |

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
- Do NOT echo any user-provided secret (API tokens) back into the
  conversation or write them to the plan file — store them only as
  environment variables for the session
- DO say things like: "Creating flag with rule: plan equals 'pro' AND country is US or UK"
- DO describe rules in plain English: "app version is at least 1.2.0", "country is US or CA"
- The plan FILE may contain MCP command payloads (for machine execution),
  but conversation output must be human-friendly

## Prerequisites: Optimizely Side

Optimizely does not publish a Claude MCP server, so the migration talks
to Optimizely's **REST API** directly using `curl` from the Bash tool.

### Required

1. An **Optimizely API token** (a Personal Access Token, or a Service
   Account token). Created in the Optimizely app under **Account
   Settings > API Access** (`app.optimizely.com` → profile → API
   Access). The token needs read access to flags, rulesets, and
   audiences.
2. The **Project ID** of the Optimizely Feature Experimentation project
   to migrate. Find it in the app URL:
   `https://app.optimizely.com/v2/projects/<PROJECT_ID>/flags/list`.
3. Two base URLs are used (both authenticate with the same token):
   - **Flags API** — `https://api.optimizely.com/flags/v1` (flags,
     rulesets, rules, variations, environments)
   - **Platform API v2** — `https://api.optimizely.com/v2` (audiences,
     projects)

**Authentication header (both APIs):**
- `Authorization: Bearer <api-token>`

### ASK the user (only if not already provided)

> To read your Optimizely flags, rollouts, and experiments, I need:
> 1. An Optimizely **API token** (Account Settings > API Access — a
>    Personal Access Token is fine, with read access).
> 2. Your **Project ID** (the number in the app URL, e.g.
>    `app.optimizely.com/v2/projects/<PROJECT_ID>/flags/list`).
>
> Paste the token here, or set it in your shell as `OPTIMIZELY_API_TOKEN`
> before continuing, and tell me the project ID.

### Storing the token

Once provided, store the token for the session in the environment
variable `OPTIMIZELY_API_TOKEN` (export it in the Bash session the agent
uses) and reference it via `$OPTIMIZELY_API_TOKEN` in every `curl` call —
never hardcode the token into the plan file, the conversation output, or
any committed file. If the user pastes a token inline, scrub it from the
plan file and only keep a placeholder like `<your-optimizely-api-token>`.
(See also the "never echo secrets" rule in the User-Facing Communication
Rules above.) The project ID is not a secret and may be written to the
plan.

### Smoke test before scanning

```bash
curl -sS -H "Authorization: Bearer $OPTIMIZELY_API_TOKEN" \
  "https://api.optimizely.com/flags/v1/projects/$OPTIMIZELY_PROJECT_ID/flags?per_page=1" \
  | head -c 200
```

If this returns a `401`/`403` or an HTML error page, stop and surface
the error to the user — do not start scanning.

### Local testing (no Optimizely account needed)

For development and CI smoke tests, this skill ships with a fake
Optimizely REST API server under
`skills/migrate-optimizely/test-fixtures/`. It implements the read
endpoints with curated fixtures that exercise every operator-mapping
branch. See that directory's `README.md` for usage — short version is
`python3 server.py`, then point this skill at `http://127.0.0.1:4100`
when prompted for the base URL (the fake server serves both the
`/flags/v1` and `/v2` routes on one port).

---

## Optimizely REST API Reference

The migration uses these endpoints. All require
`-H "Authorization: Bearer $OPTIMIZELY_API_TOKEN"`. `PROJECT_ID` is the
project being migrated; `ENV_KEY` is an environment key (e.g.
`production`).

> **Source of truth.** Field names and shapes here are taken from
> Optimizely's published API docs at
> <https://docs.developers.optimizely.com/feature-experimentation/reference>.
> Refer back to it if you encounter a field that isn't documented below.

| Purpose | Endpoint |
|---------|----------|
| List flags (paginated) | `GET {flags}/projects/{PROJECT_ID}/flags?per_page=100&page=<n>` |
| Get one flag (variable definitions, environments) | `GET {flags}/projects/{PROJECT_ID}/flags/{FLAG_KEY}` |
| List a flag's variations | `GET {flags}/projects/{PROJECT_ID}/flags/{FLAG_KEY}/variations` |
| Get the ruleset for a flag in an environment | `GET {flags}/projects/{PROJECT_ID}/flags/{FLAG_KEY}/environments/{ENV_KEY}/ruleset` |
| List audiences (paginated) | `GET {v2}/audiences?project_id={PROJECT_ID}&per_page=100&page=<n>` |
| Get one audience | `GET {v2}/audiences/{AUDIENCE_ID}` |
| List environments | `GET {v2}/environments?project_id={PROJECT_ID}` |

`{flags}` = `https://api.optimizely.com/flags/v1`,
`{v2}` = `https://api.optimizely.com/v2`.

**Convention.** Field names are `snake_case`. Flag keys may be
`snake_case` or `kebab-case` and IDs are integers. **Percentages are in
basis points out of 10000** (`10000` = 100%, `5000` = 50%, `2500` =
25%). Audience `conditions` is a **JSON-encoded string** (parse it, then
walk it). The list endpoints return `{ "items": [...], "page": N,
"total_pages": M, ... }`.

### Optimizely's flag model

Optimizely Feature Experimentation has one configurable type — the
**flag** — but a flag's behavior in each environment is governed by an
ordered **ruleset**. All become Confidence flags:

| Optimizely concept | What it is | Confidence flag shape |
|--------------------|-----------|-----------------------|
| **Flag** (no variables) | Boolean on/off feature | Boolean flag (`{ enabled }`); variations `on`/`off` |
| **Flag with variables** | Returns typed variable values | Struct flag; one property per variable; each **variation** → a variant carrying its variable values |
| **Targeted delivery rule** | Roll a flag out to an audience at a % | One targeting rule: audience → payload, rollout % → variant split |
| **A/B test rule** | Experiment with weighted variations | One targeting rule: audience → payload, variation split by `percentage_included` |

> **Groups (exclusion groups).** Optimizely can place several rules/
> experiments in a **mutually exclusive group** sharing a traffic budget.
> Migrate each rule as its own Confidence targeting rule. The mutual
> exclusion maps to a Confidence **exclusivity group** via segment
> coordination on the **REST** backend — see "Exclusion-group mutual
> exclusion" under "Full-Fidelity Phase 1 via the Confidence REST API".
> On the MCP backend, mutual exclusion can't be reproduced; record the
> shared group as a note and surface the gap.

### The Flag object

- `key` (string used in code as the flag name), `name`, `description`
- `archived` (boolean) — archived flags are skipped by default
- `variable_definitions` — map of `key → { type, default_value }`.
  `type` is one of `boolean`, `string`, `integer`, `double`, `json`.
  `default_value` is always a **string** (parse per `type`). A flag with
  no variables (or a single boolean variable) is a boolean flag.
- `environments` — map of `env_key → { enabled, status, rules_detail[],
  priority }`. `enabled` is whether the flag is ON in that environment.
  Each flag has a **separate ruleset per environment** — the migration
  reads the ruleset for the chosen environment (Step 1).

### The Variation object (from `.../variations`)

- `key` (e.g. `on`, `off`, or a custom variation key), `name`
- `variables` — map of `variable_key → { value }` (the variable values
  this variation serves). For a bare boolean flag the variations are
  `on` (feature enabled) and `off` (feature disabled) with no variables.

### The Ruleset object (per environment)

- `rules` — map of `rule_key → Rule` (see below)
- `rule_priorities` — **ordered list of rule keys, first wins.**
  Confidence evaluates targeting rules top-down, so emit one rule per
  Optimizely rule in `rule_priorities` order.
- `enabled` — whether the ruleset (flag in this environment) is live. If
  `false`, migrate the flag but keep it OFF (see disabled handling).
- `default_variation_key` / `default_variation_name` — the variation
  served when **no rule matches** (typically `off`). Maps to the
  catch-all final rule's variant.

### The Rule object

- `key`, `name`
- `type` — `targeted_delivery` (rollout), `a/b` (experiment),
  `multi_armed_bandit` (adaptive — see notes), `feature_test` (legacy
  experiment, treat like `a/b`)
- `enabled` — a disabled rule contributes nothing; skip it (but keep the
  catch-all default)
- `percentage_included` — **rule-level traffic allocation** in basis
  points (10000 = 100%). For `targeted_delivery` this is the rollout
  percent; for `a/b` this is the percent of matched users who enter the
  experiment.
- `variations` — map of `variation_key → { percentage_included,
  variation_id }`. `percentage_included` here (basis points) is the
  split **within** the included traffic and sums to 10000 across the
  rule's variations. A `targeted_delivery` rule usually has a single
  `on` variation at 10000.
- `audience_conditions` — the audience targeting (see "Audience
  conditions"). Empty `[]` means "everyone".
- `audience_ids` — the numeric ids referenced by `audience_conditions`.
- `distribution_mode` — `manual` (fixed split), `stats_accelerator` /
  `stats_engine` (adaptive — snapshot the current split and note it).

**Pagination.** Optimizely uses `page` (1-based) + `per_page` (≤ 100).
List responses carry `items[]`, `page`, and `total_pages`:

```
page = 1
LOOP:
  resp = GET .../flags?per_page=100&page=<page>
  process resp.items
  if page >= resp.total_pages OR resp.items is empty → STOP
  page += 1 → continue LOOP
```

Repeat the loop for `flags` AND `audiences`.

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
  [1] Scan Optimizely  ○ pending
  [2] Choose client    ○ pending
  [3] Map bucketing ID ○ pending
  [4] Generate plan    ○ pending
────────────────────────────────────────────────────────────
```

Example after Step 1 completes:
```
───── Plan Flags ──────────────────────────────────────────
  [1] Scan Optimizely  ✓ 12 flags, 4 audiences (env: production)
  [2] Choose client    ◉ in progress
  [3] Map bucketing ID ○ pending
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
  Optimizely flag keys often use `snake_case` (`new_checkout_flow`);
  normalize to hyphens (`new-checkout-flow`) and record the mapping in
  the plan so the code phase can find the right replacement.
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

Both `plan flags` and `plan code` use a progressive plan file. Created
at Step 1, updated after each step, so a closed session can resume.

### Resume check (MUST do first)

Before starting any plan workflow, check for an existing in-progress
plan:

- `plan flags` → `.claude/plans/optimizely-flag-migration-*.md`
- `plan code`  → `.claude/plans/optimizely-code-migration-*.md`

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

The migration follows a 4-step plan flow: Step 1 scan Optimizely (and
pick the environment), Step 2 choose a Confidence client, Step 3 map the
bucketing ID, Step 4 generate the MCP commands.

### Plan-file path

`.claude/plans/optimizely-flag-migration-<date>.md`

### Step 1: Scan Optimizely

**Step 1a — pick the environment.** Optimizely keeps a separate ruleset
per environment (e.g. `development`, `production`). List environments and
ASK which one to migrate (default: `production`):

```bash
curl -sS -H "Authorization: Bearer $OPTIMIZELY_API_TOKEN" \
  "https://api.optimizely.com/v2/environments?project_id=$OPTIMIZELY_PROJECT_ID"
```

Record the chosen `ENV_KEY` in the plan — every ruleset fetch uses it.

**Step 1b — list all flags. CRITICAL: paginate until exhausted.**

```
page = 1
LOOP:
  resp = GET .../projects/{PROJECT_ID}/flags?per_page=100&page=<page>
  process resp.items
  if page >= resp.total_pages OR resp.items empty → STOP
  page += 1 → continue LOOP
```

```bash
curl -sS -H "Authorization: Bearer $OPTIMIZELY_API_TOKEN" \
  "https://api.optimizely.com/flags/v1/projects/$OPTIMIZELY_PROJECT_ID/flags?per_page=100&page=1"
```

Ask once up-front: "Include archived flags too? Default: no". Skip flags
whose `archived` is `true` unless the user opts in.

**Step 1c — for each flag, fetch its variations and the ruleset for the
chosen environment (in batches of 5).**

```bash
# variations (variable values per variation)
curl -sS -H "Authorization: Bearer $OPTIMIZELY_API_TOKEN" \
  "https://api.optimizely.com/flags/v1/projects/$OPTIMIZELY_PROJECT_ID/flags/<FLAG_KEY>/variations"
# ruleset for the chosen environment (rules, priorities, default variation)
curl -sS -H "Authorization: Bearer $OPTIMIZELY_API_TOKEN" \
  "https://api.optimizely.com/flags/v1/projects/$OPTIMIZELY_PROJECT_ID/flags/<FLAG_KEY>/environments/<ENV_KEY>/ruleset"
```

**After each batch of 5**, write the data to the plan file — append the
sections to Section 4. This way if the session closes mid-scan, the
flags fetched so far are saved.

Extract from each flag:

- `key`, `name`, `description`
- `variable_definitions` — determines the Confidence flag shape (boolean
  vs struct; see "Optimizely's flag model")
- the variations and their variable values
- the chosen environment's ruleset: `rule_priorities` (order),
  `default_variation_key`, and `enabled`
- For each rule (in `rule_priorities` order): `type`,
  `percentage_included`, the `variations` split, `audience_conditions` /
  `audience_ids`, `enabled`, `distribution_mode`
- Whether the flag needs the **REST backend** (partial allocation that
  must fall through, reusable audiences, or an exclusion group) — record
  the backend on the flag's plan entry so `execute` knows which path to
  take

**Step 1d — fetch referenced audiences (once per unique id).** While
scanning rules, collect every `audience_id` referenced by any rule's
`audience_conditions`. For each unique id:

```bash
curl -sS -H "Authorization: Bearer $OPTIMIZELY_API_TOKEN" \
  "https://api.optimizely.com/v2/audiences/<AUDIENCE_ID>"
```

Parse the audience's `conditions` (a JSON-encoded string) and translate
its conditions with the operator table. The Confidence MCP in this plugin
has no `createSegment` tool, so **inline** the audience's conditions into
each referencing flag's targeting (see "Audiences"). On the REST backend,
a reusable audience referenced by many flags becomes one Confidence
segment.

**Bucketing ID.** Optimizely buckets each user on the ID passed to the
SDK (`decide` / `activate`), optionally overridden by a `$opt_bucketing_id`
attribute. There is no per-flag unit type — the user maps the bucketing
ID to one Confidence entity field in Step 3.

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

### Step 3: Map Bucketing ID (Optimizely-specific)

This step maps Optimizely's bucketing ID (the user ID handed to the SDK)
to a Confidence entity field.

**EDUCATE then ASK:**

> **What is a randomization unit (entity)?**
> An entity is the "thing" that gets randomly assigned to a variant —
> usually a user. The entity field (like `user_id` or `visitor_id`) is
> the identifier Confidence uses to ensure **consistent assignment**: the
> same user always sees the same variant.
>
> In Confidence, it maps to the `targetingKey` in the evaluation context.
>
> In Optimizely, every flag buckets on the **user ID** you pass to
> `decide()` (or a `$opt_bucketing_id` override).
>
> Common choices:
> - **user_id** — for authenticated users
> - **visitor_id** — for anonymous visitors (auto-generated by Confidence
>   client SDKs)
> - **company_id** — for a company/org/tenant unit
>
> Your client's existing entity fields:
> 1. <entity-field-1>
> 2. <entity-field-2>
> ...
> N. Create a new field
>
> Which Confidence field represents the Optimizely user/bucketing ID?

Same wait-for-explicit-pick rule as Step 2 above. Silence is not
consent.

- If user picks existing → use it as `targetingKey`
- If user wants new → ASK for name + type → `mcp__confidence__addContextField`
  (always provide an explicit `entityReference` — see Confidence Naming
  Rules above)

### Step 4: Generate MCP commands

**Confirmation gate (MUST pass before generating).** Before writing the
Flags to Migrate section, summarize the choices made in earlier steps
(environment, client, bucketing-ID → entity mapping) and ask:

> Plan will assume environment `<env>`, client `<client>`, with the
> Optimizely user ID → entity `<entity>`. All flags will be defaulted to
> `[ ] Migrate  [ ] Skip` (neither pre-checked) — you'll opt each one in
> during review. Confirm or change?

Set the step to `⏸ awaiting user` and stop. Only proceed on an explicit
`yes` / `confirm` / equivalent. A re-run or ambiguous reply is **not**
confirmation.

For each flag, generate the MCP command payloads (`createFlag`,
`addFlagToClient`, `addTargetingRule`, `resolveFlag`) using the Operator
Mapping table together with the Confidence Targeting Payload Format
(below). Write them into each flag's section in the plan.

**After all commands generated:** Update Generation Status step 4 to
`✓ complete`, set the overall status to `complete`, and tell the user:

> Plan generated! Review it at `.claude/plans/optimizely-flag-migration-<date>.md`
>
> Migration is **opt-in**: every flag starts with both checkboxes empty.
> Tick `[x] Migrate` or `[x] Skip` for each flag — `execute` will refuse
> any flag with neither box set. When ready, run:
> `/migrate-optimizely execute <plan-file>`

**Rule → targeting-rule order.** Optimizely rules form a waterfall —
the first matching rule (by `rule_priorities`) wins. Confidence
evaluates targeting rules in declared order, so emit one
`addTargetingRule` call per Optimizely rule, in the same order.

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

> **No working presence operator.** A bare attribute criterion with **no
> inner rule** (`{ "attribute": { "attributeName": "X" } }`) is *accepted*
> by `addTargetingRule` but stores with `operator: "unknown"` and
> **errors at resolve** (verified live: the rule returns
> `Status: ERROR — Resolve status unknown` and is treated as no-match).
> So there is **no reliable "attribute exists / is null" targeting** via
> the current tooling — do NOT emit ruleless criteria. Map Optimizely's
> `exists` match type to **BLOCKED** (see Operator Mapping).

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

**Existence / null checks are NOT supported.** A bare attribute
criterion with no inner rule (`{ "attribute": { "attributeName": "X" } }`)
looks like a presence check, but it is **broken at resolve**: it stores
with `operator: "unknown"` and the resolver returns
`Status: ERROR — Resolve status unknown`, which is treated as no-match
(verified live against the resolver). There is therefore **no reliable
way to target "attribute is set" or "attribute is null/absent"**. Do NOT
emit ruleless criteria. Map Optimizely's `exists` match type (and any
negated-exists) to **BLOCKED** — see the Operator Mapping table and the
Blocked section.

### Default value (no server-side default → emit a catch-all rule)

Confidence has **no server-side flag default**. The `Flag` resource
carries variants and an ordered list of rules but no default-value
field. The resolver's contract is explicit: *"each rule is tried in
order; the first match assigns a variant; if no rule matches, no variant
is assigned."* When no rule matches, the SDK returns **the default the
caller passed at the call site** (e.g. `decide` falls back to the
flag-off default).

So an Optimizely default — the ruleset's `default_variation_key`
(typically `off`) — does **not** map to any flag-level field. To
preserve it faithfully, emit it as an explicit **catch-all final rule**:

- `addTargetingRule` with `variantAllocations` =
  `{ "<defaultVariant>": 100 }` and **no `payload`** (an omitted/empty
  payload targets all contexts).
- Add it **last**, after every specific rule, so it only catches
  subjects that matched nothing above it.

For a **boolean flag**, the catch-all variant is `disabled` (`off`) —
reached only by users who matched **no** rule. For a **flag with
variables**, the catch-all variant carries the `default_variation`'s
variable values (usually the `off` variation's values).

### Expression combinators

| Pattern | Expression |
|---------|-----------|
| Single condition | `{ "ref": "ref-0" }` |
| AND | `{ "and": { "operands": [{ "ref": "ref-0" }, { "ref": "ref-1" }] } }` |
| OR | `{ "or": { "operands": [{ "ref": "ref-0" }, { "ref": "ref-1" }] } }` |
| NOT | `{ "not": { "ref": "ref-0" } }` |
| NOT IN (list) | Prefer one `setRule` criterion wrapped in `not`: `{ "not": { "ref": "ref-0" } }`. |
| attribute IS null / IS set | **Not supported** — ruleless presence criteria error at resolve (see "Existence / null checks"); BLOCK these. |

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

## Audiences

An Optimizely **audience** is a named, reusable targeting condition.
Confidence **has** reusable segments, but the **MCP** backend in this
plugin exposes no `createSegment` tool. So the handling depends on the
backend:

- **REST backend (preferred for reuse):** create one Confidence segment
  per Optimizely audience and reference it from every flag that uses it —
  see "Audiences as reusable segments" under "Full-Fidelity Phase 1 via
  the Confidence REST API". This preserves reuse/de-duplication.
- **MCP backend (inline fallback):** with no `createSegment` tool,
  **inline** the audience's conditions into each referencing flag. Parse
  the audience's `conditions` string, translate each leaf condition with
  the operator table, and combine them per the condition language's
  `and` / `or` / `not` operators into the flag's `criteria` +
  `expression`. Repeat the inlined criteria in each referencing flag (no
  de-dup without a segment primitive — note in the plan).

### Audience condition language

An audience's `conditions` is a **JSON-encoded string**. Parse it first.
The structure is a nested list whose first element is an operator:

```
["and", cond_or_list, cond_or_list, ...]
["or",  cond_or_list, cond_or_list, ...]
["not", cond_or_list]                       # exactly one operand
{ ...leaf condition... }
```

A `["and", X]` / `["or", X]` with a single operand just matches `X`.
Optimizely's UI commonly emits deeply nested wrappers like
`["and", ["or", ["or", {leaf}]]]` — flatten single-operand wrappers
when translating.

**Leaf condition (custom attribute):**

```json
{ "type": "custom_attribute", "name": "<attr>", "match_type": "<mt>", "value": <v> }
```

- `name` → the Confidence attribute name (the evaluation-context field).
- `match_type` → the rule shape (see Operator Mapping).
- `value` → the comparison value (string, number, or boolean).
- A missing `match_type` defaults to `exact` when a `value` is present,
  or `exists` when no value is present.

**Audience references (combinations).** A rule's `audience_conditions`
may also contain `{ "audience_id": <id> }` leaves that reference whole
audiences. Resolve each referenced audience and inline its conditions
(MCP), or reference the corresponding Confidence segment (REST), then
combine with the surrounding `and` / `or` / `not`.

**Non-custom-attribute leaves.** Optimizely Web audiences can use
`type`s like `browser`, `device`, `query`, `cookie`, `location`. In
Feature Experimentation, audiences are almost always `custom_attribute`
(the SDK passes attributes explicitly). Any non-`custom_attribute` leaf
has no Confidence equivalent — mark it **BLOCKED** for manual review.

## Multivariant / Traffic Allocation Handling

**CRITICAL — there is no separate `rolloutPercentage` knob.** The
Confidence `addTargetingRule` tool takes only `variantAllocations` (a
map of variant → percent that **must sum to exactly 100**), `payload`,
and `targetingKey`. Encode the entire rollout or variation split *inside*
`variantAllocations` — do NOT expect a rule-level rollout field.

**Percentages are basis points in Optimizely.** Divide by 100:
`percentage_included` 10000 → 100, 5000 → 50, 2500 → 25.

- **Targeted-delivery rule** (rollout): ONE Confidence rule with the
  audience as `payload` and `variantAllocations` =
  `{ "<on-variant>": <pct>, "<off/default-variant>": <100 − pct> }`,
  where `pct` is the rule's `percentage_included / 100`. A 100% rollout
  is `{ "<on>": 100 }`. An empty `audience_conditions` ("everyone") is
  the same but with **no payload** (targets all).
- **A/B test rule** (experiment): ONE Confidence rule (audience as
  `payload`, or no payload) with `variantAllocations` = each variation's
  key → its `percentage_included / 100` (e.g.
  `{ "off": 50, "on": 50 }`). If the rule-level `percentage_included` is
  < 100 (partial allocation), see the note below.

**Do NOT create separate rules per variant.** One targeting rule = one
set of targeting conditions, with the variant split defined inside that
rule via `variantAllocations`.

### Partial / fall-through allocation (`percentage_included` < 100)

Optimizely's waterfall has **true fall-through**: a user who matches a
rule's audience but isn't in its `percentage_included` traffic continues
to the **next** rule in `rule_priorities`. The MCP backend can't be
exact (`variantAllocations` must sum to 100, no rollout knob).

- If the un-included traffic in Optimizely would just land on the
  default variation anyway (the common case for the last/"everyone"
  rule), the MCP approximation is faithful: fold the remainder into the
  default variant inside `variantAllocations`.
- If un-included traffic must **fall through to a later rule**, **prefer
  the REST backend**, which represents it exactly via a segment
  `allocation.proportion` + variant bucket ranges (users not in the
  segment fall through to the next rule) — see "Partial allocation with
  fall-through" under "Full-Fidelity Phase 1 via the Confidence REST
  API". If REST isn't available, fall back to the MCP approximation and
  **record that it's approximate** in the plan.

### Adaptive distribution (`multi_armed_bandit` / `stats_accelerator`)

When `type` is `multi_armed_bandit`, or `distribution_mode` is
`stats_accelerator` / `stats_engine`, Optimizely adjusts the split
dynamically. Confidence allocations are static, so **snapshot the
current `percentage_included` split** as the `variantAllocations` and
**note in the plan** that the live split was adaptive (it won't keep
auto-tuning after migration).

## Operator Mapping (Optimizely → Confidence)

This is how Optimizely audience conditions map to the Confidence
targeting payloads defined above. Within an audience, leaves are combined
by the condition language's `and` / `or` / `not`. Across rules in a
flag's ruleset, the waterfall means each rule becomes a **separate
Confidence targeting rule** in `rule_priorities` order.

A leaf is `{ type: "custom_attribute", name, match_type, value }`. The
**`name`** selects the attribute; the **`match_type`** selects the rule
shape; the JSON type of **`value`** selects the `Value` type
(`stringValue` / `numberValue` / `boolValue`).

### `match_type` → Confidence rule shape

| Optimizely `match_type` | Confidence payload strategy |
|---|---|
| `exact` (string) | one criterion `eqRule` with `stringValue`, expression `ref` |
| `exact` (number) | one criterion `eqRule` with `numberValue`, expression `ref` |
| `exact` (boolean) | one criterion `eqRule` with `boolValue`, expression `ref` |
| `exists` | **BLOCKED** (no working presence operator — ruleless criteria error at resolve) |
| `gt` | `rangeRule.startExclusive: { numberValue: N }` |
| `ge` | `rangeRule.startInclusive: { numberValue: N }` |
| `lt` | `rangeRule.endExclusive: { numberValue: N }` |
| `le` | `rangeRule.endInclusive: { numberValue: N }` |
| `semver_eq` | `eqRule.value.versionValue: { version }` |
| `semver_gt` | `rangeRule.startExclusive: { versionValue: { version } }` |
| `semver_ge` | `rangeRule.startInclusive: { versionValue: { version } }` |
| `semver_lt` | `rangeRule.endExclusive: { versionValue: { version } }` |
| `semver_le` | `rangeRule.endInclusive: { versionValue: { version } }` |
| `substring` | **BLOCKED** (Confidence has no substring/contains rule) |
| `regex` | **BLOCKED** (Confidence has no general regex rule) |

**Negation.** A leaf inside a `["not", ...]` list is wrapped in `not` in
the Confidence expression. `["not", {exact value}]` is "not equals" (a
real `eqRule` under `not`, which works). `["not", {exists}]` ("attribute
is null/absent") is **BLOCKED** — it depends on the unsupported presence
criterion.

**Set membership.** Optimizely expresses "is one of" as an `["or", ...]`
of `exact` leaves on the same attribute. Collapse those into a single
`setRule` (preferred), or keep them as an `or` of `eqRule`s — both
resolve identically.

**Booleans.** Optimizely attributes are untyped; a boolean audience uses
`value: true/false` with `match_type: exact`. Map to `boolValue`. The
evaluation context must send a real boolean (not the string `"true"`).

### Blocked (manual review)

These genuinely have no clean Confidence translation:

- **`substring`** — Confidence has no substring/contains rule. Reason:
  `Uses a 'contains' match on '<attribute>'; Confidence has no substring
  rule.` (Workaround: change the context field to send a list of strings
  and use set matching.)
- **`regex`** — Confidence has no general regex rule. Reason: `Uses a
  regex on '<attribute>'; Confidence has no general regex rule.`
- **`exists`** (and negated-exists) — Confidence has no working presence
  operator; a ruleless attribute criterion stores as `operator: unknown`
  and errors at resolve. Reason: `Uses an 'exists'/presence match on
  '<attribute>'; Confidence has no presence operator.` (Workaround: if
  the attribute has a small known set of values, target those explicitly
  with a `setRule`; otherwise migrate manually.)
- **Non-`custom_attribute` audience leaves** (`browser`, `device`,
  `query`, `cookie`, `location`, ODP `qualified` segments) — no
  Confidence equivalent. Reason: `Uses a '<type>' audience condition with
  no Confidence equivalent; migrate manually.`

When a rule/condition is blocked, mark it in Section 4 (per the
template). A flag is fully blocked only when *every* non-default rule is
blocked.

### Worked example (ruleset waterfall)

A two-rule flag — a targeted-delivery rollout to a "Beta users" audience
at 25%, then an "everyone" rollout at 100% — becomes `addTargetingRule`
calls plus a catch-all (the split lives entirely in `variantAllocations`;
there is no separate rollout field):

1. Rule 1 (`targeted_delivery`, `percentage_included` 2500, audience
   "Beta users" = `is_beta exact true`) → payload `eqRule boolValue
   true` on `is_beta`, `variantAllocations { "on": 25, "off": 75 }`
2. Rule 2 (`targeted_delivery`, `percentage_included` 10000, no
   audience) → no payload, `variantAllocations { "on": 100 }`
3. Catch-all (default): no payload → `off` at 100%. Reproduces the
   ruleset's `default_variation` (`off`); MUST come last. (When Rule 2
   already covers everyone at 100%, the catch-all is only reached if no
   earlier rule matched — keep it for safety / disabled-flag cases.)

---

## Full-Fidelity Phase 1 via the Confidence REST API

Use this path for the constructs the MCP can't express: partial traffic
allocation with fall-through, reusable audiences shared across flags, and
exclusion-group mutual exclusion. It needs the `CONFIDENCE_TOKEN` from
"Prerequisites: Confidence Side". Base URL
`https://flags.confidence.dev/v1`; every call sends
`-H "Authorization: Bearer $CONFIDENCE_TOKEN"`.

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
      { "variant": { "variant": "flags/<flag>/variants/off" }, "bucketRanges": [{"lower":0,"upper":50}] },
      { "variant": { "variant": "flags/<flag>/variants/on" }, "bucketRanges": [{"lower":50,"upper":100}] }
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
  not in the segment fall through to the next rule — this is exactly
  Optimizely's `percentage_included` fall-through behavior.
- Special assignments: `{"fallthrough":{}}` (matched → continue to next
  rule) and `{"clientDefault":{}}` (serve the caller's default).
- **Rules start disabled.** Enable each with
  `PATCH /v1/flags/<flag>/rules/<ruleId>?updateMask=enabled` body
  `{"enabled":true}`. Order via the `priority` field (lower = first).
- Flags/variants still need to exist first — create them with the MCP
  `createFlag` (recommended, since it also wires the client) or via
  `POST /v1/flags`. Either way the REST rules then reference
  `flags/<flag>/variants/<variant>`.

### Audiences as reusable segments

Create once, allocate, reference from many flag rules:

```bash
# segment from an Optimizely audience's conditions
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
- **De-duplicate:** an Optimizely audience referenced by N flags becomes
  ONE Confidence segment, referenced N times. Track the
  `optimizely-audience-id → segments/<id>` map in the plan.
- **Composing audiences (e.g. audience A AND NOT audience B in one
  rule):** a REST flag rule references exactly ONE segment, but segment
  targeting supports **segment criteria** — create a wrapper segment
  whose expression combines the reusable ones:

  ```json
  "targeting": {
    "criteria": { "s0": { "segment": { "segment": "segments/beta-users" } },
                   "s1": { "segment": { "segment": "segments/internal-staff" } } },
    "expression": { "and": { "operands": [ { "ref": "s0" }, { "not": { "ref": "s1" } } ] } }
  }
  ```

### Partial allocation with fall-through

A rule whose `percentage_included` < 100 and whose un-included traffic
must fall through to a later rule maps exactly:

1. Create a segment for the rule's audience targeting (or empty
   `targeting: {}` for "everyone"), with `allocation.proportion =
   percentage_included / 10000` (e.g. `"0.25"` for 2500 basis points).
2. Allocate the segment.
3. Add a flag rule referencing it whose `assignmentSpec` splits the
   variations across the full `0–100` bucket range by their
   `percentage_included` (basis points).
4. Subsequent rules (the next entries in `rule_priorities`) become later
   rules — users not in the segment fall through to them, exactly like
   Optimizely.

This reproduces "25% get the rollout, the other 75% fall through to the
next rule" faithfully, which the MCP `variantAllocations` (sum-to-100, no
rollout knob) cannot.

### Exclusion-group mutual exclusion

Optimizely **exclusion groups** make their experiments mutually
exclusive. Map each group to a Confidence **exclusivity group** via
segment coordination: every rule in group `G` gets a segment whose
`allocation` carries matching coordination tags:

```json
"allocation": { "proportion": { "value": "0.5" },
                "exclusivityTags": ["<group-id>"],
                "exclusiveTo": ["<group-id>"] }
```

Segments sharing an `exclusivityTags`/`exclusiveTo` group never overlap —
no user lands in two of the group's experiments. The sum of proportions
across a coordination group must fit in 100% (allocation can fail
otherwise — surface that to the user). Record the
`group-id → exclusivity tag` mapping in the plan.

### Verification

REST-created flags resolve through the same client. Verify with the MCP
`resolveFlag` (positive + negative + waterfall) exactly as the MCP path
does — the resolve behavior is identical regardless of which backend
wrote the rules.

---

## Plan Flag: Template

```markdown
# Optimizely to Confidence Flag Migration Plan

**Created:** <date>
**Scope:** Flag definitions only
**Optimizely project:** <PROJECT_ID>
**Environment:** <env-key>

---

## Generation Status

| Step | Status | Result |
|------|--------|--------|
| 1. Scan Optimizely | ○ not started | |
| 2. Choose client | ○ not started | |
| 3. Map bucketing ID | ○ not started | |
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

## 2. Bucketing ID Mapping

An entity is the "thing" being randomly assigned to a variant — usually
a user. The entity field (like `user_id` or `visitor_id`) is the
identifier Confidence uses for consistent assignment: the same subject
always sees the same variant.

Optimizely buckets on the user ID passed to the SDK; it maps to one
Confidence entity field.

| Optimizely bucketing ID | Confidence entity field |
|-------------------------|-------------------------|
| user id (`decide`) | `<selected-entity>` |

---

## 3. Context Schema

The context schema defines what fields Confidence expects in the
evaluation context when resolving flags — the custom attributes the
audiences use (e.g. `country`, `plan`, `appVersion`).

> Note: Optimizely attributes are untyped and passed explicitly by your
> SDK calls. Confidence needs these in the evaluation context with the
> right type (string/number/boolean/version) — Phase 2 must supply them.

### Already in Confidence

| Field | Type | Entity | Optimizely attribute |
|-------|------|--------|----------------------|
<matching fields>

### Need to Create

| Field | Type | Entity | Optimizely attribute |
|-------|------|--------|----------------------|
<missing fields — execute will create these>

### Confidence-only (not in Optimizely)

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

**Description:** <from Optimizely if available, otherwise empty>
**Backend:** <MCP (default) / REST — REST is required for partial allocation with fall-through, reusable audiences, or exclusion-group exclusivity>
**Confidence schema:** <e.g. `{ enabled: boolean }` for a boolean flag; the variable shape for a flag with variables>
**Variants:** <variant list — e.g. "on, off" for a boolean flag; variation keys for a flag with variations, each carrying its variable values>
**Confidence resolve path:** `<flag-key>.<property>` (Phase 2 reads this; `.enabled` for boolean flags, `.<variable>` per variable)
**Unit:** Optimizely user id → entity `<entity>`
**Enabled in Optimizely (env `<env>`):** <yes / no — if no, set every rule's on-share to 0 (boolean flag rules become `variantAllocations { off: 100 }`) so the flag stays OFF until intentionally enabled>
**Rules (Optimizely, in priority order):**
  1. `<rule key>` (<targeted_delivery / a/b>) — <plain-English audience>, traffic <X>%, <variant split>
  2. ...
**Default:** <ruleset default_variation (e.g. off) → catch-all rule>
**Rollout/split:** <how percentage_included / variation split are encoded — variantAllocations (MCP) or segment proportion + bucketRanges (REST)>
**Audiences:** <none, or list of Confidence segments created (REST) / inlined (MCP) with the optimizely-audience-id → segments/<id> mapping>
**Exclusion group:** <none, or group-id → exclusivity tag (REST)>
**Adaptive:** <none, or "multi_armed_bandit / stats_accelerator — split snapshotted, no longer auto-tunes">
**Presence/exists conditions:** <none, or "BLOCKED — `exists`/null match on '<attr>'; Confidence has no working presence operator">
**Confidence rules:** one targeting rule per Optimizely rule, in priority order, plus a final catch-all rule for the default
**Action:** [ ] Migrate  [ ] Skip

If any rule or the whole flag is BLOCKED, replace the **Action** line
with:

**Status:** BLOCKED — <one-line reason from the BLOCKED rules above>
**Action:** [ ] Skip (no migrate option available until the block is resolved)

**Commands:**
<For MCP backend: createFlag, addFlagToClient, addTargetingRule (ONE per Optimizely rule, in priority order) THEN a final catch-all addTargetingRule (no payload, 100% → default variant). For REST backend: createFlag (MCP, to wire the client), then per audience a POST /v1/segments + :allocate, then POST /v1/flags/<flag>/rules (segment + assignmentSpec) + PATCH enabled=true, in order. Finish with resolveFlag (MCP) — positive AND negative case (negative must land on the catch-all and return the default variant)>

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
   - Bucketing-ID → entity mapping is in the plan
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
   - If the plan flags a resolve-mode CHANGE, re-surface it here and get
     an explicit acknowledgement before touching code
3. FOR EACH FLAG in the files list:
   a. Create a branch: `migrate/<flag-key>-to-confidence`
   b. Show flag name + all files using it
   c. ASK: "Transform this flag's files? [Yes / Skip / Pause]"
   d. If Yes → apply transform rules from plan to all files for this flag
   e. Run lint + typecheck on changed files
   f. Commit changes
   g. Create PR titled: "feat: migrate <flag-key> from Optimizely to Confidence"
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
    call per Optimizely rule in the SAME ORDER (rule_priorities;
    Confidence evaluates rules top-down — order is semantically
    significant).
  → Add the default LAST as a catch-all rule: addTargetingRule with
    variantAllocations { <defaultVariant>: 100 } and NO payload (empty
    payload = targets all contexts). Confidence has no flag-level default
    (see "Default value" above), so this is the only way to reproduce a
    ruleset's default_variation. It MUST come after every specific rule.
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

For flags needing partial allocation with fall-through, reusable
audiences, or exclusion-group exclusivity. Requires `CONFIDENCE_TOKEN`
(confirm it's set; if not, prompt the user — see prerequisites). Follow
the recipes in "Full-Fidelity Phase 1 via the Confidence REST API".

```
STEP 1: createFlag + client  (MCP createFlag — also wires the client and variants)
STEP 2: For each audience this flag needs (in the plan's Audiences list):
  → POST /v1/segments?segmentId=<id>  (targeting + allocation.proportion
    + exclusivityTags/exclusiveTo for exclusion-group rules)
  → POST /v1/segments/<id>:allocate   (MUST allocate before use)
  → Reuse already-created segments (check the plan's segment map) — do
    not recreate
STEP 3: For each Optimizely rule, in priority order:
  → POST /v1/flags/<flag>/rules  (segment + assignmentSpec bucketRanges
    + targetingKeySelector)
  → PATCH /v1/flags/<flag>/rules/<ruleId>?updateMask=enabled  {enabled:true}
  → Set priority so order matches the Optimizely waterfall (lower = first)
  → Add the trailing catch-all rule LAST (default variant)
STEP 4: resolveFlag (verification) — identical to the MCP sequence's
  STEP 4 (positive + negative + waterfall).
```

### Rules

- **NEVER auto-continue** — always wait for user at each checkpoint
- **Flag-by-flag** — each flag is one unit (its files + tests)
- **Preserve source order** — one Confidence rule per Optimizely rule, in
  `rule_priorities` order
- **Resumable** — update the Progress table in the plan file after each step

## Execute: Optimizely-Specific Notes

**Audiences first.** REST-backend flags: create + allocate every segment
the flag references **before** adding its rules (rules reference segments
by name), reusing any already-created segment per the plan's segment map.
MCP-backend flags: the audience conditions are already inlined into the
flag's payload in the plan, so no separate step is needed — apply the
payload as written.

**Disabled-in-Optimizely handling.** If the flag's ruleset for the chosen
environment has `enabled: false`, surface that during execute:

> This flag is DISABLED in Optimizely (environment `<env>`). I'll create
> it in Confidence but keep it OFF (every rule's on-share set to 0 —
> boolean flag rules become `variantAllocations { off: 100 }`) until you
> turn it on intentionally. Continue?

**Flag shape → Confidence schema (and the resolve-path handoff to Phase
2).** A Confidence flag is a struct, not a bare scalar, so each flag needs
named **properties** that hold the migrated values:

| Optimizely flag | Confidence schema (`schemaObject`) | Resolve path |
|-----------------|------------------------------------|--------------|
| **Boolean flag** (no variables) | `{ "enabled": "boolean" }` (the `createFlag` default) | `<flag>.enabled` |
| **Flag with variables** | one property per `variable_definition` (typed by the variable's `type`) | `<flag>.<variable>` per variable |

For boolean flags, variants are `on` (`{ enabled: true }`) and `off`
(`{ enabled: false }`). For flags with variables, create one variant per
Optimizely **variation**, each carrying that variation's variable values
(`variable_definitions` give the `default_value`; the variation's
`variables` map gives the per-variant overrides). Record the resolve path
on the flag's plan entry — Phase 2's code transform reads it verbatim.

**Waterfall verification.** Because Optimizely flags often have multiple
rules, the Flag Setup Sequence Step 4 (above) requires you to also resolve
with a context that misses the first rule but matches a later one — this
verifies the waterfall (`rule_priorities`) order is preserved.

---

## Plan Code: Steps

The code phase has 5 steps: Step 1 detect language/framework, Step 2
fetch the Confidence SDK guide (and signal any resolve-mode change),
Step 3 scan the codebase for Optimizely usage, Step 4 generate transform
rules, Step 5 generate the plan.

### Step 1: Detect language & framework

```
Grep: pattern="<Optimizely import/symbol patterns from Step 3>"  → Find Optimizely usage
Glob: pattern="package.json" or "build.gradle" or "*.csproj" or "go.mod" or "pyproject.toml"/"requirements.txt" or "Gemfile" etc
Read: dependency file  → Determine language/framework AND which Optimizely SDK package
```

### Step 2: Fetch SDK guide from `confidence-docs` MCP

**Step 2a — pick the target resolve mode.** Confidence has FOUR modes,
not a local/remote binary. Pick from the language/framework detected in
Step 1, honoring the "prefer local resolve" policy (see "SDK
Preference"):

| Target mode | Confidence SDKs | How evaluation works | Network profile |
|-------------|-----------------|----------------------|-----------------|
| **In-process** (local resolve) | backend **Java, Go, JS/Node, Rust** | Periodically fetch the resolver **state** (full ruleset); evaluate locally via WASM | No per-eval network call; network only for state refresh |
| **Cached client** | **Android, iOS, web/browser JS, React, React Native** | Backend resolves; device **prefetches and caches resolved VALUES** (not the ruleset). Reads are local + offline. Context change triggers a refetch | Network on init / context change / refresh — NOT per read |
| **Server-precomputed** | server-rendered React/Next.js (RSC) | Server resolves for a bound subject; client reads resolved values offline | Resolution on the server; client reads are offline |
| **Remote** (per-call) | backend **Python, Ruby, .NET** | Each resolve is a service call to Confidence | One call per resolve (with default-value fallback on failure) |

Routing:

- Backend **and** language ∈ {Java, Go, JS/Node, Rust} → **in-process**.
  Fetch the local-resolve guide (server-only; the JS WASM provider is
  **not** for browsers):

  ```
  mcp__confidence-docs__getLocalResolveIntegrationGuide
    sdk: "JAVA" | "GO" | "JS" | "RUST"
  ```

- Client app (mobile / browser / React Native) → **cached client**.
  Backend **Python / Ruby / .NET** → **remote**. Either way fetch:

  ```
  mcp__confidence-docs__getCodeSnippetAndSdkIntegrationTips
    sdk: "<detected>"
  ```

- **Server-rendered React / Next.js (RSC)** → **server-precomputed**.
  Use Confidence's React local-resolve provider (`<ConfidenceProvider>`
  + `useFlag`); fetch `getLocalResolveIntegrationGuide sdk: "JS"`.

> **PHP / Flutter / edge.** Optimizely ships PHP, Flutter, and edge
> (Edge Worker / Agent) SDKs that Confidence does not match 1:1. If the
> detected stack has no Confidence SDK, STOP and surface it: the flags
> still migrate (Phase 1), but the code transform must be done manually
> or the app re-platformed onto a supported Confidence SDK. Record this
> in the plan rather than inventing an API.

**CRITICAL:** Include the ACTUAL MCP response in the plan, not a
reference to fetch it. Plans are self-sufficient.

**Step 2b — signal any resolve-mode CHANGE.** Compare the source mode
(defined in "Source resolve mode (Optimizely)" below) to the target mode
from 2a and, if it shifts, tell the user precisely what changes. Record
the decision and any change notice in the plan's SDK Setup section and
re-surface it at execute time before touching code. If unchanged, state
that explicitly so the user knows it was considered.

### Source resolve mode (Optimizely) — feeds the Step 2b signal

**Optimizely SDKs evaluate locally off a downloaded datafile — but
"local" means different things on server vs client; the Agent is the
exception.** Map the source surface to a mode:

- **Optimizely backend SDK** (Node/Python/Ruby/PHP/Java/Go/.NET, datafile
  in-process) → source mode = **in-process eval**.
- **Optimizely client SDK** (Swift/Android/JS browser/React/React Native,
  datafile on device) → source mode = **on-device eval** (the device
  holds the full datafile and evaluates locally).
- **Optimizely Agent** (the REST microservice exposing `/v1/decide`) →
  source mode = **remote** (per-call service eval).
- **Optimizely Edge / Cloudflare Worker** → source mode = **in-process at
  edge**.

Then the Step 2b transitions apply:

- Optimizely backend → Confidence **in-process** (Java/Go/JS/Rust): unchanged.
- Optimizely backend → Confidence **remote** (Python/Ruby/.NET): ⚠️ in-process
  → remote — each resolve becomes a service call.
- Optimizely client → Confidence **cached client** (mobile/web): ⚠️ on-device
  → cached client. Reads stay local/offline and fast (NOT per-call
  network), but evaluation moves to the backend: the device caches
  resolved values instead of the datafile, targeting changes apply on the
  next fetch, a cold first run may return defaults, and the full ruleset
  is no longer shipped to the client (a security/payload win over
  Optimizely's on-device datafile).
- Optimizely Agent (remote) → Confidence **in-process** or **remote**: note
  whether per-call network goes away (Agent → in-process) or stays
  (Agent → remote).
- Optimizely server-rendered React/Next.js → Confidence React
  **local-resolve** provider: ✅ architecture preserved (server-precomputed
  → server-precomputed). Surface as "no resolve-mode change".

### Plan-file path

`.claude/plans/optimizely-code-migration-<date>.md`

### Step 3: Scan codebase for Optimizely usage

Optimizely has **two API generations** — the modern **Decide API** and
the **legacy Full Stack API**. Scan for both:

```
Grep: pattern="optimizely|Optimizely|@optimizely" → Find Optimizely imports/packages
Grep: pattern="createInstance|OptimizelyFactory|createUserContext" → Find SDK init + user context
Grep: pattern="\.decide(All|ForKeys)?\(" → Find the DECIDE API (current FX)
Grep: pattern="isFeatureEnabled|getFeatureVariable(Boolean|String|Integer|Double|JSON)?|getAllFeatureVariables" → Find LEGACY feature API
Grep: pattern="\.activate\(|getVariation\(" → Find LEGACY experiment API (returns a variation key)
Grep: pattern="useDecision|useFeature|withOptimizely|OptimizelyProvider|OptimizelyFeature|OptimizelyExperiment" → Find REACT SDK usage
Grep: pattern="\.track\(|trackEvent\(|addNotificationListener|NotificationCenter" → Find event tracking + notification listeners
```

Run greps **case-insensitively** (`rg -i` / `Grep -i`); method casing
varies by language (Go `Decide`, Python `decide`, Java `decide`).

**The Decide API (current).** A decision is fetched per flag:

```
user = optimizely.createUserContext(userId, attributes)
decision = user.decide("flag_key")
decision.enabled            // boolean
decision.variables["var"]   // typed variable value (map; older SDKs: decision.getVariableValue("var"))
decision.variationKey       // which variation (string) — for experiments
decision.ruleKey            // which rule matched (no Confidence equivalent)
```

**The legacy Full Stack API.** Pre-`decide`, evaluation is per call with
`userId` + `attributes` passed each time:

```
optimizely.isFeatureEnabled("feature_key", userId, attributes)                       // boolean
optimizely.getFeatureVariableString("feature_key", "var", userId, attributes)        // typed variable
optimizely.activate("experiment_key", userId, attributes)                            // → variation key (logs impression)
optimizely.getVariation("experiment_key", userId, attributes)                        // → variation key (no impression)
```

**Classify the SDK as client-side or server-side** — this decides the
evaluation-context model in Step 4:

| Optimizely package | Side |
|--------------------|------|
| `@optimizely/react-sdk`, `@optimizely/optimizely-sdk` (browser usage), `OptimizelySwiftSDK`/`Optimizely` (iOS), `com.optimizely.ab:android-sdk`, React Native, `optimizely_flutter_sdk` | **client** |
| `@optimizely/optimizely-sdk` (Node), `optimizely-sdk` (Python/Ruby), `optimizely/optimizely-sdk` (PHP), `com.optimizely.ab:core-api` (Java), `github.com/optimizely/go-sdk`, `Optimizely.SDK` (.NET), Optimizely Agent (REST) | **server** |

`@optimizely/optimizely-sdk` is dual-use — disambiguate by where it runs
(Node entrypoint = server; bundled into a browser/React app = client).

Group files by **flag key** they reference (the first arg to `decide`,
the first arg to `isFeatureEnabled` / `getFeatureVariable*`; for
`activate`/`getVariation` the arg is an **experiment key** — resolve it to
its parent flag via the Phase 1 plan, since FX experiments live inside a
flag's ruleset).

For each evaluation site, record:
- Flag key (and, for `activate`/`getVariation`, the experiment key →
  parent flag from Phase 1)
- **Client vs server side** (from the table above)
- API generation (**decide** vs **legacy**) and the value TYPE read
  (`enabled` → boolean; each variable by its declared type)
- The `userId`/user-context argument (→ `targetingKey`)
- The `attributes` argument (→ evaluation context)
- The default value (carried over to the Confidence call)
- The **Confidence resolve path** (`<confidence-flag>.<property>`) — take
  the Confidence flag key (Phase 1 normalized underscores → hyphens) and
  property from the Phase 1 plan's "Confidence resolve path" line.
  `decision.enabled` → `<flag>.enabled`; `decision.variables["x"]` /
  `getFeatureVariable*(.., "x", ..)` → `<flag>.x`. If the flag is NOT in
  the Phase 1 plan, surface it — do not invent a path.

### Step 4: Generate transform rules

Based on the SDK guide from `confidence-docs` MCP: extract install
commands, initialization, the flag-evaluation API, and generate
find/replace rules.

**Two things are NOT 1:1 line replacements — get them right first:**

1. **Flag key → resolve path.** Confidence flags are structs; every read
   uses `<confidence-flag>.<property>` (see Step 3). The Confidence flag
   key may differ from the Optimizely flag key (underscore→hyphen
   normalization in Phase 1) — use the Phase 1 mapping everywhere.
2. **Evaluation-context model depends on client vs server** (from Step 3):
   - **Server SDKs** pass context **per call** — fold the `userId` +
     `attributes` into the evaluation-context argument of each resolve.
   - **Client SDKs** use **ambient** context — hoist `userId` +
     `attributes` ONCE into a
     `setEvaluationContext`/`setEvaluationContextAndWait` (where the
     Optimizely code called `createUserContext` / set attributes), and the
     per-call site becomes a bare `get<Type>Value(path, default)`.

**Decide API → OpenFeature (server target, per-call context):**

| Optimizely | OpenFeature |
|------------|-------------|
| `user = optimizely.createUserContext(uid, attrs)` | (no user object — build an evaluation context `{ targetingKey: uid, ...attrs }` per call) |
| `user.decide("k").enabled` | `client.getBooleanValue("k.enabled", default, { targetingKey: uid, ...attrs })` |
| `user.decide("k").variables["v"]` (string) | `client.getStringValue("k.v", default, ctx)` |
| `user.decide("k").variables["v"]` (int/double) | `client.getNumberValue("k.v", default, ctx)` |
| `user.decide("k").variables["v"]` (json) | `client.getObjectValue("k.v", default, ctx)` |

**Legacy Full Stack API → OpenFeature (server target):**

| Optimizely | OpenFeature |
|------------|-------------|
| `optimizely.isFeatureEnabled("k", uid, attrs)` | `client.getBooleanValue("k.enabled", false, { targetingKey: uid, ...attrs })` |
| `optimizely.getFeatureVariableBoolean("k", "v", uid, attrs)` | `client.getBooleanValue("k.v", default, ctx)` |
| `optimizely.getFeatureVariableString("k", "v", uid, attrs)` | `client.getStringValue("k.v", default, ctx)` |
| `optimizely.getFeatureVariableInteger/Double("k", "v", uid, attrs)` | `client.getNumberValue("k.v", default, ctx)` |
| `optimizely.getFeatureVariableJSON("k", "v", uid, attrs)` | `client.getObjectValue("k.v", default, ctx)` |
| `optimizely.getAllFeatureVariables("k", uid, attrs)` | one `get<Type>Value("k.<v>", …)` per variable (Confidence has no "all variables" call) |

**Client target (ambient context):** the per-call site drops its
`uid`/`attrs` arguments; emit a one-time
`setEvaluationContext({ targetingKey: uid, ...attrs })` where the source
called `createUserContext` / set attributes (or at login/init).

The accessor name AND signature are language-specific — use the Step 2
SDK guide for the exact form:
- **Go**: PascalCase, no `get` prefix, `ctx` first, context last:
  `client.BooleanValue(ctx, "k.enabled", default, evalCtx)`; numeric →
  `FloatValue`, integer → `IntValue`, JSON → `ObjectValue`.
- **Java**: build a `MutableContext(uid)` + `ctx.add(...)` and pass it
  last: `client.getBooleanValue("k.enabled", default, ctx)`,
  `client.getDoubleValue("k.v", default, ctx)`, `getObjectValue(...)`.
- **Python (REMOTE target)**: snake_case `get_<type>_value`, numeric →
  `get_float_value`, JSON → `get_object_value`, context last:
  `client.get_boolean_value("k.enabled", False, EvaluationContext(targeting_key=uid, attributes=attrs))`.
  Use `api.set_provider(ConfidenceOpenFeatureProvider(Confidence(client_secret=...)))`
  (NOT `set_provider_and_wait`) and delete Optimizely's datafile-ready wait.

**`activate` / `getVariation` (legacy experiment API).** These return a
**variation key** (string) for an *experiment*, and the impression is
logged automatically by Confidence (so `activate`'s logging side effect
is implicit). Map by how the result is used:
- If the code **branches on the variation key string** (e.g.
  `if (v === "treatment")`), expose the decision via the flag the
  experiment belongs to: read the variable(s) that drive behavior
  (`get<Type>Value("<flag>.<var>", …)`) instead of switching on the key,
  OR — if a raw variant label is genuinely needed — read a string
  property carrying it. Surface these sites for human review in the plan;
  a key-switch is rarely a clean 1:1.
- `getVariation` (no impression) has no separate Confidence form —
  Confidence logs exposure on resolve. Note the behavior change.

**React SDK mapping.** `@optimizely/react-sdk` →
`@spotify-confidence/react` (or the React local-resolve provider for
RSC; fetch the JS guide in Step 2):

| Optimizely React | Confidence React |
|------------------|------------------|
| `<OptimizelyProvider optimizely={client} user={{ id, attributes }}>` | `<ConfidenceProvider>` with evaluation context `{ targetingKey: id, ...attributes }` |
| `const [decision] = useDecision("k")` → `decision.enabled` / `decision.variables.v` | `useFlag("k.enabled", default)` / `useFlag("k.v", default)` |
| `<OptimizelyFeature feature="k">{(enabled, variables) => …}</OptimizelyFeature>` | read via `useFlag("k.enabled", default)` (and `useFlag("k.v", …)` per variable) inside the component |
| `<OptimizelyExperiment experiment="k">{(variation) => …}</OptimizelyExperiment>` | resolve the underlying flag's variable(s) with `useFlag`; branching on a raw variation key needs review (see `activate` above) |

**Event tracking has no OpenFeature equivalent.**
`optimizely.track(eventKey, userId, attrs, tags)` /
`user.trackEvent(eventKey, tags)` map to Confidence's **track** API
(`confidence.track(eventKey, data)`), NOT to OpenFeature (which has no
track). Use the Confidence SDK's `track` from the Step 2 guide; the
evaluation context / subject carries through. Keep the event keys.

**Delete Optimizely scaffolding that Confidence handles automatically:**
- **Notification listeners** (`addNotificationListener`, `DECISION` /
  `NotificationCenter`, custom impression bridges) — Confidence logs
  exposure automatically. Delete them.
- **Datafile management** (`datafileOptions`, polling intervals,
  `OptimizelyConfig`, manual datafile fetch) — Confidence's provider
  refresh replaces it.
- **Event dispatcher / batch event processor** config — Confidence
  handles event delivery internally.
- **Readiness scaffolding** (`onReady()`, `await optimizely.onReady()`,
  Android handler delays) — Confidence's
  `setProviderAndWait` / `setEvaluationContextAndWait` already block until
  flags are ready; delete the hand-rolled wait.

**Bandits.** Optimizely multi-armed and contextual bandits (CMAB) are
**rule types** read through the normal `decide` API — the adaptive
allocation lives server-side (already snapshotted in Phase 1). So the
code transform for a bandit flag is the same as any `decide` read; just
note in the plan that the live split was adaptive and no longer auto-tunes
after migration. (This differs from sources that expose a separate
bandit-action call.)

### Step 5: Generate plan

Save the plan to `.claude/plans/optimizely-code-migration-<date>.md`
using the template below.

**Two Confidence-wide truths every code transform must honor:**

- **Flags are structs — read a property, not the bare key** (`<flag>.<property>`).
- **Client SDKs use ambient context; server SDKs pass it per call.**

## Plan Code: Template

```markdown
# Optimizely to Confidence Code Migration Plan

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
| **Source mode** | <in-process eval / on-device eval / remote (Agent) — per surface> |
| **Target mode** | <in-process / cached client / server-precomputed / remote — from Step 2a> |
| **Change** | <unchanged / ⚠️ in-process → remote / ⚠️ on-device → cached client / …> |

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
| <Optimizely import> | <Confidence import> |
| <Optimizely usage (decide / legacy)> | <Confidence usage> |

### Test Files

| Find | Replace |
|------|---------|
| <Optimizely mock> | <Confidence mock> |

---

## 3. Files to Transform

<list from codebase scan, grouped by flag key (experiment keys resolved to their parent flag); note any sites flagged for human review — activate/getVariation key-switches, event tracking, unsupported SDKs>

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
`confidence-docs` for `plan code`), plus the Optimizely REST API — no
MCP, just `curl` with `Authorization: Bearer $OPTIMIZELY_API_TOKEN`.

| Source | What's used |
|--------|-------------|
| Confidence MCP | `listClients`, `createClient`, `getContextSchema`, `addContextField`, `createFlag`, `addFlagToClient`, `unarchiveFlag`, `addTargetingRule`, `resolveFlag` |
| Confidence Docs MCP (`plan code`) | `getLocalResolveIntegrationGuide`, `getCodeSnippetAndSdkIntegrationTips`, `searchDocumentation`, `getFullSource` |
| Confidence REST API (`CONFIDENCE_TOKEN`, OPTIONAL — full-fidelity Phase 1) | `POST /v1/segments` + `:allocate`, `POST /v1/flags/{flag}/rules` + `PATCH …?updateMask=enabled`; token via `POST https://iam.confidence.dev/v1/oauth/token` |
| Optimizely Flags API (`OPTIMIZELY_API_TOKEN`) | `GET /flags/v1/projects/{id}/flags[/{key}]`, `GET …/flags/{key}/variations`, `GET …/flags/{key}/environments/{env}/ruleset` |
| Optimizely Platform API v2 (`OPTIMIZELY_API_TOKEN`) | `GET /v2/audiences[/{id}]`, `GET /v2/environments`, `GET /v2/projects` |
