#!/usr/bin/env python3
"""Model Optimizely's evaluation over the fixtures to produce a ground-truth matrix.

This computes, locally and with no network, what each fixture flag is
expected to return for a set of test contexts. Use it to spot-check that
Confidence resolves (after running `/migrate-optimizely execute`) match
Optimizely for the same context.

It deliberately models the **deterministic** part of evaluation: audience
matching and the ruleset waterfall (`rule_priorities`, first match wins).
The random percentage dimension (`percentage_included` / variation split)
is reported as metadata, not simulated — bucketing is stable per
bucketing ID but its exact split is a property of the hashing, not the
config translation.

Run:
    python3 verify_migration.py
"""

from __future__ import annotations

import json
from typing import Any

from server import AUDIENCES_BY_ID, FLAGS

# match_types with no clean Confidence translation → BLOCKED.
# `exists` is blocked because Confidence has no working presence operator:
# a ruleless attribute criterion stores as operator "unknown" and errors at
# resolve (verified live against the resolver).
BLOCKED_MATCH_TYPES = {"substring", "regex", "exists"}


class Blocked(Exception):
    """Raised when a condition cannot be migrated/evaluated."""


def _ver_tuple(s: str) -> tuple[int, ...]:
    return tuple(int(p) for p in str(s).split("-", 1)[0].split("."))


def eval_leaf(leaf: dict[str, Any], ctx: dict[str, Any]) -> bool:
    ctype = leaf.get("type")
    if ctype != "custom_attribute":
        raise Blocked(f"non-custom_attribute audience leaf '{ctype}'")
    mt = leaf.get("match_type") or ("exact" if "value" in leaf else "exists")
    if mt in BLOCKED_MATCH_TYPES:
        raise Blocked(f"match_type '{mt}'")

    value = ctx.get(leaf["name"])
    target = leaf.get("value")

    if value is None:
        return False
    if mt == "exact":
        return value == target
    if mt in ("gt", "ge", "lt", "le"):
        v, t = float(value), float(target)
        return {"gt": v > t, "ge": v >= t, "lt": v < t, "le": v <= t}[mt]
    if mt.startswith("semver_"):
        v, t = _ver_tuple(value), _ver_tuple(target)
        return {
            "semver_eq": v == t,
            "semver_gt": v > t,
            "semver_ge": v >= t,
            "semver_lt": v < t,
            "semver_le": v <= t,
        }[mt]
    raise Blocked(f"unhandled match_type '{mt}'")


def eval_tree(node: Any, ctx: dict[str, Any]) -> bool:
    """Evaluate the list-based condition language (or an audience_id ref)."""
    if isinstance(node, dict):
        if "audience_id" in node:
            aud = AUDIENCES_BY_ID.get(node["audience_id"])
            if aud is None:
                raise Blocked(f"unknown audience {node['audience_id']}")
            return eval_tree(json.loads(aud["conditions"]), ctx)
        return eval_leaf(node, ctx)
    if isinstance(node, list):
        if not node:
            return True  # empty audience_conditions = everyone
        op, rest = node[0], node[1:]
        if op == "and":
            return all(eval_tree(c, ctx) for c in rest)
        if op == "or":
            return any(eval_tree(c, ctx) for c in rest)
        if op == "not":
            return not eval_tree(rest[0], ctx)
        # bare list of conditions → treat as AND
        return all(eval_tree(c, ctx) for c in node)
    raise Blocked(f"unexpected node {node!r}")


def rule_matches(rule: dict[str, Any], ctx: dict[str, Any]) -> bool:
    if not rule.get("enabled", True):
        return False
    return eval_tree(rule.get("audience_conditions", []), ctx)


def rule_is_blocked(rule: dict[str, Any]) -> str | None:
    try:
        eval_tree(rule.get("audience_conditions", []), {})
        return None
    except Blocked as b:
        return str(b)


def flag_backend(flag: dict[str, Any]) -> str:
    """REST if any non-last rule has partial allocation (fall-through)."""
    prios = flag["_rule_priorities"]
    for i, rk in enumerate(prios):
        rule = flag["_rules"][rk]
        partial = rule["percentage_included"] < 10000
        not_last = i < len(prios) - 1
        if partial and not_last:
            return "REST"
    return "MCP"


CONTEXTS: dict[str, dict[str, Any]] = {
    "beta-us": {"is_beta": True, "country": "US", "is_logged_in": True},
    "us-ios-13": {"country": "US", "os": "ios", "app_version": "1.3.0"},
    "us-ios-11": {"country": "US", "os": "ios", "app_version": "1.1.0"},
    "ca-anon": {"country": "CA"},
    "de-user": {"country": "DE", "is_logged_in": True},
    "recent-buyer": {"days_since_last_order": 3},
    "old-buyer": {"days_since_last_order": 40},
    "member": {"is_logged_in": True, "is_internal": False, "plan": "pro"},
    "staff": {"is_logged_in": True, "is_internal": True, "plan": "pro"},
}


def main() -> None:
    print("=" * 72)
    print("Optimizely fixture evaluation — ground-truth matrix (env: production)")
    print("=" * 72)

    for flag in FLAGS:
        if flag["archived"]:
            print(f"\n  {flag['key']:<22} ARCHIVED (excluded from default scan)")
            continue

        shape = "boolean" if not flag["variable_definitions"] else \
            f"struct({', '.join(flag['variable_definitions'])})"
        print(f"\n  {flag['key']}  [{shape}]")

        if not flag["_enabled"]:
            print("      DISABLED in Optimizely (off for every context; "
                  "migrates OFF — rules at 0%)")
            continue

        prios = flag["_rule_priorities"]
        blocked = [rule_is_blocked(flag["_rules"][rk]) for rk in prios]
        if all(b is not None for b in blocked):
            print(f"      BLOCKED ({blocked[0]})")
            continue

        backend = flag_backend(flag)
        for rk in prios:
            r = flag["_rules"][rk]
            split = ", ".join(f"{vk}={vp/100:g}%" for vk, vp in
                              {k: v["percentage_included"] for k, v in r["variations"].items()}.items())
            adaptive = r["distribution_mode"] != "manual" or r["type"] == "multi_armed_bandit"
            note = "  (ADAPTIVE — snapshot)" if adaptive else ""
            print(f"      rule {rk} [{r['type']}] traffic={r['percentage_included']/100:g}% "
                  f"split=[{split}]{note}")
        print(f"      backend: {backend}"
              + ("  (partial allocation must fall through)" if backend == "REST" else ""))

        for cname, ctx in CONTEXTS.items():
            matched = None
            for rk in prios:
                rule = flag["_rules"][rk]
                if rule_is_blocked(rule):
                    continue
                if rule_matches(rule, ctx):
                    matched = rk
                    break
            result = f"rule '{matched}'" if matched else f"default '{flag['_default_variation_key']}'"
            print(f"        {cname:<14} -> {result}")

    print("\nDone. Compare these against Confidence resolveFlag output.")


if __name__ == "__main__":
    main()
