#!/usr/bin/env python3
"""Seed a real Statsig project with the migrate-statsig test fixtures.

Pushes the fixtures defined in `server.py` into an actual Statsig project
through the Console API, so the migration skill can be tested end-to-end
against real Statsig (wire format, pagination, auth) instead of the fake
server. Statsig's free tier is sufficient.

Prerequisites:
  * A Statsig account + project (console.statsig.com — manual signup).
  * A Console API key with WRITE access (Project Settings > API Keys,
    starts with `console-`), exported as STATSIG_API_KEY.

Run:
    export STATSIG_API_KEY=console-...
    python3 seed_statsig.py             # create everything
    python3 seed_statsig.py --dry-run   # print what would be created
    python3 seed_statsig.py --teardown  # best-effort delete of seeded items

What gets seeded (mirrors server.py):
  * 3 segments  — premium_users / internal_staff (rule_based, with rules),
                  vip_user_list (id_list, --vip-count generated ids)
  * 1 layer     — onboarding_layer
  * 13 gates    — including the disabled one (isEnabled false) and the
                  archived one (created, then archived via /archive)
  * 1 dynamic config — homepage_config (defaultValue + 2 rules)
  * 2 experiments — created, then started (PUT /{id}/start → active);
                  onboarding_flow_experiment is attached to the layer
  * 1 holdout   — q1_holdout, attached to onboarding_flow_experiment

KNOWN API LIMITATION — one manual step. The Console API cannot write
`inlineTargetingRules` (read-only on ExternalExperimentDto; absent from
the create/update DTOs as of API version 20240601). Experiments whose
fixture carries inline targeting are therefore left UNSTARTED (targeting
locks at start): add the rule in the console UI (for
`onboarding_flow_experiment`: country is any of [US, CA]), then re-run
this script to start them. If an experiment was already started, unlock
it with `PUT /console/v1/experiments/{id}/reset`.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

from server import DYNAMIC_CONFIGS, EXPERIMENTS, GATES, SEGMENTS

API_VERSION = "20240601"

# Fields that exist on the read DTOs (and our fixtures) but are not
# accepted (or not safe to send) on the create DTOs.
GATE_CREATE_FIELDS = {"id", "name", "description", "idType", "isEnabled", "rules", "type", "tags"}
CONFIG_CREATE_FIELDS = {"id", "name", "description", "idType", "isEnabled", "rules", "defaultValue"}
EXPERIMENT_CREATE_FIELDS = {"id", "name", "description", "idType", "allocation", "layerID", "targetingGateID"}
SEGMENT_CREATE_FIELDS = {"id", "name", "description", "idType", "type", "rules"}

HOLDOUT = {
    "id": "q1_holdout",
    "name": "Q1 holdout",
    "description": "Fixture holdout covering the onboarding experiment.",
    "idType": "userID",
    "passPercentage": 5,
    "experimentIDs": ["onboarding_flow_experiment"],
}

LAYER = {
    "id": "onboarding_layer",
    "name": "Onboarding layer",
    "description": "Fixture layer for onboarding experiments.",
    "idType": "userID",
    # Experiments in a layer may only use parameters the layer defines;
    # set via PATCH after create (LayerCreateContractDto has no params).
    "parameters": [{"name": "flow", "type": "string", "defaultValue": "classic"}],
}


class Api:
    def __init__(self, base: str, key: str, dry_run: bool):
        self.base = base.rstrip("/")
        self.key = key
        self.dry_run = dry_run

    def call(self, method: str, path: str, body: dict | None = None) -> tuple[int, Any]:
        url = f"{self.base}{path}"
        if self.dry_run:
            print(f"  DRY-RUN {method} {path}"
                  + (f" {json.dumps(body)[:120]}..." if body else ""))
            return 200, {}
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("STATSIG-API-KEY", self.key)
        req.add_header("STATSIG-API-VERSION", API_VERSION)
        if data:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, json.loads(resp.read() or b"{}")
        except urllib.error.HTTPError as e:
            try:
                payload = json.loads(e.read() or b"{}")
            except json.JSONDecodeError:
                payload = {}
            return e.code, payload


def step(api: Api, label: str, method: str, path: str, body: dict | None = None) -> bool:
    """Run one API call; treat 'already exists' conflicts as a skip."""
    code, payload = api.call(method, path, body)
    if 200 <= code < 300:
        print(f"  ✓ {label}")
        return True
    detail = payload.get("errors") or payload.get("message") or payload
    msg = json.dumps(detail) if not isinstance(detail, str) else detail
    lower = msg.lower()
    if code in (400, 409) and any(s in lower for s in ("already exists", "already in use", "already started", "duplicate")):
        print(f"  ⊘ {label} — already exists, skipping")
        return True
    print(f"  ✗ {label} — HTTP {code}: {msg[:300]}")
    return False


def strip_nones(value: Any) -> Any:
    """Drop None-valued keys recursively — the API rejects explicit nulls
    (e.g. a public condition must omit operator/targetValue entirely)."""
    if isinstance(value, dict):
        return {k: strip_nones(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [strip_nones(v) for v in value]
    return value


def pick(d: dict, allowed: set) -> dict:
    return strip_nones({k: v for k, v in d.items() if k in allowed and v is not None})


def seed(api: Api, vip_count: int) -> int:
    failures = 0

    print("\n## Segments")
    for seg in SEGMENTS:
        body = pick(seg, SEGMENT_CREATE_FIELDS)
        if not body.get("rules"):
            body.pop("rules", None)  # only rule_based segments may carry rules
        if not step(api, f"segment {seg['id']} ({seg['type']})", "POST", "/console/v1/segments", body):
            failures += 1
            continue
        if seg["type"] == "id_list":
            # id_list segments upload via /id_list (max 100k ids per call);
            # /add_ids is only for user_store_id_list segments.
            ids = [f"vip-user-{i:05d}" for i in range(vip_count)]
            if not step(api, f"  id_list upload {seg['id']} ({len(ids)} ids)",
                        "PATCH", f"/console/v1/segments/{seg['id']}/id_list", {"ids": ids}):
                failures += 1

    print("\n## Layer")
    create = {k: v for k, v in LAYER.items() if k != "parameters"}
    if step(api, f"layer {LAYER['id']}", "POST", "/console/v1/layers", create):
        if not step(api, f"  parameters {LAYER['id']}", "PATCH",
                    f"/console/v1/layers/{LAYER['id']}",
                    {"parameters": LAYER["parameters"]}):
            failures += 1
    else:
        failures += 1

    print("\n## Gates")
    for gate in GATES:
        body = pick(gate, GATE_CREATE_FIELDS)
        if not step(api, f"gate {gate['id']}", "POST", "/console/v1/gates", body):
            failures += 1
            continue
        if gate.get("status") in ("Archived", "archived"):
            if not step(api, f"  archive {gate['id']}", "PUT",
                        f"/console/v1/gates/{gate['id']}/archive", {}):
                failures += 1

    print("\n## Dynamic configs")
    for cfg in DYNAMIC_CONFIGS:
        body = pick(cfg, CONFIG_CREATE_FIELDS)
        if not step(api, f"dynamic config {cfg['id']}", "POST", "/console/v1/dynamic_configs", body):
            failures += 1

    print("\n## Experiments")
    for exp in EXPERIMENTS:
        body = pick(exp, EXPERIMENT_CREATE_FIELDS)
        # Group ids are assigned by Statsig; send name/size/parameterValues
        # only and keep Control first (Statsig defaults control to the
        # first group, replacing the fixtures' controlGroupID).
        body["groups"] = [
            {"name": g["name"], "size": g["size"], "parameterValues": g["parameterValues"]}
            for g in exp["groups"]
        ]
        if not step(api, f"experiment {exp['id']}", "POST", "/console/v1/experiments", body):
            failures += 1
            continue
        if exp.get("inlineTargetingRules"):
            # Targeting locks once an experiment starts, and the API can't
            # write inlineTargetingRules — leave it in `setup` so the rule
            # can be added in the console UI first, then re-run this script
            # (or PUT /{id}/start) to start it. A started experiment can be
            # unlocked again with PUT /{id}/reset.
            print(f"  ⏸ start {exp['id']} — SKIPPED: add the inline targeting "
                  "rule in the console UI first, then re-run to start")
            continue
        if not step(api, f"  start {exp['id']}", "PUT",
                    f"/console/v1/experiments/{exp['id']}/start", {}):
            failures += 1

    print("\n## Holdout")
    if step(api, f"holdout {HOLDOUT['id']}", "POST", "/console/v1/holdouts",
            {"id": HOLDOUT["id"], "name": HOLDOUT["name"],
             "description": HOLDOUT["description"], "idType": HOLDOUT["idType"]}):
        # Full update (POST) replaces experimentIDs; PATCH appends and
        # duplicates entries on re-runs.
        if not step(api, f"  attach {HOLDOUT['id']} → {HOLDOUT['experimentIDs']}", "POST",
                    f"/console/v1/holdouts/{HOLDOUT['id']}",
                    {"isEnabled": True, "passPercentage": HOLDOUT["passPercentage"],
                     "experimentIDs": HOLDOUT["experimentIDs"], "gateIDs": [],
                     "layerIDs": [], "isGlobal": False, "targetingGateID": None,
                     "description": HOLDOUT["description"]}):
            failures += 1
    else:
        failures += 1

    return failures


def teardown(api: Api) -> None:
    print("\n## Teardown (best-effort)")
    for exp in EXPERIMENTS:
        step(api, f"delete experiment {exp['id']}", "DELETE", f"/console/v1/experiments/{exp['id']}")
    for cfg in DYNAMIC_CONFIGS:
        step(api, f"delete dynamic config {cfg['id']}", "DELETE", f"/console/v1/dynamic_configs/{cfg['id']}")
    for gate in GATES:
        step(api, f"delete gate {gate['id']}", "DELETE", f"/console/v1/gates/{gate['id']}")
    for seg in SEGMENTS:
        step(api, f"delete segment {seg['id']}", "DELETE", f"/console/v1/segments/{seg['id']}")
    step(api, f"delete holdout {HOLDOUT['id']}", "DELETE", f"/console/v1/holdouts/{HOLDOUT['id']}")
    step(api, f"delete layer {LAYER['id']}", "DELETE", f"/console/v1/layers/{LAYER['id']}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base", default="https://statsigapi.net",
                        help="Console API base URL (default: %(default)s)")
    parser.add_argument("--vip-count", type=int, default=5000,
                        help="ids to upload into the vip_user_list id_list segment")
    parser.add_argument("--dry-run", action="store_true", help="print calls without sending")
    parser.add_argument("--teardown", action="store_true", help="delete the seeded items")
    args = parser.parse_args()

    key = os.environ.get("STATSIG_API_KEY", "")
    if not key and not args.dry_run:
        sys.exit("Set STATSIG_API_KEY to a Console API key with write access "
                 "(Project Settings > API Keys; starts with 'console-').")
    if key and not key.startswith("console-") and not args.dry_run:
        print("WARNING: key does not start with 'console-' — this must be a "
              "CONSOLE API key, not a server/client SDK key.\n")

    api = Api(args.base, key, args.dry_run)

    if args.teardown:
        teardown(api)
        return

    failures = seed(api, args.vip_count)

    print("\n" + "=" * 64)
    if failures:
        print(f"Done with {failures} failure(s) — see ✗ lines above.")
    else:
        print("All fixtures seeded.")
    print("""
MANUAL STEP (Console API can't write inlineTargetingRules):
  In the Statsig console, open experiment `onboarding_flow_experiment`
  and add an inline targeting rule: country is any of [US, CA].

Then run the migration against real Statsig:
  /confidence:migrate-statsig plan flags     (base URL: https://statsigapi.net)
and diff the plan against `python3 verify_migration.py`.""")


if __name__ == "__main__":
    main()
