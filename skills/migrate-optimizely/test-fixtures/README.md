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
#   14 flags (13 non-archived), 11 audiences, 2 environments
#   Project ID: 4100100100
```

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

## What this does NOT test

- **Real Optimizely evaluation.** This server is config-only; it never
  decides "given user X, what value?". The migration translates
  *configs*; post-migration evaluation happens on Confidence's side.
- **Authentication semantics.** The server validates the `Bearer` header
  is present but doesn't check the value, scope, or rate limits.
- **Mutations.** All write methods (POST/PATCH/PUT/DELETE) return 405.
  Migration is read-only on the Optimizely side; writes happen against
  Confidence.
