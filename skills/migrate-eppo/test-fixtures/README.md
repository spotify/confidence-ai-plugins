# Fake Eppo Fixture Server

A local HTTP server that mimics Eppo's REST admin API for testing the
`migrate-eppo` skill end-to-end without needing an Eppo account.

The server is read-only and serves the read endpoints the skill calls
(feature flags, environments, and audiences). Fixture flag definitions
are inline in `server.py` and chosen to exercise every branch of the
skill's operator-mapping table — both the auto-migratable translations
(including SemVer, regex alternation, IS_NULL, and audience→segment) and
the genuinely BLOCKED paths.

## Schema source of truth

JSON shapes are derived from Eppo's public OpenAPI 3.0 spec, embedded
inline at <https://eppo.cloud/api/docs/swagger-ui-init.js>. The file is
publicly served (no auth, no account) and is the authoritative reference
for field names, enum values, required fields, and pagination semantics.

If you suspect the fixtures have drifted from real Eppo, fetch that file
fresh and diff against `server.py`. Update either the fixtures or the
skill — they must agree on the wire format.

## Run

Python 3.10+ stdlib, no dependencies.

```bash
python3 server.py
# Fake Eppo server listening on http://127.0.0.1:3000/api/v1
#   13 fixture flags, 2 audiences, 3 environments
```

Override the port if 3000 is taken:

```bash
python3 server.py --port 4000
```

## Smoke test

In another terminal:

```bash
export EPPO_API_KEY=fake-key-for-testing
curl -sS -H "X-Eppo-Token: $EPPO_API_KEY" \
  "http://127.0.0.1:3000/api/v1/feature-flags?offset=0&limit=5" | jq
```

You should see five flag summaries. If you forget the header, the server
returns `401 {"error": "Missing X-Eppo-Token header"}`.

## Drive the skill against this server

In Claude Code / Cursor, with the server running:

```
export EPPO_API_KEY=fake-key-for-testing
```

Then run `/migrate-eppo plan flags`. When the skill prompts you for the
Eppo API base URL, answer:

```
http://127.0.0.1:3000/api/v1
```

The skill will list 3 environments — pick **Production** (`id: 1`) to
exercise the inactive-in-env handling for `legacy-checkout-redesign`.
Then pick a throwaway Confidence client and a `user_id` entity field,
confirm, and review the generated plan file.

## Fixture flags and what each one tests

| `id` | `key` | What it tests | Expected status |
|---|---|---|---|
| 1 | `internal-tools-gate` | `MATCHES .*suffix$` → `endsWithRule` | Migrate |
| 2 | `pricing-experiment` | Waterfall (Feature Gate + Experiment), multivariant 50/50 split, `ONE_OF` set membership | Migrate |
| 3 | `legacy-search-rollout` | `NOT_ONE_OF` (→ `setRule` + `not`), `GTE` numeric on `appBuildNumber`, AND combination within one rule | Migrate |
| 4 | `subject-id-targeting` | The special `id` attribute → rewrite to chosen Confidence entity field | Migrate |
| 5 | `legacy-checkout-redesign` | `active: false` in Production → migration creates flag at 0% rollout | Migrate (with warning) |
| 6 | `mobile-only-feature` | SemVer `appVersion >= "1.2.0"` → `rangeRule` with `versionValue`; ANDed with a `device` set membership | Migrate |
| 7 | `general-regex-flag` | `MATCHES` suffix **alternation** `.*@(test\|qa\|staging)\.com$` → one `endsWithRule` per branch, OR'd | Migrate |
| 8 | `missing-attribute-fallback` | `IS_NULL` serving a **non-default** variant (no-plan subjects → on) → ruleless presence criterion under `not` | Migrate |
| 9 | `delivery-pricing-switchback` | `SWITCHBACK` allocation type → entire flag BLOCKED | BLOCKED |
| 10 | `premium-users-only` | Allocation referencing `audiences[]` (`IS_IN` 7001 AND `IS_NOT_IN` 7002) → each audience becomes a Confidence segment | Migrate |
| 11 | `regex-id-format` | Generic regex `^user_[0-9]{4}$` (char class + quantifier, not prefix/suffix/alternation) → BLOCKED | BLOCKED |
| 12 | `null-and-condition` | `IS_NULL` ANDed with `plan == free` → `and(not(exists country), plan eq free)` | Migrate |
| 13 | `old-onboarding-flow` | `is_archived: true` → hidden from list by default, visible with `include_archived=true` | Skipped (archived) |

Two audiences back fixture #10, served from `/api/v1/audiences/{id}`:

| `id` | `name` | Targeting |
|---|---|---|
| 7001 | Premium subscribers | `plan ONE_OF [premium, enterprise]` |
| 7002 | Internal staff | `email MATCHES .*@spotify\.com$` |

The default value for each flag lives on the trailing allocation
marked `is_default: true` — that mirrors how real Eppo stores defaults
and gives the skill something concrete to consume.

## Verifying the translation logic (`verify_migration.py`)

`verify_migration.py` computes Eppo's ground-truth waterfall evaluation
(regex, SemVer, set membership, IS_NULL, and audience IS_IN/IS_NOT_IN)
locally over the fixtures and prints a context × flag matrix of expected
results. Run it before/after `execute` to spot-check that Confidence
resolves match Eppo for the same context:

```bash
python3 verify_migration.py
```

It covers the ten migratable fixtures across nine contexts (90 cases)
and lists the two intentionally-BLOCKED fixtures separately. No network
or running server needed — it imports the fixture data directly.

## What a successful test looks like

After running `plan flags`, the generated plan file at
`.claude/plans/eppo-flag-migration-<date>.md` should:

- Have all 12 non-archived flags in Section 4 (flag #13
  `old-onboarding-flow` is archived and excluded by default; if the user
  opted in to archived flags, all 13 should appear)
- For `pricing-experiment`, list **two** non-default allocations in order:
  the internal-QA feature gate first, then the NA 50/50 experiment.
  The third allocation (`is_default: true`) should appear as a **final
  catch-all rule** (no payload, 100% → `control`) — Confidence has no
  server-side flag default, so the default variation must be an explicit
  trailing rule
- For `legacy-search-rollout`, render the rule in plain English as
  something like "country is not DE and is not FR AND appBuildNumber >= 28"
- For `subject-id-targeting`, show the `id` attribute rewritten to
  `user_id` (or whatever Confidence entity field you chose)
- For `legacy-checkout-redesign`, note "Active in Production: no" and
  warn that rules will be added at 0% rollout
- For `mobile-only-feature`, translate `appVersion >= "1.2.0"` to a
  version range criterion (not a numeric one)
- For `general-regex-flag`, decompose the alternation into three
  `endsWithRule`s (`@test.com`, `@qa.com`, `@staging.com`) OR'd together
- For `missing-attribute-fallback`, emit two rules: the positive
  `plan in [premium, enterprise]` rule, plus a ruleless presence
  criterion on `plan` under `not` (no-plan subjects → on), default off
- For `null-and-condition`, emit one rule combining a ruleless presence
  criterion on `country` under `not` with `plan eq free`:
  `and(not(exists country), plan eq free)`
- For `premium-users-only`, list two segments in Section 3b (from
  audiences 7001 / 7002) and reference them from the rule
- Mark only `delivery-pricing-switchback` and `regex-id-format` as
  **BLOCKED** with clear reasons (SWITCHBACK, generic regex).
  `execute` should refuse to proceed on these unless they're `[x] Skip`'d

After you tick `[x] Migrate` on the ten non-blocked flags and run
`/migrate-eppo execute <plan-file>`, each migrated flag should:

- Be created in your throwaway Confidence client with the right
  variations (one per Eppo variation, keyed by `variant_key`)
- Have one targeting rule per non-default Eppo allocation, in the same
  order, plus a final catch-all rule (no payload, 100% → the
  `is_default` allocation's variation) reproducing the default variation
- Resolve correctly for both positive and negative test contexts (the
  skill generates these automatically); a negative context that matches
  no specific rule should land on the catch-all and return the default
  variation, not a client-code default
- For `pricing-experiment` specifically, also pass the waterfall test:
  resolve with a `country: US` context (no Spotify email) that misses
  the first allocation and confirm it lands in the 50/50 second
  allocation, returning `control` or `treatment_a`

If any of these checks fail, that's a real bug in the skill — please
file it on the PR or open an issue.

## Editing fixtures

To add a new test case, append a new dict to the `FLAGS` list in
`server.py`. Use one of the existing flags as a template — they cover
the full schema surface the skill expects. Conventions:

- IDs are numbers; pick something distinct from the existing ones
- Variation IDs should be flag-scoped (e.g. `<flag_id>01`, `<flag_id>02`) to
  stay unique across the fixture set
- Variation weights are an array of `{variation_id, weight}` — refer
  to variations by their numeric `id`, never by `variant_key`
- All `targeting_rules[].conditions[].values` are arrays even if a
  single-value operator
- The trailing allocation should always have `is_default: true`, empty
  `targeting_rules[]`, empty `audiences[]`, and supply the default
  variation

If your new flag should be inactive in a specific environment, add an
entry to `ENV_OVERRIDES`: `(<flag_id>, <env_id>): {"active": False}`.

The server has no caching, so changes take effect when you restart it
(`Ctrl+C` and re-run).

## What this does NOT test

- **Real Eppo evaluation logic.** This *server* is config-only; it never
  decides "given subject X, what variant?". The migration translates
  *configs*, and post-migration evaluation happens on Confidence's side.
  (`verify_migration.py` does model Eppo's evaluation locally, but only
  to produce the expected-results matrix you check Confidence against —
  it is not part of the server.)
- **Authentication semantics.** The server validates the header is
  present but doesn't check the value, scope, or rate-limit behavior.
- **Mutations.** All write endpoints (POST/PUT/DELETE) return 405.
  Migration is read-only on the Eppo side; writes happen against
  Confidence.
