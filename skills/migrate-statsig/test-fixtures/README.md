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

## Run

Python 3.10+ stdlib, no dependencies.

```bash
python3 server.py
# Fake Statsig Console API listening on http://127.0.0.1:4000
#   10 gates, 1 dynamic config, 2 experiments, 2 segments
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
| `internal_tools_gate` | `str_ends_with_any` → `endsWithRule` | Migrate |
| `new_search_rollout` | `none` (NOT IN) → `setRule` + `not`, numeric `gte` → `rangeRule`, AND in one rule | Migrate |
| `mobile_only_feature` | `os_name any` → `setRule`, `app_version version_gte` → `rangeRule` with `versionValue` | Migrate |
| `gradual_rollout` | `public` "Everyone" at 25% → catch-all rule at 25% rollout | Migrate |
| `legacy_checkout` | `isEnabled: false` → flag created OFF, rules at 0% rollout | Migrate (with warning) |
| `non_prod_email_gate` | `str_matches` suffix alternation `.*@(test\|qa\|staging)\.com$` → one `endsWithRule` per branch, OR'd | Migrate |
| `contains_blocked_gate` | `str_contains_any` → no Confidence substring rule | BLOCKED |
| `depends_on_gate` | `passes_gate` → no cross-flag dependency | BLOCKED |
| `premium_segment_gate` | `passes_segment` + `fails_segment` (both `rule_based`) → inline each segment's conditions | Migrate |
| `test_user_allowlist` | `user_id any` → `setRule` on the chosen entity field | Migrate |
| `old_onboarding_gate` | `status: Archived` → hidden from list unless opted in | Skipped (archived) |

## Fixture dynamic configs

| `id` | What it tests |
|---|---|
| `homepage_config` | Server-side `defaultValue` → catch-all variant; two country rules each with a distinct `returnValue` → one variant per return value |

## Fixture experiments

| `id` | What it tests |
|---|---|
| `checkout_button_experiment` | 50/50 groups, `allocation: 100` → ONE rule, variant split 50/50 |
| `onboarding_flow_experiment` | 3 groups (34/33/33), `allocation: 50` → rule at 50% rollout, control fall-through catch-all; `inlineTargetingRules` (country US/CA); `layerID` set → layer note |

## Fixture segments (rule_based → inlined)

| `id` | Targeting |
|---|---|
| `premium_users` | `custom_field plan any [premium, enterprise]` |
| `internal_staff` | `email str_ends_with_any [@spotify.com]` |

These are inlined into `premium_segment_gate` because this plugin's
Confidence MCP has no `createSegment` tool.

## What a successful test looks like

After running `plan flags`, the generated plan file at
`.claude/plans/statsig-flag-migration-<date>.md` should:

- Include the 10 non-archived gates, 1 dynamic config, and 2 experiments
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
- For `premium_segment_gate`, inline the `premium_users` conditions and
  inline `internal_staff` wrapped in `not`
- For `test_user_allowlist`, rewrite the `user_id` condition to a
  `setRule` on the chosen entity field
- For `homepage_config`, create one variant per `returnValue` plus a
  default variant for `defaultValue`, and emit a final catch-all rule
- For `onboarding_flow_experiment`, emit ONE rule at 50% rollout with the
  three-way group split, restricted to US/CA, plus a layer note
- Mark `contains_blocked_gate` and `depends_on_gate` as **BLOCKED** with
  clear reasons. `execute` should refuse to proceed on these unless
  they're `[x] Skip`'d

## What this does NOT test

- **Real Statsig evaluation.** This server is config-only; it never
  decides "given user X, what value?". The migration translates
  *configs*; post-migration evaluation happens on Confidence's side.
- **Authentication semantics.** The server validates the header is
  present but doesn't check the value, scope, or rate limits.
- **Mutations.** All write methods (POST/PATCH/PUT/DELETE) return 405.
  Migration is read-only on the Statsig side; writes happen against
  Confidence.
