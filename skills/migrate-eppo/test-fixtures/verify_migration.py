#!/usr/bin/env python3
"""Verify migrated Eppo flags resolve identically in Confidence.

Computes Eppo's waterfall evaluation locally over the fixture data in
`server.py`, then prints a test matrix to spot-check Confidence resolves
after running `/migrate-eppo execute`.

Purely arithmetic — no network, no fake server required. Run it as a
sanity check before/after the migration; the "Expected (Eppo)" column
should always match what Confidence returns for the same flag + context
pair.

Usage:
    python3 verify_migration.py
"""

import re
from typing import Any

from server import ENV_OVERRIDES, FLAGS

# Resolve flags against the Production environment (matches the
# `legacy-checkout-redesign` inactive-in-prod fixture override).
ENVIRONMENT_ID = 1

# Flags the skill migrates by default. Five additional fixture flags
# (`mobile-only-feature`, `general-regex-flag`, `missing-attribute-
# fallback`, `delivery-pricing-switchback`, `premium-users-only`) are
# deliberately BLOCKED by the skill and won't have Confidence
# equivalents to verify against unless the user manually rewrites them
# during execute.
MIGRATED_FLAGS = [
    "internal-tools-gate",
    "pricing-experiment",
    "legacy-search-rollout",
    "subject-id-targeting",
    "legacy-checkout-redesign",
]

TEST_CONTEXTS: list[dict[str, Any]] = [
    {"name": "spotify-employee-SE", "user_id": "u1", "email": "alice@spotify.com", "country": "SE", "appVersion": 30},
    {"name": "us-user-v30", "user_id": "u2", "email": "bob@gmail.com", "country": "US", "appVersion": 30},
    {"name": "ca-user-v30", "user_id": "u3", "email": "carol@gmail.com", "country": "CA", "appVersion": 30},
    {"name": "de-user-v30", "user_id": "u4", "email": "dave@gmail.com", "country": "DE", "appVersion": 30},
    {"name": "fr-user-v25", "user_id": "u5", "email": "eve@gmail.com", "country": "FR", "appVersion": 25},
    {"name": "uk-user-v30", "user_id": "u6", "email": "fran@gmail.com", "country": "UK", "appVersion": 30},
    {"name": "test-user-1", "user_id": "test-user-1", "email": "test@gmail.com", "country": "SE", "appVersion": 30},
    {"name": "normal-user-SE", "user_id": "u11", "email": "user@gmail.com", "country": "SE", "appVersion": 30},
]


def _coerce_numeric(*vals: Any) -> tuple[float, ...] | None:
    """Coerce each arg to float; return None if any fails."""
    out: list[float] = []
    for v in vals:
        try:
            out.append(float(v))
        except (TypeError, ValueError):
            return None
    return tuple(out)


def eval_condition(condition: dict[str, Any], context: dict[str, Any]) -> bool:
    """Eppo-style condition evaluation against the real schema.

    Uses `values` (array), not `value` (scalar). Numeric operators
    coerce both sides to float; SemVer-looking values would fail
    coercion and return False (the migration skill marks those BLOCKED).
    """
    attr = condition["attribute"]
    op = condition["operator"]
    values = condition["values"]

    # The special `id` attribute targets the subject key; the migration
    # rewrites it to the chosen entity field (here, `user_id`).
    ctx_val = context.get("user_id") if attr == "id" else context.get(attr)

    if op == "IS_NULL":
        return ctx_val is None
    if ctx_val is None:
        return False

    if op == "ONE_OF":
        return str(ctx_val) in [str(v) for v in values]
    if op == "NOT_ONE_OF":
        return str(ctx_val) not in [str(v) for v in values]
    if op == "MATCHES":
        return bool(re.match(values[0], str(ctx_val)))
    if op in ("GTE", "GT", "LTE", "LT"):
        coerced = _coerce_numeric(ctx_val, values[0])
        if coerced is None:
            return False
        a, b = coerced
        if op == "GTE":
            return a >= b
        if op == "GT":
            return a > b
        if op == "LTE":
            return a <= b
        return a < b
    return False


def eval_rule(rule: dict[str, Any], context: dict[str, Any]) -> bool:
    return all(eval_condition(c, context) for c in rule.get("conditions", []))


def eval_allocation(allocation: dict[str, Any], context: dict[str, Any]) -> bool:
    """An allocation matches if any of its targeting_rules matches.

    The default allocation has empty `targeting_rules[]` and empty
    `audiences[]`, which matches everyone — that's Eppo's catch-all
    pattern at the bottom of the waterfall.
    """
    rules = allocation.get("targeting_rules", [])
    if not rules:
        return not allocation.get("audiences", [])
    return any(eval_rule(r, context) for r in rules)


def _variant_key(flag: dict[str, Any], variation_id: int) -> str:
    for v in flag["variations"]:
        if v["id"] == variation_id:
            return v["variant_key"]
    return f"<unknown variation_id={variation_id}>"


def eppo_resolve(flag: dict[str, Any], context: dict[str, Any]) -> str:
    """Walk the Eppo waterfall and return what Confidence should produce.

    Returns:
      - `variant_key` — deterministic single-variant allocation matched
      - `a(N%) | b(M%)` — probabilistic split; Confidence should return
        one of these variants for the given context
      - `NO_MATCH (inactive)` — flag is OFF in the chosen env, Confidence
        is created in the OFF state with all rules at 0% rollout
      - `NO_MATCH` — defensive; with a proper default allocation this
        shouldn't trigger
    """
    override = ENV_OVERRIDES.get((flag["id"], ENVIRONMENT_ID), {})
    if not override.get("active", True):
        return "NO_MATCH (inactive)"
    for alloc in flag["allocations"]:
        if eval_allocation(alloc, context):
            weights = alloc["variation_weight"]
            if len(weights) == 1:
                return _variant_key(flag, weights[0]["variation_id"])
            parts = [
                f"{_variant_key(flag, w['variation_id'])}({w['weight']}%)"
                for w in sorted(weights, key=lambda x: x["variation_id"])
            ]
            return " | ".join(parts)
    return "NO_MATCH"


def main() -> None:
    flags_by_key = {f["key"]: f for f in FLAGS}
    missing = [k for k in MIGRATED_FLAGS if k not in flags_by_key]
    if missing:
        raise SystemExit(f"Fixture flags missing from server.py: {missing}")

    ctx_name_width = max(len(c["name"]) for c in TEST_CONTEXTS)
    flag_width = max(len(k) for k in MIGRATED_FLAGS)

    header = f"{'Context':<{ctx_name_width}}  {'Flag':<{flag_width}}  Expected (Eppo)"
    bar = "=" * len(header)
    print(bar)
    print("  Eppo → Confidence Migration Verification Matrix")
    print(bar)
    print()
    print(header)
    print("-" * len(header))

    total = 0
    deterministic = 0
    for ctx in TEST_CONTEXTS:
        for flag_key in MIGRATED_FLAGS:
            flag = flags_by_key[flag_key]
            result = eppo_resolve(flag, ctx)
            marker = "  " if "NO_MATCH" in result or "|" in result else "→ "
            print(f"{ctx['name']:<{ctx_name_width}}  {flag_key:<{flag_width}}  {marker}{result}")
            total += 1
            if "|" not in result:
                deterministic += 1
        print()

    print("-" * len(header))
    print(f"Total test cases: {total}")
    print(f"Deterministic (exact match expected): {deterministic}")
    print(f"Probabilistic (verify Confidence returned one of the listed variants): {total - deterministic}")
    print()
    print("Legend:")
    print("  → variant            deterministic — Confidence must return this exact variant")
    print("  NO_MATCH (inactive)  flag is OFF in this env — Confidence returns its default value")
    print("  NO_MATCH             no allocation matched (shouldn't happen with a default allocation)")
    print("  a(50%) | b(50%)      probabilistic split — Confidence returns one of these variants")


if __name__ == "__main__":
    main()
