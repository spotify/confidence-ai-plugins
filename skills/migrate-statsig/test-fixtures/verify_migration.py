#!/usr/bin/env python3
"""Model Statsig's evaluation over the fixtures to produce a ground-truth matrix.

This computes, locally and with no network, what each fixture
gate/dynamic-config/experiment is expected to return for a set of test
contexts. Use it to spot-check that Confidence resolves (after running
`/migrate-statsig execute`) match Statsig for the same context.

It deliberately models the **deterministic** part of evaluation:
condition matching and the waterfall. The random percentage dimension
(passPercentage / group size / allocation) is reported as metadata, not
simulated — bucketing is stable per unit ID but its exact split is a
property of the hashing, not the translation, so the matrix reports the
pass-eligible variant(s) and their configured split.

Run:
    python3 verify_migration.py
"""

from __future__ import annotations

import re
from typing import Any

from server import DYNAMIC_CONFIGS, EXPERIMENTS, GATES, SEGMENTS

SEGMENTS_BY_ID = {s["id"]: s for s in SEGMENTS}
GATES_BY_ID = {g["id"]: g for g in GATES}


# ---------------------------------------------------------------------------
# Condition / operator evaluation (the same surface the skill translates)
# ---------------------------------------------------------------------------

# Operators that have no clean Confidence translation. A condition using
# one of these makes the whole rule (and usually the flag) BLOCKED.
# passes_gate/fails_gate are NOT blocked — the referenced gate's
# conditions can be inlined (modeled below).
BLOCKED_OPERATORS = {"str_contains_any", "str_contains_none"}
BLOCKED_TYPES = {"experiment_group", "javascript"}


class Blocked(Exception):
    """Raised when a condition cannot be migrated/evaluated."""


def _as_list(v: Any) -> list[Any]:
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def _ver_tuple(s: str) -> tuple[int, ...]:
    s = s.split("-", 1)[0]
    return tuple(int(p) for p in s.split("."))


def _regex_alternation_ok(pattern: str) -> bool:
    """True if a str_matches value is a prefix/suffix/alternation we can map.

    Mirrors the skill's decomposition rule: after stripping anchors and
    leading/trailing `.*`, the remainder must be literal text (escaped
    dots ok) with at most ONE alternation group of literals — no other
    regex metacharacters (`.` as wildcard, quantifiers, classes, ...).
    """
    metachars = r"[\[\]+?{}\\.*]"  # checked after removing `\.` escapes
    body = pattern
    anchored_end = body.endswith("$")
    anchored_start = body.startswith("^")
    body = body.lstrip("^").rstrip("$")
    body = re.sub(r"^\.\*", "", body)
    body = re.sub(r"\.\*$", "", body)
    groups = re.findall(r"\(([^()]*)\)", body)
    if len(groups) > 1:
        return False
    if any(re.search(metachars, g.replace("\\.", "")) for g in groups):
        return False
    stripped = re.sub(r"\([^()]*\)", "", body).replace("\\.", "")
    return (anchored_start or anchored_end) and not re.search(metachars, stripped)


def eval_condition(cond: dict[str, Any], ctx: dict[str, Any], entity_value: str) -> bool:
    ctype = cond.get("type")
    op = cond.get("operator")
    targets = _as_list(cond.get("targetValue"))

    if ctype in BLOCKED_TYPES or op in BLOCKED_OPERATORS:
        raise Blocked(f"{ctype}/{op}")

    if ctype == "public":
        return True

    if ctype in ("passes_segment", "fails_segment"):
        seg = SEGMENTS_BY_ID.get(targets[0])
        if seg is None:
            raise Blocked(f"unknown segment {targets[0]}")
        if seg.get("type") in ("id_list", "user_store_id_list"):
            raise Blocked(f"id_list segment {seg['id']} (REST materialized)")
        if seg.get("type") != "rule_based":
            # e.g. analysis_list — analysis-only audience, no Confidence equivalent
            raise Blocked(f"{seg.get('type')} segment {seg['id']}")
        in_seg = eval_rules(seg["rules"], ctx, entity_value) is not None
        return in_seg if ctype == "passes_segment" else not in_seg

    if ctype in ("passes_gate", "fails_gate"):
        gate = GATES_BY_ID.get(targets[0])
        if gate is None:
            raise Blocked(f"unknown gate {targets[0]}")
        passes = eval_rules(gate["rules"], ctx, entity_value) is not None
        return passes if ctype == "passes_gate" else not passes

    # Pick the value from context. user_id/unit_id read the entity value.
    if ctype in ("user_id", "unit_id"):
        value = entity_value
    elif ctype == "custom_field":
        value = ctx.get(cond.get("field"))
    elif ctype == "os_name":
        value = ctx.get("os")
    elif ctype == "app_version":
        value = ctx.get("appVersion")
    else:
        value = ctx.get(ctype)

    if op in ("any", "any_case_sensitive"):
        return value in targets
    if op in ("none", "none_case_sensitive"):
        return value not in targets
    if op == "eq":
        return value == targets[0]
    if op == "neq":
        return value != targets[0]
    if op in ("gt", "gte", "lt", "lte"):
        if value is None:
            return False
        v, t = float(value), float(targets[0])
        return {"gt": v > t, "gte": v >= t, "lt": v < t, "lte": v <= t}[op]
    if op in ("version_gt", "version_gte", "version_lt", "version_lte", "version_eq", "version_neq"):
        if value is None:
            return False
        v, t = _ver_tuple(str(value)), _ver_tuple(targets[0])
        return {
            "version_gt": v > t,
            "version_gte": v >= t,
            "version_lt": v < t,
            "version_lte": v <= t,
            "version_eq": v == t,
            "version_neq": v != t,
        }[op]
    if op == "str_starts_with_any":
        return any(str(value).startswith(t) for t in targets) if value is not None else False
    if op == "str_ends_with_any":
        return any(str(value).endswith(t) for t in targets) if value is not None else False
    if op == "str_matches":
        if not _regex_alternation_ok(targets[0]):
            raise Blocked(f"generic regex {targets[0]}")
        return re.search(targets[0], str(value)) is not None if value is not None else False

    raise Blocked(f"unhandled operator {op}")


def eval_rules(rules: list[dict[str, Any]], ctx: dict[str, Any], entity_value: str) -> dict | None:
    """Return the first matching rule (waterfall), or None if no rule matches."""
    for rule in rules:
        try:
            if all(eval_condition(c, ctx, entity_value) for c in rule["conditions"]):
                return rule
        except Blocked:
            continue
    return None


def references_id_list(rules: list[dict[str, Any]]) -> str | None:
    """Return the id_list segment id a rule references (REST/materialized), else None."""
    for rule in rules:
        for c in rule.get("conditions", []):
            if c.get("type") in ("passes_segment", "fails_segment"):
                seg = SEGMENTS_BY_ID.get(_as_list(c.get("targetValue"))[0])
                if seg and seg.get("type") in ("id_list", "user_store_id_list"):
                    return seg["id"]
    return None


def flag_is_blocked(rules: list[dict[str, Any]]) -> str | None:
    """Return a reason if every non-trivial rule is blocked, else None."""
    reasons = []
    any_ok = False
    for rule in rules:
        try:
            for c in rule["conditions"]:
                # Probe each condition for migratability with a dummy ctx.
                eval_condition(c, {}, "")
            any_ok = True
        except Blocked as b:
            reasons.append(str(b))
    return None if any_ok else (reasons[0] if reasons else "all rules blocked")


# ---------------------------------------------------------------------------
# Test contexts
# ---------------------------------------------------------------------------

CONTEXTS: dict[str, dict[str, Any]] = {
    "spotify-emp": {"email": "emp@spotify.com", "country": "US", "appBuildNumber": 30},
    "us-newbuild": {"country": "US", "appBuildNumber": 30},
    "de-newbuild": {"country": "DE", "appBuildNumber": 30},
    "us-oldbuild": {"country": "US", "appBuildNumber": 20},
    "ios-1.3": {"os": "iOS", "appVersion": "1.3.0"},
    "ios-1.1": {"os": "iOS", "appVersion": "1.1.0"},
    "qa-email": {"email": "x@qa.com"},
    "premium-gmail": {"plan": "premium", "email": "u@gmail.com"},
    "premium-spotify": {"plan": "premium", "email": "u@spotify.com"},
    "free-jp": {"plan": "free", "country": "JP"},
}

ENTITY = "test-user-1"  # exercises the user_id allowlist gate


def main() -> None:
    print("=" * 72)
    print("Statsig fixture evaluation — ground-truth matrix")
    print("=" * 72)

    print("\n## Feature gates (boolean) — first matching rule, or default false\n")
    for gate in GATES:
        if gate.get("status") in ("Archived", "archived"):
            print(f"  {gate['id']:<26} ARCHIVED (excluded from default scan)")
            continue
        if not gate.get("isEnabled", True):
            print(f"  {gate['id']:<26} DISABLED in Statsig (false for every "
                  "context; migrates OFF — rules at 0%)")
            continue
        id_list = references_id_list(gate["rules"])
        if id_list:
            print(f"  {gate['id']:<26} REST backend (id_list segment "
                  f"'{id_list}' → materialized segment / BigQuery)")
            continue
        blocked = flag_is_blocked(gate["rules"])
        if blocked:
            print(f"  {gate['id']:<26} BLOCKED ({blocked})")
            continue
        cells = []
        for cname, ctx in CONTEXTS.items():
            rule = eval_rules(gate["rules"], ctx, ENTITY)
            if rule is None:
                cells.append(f"{cname}=off")
            else:
                pp = rule["passPercentage"]
                cells.append(f"{cname}={'on' if pp else 'off'}@{pp}%")
        print(f"  {gate['id']:<26}")
        for c in cells:
            if "=on" in c or "off@" in c:
                print(f"      {c}")

    print("\n## Dynamic configs — returned variant value (or defaultValue)\n")
    for cfg in DYNAMIC_CONFIGS:
        print(f"  {cfg['id']}  (default={cfg['defaultValue']})")
        if not cfg.get("isEnabled", True):
            print("      DISABLED in Statsig (defaultValue for every context; "
                  "migrates OFF — rules at 0%)")
            continue
        for cname, ctx in CONTEXTS.items():
            rule = eval_rules(cfg["rules"], ctx, ENTITY)
            val = rule["returnValue"] if rule else cfg["defaultValue"]
            print(f"      {cname:<16} -> {val}")

    print("\n## Experiments — group split + allocation + targeting\n")
    for exp in EXPERIMENTS:
        groups = ", ".join(f"{g['name']}={g['size']}%" for g in exp["groups"])
        itr = exp.get("inlineTargetingRules") or []  # key is absent when unset
        tgate = GATES_BY_ID.get(exp["targetingGateID"]) if exp.get("targetingGateID") else None
        targ = ("inline-targeted" if itr else
                f"gate:{tgate['id']}" if tgate else "all")
        print(f"  {exp['id']}")
        print(f"      allocation={exp['allocation']}%  groups=[{groups}]  targeting={targ}")
        if exp["allocation"] < 100:
            print("      NOTE: allocation < 100 — exact via REST segment proportion "
                  f"({exp['allocation'] / 100}); MCP can only approximate")
        if exp["layerID"]:
            print(f"      NOTE: layer '{exp['layerID']}' → REST exclusivity group "
                  "(exclusivityTags)")
        holdouts = list(dict.fromkeys(exp.get("holdoutIDs") or []))  # live API duplicates entries
        if holdouts:
            print(f"      NOTE: holdouts {holdouts} → Confidence holdback "
                  "(surface step)")
        for cname, ctx in CONTEXTS.items():
            eligible = eval_rules(itr, ctx, ENTITY) is not None if itr else True
            if eligible and tgate:  # targetingGateID restricts entry like passes_gate
                eligible = eval_rules(tgate["rules"], ctx, ENTITY) is not None
            print(f"      {cname:<16} -> {'in-experiment' if eligible else 'control (untargeted)'}")

    print("\nDone. Compare these against Confidence resolveFlag output.")


if __name__ == "__main__":
    main()
