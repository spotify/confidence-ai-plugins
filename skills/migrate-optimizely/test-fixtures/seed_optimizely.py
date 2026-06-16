#!/usr/bin/env python3
"""Seed a real Optimizely project with the migrate-optimizely test fixtures.

Pushes the fixtures defined in `server.py` into an actual Optimizely
Feature Experimentation project through the REST API, so the migration
skill can be tested end-to-end against real Optimizely (wire format,
pagination, auth) instead of the fake server.

Prerequisites:
  * An Optimizely account + Feature Experimentation project.
  * An API token (Personal Access Token, Account Settings > API Access),
    exported as OPTIMIZELY_API_TOKEN.
  * The numeric project id, passed via --project-id.

Run:
    export OPTIMIZELY_API_TOKEN=...
    python3 seed_optimizely.py --project-id 12345          # create everything
    python3 seed_optimizely.py --project-id 12345 --dry-run
    python3 seed_optimizely.py --project-id 12345 --teardown

What gets seeded (mirrors server.py):
  * audiences  — one per fixture audience (POST /v2/audiences)
  * flags      — one per fixture flag, with variable_definitions
                 (POST /flags/v1/projects/{id}/flags)
  * variations — struct flags get their non-default variations
  * rules      — added to each flag's `development` ruleset via a
                 json-patch PATCH on the ruleset

KNOWN LIMITATIONS — this is a BEST-EFFORT seeder and a few steps need the
Optimizely UI:
  * Optimizely auto-creates `on`/`off` variations on flag create; only
    extra/struct variations are created here.
  * Ruleset rules are added to the `development` environment and left
    DISABLED; enable + push to production in the UI (or via the
    ruleset/enabled endpoint) before running the migration against the
    `production` env. The fake server serves everything under
    `production`, so when seeding real Optimizely, run the migration
    against the `development` env (or promote the rules first).
  * `multi_armed_bandit` and `stats_accelerator` distribution require a
    plan that supports them; the MAB fixture may need to be created as a
    plain a/b in the UI on lower tiers.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

from server import AUDIENCES, FLAGS

FLAGS_BASE = "https://api.optimizely.com/flags/v1"
V2_BASE = "https://api.optimizely.com/v2"
SEED_ENV = "development"


class Api:
    def __init__(self, token: str, dry_run: bool):
        self.token = token
        self.dry_run = dry_run

    def call(self, method: str, url: str, body: Any = None, content_type: str = "application/json") -> tuple[int, Any]:
        if self.dry_run:
            print(f"  DRY-RUN {method} {url}" + (f" {json.dumps(body)[:120]}..." if body else ""))
            return 200, {}
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.token}")
        req.add_header("Accept", "application/json")
        if data:
            req.add_header("Content-Type", content_type)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, json.loads(resp.read() or b"{}")
        except urllib.error.HTTPError as e:
            try:
                payload = json.loads(e.read() or b"{}")
            except json.JSONDecodeError:
                payload = {}
            return e.code, payload


def step(api: Api, label: str, method: str, url: str, body: Any = None, content_type: str = "application/json") -> bool:
    code, payload = api.call(method, url, body, content_type)
    if 200 <= code < 300:
        print(f"  ✓ {label}")
        return True
    detail = payload.get("message") or payload.get("errors") or payload
    msg = json.dumps(detail) if not isinstance(detail, str) else detail
    if code in (400, 409) and any(s in msg.lower() for s in ("already", "duplicate", "exists")):
        print(f"  ⊘ {label} — already exists, skipping")
        return True
    print(f"  ✗ {label} — HTTP {code}: {msg[:300]}")
    return False


def _td_rule_patch(rule_key: str, rule: dict[str, Any]) -> dict[str, Any]:
    """A json-patch 'add' op that creates a rule in the ruleset."""
    variations = {
        vk: {"key": vk, "percentage_included": v["percentage_included"]}
        for vk, v in rule["variations"].items()
    }
    value: dict[str, Any] = {
        "key": rule_key,
        "name": rule["name"],
        "type": rule["type"],
        "percentage_included": rule["percentage_included"],
        "audience_conditions": rule["audience_conditions"],
        "variations": variations,
        "enabled": False,
    }
    if rule["type"] != "targeted_delivery":
        value["distribution_mode"] = rule["distribution_mode"]
    return {"op": "add", "path": f"/rules/{rule_key}", "value": value}


def seed(api: Api, project_id: int) -> int:
    failures = 0

    print("\n## Audiences")
    for aud in AUDIENCES:
        body = {"name": aud["name"], "description": aud["description"],
                "conditions": aud["conditions"], "project_id": project_id}
        if not step(api, f"audience {aud['name']}", "POST", f"{V2_BASE}/audiences", body):
            failures += 1

    print("\n## Flags + rules")
    for flag in FLAGS:
        body = {"key": flag["key"], "name": flag["name"],
                "description": flag["description"],
                "variable_definitions": flag["variable_definitions"]}
        url = f"{FLAGS_BASE}/projects/{project_id}/flags"
        if not step(api, f"flag {flag['key']}", "POST", url, body):
            failures += 1
            continue

        # Extra (non on/off) variations for struct flags.
        for var in flag["_variations"]:
            if var["key"] in ("on", "off") and not var["variables"]:
                continue
            vbody = {"key": var["key"], "name": var["name"], "variables": var["variables"]}
            step(api, f"  variation {flag['key']}/{var['key']}", "POST",
                 f"{url}/{flag['key']}/variations", vbody)

        # Add rules to the dev ruleset via json-patch.
        patch = [_td_rule_patch(rk, flag["_rules"][rk]) for rk in flag["_rule_priorities"]]
        ruleset_url = f"{url}/{flag['key']}/environments/{SEED_ENV}/ruleset"
        if not step(api, f"  rules {flag['key']} ({len(patch)})", "PATCH", ruleset_url,
                    patch, content_type="application/json-patch+json"):
            failures += 1

        if flag["archived"]:
            step(api, f"  archive {flag['key']}", "POST",
                 f"{url}/archived", {"keys": [flag["key"]]})

    return failures


def teardown(api: Api, project_id: int) -> None:
    print("\n## Teardown (best-effort)")
    for flag in FLAGS:
        step(api, f"delete flag {flag['key']}", "DELETE",
             f"{FLAGS_BASE}/projects/{project_id}/flags/{flag['key']}")
    print("  (audiences are not auto-deleted — archive them in the UI if needed)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project-id", type=int, required=True, help="Optimizely project id")
    parser.add_argument("--dry-run", action="store_true", help="print calls without sending")
    parser.add_argument("--teardown", action="store_true", help="delete the seeded flags")
    args = parser.parse_args()

    token = os.environ.get("OPTIMIZELY_API_TOKEN", "")
    if not token and not args.dry_run:
        sys.exit("Set OPTIMIZELY_API_TOKEN to an API token with write access "
                 "(Account Settings > API Access).")

    api = Api(token, args.dry_run)

    if args.teardown:
        teardown(api, args.project_id)
        return

    failures = seed(api, args.project_id)

    print("\n" + "=" * 64)
    if failures:
        print(f"Done with {failures} failure(s) — see ✗ lines above.")
    else:
        print("All fixtures seeded.")
    print("""
NEXT STEPS:
  Rules were added to the `development` environment and left disabled.
  Enable them (or promote to production) in the Optimizely UI, then run:
    /confidence:migrate-optimizely plan flags
  pointing at the standard base URLs, project id {pid}, and the
  `development` environment. Diff the plan against:
    python3 verify_migration.py""".replace("{pid}", str(args.project_id)))


if __name__ == "__main__":
    main()
