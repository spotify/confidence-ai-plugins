# Fake Eppo Fixture Server

A local HTTP server that mimics Eppo's REST admin API for testing the
`migrate-eppo` skill end-to-end without needing an Eppo account.

The server is read-only and serves four endpoints — exactly the four the
skill calls. Fixture flag definitions are inline in `server.py` and chosen
to exercise every branch of the skill's operator-mapping table.

> **The fixture JSON is our best guess at Eppo's actual schema**, modeled on
> the public Swagger summary at <https://eppo.cloud/api/docs> and the
> docs at <https://docs.geteppo.com/reference/api/>. A future "Tier 3"
> validation pass with a real Eppo account should diff a real response
> against these fixtures and update either the fixtures or the skill if
> they drift. Until then, this server lets us test the skill's logic
> deterministically.

## Run

Python 3.10+ stdlib, no dependencies.

```bash
python3 server.py
# Fake Eppo server listening on http://127.0.0.1:3000/api/v1
#   10 fixture flags, 3 environments
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
  http://127.0.0.1:3000/api/v1/feature-flags?page=1&per_page=5 | jq
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

The skill will list 3 environments — pick **Production** to exercise the
disabled-in-env handling for `legacy-checkout-redesign`. Then pick a
throwaway Confidence client and a `user_id` entity field, confirm, and
review the generated plan file.

## Fixture flags and what each one tests

| # | Flag | What it tests |
|---|---|---|
| 1 | `internal-tools-gate` | `MATCHES .*suffix$` → `endsWithRule` |
| 2 | `pricing-experiment` | Waterfall (two allocations), Feature Gate + Experiment, multivariant 50/50 split, `ONE_OF` |
| 3 | `legacy-search-rollout` | `NOT_ONE_OF`, `GTE` numeric, AND combination within one rule |
| 4 | `subject-id-targeting` | The special `id` attribute → rewrite to chosen Confidence entity field |
| 5 | `legacy-checkout-redesign` | Disabled in Production env → migration creates flag at 0% rollout |
| 6 | `mobile-only-feature` | SemVer `appVersion >= 1.2.0` → BLOCKED path |
| 7 | `general-regex-flag` | `MATCHES` regex with alternation (not a clean prefix/suffix) → BLOCKED path |
| 8-10 | `extra-flag-1` to `extra-flag-3` | Pagination filler — pushes the list past `per_page=5` so the skill's pagination loop is exercised |

## What a successful test looks like

After running `plan flags`, the generated plan file at
`.claude/plans/eppo-flag-migration-<date>.md` should:

- Have all 10 flags in Section 4
- For `pricing-experiment`, list **two** allocations in order: the internal-QA
  feature gate first, then the NA 50/50 experiment
- For `legacy-search-rollout`, render the rule in plain English as something
  like "country is not DE and is not FR AND appVersion >= 28"
- For `subject-id-targeting`, show the `id` attribute rewritten to `user_id`
  (or whatever Confidence entity field you chose)
- For `legacy-checkout-redesign`, note "Enabled in Production: no" and warn
  that rules will be added at 0% rollout
- Mark `mobile-only-feature` and `general-regex-flag` as **BLOCKED** with
  clear reasons (SemVer, general regex), and `execute` should refuse to
  proceed unless they're either rewritten or `[x] Skip`'d

After you tick `[x] Migrate` on the non-blocked flags and run
`/migrate-eppo execute <plan-file>`, each flag should:

- Be created in your throwaway Confidence client with the right variations
- Have one targeting rule per Eppo allocation, in the same order
- Resolve correctly for both positive and negative test contexts (the skill
  generates these automatically)
- For `pricing-experiment` specifically, also pass the waterfall test:
  resolve with a `country: US` context that misses the first allocation
  and confirm it lands in the 50/50 second allocation

If any of these checks fail, that's a real bug in the skill — please file
it on the PR or open an issue.

## Editing fixtures

To add a new test case, append a new dict to the `FLAGS` list in
`server.py`. Use one of the existing flags as a template — they cover the
full schema surface the skill expects. If your new flag should behave
differently in a specific environment, add an entry to `ENV_OVERRIDES`.

The server has no caching, so changes take effect when you restart it
(`Ctrl+C` and re-run).

## What this does NOT test

- **Real Eppo schema.** Fixtures are doc-derived best-guesses; only a real
  Eppo account can verify the actual response shape today.
- **Eppo's evaluation logic.** This server is config-only; it never decides
  "given subject X, what variant?" That's Eppo's SDK, which is irrelevant
  to the migration — the migration translates *configs*, and post-migration
  evaluation happens on Confidence's side.
- **Authentication semantics.** The server validates the header is present
  but doesn't check the value, scope, or rate-limit behavior.
