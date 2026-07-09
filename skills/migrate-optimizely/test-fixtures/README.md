# Fake Optimizely REST API Server

A local HTTP server that mimics Optimizely Feature Experimentation's
REST API for testing the `migrate-optimizely` skill end-to-end without
needing an Optimizely account.

The server is read-only and serves the read endpoints the skill calls,
across both Optimizely base paths on one port: the **Flags API**
(`/flags/v1`, for flags / variations / rulesets) and the **Platform API
v2** (`/v2`, for audiences / environments). Fixtures are inline in
`server.py` and chosen to exercise every branch of the skill's
operator-mapping table — both the auto-migratable translations (semver
ranges, numeric comparisons, set membership, audience inlining,
presence) and the genuinely BLOCKED paths.

## Schema source of truth

JSON shapes are derived from Optimizely's published Feature
Experimentation API docs at
<https://docs.developers.optimizely.com/feature-experimentation/reference>.
It is the authoritative reference for field names, the ruleset/rule
shapes, the audience condition language, and pagination semantics.

If you suspect the fixtures have drifted from real Optimizely, fetch the
docs fresh and diff against `server.py`. Key facts the fixtures encode:

- **Percentages are basis points out of 10000** (10000 = 100%).
- A ruleset has an ordered `rule_priorities` (first wins) and a
  `default_variation_key` served when no rule matches.
- A rule references audiences via `audience_conditions` (the list-based
  condition language) + `audience_ids`; the custom-attribute leaves live
  in each **audience's** `conditions`, which is a **JSON-encoded string**.

## Run

Python 3.10+ stdlib, no dependencies.

```bash
python3 server.py
# Fake Optimizely REST API listening on http://127.0.0.1:4100
#   Project 4100100100 (curated operator-mapping fixtures): 14 flags (13 non-archived), 11 audiences, 2 environments
#   Project 5551000001 (summary export scenario): 10 flags (10 non-archived), 0 audiences, 1 environment
```

The server hosts **two Optimizely projects** on one port, selected by the
project id in each request: the curated operator-mapping fixtures
(`4100100100`) and a synthetic summary-export scenario (`5551000001`, see
[Summary export scenario](#summary-export-scenario-option-b2-flattened-export)
below).

Override the port if 4100 is taken:

```bash
python3 server.py --port 4155
```

## Smoke test

In another terminal:

```bash
export OPTIMIZELY_API_TOKEN=fake-token-for-testing
curl -sS -H "Authorization: Bearer $OPTIMIZELY_API_TOKEN" \
  "http://127.0.0.1:4100/flags/v1/projects/4100100100/flags?per_page=3&page=1" | jq
```

You should see three flag summaries plus `page`/`total_pages`. If you
forget the header, the server returns
`401 {"message": "Missing or malformed Authorization header"}`.

## Drive the skill against this server

In Claude Code / Cursor, with the server running:

```
export OPTIMIZELY_API_TOKEN=fake-token-for-testing
```

Then run `/migrate-optimizely plan flags`. When the skill prompts for the
Optimizely API base URLs, answer `http://127.0.0.1:4100` (the fake server
serves both `/flags/v1` and `/v2` there), use project id `4100100100`,
and pick the `production` environment.

Pick a throwaway Confidence client and map the Optimizely user ID to a
`user_id` entity field, confirm, and review the generated plan file.

## Fixture flags and what each one tests

| `key` | What it tests | Expected status |
|---|---|---|
| `new-homepage` | 100% targeted-delivery to everyone → catch-all rule at 100% on | Migrate |
| `beta_feature` | 25% targeted-delivery to a boolean audience → `eqRule boolValue` + 25/75 split | Migrate |
| `na_promo` | audience `country US OR CA` → `setRule` | Migrate |
| `mobile_checkout` | audience `app_version semver_ge 1.2.0 AND os exact ios` → version `rangeRule` + string `eqRule` | Migrate |
| `winback_banner` | audience `days_since_last_order le 14` → numeric `rangeRule.endInclusive` | Migrate |
| `substring_gate` | audience `email substring` → no Confidence substring rule | BLOCKED |
| `product_sort` | flag WITH variables (`sort_algorithm` string, `show_amounts` bool), a/b 50/50 → struct flag, variant split | Migrate |
| `pricing_test` | a/b at 50% allocation THEN an everyone fallback rule → REST backend (un-allocated traffic must fall through) | Migrate (REST) |
| `headline_mab` | `multi_armed_bandit` / `stats_accelerator` → adaptive split snapshotted, with a note | Migrate (note) |
| `legacy_banner` | ruleset `enabled: false` → flag created OFF, rules at 0% | Migrate (with warning) |
| `members_dashboard` | combo `Authenticated AND NOT Internal` → inline both audiences, internal negated | Migrate |
| `plan_badge` | audience `plan exists` → Confidence has no working presence operator (ruleless criteria error at resolve) | BLOCKED |
| `browser_gate` | non-`custom_attribute` (`browser`) audience leaf → no Confidence equivalent | BLOCKED |
| `old_experiment` | `archived: true` → hidden from list unless opted in | Skipped (archived) |

## Fixture audiences

| `id` | Targeting | Notes |
|---|---|---|
| 1 `Beta users` | `is_beta exact true` | boolean → `eqRule boolValue` |
| 2 `North America` | `country exact US OR country exact CA` | set membership → `setRule` |
| 3 `Modern mobile` | `app_version semver_ge 1.2.0 AND os exact ios` | version range + string eq |
| 4 `Recent purchasers` | `days_since_last_order le 14` | numeric → `rangeRule.endInclusive` |
| 5 `Test email substring` | `email substring @test` | BLOCKED |
| 6 `Regex email` | `email regex .*@test\.com` | BLOCKED |
| 7 `Authenticated users` | `is_logged_in exact true` | used alone + in a combo |
| 9 `Internal staff` | `is_internal exact true` | used NEGATED in a combo |
| 10 `Has plan` | `plan exists` | BLOCKED — no working presence operator |
| 11 `Chrome users` | `browser exact gc` | non-custom_attribute → BLOCKED |

## Summary export scenario (Option B2: flattened export)

Project `5551000001` is a **synthetic** account modeling a real-world
support pattern: an account whose export tool/token could only produce
rule *summaries* (`has_restricted_permissions: true`, no full rulesets).
All flag names, keys, and ids in this scenario are made up — this is not
any real account's data. A matching synthetic export file is checked in
at [`summary-export-sample.json`](./summary-export-sample.json). This is
the reference example for the skill's **Option B2** input method (see
`SKILL.md` → "Prerequisites: Optimizely Side" → "Option B: Exported JSON
files").

**Test the file-input path directly (Option B):** run
`/migrate-optimizely plan flags` and, when asked for an input method,
point it at `summary-export-sample.json` — no server, no token needed.
This exercises the skill's B2 detection and gap-filling logic.

**Test the same data via the live-API path (Option A) for comparison:**
run the fake server and drive the skill against project `5551000001` over
HTTP instead:

```
export OPTIMIZELY_API_TOKEN=fake-token-for-testing
```

Then run `/migrate-optimizely plan flags`, answer `http://127.0.0.1:4100`
for the base URL, project id `5551000001`, and the `production`
environment. (The server reconstructs full rulesets for this project —
see "Reconstruction assumptions" below — so this path exercises normal
Step 1c/1d extraction rather than the B2 gap-filling logic itself.)

### What this scenario exercises

| Trait | In the export | Why it matters for the migration |
|---|---|---|
| `type: a/b` with **no flag variables** | variations are bare names (`control`/`treatment`, `layout_a`/`layout_b`, `variation_1`/`variation_2`, etc.) | Code branches on the **variation key**, not on flag variables — the a/b rule still folds into one Confidence targeting rule with a bare variant per arm (no separate "experiment" migration path; see SKILL.md "Optimizely's flag model") |
| **Paused / disabled** experiments (6 flags) | `enabled: false`, `status: paused` | Excluded by default per the Migration Scope Policy; if the user opts them in, they migrate **OFF** |
| **Duplicate variation names** (`CMS-aa11bb22-…`) | both `variation_names` identical; human name in `description`, key synthetic | Collapsed to a single fully-rolled-out variant (no split between identical arms); display name comes from the description |
| **"Running" a/b with distinct arms** (`flag-sample-video-autoplay`, `days_running` ≈ 3 years) | no per-variation split in the export | Triggers the live-vs-stale scope question; never migrated with an assumed split |
| **100% rollout** (`flag-sample-dark-mode`) | `targeted_delivery`, `traffic_allocation: 10000`, synthetic `variation_names` label | Stable flag — migrates under the default scope policy (the label is not a real variation key) |
| **Partial 40% rollout** (`flag-sample-beta-search`) | `targeted_delivery`, `traffic_allocation: 4000` | Excluded by default — the included cohort can't be reproduced in Confidence |
| **No audiences** | `audience_ids: []` | Each rule targets everyone (no gap) |
| `has_restricted_permissions: true` | present on every config | The tell for Option B2: a restricted token could only export rule **summaries** — no per-variation split, variable values, or audience conditions |

### Reconstruction assumptions (fake-server / Option A comparison path only)

The export only carries rule *summaries* (`traffic_allocation` +
`variation_names`). For the **Option A comparison path** above, `server.py`
fills the gaps with Optimizely's documented defaults to serve a complete
ruleset over HTTP:

- **Split:** `distribution_mode: manual` with N arms → an even split
  (2 arms = 50/50). The real live split isn't in the export. This is a
  server-side reconstruction convenience only — the skill's own file
  path (Option B) never assumes a split: multi-variant rules with an
  unknown split follow the Migration Scope Policy (excluded, or
  migrated as a rollout to a user-confirmed variant).
- **Variables:** none — each arm becomes a bare Confidence variant. The
  arm identity (the variation key) is what code reads.
- **`off` variation:** `default_variation_key: "off"` implies an implicit
  `off` variation served when the (disabled) rule doesn't apply.
- **Duplicate names:** the CMS flag's ruleset has distinct variation
  *keys* (`variation_1`/`variation_2`) with identical display *names* —
  which is exactly how the summary export ends up with duplicate
  `variation_names`.

If a real account later shares the full `/ruleset` and `/variations`
responses (Option B1), the skill uses those directly with no fidelity
loss — see "Option B: Exported JSON files" in `SKILL.md`.

## What a successful test looks like

After running `plan flags`, the generated plan file at
`.claude/plans/optimizely-flag-migration-<date>.md` should:

- Include the 13 non-archived flags in Section 4 (`old_experiment` is
  archived and excluded by default)
- For `na_promo`, render the audience as a set membership (country is US
  or CA → `setRule`)
- For `mobile_checkout`, translate `app_version >= 1.2.0` as a version
  range (not numeric) AND `os` equals `ios`
- For `winback_banner`, translate `days_since_last_order <= 14` as a
  numeric `rangeRule.endInclusive`
- For `product_sort`, create a struct flag with one property per variable
  and one variant per variation, split 50/50
- For `pricing_test`, mark `Backend: REST` (50% A/B with a fall-through
  fallback rule that the MCP `variantAllocations` can't represent)
- For `headline_mab`, snapshot the 33/33/34 split and note the live
  allocation was adaptive
- For `legacy_banner`, note "Enabled in Optimizely: no" and warn rules go
  in at 0% rollout
- For `members_dashboard`, inline the `Authenticated` and `Internal`
  audiences, with `Internal` wrapped in `not`
- Mark `substring_gate`, `browser_gate`, and `plan_badge` as **BLOCKED**
  (`plan_badge` uses an `exists` match, which has no working Confidence
  presence operator). `execute` should refuse to proceed on them unless
  they're `[x] Skip`'d

## Verifying the translation logic (`verify_migration.py`)

`verify_migration.py` models Optimizely's deterministic evaluation
(audience matching + the ruleset waterfall) over the fixtures and prints
a flag × context matrix of expected results — including which flags are
BLOCKED, which need the REST backend, and which rules are adaptive. Run
it before/after `execute` to spot-check that Confidence resolves match
Optimizely for the same context:

```bash
python3 verify_migration.py
```

It imports the fixtures directly from `server.py`, so no network or
running server is needed. The random percentage dimension
(`percentage_included` / variation split) is reported as metadata rather
than simulated, since bucketing is a property of the hashing, not the
config translation.

## Seeding a real Optimizely project (`seed_optimizely.py`)

To test end-to-end against **real** Optimizely instead of this fake
server, `seed_optimizely.py` pushes the same fixtures into an actual
Feature Experimentation project via the REST API:

1. Sign up at <https://www.optimizely.com> and create a Feature
   Experimentation project (manual — the signup flow can't be automated).
2. Create an **API token** under Account Settings > API Access.
3. Seed (the numeric project id is in the app URL):

   ```bash
   export OPTIMIZELY_API_TOKEN=...
   python3 seed_optimizely.py --project-id 12345   # --dry-run to preview, --teardown to clean up
   ```

This is a **best-effort** seeder. Optimizely auto-creates the `on`/`off`
variations on flag create; rules are added to the `development`
environment and left disabled (enable/promote them in the UI first), and
some constructs (multi-armed bandit, stats-accelerator distribution) may
require a plan that supports them or manual setup in the UI. See the
script's docstring for the full list of caveats.

Then run `/confidence:migrate-optimizely plan flags` against the standard
base URLs with your project id and the `development` environment, and
compare the plan with `python3 verify_migration.py`.

## Phase 2 (code transformation) fixtures

`phase2-examples/` holds small example apps that use the Optimizely SDKs
(Decide API, legacy Full Stack API, and the React SDK) the way real
codebases do. They give `/migrate-optimizely plan code` something
concrete to scan and transform. Their flag keys match the Phase 1
fixtures so the two phases line up. See `phase2-examples/README.md`.

## What this does NOT test

- **Real Optimizely evaluation.** This server is config-only; it never
  decides "given user X, what value?". The migration translates
  *configs*; post-migration evaluation happens on Confidence's side.
- **Authentication semantics.** The server validates the `Bearer` header
  is present but doesn't check the value, scope, or rate limits.
- **Mutations.** All write methods (POST/PATCH/PUT/DELETE) return 405.
  Migration is read-only on the Optimizely side; writes happen against
  Confidence.
