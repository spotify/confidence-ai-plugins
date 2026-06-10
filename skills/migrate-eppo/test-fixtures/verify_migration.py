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

from server import AUDIENCES, ENV_OVERRIDES, FLAGS

# Resolve flags against the Production environment (matches the
# `legacy-checkout-redesign` inactive-in-prod fixture override).
ENVIRONMENT_ID = 1

# Flags the skill migrates by default. After the deep-dive into the
# Confidence resolver proto/source, five cases that were previously
# treated as blockers now migrate cleanly and are verified here:
#   * mobile-only-feature       — SemVer via versionValue
#   * general-regex-flag        — MATCHES alternation → endsWith decomposition
#   * missing-attribute-fallback — IS_NULL → ruleless presence criterion under `not`
#   * null-and-condition        — IS_NULL ANDed with another condition → and(not(exists), eq)
#   * premium-users-only        — Eppo audiences → Confidence segments
#
# Two fixtures remain genuinely BLOCKED (no clean translation) and are
# NOT listed here:
#   * delivery-pricing-switchback — time-windowed SWITCHBACK
#   * regex-id-format             — generic regex (char class + quantifier)
MIGRATED_FLAGS = [
    "internal-tools-gate",
    "pricing-experiment",
    "legacy-search-rollout",
    "subject-id-targeting",
    "legacy-checkout-redesign",
    "mobile-only-feature",
    "general-regex-flag",
    "missing-attribute-fallback",
    "null-and-condition",
    "premium-users-only",
]

BLOCKED_FLAGS = [
    "delivery-pricing-switchback",
    "regex-id-format",
]

TEST_CONTEXTS: list[dict[str, Any]] = [
    {"name": "spotify-employee-SE", "user_id": "u1", "email": "alice@spotify.com", "country": "SE", "appBuildNumber": 30, "appVersion": "2.0.0", "device": "iOS", "plan": "premium"},
    {"name": "us-premium-ios", "user_id": "u2", "email": "bob@gmail.com", "country": "US", "appBuildNumber": 30, "appVersion": "2.1.0", "device": "iOS", "plan": "premium"},
    {"name": "ca-free-android", "user_id": "u3", "email": "carol@gmail.com", "country": "CA", "appBuildNumber": 30, "appVersion": "1.1.0", "device": "Android", "plan": "free"},
    {"name": "de-enterprise-web", "user_id": "u4", "email": "dave@gmail.com", "country": "DE", "appBuildNumber": 30, "appVersion": "2.0.0", "device": "Web", "plan": "enterprise"},
    {"name": "fr-build25-old", "user_id": "u5", "email": "eve@gmail.com", "country": "FR", "appBuildNumber": 25, "appVersion": "1.0.0", "device": "Android", "plan": "free"},
    {"name": "uk-qa-email", "user_id": "u6", "email": "tester@qa.com", "country": "UK", "appBuildNumber": 30, "appVersion": "2.0.0", "device": "iOS", "plan": "premium"},
    {"name": "test-user-1", "user_id": "test-user-1", "email": "test@gmail.com", "country": "SE", "appBuildNumber": 30, "appVersion": "2.0.0", "device": "iOS", "plan": "premium"},
    {"name": "noplan-user-SE", "user_id": "u11", "email": "user@gmail.com", "country": "SE", "appBuildNumber": 30, "appVersion": "1.5.0", "device": "Android"},
    {"name": "nocountry-free", "user_id": "u12", "email": "user2@gmail.com", "appBuildNumber": 30, "appVersion": "2.0.0", "device": "iOS", "plan": "free"},
]

# Matches the migration skill's SemVer heuristic: 2–4 numeric segments
# with an optional pre-release suffix.
_SEMVER_RE = re.compile(r"^\d+(\.\d+){1,3}(-.+)?$")


def _parse_version(value: Any) -> tuple[int, int, int, int]:
    """Mirror the Confidence resolver's version parser (value.rs).

    2–4 numeric segments; pre-release suffix after '-' is stripped;
    anything unparseable sorts as (0, 0, 0, 0). This is the ground truth
    we expect Confidence to reproduce for versionValue comparisons.
    """
    s = str(value).split("-", 1)[0]
    parts = s.split(".")
    if not (2 <= len(parts) <= 4) or not all(p.isdigit() and len(p) <= 10 for p in parts):
        return (0, 0, 0, 0)
    nums = [int(p) for p in parts]
    if len(parts) == 3 and len(parts[2]) > 3:
        # >3-digit third segment is treated as a tag, patch becomes 0
        nums = [nums[0], nums[1], 0, nums[2]]
    nums += [0] * (4 - len(nums))
    return tuple(nums[:4])  # type: ignore[return-value]


def _coerce_numeric(*vals: Any) -> tuple[float, ...] | None:
    """Coerce each arg to float; return None if any fails."""
    out: list[float] = []
    for v in vals:
        try:
            out.append(float(v))
        except (TypeError, ValueError):
            return None
    return tuple(out)


def _compare(op: str, ctx_val: Any, rule_val: Any) -> bool:
    """GT/GTE/LT/LTE comparison. Versions if the rule value looks like a
    SemVer (matching the skill's detection), otherwise numeric."""
    if _SEMVER_RE.match(str(rule_val)):
        a: Any = _parse_version(ctx_val)
        b: Any = _parse_version(rule_val)
    else:
        coerced = _coerce_numeric(ctx_val, rule_val)
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


def eval_condition(condition: dict[str, Any], context: dict[str, Any]) -> bool:
    """Eppo-style condition evaluation against the real schema.

    Models Eppo's ground-truth behaviour (the target the migration must
    reproduce): regex via Python `re`, numeric vs SemVer comparison by
    the value shape, set membership, and null checks.
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
        return bool(re.search(values[0], str(ctx_val)))
    if op in ("GTE", "GT", "LTE", "LT"):
        return _compare(op, ctx_val, values[0])
    return False


def eval_rule(rule: dict[str, Any], context: dict[str, Any]) -> bool:
    return all(eval_condition(c, context) for c in rule.get("conditions", []))


_AUDIENCES_BY_ID = {a["id"]: a for a in AUDIENCES}


def _in_audience(audience_id: int, context: dict[str, Any]) -> bool:
    """An audience matches if any of its targeting_rules matches (rules
    OR'd, conditions within a rule AND'd) — same shape as a flag rule."""
    audience = _AUDIENCES_BY_ID.get(audience_id)
    if audience is None:
        return False
    return any(eval_rule(r, context) for r in audience.get("targeting_rules", []))


def eval_allocation(allocation: dict[str, Any], context: dict[str, Any]) -> bool:
    """An allocation matches when its targeting_rules AND audiences match.

    - targeting_rules[]: OR across rules (empty → matches on this axis)
    - audiences[]: IS_IN must be in, IS_NOT_IN must not be in (ANDed)
    The default allocation has neither and matches everyone.
    """
    rules = allocation.get("targeting_rules", [])
    audiences = allocation.get("audiences", [])

    rules_ok = (not rules) or any(eval_rule(r, context) for r in rules)
    if not rules_ok:
        return False

    for ref in audiences:
        inside = _in_audience(ref["audience_id"], context)
        if ref["type"] == "IS_IN" and not inside:
            return False
        if ref["type"] == "IS_NOT_IN" and inside:
            return False
    return True


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
      - `NO_MATCH` — defensive; a flag with an `is_default` allocation
        never reaches this, because that allocation matches everyone and
        is migrated as Confidence's catch-all final rule (100% → default
        variant), which Confidence returns when no specific rule matches
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
    print("  NO_MATCH             no allocation matched (won't happen when an is_default allocation exists — it's the catch-all rule)")
    print("  a(50%) | b(50%)      probabilistic split — Confidence returns one of these variants")
    print()
    blocked_present = [k for k in BLOCKED_FLAGS if k in flags_by_key]
    if blocked_present:
        print("Intentionally BLOCKED (no clean Confidence translation; not migrated):")
        reasons = {
            "delivery-pricing-switchback": "time-windowed SWITCHBACK allocation",
            "regex-id-format": "generic regex (character class + quantifier)",
        }
        for k in blocked_present:
            print(f"  ⊘ {k:<28} {reasons.get(k, '')}")


if __name__ == "__main__":
    main()
