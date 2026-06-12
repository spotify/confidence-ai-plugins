# Fake Statsig Console API Server

A local HTTP server that mimics Statsig's Console API for testing the
`migrate-statsig` skill end-to-end without needing a Statsig account.

The server is read-only and serves the read endpoints the skill calls
(gates, dynamic configs, experiments, and segments). Fixtures are inline
in `server.py` and chosen to exercise every branch of the skill's
operator-mapping table — both the auto-migratable translations
(SemVer, regex alternation, set membership, segment inlining) and the
genuinely BLOCKED paths.

## Schema source of truth

JSON shapes are derived from Statsig's public OpenAPI 3.0 spec at
<https://api.statsig.com/openapi/20240601.json> (publicly served, no
auth, no account). It is the authoritative reference for field names,
enum values, required fields, and pagination semantics
(`ExternalGateDto`, `DynamicConfigDto`, `ExternalExperimentDto`,
`SegmentDto`).

If you suspect the fixtures have drifted from real Statsig, fetch that
file fresh and diff against `server.py`.

One thing the spec does NOT capture (verified against the live Console
API): operators are validated **per condition type**. Notably,
`str_starts_with_any` / `str_ends_with_any` are rejected for `email`,
`custom_field`, `url`, `locale`, `user_agent`, and `browser_name` —
suffix matching arrives as an anchored `str_matches` regex instead, and
`custom_field` additionally accepts array operators
(`array_contains_any/none/all`, `not_array_contains_all`). The fixtures
only use type/operator combinations the live API accepts.

## Run

Python 3.10+ stdlib, no dependencies.

```bash
python3 server.py
# Fake Statsig Console API listening on http://127.0.0.1:4000
#   13 gates, 1 dynamic config, 2 experiments, 3 segments
```

Override the port if 4000 is taken:

```bash
python3 server.py --port 4055
```

## Smoke test

In another terminal:

```bash
export STATSIG_API_KEY=fake-key-for-testing
curl -sS -H "STATSIG-API-KEY: $STATSIG_API_KEY" \
  -H "STATSIG-API-VERSION: 20240601" \
  "http://127.0.0.1:4000/console/v1/gates?limit=3&page=1" | jq
```

You should see three gate summaries plus a `pagination` block. If you
forget the header, the server returns
`401 {"message": "Missing STATSIG-API-KEY header"}`.

## Drive the skill against this server

In Claude Code / Cursor, with the server running:

```
export STATSIG_API_KEY=fake-key-for-testing
```

Then run `/migrate-statsig plan flags`. When the skill prompts you for
the Statsig Console API base URL, answer:

```
http://127.0.0.1:4000
```

Pick a throwaway Confidence client and map the `userID` unit to a
`user_id` entity field, confirm, and review the generated plan file.

## Fixture gates and what each one tests

| `id` | What it tests | Expected status |
|---|---|---|
| `internal_tools_gate` | `str_matches` suffix regex (`.*@spotify\.com$`) → `endsWithRule` | Migrate |
| `new_search_rollout` | `none` (NOT IN) → `setRule` + `not`, numeric `gte` → `rangeRule`, AND in one rule | Migrate |
| `mobile_only_feature` | `os_name any` → `setRule`, `app_version version_gte` → `rangeRule` with `versionValue` | Migrate |
| `gradual_rollout` | `public` "Everyone" at 25% → catch-all rule at 25% rollout | Migrate |
| `legacy_checkout` | `isEnabled: false` → flag created OFF, rules at 0% rollout | Migrate (with warning) |
| `non_prod_email_gate` | `str_matches` suffix alternation `.*@(test\|qa\|staging)\.com$` → one `endsWithRule` per branch, OR'd | Migrate |
| `contains_blocked_gate` | `str_contains_any` → no Confidence substring rule | BLOCKED |
| `depends_on_gate` | `passes_gate` → inline the referenced gate's conditions (or a shared segment) | Migrate (inlined) |
| `premium_segment_gate` | `passes_segment` + `fails_segment` (both `rule_based`) → reusable segments (REST) or inline (MCP) | Migrate |
| `test_user_allowlist` | `user_id any` → `setRule` on the chosen entity field | Migrate |
| `vip_gate` | `passes_segment` on an **`id_list`** segment (count 5000) → REST materialized segment (BigQuery), else BLOCKED | Migrate (REST) |
| `onboarding_na_targeting` | plain `country any [US, CA]` gate; also referenced by `onboarding_flow_experiment.targetingGateID` (conditions inlined there) | Migrate |
| `old_onboarding_gate` | `status: Archived` → hidden from list unless opted in | Skipped (archived) |

## Fixture dynamic configs

| `id` | What it tests |
|---|---|
| `homepage_config` | Server-side `defaultValue` → catch-all variant; two country rules each with a distinct `returnValue` → one variant per return value |

## Fixture experiments

| `id` | What it tests |
|---|---|
| `checkout_button_experiment` | 50/50 groups, `allocation: 100` → ONE rule, variant split 50/50 (MCP-OK) |
| `onboarding_flow_experiment` | 3 groups (34/33/33), `allocation: 50` (→ REST segment `proportion` 0.5; control catch-all); `targetingGateID: onboarding_na_targeting` (gate conditions inlined — how the modern console targets experiments); `layerID` → REST exclusivity group; duplicated `holdoutIDs` (live-API quirk — dedupe) → holdback surface step |

## Fixture segments

| `id` | Type | Targeting |
|---|---|---|
| `premium_users` | rule_based | `custom_field plan any [premium, enterprise]` |
| `internal_staff` | rule_based | `email str_matches [.*@spotify\.com$]` |
| `vip_user_list` | id_list (count 5000) | literal unit IDs → REST materialized segment (BigQuery) |

The `rule_based` segments become reusable Confidence segments on the REST
backend, or are inlined into `premium_segment_gate` on the MCP backend
(this plugin's Confidence MCP has no `createSegment` tool). The `id_list`
segment maps to a REST materialized segment.

## What a successful test looks like

After running `plan flags`, the generated plan file at
`.claude/plans/statsig-flag-migration-<date>.md` should:

- Include the 12 non-archived gates, 1 dynamic config, and 2 experiments
  in Section 4 (`old_onboarding_gate` is archived and excluded by default)
- For `new_search_rollout`, render the rule as something like "country is
  not DE and not FR AND appBuildNumber >= 28"
- For `mobile_only_feature`, translate `app_version >= 1.2.0` as a
  version range (not numeric)
- For `non_prod_email_gate`, decompose the alternation into three
  `endsWithRule`s (`@test.com`, `@qa.com`, `@staging.com`) OR'd together
- For `gradual_rollout`, emit a catch-all rule at 25% rollout to `enabled`
- For `legacy_checkout`, note "Enabled in Statsig: no" and warn rules go
  in at 0% rollout
- For `premium_segment_gate`, create reusable `premium_users` /
  `internal_staff` segments (REST) or inline their conditions (MCP), with
  `internal_staff` wrapped in `not`
- For `test_user_allowlist`, rewrite the `user_id` condition to a
  `setRule` on the chosen entity field
- For `depends_on_gate`, inline the referenced `internal_tools_gate`
  conditions (email matches `.*@spotify\.com$` → `endsWithRule`) — not BLOCKED
- For `vip_gate`, mark `Backend: REST` and map the `vip_user_list`
  id_list segment to a materialized segment (or BLOCKED if no BigQuery)
- For `homepage_config`, create one variant per `returnValue` plus a
  default variant for `defaultValue`, and emit a final catch-all rule
- For `onboarding_flow_experiment`, mark `Backend: REST`, use a segment
  with `proportion` 0.5 + the three-way group split restricted to US/CA
  (inlined from the `onboarding_na_targeting` targeting gate), map
  `layerID` to an exclusivity group, and record the `q1_holdout` →
  holdback surface step (deduped — the live API returns the id twice)
- Mark only `contains_blocked_gate` as **BLOCKED** (`str_contains_any`).
  `execute` should refuse to proceed on it unless it's `[x] Skip`'d

## Verifying the translation logic (`verify_migration.py`)

`verify_migration.py` models Statsig's deterministic evaluation (condition
matching + the waterfall) over the fixtures and prints a context × flag
matrix of expected results — including which gates are BLOCKED and which
experiments have an un-representable `allocation` < 100. Run it
before/after `execute` to spot-check that Confidence resolves match
Statsig for the same context:

```bash
python3 verify_migration.py
```

It imports the fixtures directly from `server.py`, so no network or
running server is needed. The random percentage dimension
(`passPercentage` / group `size` / `allocation`) is reported as metadata
rather than simulated, since bucketing is a property of the hashing, not
the config translation.

## Seeding a real Statsig project (`seed_statsig.py`)

To test end-to-end against **real** Statsig instead of this fake server,
`seed_statsig.py` pushes the same fixtures into an actual Statsig project
via the Console API (free tier is enough):

1. Sign up at <https://statsig.com> and create a project (manual — the
   signup flow can't be automated).
2. Create a **Console API key with write access** under Project Settings
   > API Keys (starts with `console-`).
3. Seed:

   ```bash
   export STATSIG_API_KEY=console-...
   python3 seed_statsig.py            # --dry-run to preview, --teardown to clean up
   ```

4. One manual step: the Console API cannot write `inlineTargetingRules`
   (read-only as of API version 20240601), so add the inline rule to
   `onboarding_flow_experiment` in the console UI: country is any of
   [US, CA].

Then run `/confidence:migrate-statsig plan flags` against
`https://statsigapi.net` and compare the plan with
`python3 verify_migration.py` — same expectations as the fake-server
table above. Differences from the fake fixtures: experiment group IDs
and `controlGroupID` are assigned by Statsig (Control is kept as the
first group), and `status` values reflect the real lifecycle
(experiments are started by the script).

## What this does NOT test

- **Real Statsig evaluation.** This server is config-only; it never
  decides "given user X, what value?". The migration translates
  *configs*; post-migration evaluation happens on Confidence's side.
- **Authentication semantics.** The server validates the header is
  present but doesn't check the value, scope, or rate limits.
- **Mutations.** All write methods (POST/PATCH/PUT/DELETE) return 405.
  Migration is read-only on the Statsig side; writes happen against
  Confidence.
