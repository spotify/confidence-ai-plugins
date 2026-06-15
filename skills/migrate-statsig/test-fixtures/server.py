#!/usr/bin/env python3
"""Fake Statsig Console API server for testing the migrate-statsig skill.

Implements the read endpoints the skill calls:
  GET /console/v1/gates?limit=N&page=N
  GET /console/v1/gates/{id}
  GET /console/v1/dynamic_configs?limit=N&page=N
  GET /console/v1/dynamic_configs/{id}
  GET /console/v1/experiments?limit=N&page=N
  GET /console/v1/experiments/{id}
  GET /console/v1/segments/{id}

JSON shapes are derived from Statsig's public OpenAPI 3.0 spec
(<https://api.statsig.com/openapi/20240601.json>; no auth required to
fetch). Field names match `ExternalGateDto`, `DynamicConfigDto`,
`ExternalExperimentDto`, and `SegmentDto` as of API version 20240601.

Notable conventions:
  * camelCase everywhere (`idType`, `passPercentage`, `isEnabled`, ...)
  * IDs are strings (e.g. "internal_tools_gate")
  * A condition is { type, operator?, targetValue, field?, customID? };
    a single targetValue is a SCALAR (string/number), multiple values an
    array; numeric comparisons carry numbers, not numeric strings; and
    passes_gate / passes_segment / fails_segment conditions have NO
    operator key (all verified against the live Console API)
  * Gates are boolean (no explicit default — implicit false on no match)
  * Dynamic configs carry a server-side `defaultValue`
  * Experiments carry weighted `groups[]` + an `allocation` percent
  * List endpoints wrap results under `data` with a `pagination` object;
    paginated via `page` (1-based) + `limit`

Fixtures are curated to exercise every branch of the skill's
operator-mapping table and BLOCKED markers — see README.md.

Run:
    python3 server.py [--port 4000] [--limit-default 50]
"""

import argparse
import copy
import json
import re
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

CREATED = 1705439406615
MODIFIED = 1715439406750


def _meta(entity_id: str, kind: str) -> dict[str, Any]:
    """Common metadata fields shared by every entity type."""
    return {
        "lastModifierID": "4R5PV7mvYdW6NLCwK8ocoz",
        "lastModifiedTime": MODIFIED,
        "lastModifierName": "CONSOLE API",
        "lastModifierEmail": None,
        "creatorID": "4R5PV7mvYdW6NLCwK8ocoz",
        "createdTime": CREATED,
        "creatorName": "CONSOLE API",
        "creatorEmail": None,
        "targetApps": [],
        "holdoutIDs": [],
        "tags": [],
        "team": None,
        "teamID": None,
        "version": 1,
        "permalink": f"https://console.statsig.com/company/{kind}/{entity_id}",
    }


# ---------------------------------------------------------------------------
# Feature gates (boolean)
# ---------------------------------------------------------------------------

GATES: list[dict[str, Any]] = [
    # 1. email suffix via str_matches → endsWithRule. Single rule, 100% pass.
    #    (The Console API rejects str_ends_with_any for `email` — suffix
    #    matching arrives as an anchored str_matches regex in practice.)
    {
        "id": "internal_tools_gate",
        "name": "Internal tools gate",
        "description": "Show internal tooling to Spotify employees only.",
        "idType": "userID",
        "isEnabled": True,
        "status": "In Progress",
        "type": "PERMANENT",
        "rules": [
            {
                "name": "Spotify employees",
                "id": "rule_internal_1",
                "passPercentage": 100,
                "conditions": [
                    {
                        "type": "email",
                        "operator": "str_matches",
                        "targetValue": ".*@spotify\\.com$",  # single targetValue → scalar on the wire
                    }
                ],
            }
        ],
    },
    # 2. country `none` (NOT IN) + custom_field numeric gte, ANDed in one rule.
    {
        "id": "new_search_rollout",
        "name": "New search rollout",
        "description": "Roll out new search outside DE/FR for app build 28+.",
        "idType": "userID",
        "isEnabled": True,
        "status": "In Progress",
        "type": "TEMPORARY",
        "rules": [
            {
                "name": "Eligible users",
                "id": "rule_search_1",
                "passPercentage": 100,
                "conditions": [
                    {
                        "type": "country",
                        "operator": "none",
                        "targetValue": ["DE", "FR"],
                    },
                    {
                        "type": "custom_field",
                        "field": "appBuildNumber",
                        "operator": "gte",
                        "targetValue": 28,  # numerics come back as numbers, not strings
                    },
                ],
            }
        ],
    },
    # 3. os_name set membership + app_version version range, ANDed.
    {
        "id": "mobile_only_feature",
        "name": "Mobile only feature",
        "description": "iOS/Android users on app v1.2.0+.",
        "idType": "userID",
        "isEnabled": True,
        "status": "In Progress",
        "type": "TEMPORARY",
        "rules": [
            {
                "name": "Modern mobile clients",
                "id": "rule_mobile_1",
                "passPercentage": 100,
                "conditions": [
                    {
                        "type": "os_name",
                        "operator": "any",
                        "targetValue": ["iOS", "Android"],
                    },
                    {
                        "type": "app_version",
                        "operator": "version_gte",
                        "targetValue": "1.2.0",
                    },
                ],
            }
        ],
    },
    # 4. Plain percentage rollout to "Everyone" (public), 25%.
    {
        "id": "gradual_rollout",
        "name": "Gradual rollout",
        "description": "25% rollout to all users.",
        "idType": "userID",
        "isEnabled": True,
        "status": "In Progress",
        "type": "TEMPORARY",
        "rules": [
            {
                "name": "Everyone",
                "id": "rule_gradual_1",
                "passPercentage": 25,
                "conditions": [{"type": "public"}],  # real wire shape: no operator/targetValue keys
            }
        ],
    },
    # 5. Disabled gate (isEnabled false) → migrate at 0% rollout.
    {
        "id": "legacy_checkout",
        "name": "Legacy checkout",
        "description": "Old experiment that's been turned off.",
        "idType": "userID",
        "isEnabled": False,
        "status": "Disabled",
        "type": "TEMPORARY",
        "rules": [
            {
                "name": "US cohort",
                "id": "rule_legacy_1",
                "passPercentage": 100,
                "conditions": [
                    {"type": "country", "operator": "any", "targetValue": ["US"]}
                ],
            }
        ],
    },
    # 6. str_matches suffix alternation → one endsWithRule per branch, OR'd.
    {
        "id": "non_prod_email_gate",
        "name": "Non-prod email gate",
        "description": "Match test/qa/staging email domains.",
        "idType": "userID",
        "isEnabled": True,
        "status": "In Progress",
        "type": "PERMANENT",
        "rules": [
            {
                "name": "Non-prod emails",
                "id": "rule_nonprod_1",
                "passPercentage": 100,
                "conditions": [
                    {
                        "type": "email",
                        "operator": "str_matches",
                        "targetValue": ".*@(test|qa|staging)\\.com$",
                    }
                ],
            }
        ],
    },
    # 7. str_contains_any → BLOCKED (Confidence has no substring rule).
    {
        "id": "contains_blocked_gate",
        "name": "Contains blocked gate",
        "description": "Email contains a substring — not migratable.",
        "idType": "userID",
        "isEnabled": True,
        "status": "In Progress",
        "type": "PERMANENT",
        "rules": [
            {
                "name": "Substring match",
                "id": "rule_contains_1",
                "passPercentage": 100,
                "conditions": [
                    {
                        "type": "email",
                        "operator": "str_contains_any",
                        "targetValue": ["statsig"],
                    }
                ],
            }
        ],
    },
    # 8. passes_gate → BLOCKED (no cross-flag dependency).
    {
        "id": "depends_on_gate",
        "name": "Depends on another gate",
        "description": "Only passes if another gate passes.",
        "idType": "userID",
        "isEnabled": True,
        "status": "In Progress",
        "type": "PERMANENT",
        "rules": [
            {
                "name": "Gated by ranking",
                "id": "rule_depends_1",
                "passPercentage": 100,
                "conditions": [
                    {
                        "type": "passes_gate",  # no operator key on the wire
                        "targetValue": "internal_tools_gate",
                    }
                ],
            }
        ],
    },
    # 9. passes_segment (rule_based) + fails_segment → inline both segments.
    {
        "id": "premium_segment_gate",
        "name": "Premium segment gate",
        "description": "In the Premium segment, excluding internal staff.",
        "idType": "userID",
        "isEnabled": True,
        "status": "In Progress",
        "type": "PERMANENT",
        "rules": [
            {
                "name": "Premium minus internal",
                "id": "rule_premium_1",
                "passPercentage": 100,
                "conditions": [
                    {
                        "type": "passes_segment",  # no operator key on the wire
                        "targetValue": "premium_users",
                    },
                    {
                        "type": "fails_segment",
                        "targetValue": "internal_staff",
                    },
                ],
            }
        ],
    },
    # 10. user_id allowlist → setRule on the chosen entity field.
    {
        "id": "test_user_allowlist",
        "name": "Test user allowlist",
        "description": "Explicit list of test user IDs.",
        "idType": "userID",
        "isEnabled": True,
        "status": "In Progress",
        "type": "PERMANENT",
        "rules": [
            {
                "name": "Test users",
                "id": "rule_allowlist_1",
                "passPercentage": 100,
                "conditions": [
                    {
                        "type": "user_id",
                        "operator": "any",
                        "targetValue": ["test-user-1", "test-user-2"],
                    }
                ],
            }
        ],
    },
    # 11. References an id_list segment (`vip_user_list`, count 5000) →
    #     REST materialized segment (BigQuery), or BLOCKED if REST/BQ
    #     unavailable. Exercises the id_list path + REST backend selection.
    {
        "id": "vip_gate",
        "name": "VIP gate",
        "description": "Enable for users on the curated VIP id list.",
        "idType": "userID",
        "isEnabled": True,
        "status": "In Progress",
        "type": "PERMANENT",
        "rules": [
            {
                "name": "VIPs",
                "id": "rule_vip_1",
                "passPercentage": 100,
                "conditions": [
                    {
                        "type": "passes_segment",
                        "targetValue": "vip_user_list",
                    }
                ],
            }
        ],
    },
    # 12. Targeting gate referenced by onboarding_flow_experiment's
    #     targetingGateID — its conditions get inlined into the experiment.
    {
        "id": "onboarding_na_targeting",
        "name": "Onboarding NA targeting",
        "description": "Targeting gate for the onboarding experiment: North America only.",
        "idType": "userID",
        "isEnabled": True,
        "status": "In Progress",
        "type": "PERMANENT",
        "rules": [
            {
                "name": "North America",
                "id": "rule_na_1",
                "passPercentage": 100,
                "conditions": [
                    {"type": "country", "operator": "any", "targetValue": ["US", "CA"]}
                ],
            }
        ],
    },
    # 13. Archived gate — hidden from list unless include archived opt-in.
    {
        "id": "old_onboarding_gate",
        "name": "Old onboarding gate",
        "description": "Archived experiment from Q1.",
        "idType": "userID",
        "isEnabled": False,
        "status": "Archived",
        "type": "TEMPORARY",
        "rules": [
            {
                "name": "US cohort",
                "id": "rule_old_1",
                "passPercentage": 100,
                "conditions": [
                    {"type": "country", "operator": "any", "targetValue": ["US"]}
                ],
            }
        ],
    },
]


# ---------------------------------------------------------------------------
# Dynamic configs (value objects with a server-side defaultValue)
# ---------------------------------------------------------------------------

DYNAMIC_CONFIGS: list[dict[str, Any]] = [
    {
        "id": "homepage_config",
        "name": "Homepage config",
        "description": "Homepage title and item count by country.",
        "idType": "userID",
        "isEnabled": True,
        "status": "In Progress",
        "defaultValue": {"title": "Welcome", "maxItems": 10},
        "rules": [
            {
                "name": "US users",
                "id": "rule_home_us",
                "passPercentage": 100,
                "conditions": [
                    {"type": "country", "operator": "any", "targetValue": ["US"]}
                ],
                "returnValue": {"title": "Hi USA", "maxItems": 20},
            },
            {
                "name": "EU users",
                "id": "rule_home_eu",
                "passPercentage": 100,
                "conditions": [
                    {
                        "type": "country",
                        "operator": "any",
                        "targetValue": ["DE", "FR", "SE"],
                    }
                ],
                "returnValue": {"title": "Hallo EU", "maxItems": 15},
            },
        ],
    },
]


# ---------------------------------------------------------------------------
# Experiments (weighted groups + allocation)
# ---------------------------------------------------------------------------

EXPERIMENTS: list[dict[str, Any]] = [
    # Simple 50/50 experiment, fully allocated.
    {
        "id": "checkout_button_experiment",
        "name": "Checkout button experiment",
        "description": "Test button color on checkout.",
        "idType": "userID",
        "status": "active",
        "allocation": 100,
        "controlGroupID": "grp_control",
        "targetingGateID": "",  # unset reads back as empty string, not null
        "layerID": None,
        # NB: unset inlineTargetingRules is ABSENT from the real payload
        "groups": [
            {
                "name": "Control",
                "id": "grp_control",
                "size": 50,
                "parameterValues": {"buttonColor": "blue"},
            },
            {
                "name": "Treatment",
                "id": "grp_treatment",
                "size": 50,
                "parameterValues": {"buttonColor": "green"},
            },
        ],
    },
    # 3-group experiment, allocation 50% (rest fall through to control value),
    # with an inline targeting rule (country US/CA).
    {
        "id": "onboarding_flow_experiment",
        "name": "Onboarding flow experiment",
        "description": "Three onboarding variants, 50% allocated, NA only.",
        "idType": "userID",
        "status": "active",
        "allocation": 50,
        "controlGroupID": "grp_ob_control",
        # The modern Statsig console creates experiment targeting as a
        # targeting GATE (inline rules are legacy and the Console API
        # can't write them) — fetch the gate and inline its conditions.
        "targetingGateID": "onboarding_na_targeting",
        "layerID": "onboarding_layer",
        # Observed live: the Console API returns duplicated holdoutIDs
        # entries (one attach → two list items). Readers must dedupe.
        "holdoutIDs": ["q1_holdout", "q1_holdout"],
        # NB: unset inlineTargetingRules is ABSENT from the real payload
        "groups": [
            {
                "name": "Control",
                "id": "grp_ob_control",
                "size": 34,
                "parameterValues": {"flow": "classic"},
            },
            {
                "name": "Variant A",
                "id": "grp_ob_a",
                "size": 33,
                "parameterValues": {"flow": "guided"},
            },
            {
                "name": "Variant B",
                "id": "grp_ob_b",
                "size": 33,
                "parameterValues": {"flow": "minimal"},
            },
        ],
    },
]


# ---------------------------------------------------------------------------
# Segments (rule_based → inline; id_list → setRule or BLOCKED)
# ---------------------------------------------------------------------------

SEGMENTS: list[dict[str, Any]] = [
    {
        "id": "premium_users",
        "name": "Premium users",
        "description": "Subjects on a paid plan.",
        "idType": "userID",
        "isEnabled": True,
        "type": "rule_based",
        "rules": [
            {
                "name": "Paid plans",
                "id": "seg_premium_1",
                "passPercentage": 100,
                "conditions": [
                    {
                        "type": "custom_field",
                        "field": "plan",
                        "operator": "any",
                        "targetValue": ["premium", "enterprise"],
                    }
                ],
            }
        ],
    },
    {
        "id": "internal_staff",
        "name": "Internal staff",
        "description": "Spotify employees by email domain.",
        "idType": "userID",
        "isEnabled": True,
        "type": "rule_based",
        "rules": [
            {
                "name": "Spotify emails",
                "id": "seg_internal_1",
                "passPercentage": 100,
                "conditions": [
                    {
                        "type": "email",
                        "operator": "str_matches",
                        "targetValue": ".*@spotify\\.com$",
                    }
                ],
            }
        ],
    },
    # id_list segment — a literal list of unit IDs (no rules). Large lists
    # map to a Confidence materialized segment (REST/BigQuery); small ones
    # can inline as a setRule. `count` is the list length.
    {
        "id": "vip_user_list",
        "name": "VIP user list",
        "description": "Hand-curated VIP user IDs uploaded as an id list.",
        "idType": "userID",
        "isEnabled": True,
        "type": "id_list",
        "count": 5000,
        "rules": [],
    },
]


# ---------------------------------------------------------------------------
# HTTP layer
# ---------------------------------------------------------------------------

COLLECTIONS: dict[str, tuple[list[dict[str, Any]], str]] = {
    "gates": (GATES, "gate"),
    "dynamic_configs": (DYNAMIC_CONFIGS, "dynamic_config"),
    "experiments": (EXPERIMENTS, "experiment"),
    "segments": (SEGMENTS, "segment"),
}

ARCHIVED_STATUSES = {"Archived", "archived"}

ROUTE_LIST = re.compile(r"^/console/v1/(?P<coll>gates|dynamic_configs|experiments|segments)/?$")
ROUTE_BY_ID = re.compile(
    r"^/console/v1/(?P<coll>gates|dynamic_configs|experiments|segments)/(?P<id>[^/]+)/?$"
)


def _full(item: dict[str, Any], kind: str) -> dict[str, Any]:
    # Meta provides boilerplate defaults; fixture fields take precedence.
    return {**_meta(item["id"], kind), **copy.deepcopy(item)}


def _is_archived(item: dict[str, Any]) -> bool:
    return item.get("status") in ARCHIVED_STATUSES


class Handler(BaseHTTPRequestHandler):
    server_version = "FakeStatsig/0.1"
    limit_default = 50

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"  {self.address_string()} → {fmt % args}")

    def _send(self, code: int, body: Any) -> None:
        payload = json.dumps(body).encode() if body is not None else b""
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if payload:
            self.wfile.write(payload)

    def _check_auth(self) -> bool:
        if not self.headers.get("STATSIG-API-KEY", ""):
            self._send(401, {"message": "Missing STATSIG-API-KEY header", "data": None})
            return False
        return True

    def _bool_param(self, query: dict[str, list[str]], name: str) -> bool:
        return name in query and query[name][0].lower() in ("true", "1", "yes")

    def do_GET(self) -> None:  # noqa: N802
        if not self._check_auth():
            return

        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        m = ROUTE_BY_ID.match(path)
        if m:
            coll, kind = COLLECTIONS[m["coll"]]
            item = next((x for x in coll if x["id"] == m["id"]), None)
            if item is None:
                self._send(404, {"message": f"{m['coll']} {m['id']} not found", "data": None})
                return
            self._send(200, {"message": f"{m['coll']} read successfully.", "data": _full(item, kind)})
            return

        m = ROUTE_LIST.match(path)
        if m:
            coll, kind = COLLECTIONS[m["coll"]]
            include_archived = self._bool_param(query, "includeArchived")
            limit = int(query.get("limit", [str(self.limit_default)])[0])
            page = int(query.get("page", ["1"])[0])

            visible = [x for x in coll if include_archived or not _is_archived(x)]
            total = len(visible)
            start = (page - 1) * limit
            window = visible[start : start + limit]
            next_page = str(page + 1) if start + limit < total else None
            prev_page = str(page - 1) if page > 1 else None

            self._send(
                200,
                {
                    "message": f"{m['coll']} listed successfully.",
                    "data": [_full(x, kind) for x in window],
                    "pagination": {
                        "itemsPerPage": limit,
                        "pageNumber": page,
                        "totalItems": total,
                        "nextPage": next_page,
                        "previousPage": prev_page,
                    },
                },
            )
            return

        self._send(404, {"message": f"No route for {path}", "data": None})

    def do_POST(self) -> None:  # noqa: N802
        self._send(405, {"message": "This fake server is read-only", "data": None})

    def do_PUT(self) -> None:  # noqa: N802
        self._send(405, {"message": "This fake server is read-only", "data": None})

    def do_PATCH(self) -> None:  # noqa: N802
        self._send(405, {"message": "This fake server is read-only", "data": None})

    def do_DELETE(self) -> None:  # noqa: N802
        self._send(405, {"message": "This fake server is read-only", "data": None})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=4000)
    parser.add_argument("--limit-default", type=int, default=50)
    args = parser.parse_args()

    Handler.limit_default = args.limit_default
    server = HTTPServer(("127.0.0.1", args.port), Handler)
    base = f"http://127.0.0.1:{args.port}"
    print(f"Fake Statsig Console API listening on {base}")
    print(
        f"  {len(GATES)} gates, {len(DYNAMIC_CONFIGS)} dynamic configs, "
        f"{len(EXPERIMENTS)} experiments, {len(SEGMENTS)} segments"
    )
    print("  Point the migrate-statsig skill at this base URL when prompted.")
    print("  Set STATSIG_API_KEY to anything (any non-empty value passes).")
    print("  Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
