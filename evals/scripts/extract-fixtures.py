#!/usr/bin/env python3
"""Extract Optimizely fixture data from server.py for Braintrust evals.

Requires Python 3.10+ because server.py uses union type syntax (list[int] | None).
Falls back to AST-safe extraction if Python version is too old.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

FIXTURE_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'skills', 'migrate-optimizely', 'test-fixtures')
OUT_PATH = os.path.join(os.path.dirname(__file__), '..', 'fixtures', 'optimizely-flags.json')

EXTRACT_SCRIPT = '''
from __future__ import annotations
import sys, os, json
sys.path.insert(0, os.environ["FIXTURE_DIR"])
from server import FLAGS, AUDIENCES, AUDIENCES_BY_ID

ENV = "production"

def get_ruleset(flag):
    rules = {}
    rule_priorities = flag.get("_rule_priorities", [])
    for rk in rule_priorities:
        r = flag.get("_rules", {}).get(rk)
        if r:
            rules[rk] = {
                "key": r.get("key", rk),
                "name": r.get("name", rk),
                "type": r.get("type", "targeted_delivery"),
                "enabled": r.get("enabled", True),
                "percentage_included": r.get("percentage_included", 10000),
                "distribution_mode": r.get("distribution_mode", "manual"),
                "audience_conditions": r.get("audience_conditions", []),
                "audience_ids": r.get("audience_ids", []),
                "variations": r.get("variations", {}),
            }
    return {
        "enabled": flag.get("_enabled", True) if isinstance(flag.get("_enabled"), bool) else flag.get("_enabled", {}).get(ENV, True),
        "default_variation_key": flag.get("_default_variation_key", "off"),
        "rule_priorities": rule_priorities,
        "rules": rules,
    }

def get_variations(flag):
    return flag.get("_variations", [])

def walk_blocked(cond):
    if isinstance(cond, dict):
        ctype = cond.get("type", "")
        if ctype != "custom_attribute" and ctype in ("browser", "device", "query", "cookie", "location"):
            return f"non_custom_attribute_{ctype}"
        mt = cond.get("match_type", "exact")
        if mt == "substring": return "substring"
        if mt == "regex": return "regex"
        if mt == "exists": return "exists"
        return None
    if isinstance(cond, list):
        for item in cond:
            if isinstance(item, str): continue
            r = walk_blocked(item)
            if r: return r
    return None

def check_audiences_blocked(audience_ids):
    for aid in audience_ids:
        aud = AUDIENCES_BY_ID.get(aid)
        if not aud: continue
        conds = aud.get("conditions", "[]")
        if isinstance(conds, str):
            try: conds = json.loads(conds)
            except: continue
        r = walk_blocked(conds)
        if r: return r
    return None

def classify(flag, ruleset):
    if flag.get("archived"):
        return "archived", None, None
    if not ruleset.get("enabled"):
        return "excluded", "disabled_ruleset", None
    rules = ruleset.get("rules", {})
    priorities = ruleset.get("rule_priorities", [])
    needs_rest = False
    for i, rk in enumerate(priorities):
        rule = rules.get(rk, {})
        if not rule.get("enabled", True): continue
        rtype = rule.get("type", "")
        dist = rule.get("distribution_mode", "manual")
        pct = rule.get("percentage_included", 0)
        if rtype == "multi_armed_bandit" or dist in ("stats_accelerator", "stats_engine"):
            return "excluded", "adaptive_distribution", None
        if rtype in ("a/b", "feature_test"):
            distinct = set(rule.get("variations", {}).keys())
            if len(distinct) >= 2:
                return "excluded", "live_ab_test", None
        blocked = check_audiences_blocked(rule.get("audience_ids", []))
        if blocked:
            return "blocked", blocked, None
        if rtype == "targeted_delivery" and pct not in (0, 10000) and i < len(priorities) - 1:
            needs_rest = True
    return "migrate", None, "REST" if needs_rest else "MCP"

def detect_shape(flag, variations):
    if flag.get("variable_definitions", {}):
        return "struct"
    keys = {v["key"] for v in variations}
    return "boolean" if keys == {"on", "off"} else "struct"

entries = []
for f in FLAGS:
    key = f["key"]
    ruleset = get_ruleset(f)
    variations = get_variations(f)
    shape = detect_shape(f, variations)
    scope, blocked_reason, backend = classify(f, ruleset)
    ref_auds = {}
    for rk in ruleset.get("rule_priorities", []):
        rule = ruleset.get("rules", {}).get(rk, {})
        for aid in rule.get("audience_ids", []):
            aud = AUDIENCES_BY_ID.get(aid)
            if aud:
                ref_auds[str(aid)] = {"id": aid, "name": aud["name"], "conditions": aud["conditions"]}
    entries.append({
        "key": key,
        "name": f.get("name", key),
        "description": f.get("description", ""),
        "archived": f.get("archived", False),
        "variable_definitions": f.get("variable_definitions", {}),
        "variations": variations,
        "ruleset": ruleset,
        "referenced_audiences": ref_auds,
        "ground_truth": {
            "flag_shape": shape,
            "scope": scope,
            "blocked_reason": blocked_reason,
            "backend": backend,
        },
    })

print(json.dumps({"environment": ENV, "flags": entries}, indent=2))
'''

def main():
    env = os.environ.copy()
    env["FIXTURE_DIR"] = os.path.abspath(FIXTURE_DIR)

    result = subprocess.run(
        [sys.executable, "-c", EXTRACT_SCRIPT],
        capture_output=True, text=True, env=env,
    )

    if result.returncode != 0:
        print(f"Extraction failed (Python {sys.version}):", file=sys.stderr)
        print(result.stderr, file=sys.stderr)

        if "unsupported operand" in result.stderr or "TypeError" in result.stderr:
            print("\nserver.py requires Python 3.10+. Trying python3.10...", file=sys.stderr)
            for py in ("python3.13", "python3.12", "python3.11", "python3.10"):
                try:
                    result = subprocess.run(
                        [py, "-c", EXTRACT_SCRIPT],
                        capture_output=True, text=True, env=env,
                    )
                    if result.returncode == 0:
                        print(f"Success with {py}", file=sys.stderr)
                        break
                except FileNotFoundError:
                    continue

    if result.returncode != 0:
        print("All Python versions failed. stderr:", file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        sys.exit(1)

    data = json.loads(result.stdout)

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(data, f, indent=2)

    flags = data["flags"]
    print(f"Extracted {len(flags)} flags to {os.path.abspath(OUT_PATH)}")
    for e in flags:
        gt = e["ground_truth"]
        b = gt.get("backend") or "-"
        br = gt.get("blocked_reason") or "-"
        print(f"  {e['key']:30s}  shape={gt['flag_shape']:8s}  scope={gt['scope']:10s}  backend={b:4s}  blocked={br}")


if __name__ == "__main__":
    main()
