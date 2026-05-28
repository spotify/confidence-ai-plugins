#!/usr/bin/env python3
"""Fake Eppo REST API server for testing the migrate-eppo skill end-to-end.

Implements the four read endpoints the skill calls:
  GET /api/v1/environments
  GET /api/v1/feature-flags?page=N&per_page=M
  GET /api/v1/feature-flags/{id}
  GET /api/v1/feature-flags/{id}/environments/{environmentId}

The fixture flags are deliberately chosen to exercise every branch of the
PostHog/Eppo-side operator-mapping table the skill ships with. See README.md
for the full list and what each flag tests.

The JSON shapes here are our best guess at Eppo's actual responses, modeled
on the Swagger summary at https://eppo.cloud/api/docs and the public docs.
A future "Tier 3" pass with a real Eppo account should diff a real response
against these fixtures and update either the fixtures or the skill.

Run:
    python3 server.py [--port 3000] [--per-page-default 50]
"""

import argparse
import json
import re
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

ENVIRONMENTS: list[dict[str, Any]] = [
    {"id": "env-prod", "name": "Production"},
    {"id": "env-staging", "name": "Staging"},
    {"id": "env-test", "name": "Test"},
]


def _bool_variations() -> list[dict[str, Any]]:
    return [
        {"key": "enabled", "name": "Enabled", "value": True},
        {"key": "disabled", "name": "Disabled", "value": False},
    ]


# Each entry is the full /feature-flags/{id} response body. Per-env state is
# derived from these by overlaying the per-env overrides in ENV_OVERRIDES.
FLAGS: list[dict[str, Any]] = [
    # 1. Tests MATCHES with a clean suffix anchor → endsWithRule.
    {
        "id": "ff-001",
        "key": "internal-tools-gate",
        "name": "Internal tools gate",
        "description": "Show internal tooling to Spotify employees only.",
        "variationType": "BOOLEAN",
        "archived": False,
        "variations": _bool_variations(),
        "defaultVariation": "disabled",
        "allocations": [
            {
                "id": "alloc-001-1",
                "name": "Spotify employees",
                "allocationType": "FEATURE_GATE",
                "trafficExposure": 1.0,
                "targetingRules": [
                    {
                        "conditions": [
                            {
                                "attribute": "email",
                                "operator": "MATCHES",
                                "value": ".*@spotify\\.com$",
                            }
                        ]
                    }
                ],
                "variationWeightsByKey": {"enabled": 100},
            }
        ],
    },
    # 2. Tests waterfall (two allocations), Feature Gate + Experiment, ONE_OF
    #    set membership, multivariant 50/50 split.
    {
        "id": "ff-002",
        "key": "pricing-experiment",
        "name": "Pricing page experiment",
        "description": "Test a new pricing layout against control.",
        "variationType": "STRING",
        "archived": False,
        "variations": [
            {"key": "control", "name": "Control", "value": "control"},
            {"key": "treatment_a", "name": "Treatment A", "value": "treatment_a"},
            {"key": "treatment_b", "name": "Treatment B", "value": "treatment_b"},
        ],
        "defaultVariation": "control",
        "allocations": [
            {
                "id": "alloc-002-1",
                "name": "Internal QA force-on",
                "allocationType": "FEATURE_GATE",
                "trafficExposure": 1.0,
                "targetingRules": [
                    {
                        "conditions": [
                            {
                                "attribute": "email",
                                "operator": "MATCHES",
                                "value": ".*@spotify\\.com$",
                            }
                        ]
                    }
                ],
                "variationWeightsByKey": {"treatment_a": 100},
            },
            {
                "id": "alloc-002-2",
                "name": "North America 50/50",
                "allocationType": "EXPERIMENT",
                "trafficExposure": 1.0,
                "targetingRules": [
                    {
                        "conditions": [
                            {
                                "attribute": "country",
                                "operator": "ONE_OF",
                                "value": ["US", "CA"],
                            }
                        ]
                    }
                ],
                "variationWeightsByKey": {"control": 50, "treatment_a": 50},
            },
        ],
    },
    # 3. Tests NOT_ONE_OF, GTE numeric, AND combination within a single rule.
    {
        "id": "ff-003",
        "key": "legacy-search-rollout",
        "name": "Legacy search rollout",
        "description": "Roll out new search outside DE/FR for app v28+.",
        "variationType": "BOOLEAN",
        "archived": False,
        "variations": _bool_variations(),
        "defaultVariation": "disabled",
        "allocations": [
            {
                "id": "alloc-003-1",
                "name": "Eligible users",
                "allocationType": "FEATURE_GATE",
                "trafficExposure": 1.0,
                "targetingRules": [
                    {
                        "conditions": [
                            {
                                "attribute": "country",
                                "operator": "NOT_ONE_OF",
                                "value": ["DE", "FR"],
                            },
                            {
                                "attribute": "appVersion",
                                "operator": "GTE",
                                "value": 28,
                            },
                        ]
                    }
                ],
                "variationWeightsByKey": {"enabled": 100},
            }
        ],
    },
    # 4. Tests subject-key targeting via the special `id` attribute, which
    #    must be rewritten to the chosen Confidence entity field (e.g. user_id).
    {
        "id": "ff-004",
        "key": "subject-id-targeting",
        "name": "Specific test users",
        "description": "Allowlist of test user IDs.",
        "variationType": "BOOLEAN",
        "archived": False,
        "variations": _bool_variations(),
        "defaultVariation": "disabled",
        "allocations": [
            {
                "id": "alloc-004-1",
                "name": "Test allowlist",
                "allocationType": "FEATURE_GATE",
                "trafficExposure": 1.0,
                "targetingRules": [
                    {
                        "conditions": [
                            {
                                "attribute": "id",
                                "operator": "ONE_OF",
                                "value": ["test-user-1", "test-user-2"],
                            }
                        ]
                    }
                ],
                "variationWeightsByKey": {"enabled": 100},
            }
        ],
    },
    # 5. Tests disabled-in-environment handling. Configured but turned OFF in
    #    the Production env (see ENV_OVERRIDES below). Migration should still
    #    create the flag, but with the rule at 0% rollout.
    {
        "id": "ff-005",
        "key": "legacy-checkout-redesign",
        "name": "Legacy checkout redesign",
        "description": "Old experiment that's been turned off.",
        "variationType": "BOOLEAN",
        "archived": False,
        "variations": _bool_variations(),
        "defaultVariation": "disabled",
        "allocations": [
            {
                "id": "alloc-005-1",
                "name": "Test cohort",
                "allocationType": "FEATURE_GATE",
                "trafficExposure": 1.0,
                "targetingRules": [
                    {
                        "conditions": [
                            {
                                "attribute": "country",
                                "operator": "ONE_OF",
                                "value": ["US"],
                            }
                        ]
                    }
                ],
                "variationWeightsByKey": {"enabled": 100},
            }
        ],
    },
    # 6. Tests SemVer BLOCKED path. The appVersion attribute uses SemVer
    #    semantics (string comparison, not numeric), which Confidence's
    #    rangeRule cannot express.
    {
        "id": "ff-006",
        "key": "mobile-only-feature",
        "name": "Mobile only feature",
        "description": "iOS/Android users on app v1.2.0+.",
        "variationType": "BOOLEAN",
        "archived": False,
        "variations": _bool_variations(),
        "defaultVariation": "disabled",
        "allocations": [
            {
                "id": "alloc-006-1",
                "name": "Modern mobile clients",
                "allocationType": "FEATURE_GATE",
                "trafficExposure": 1.0,
                "targetingRules": [
                    {
                        "conditions": [
                            {
                                "attribute": "device",
                                "operator": "ONE_OF",
                                "value": ["iOS", "Android"],
                            },
                            {
                                "attribute": "appVersion",
                                "operator": "GTE",
                                "value": "1.2.0",
                                "valueType": "SEMVER",
                            },
                        ]
                    }
                ],
                "variationWeightsByKey": {"enabled": 100},
            }
        ],
    },
    # 7. Tests general-regex BLOCKED path. The MATCHES regex uses alternation,
    #    which can't be expressed as startsWithRule or endsWithRule.
    {
        "id": "ff-007",
        "key": "general-regex-flag",
        "name": "Non-prod email gate",
        "description": "Block production traffic from test/qa/staging email domains.",
        "variationType": "BOOLEAN",
        "archived": False,
        "variations": _bool_variations(),
        "defaultVariation": "disabled",
        "allocations": [
            {
                "id": "alloc-007-1",
                "name": "Non-prod emails",
                "allocationType": "FEATURE_GATE",
                "trafficExposure": 1.0,
                "targetingRules": [
                    {
                        "conditions": [
                            {
                                "attribute": "email",
                                "operator": "MATCHES",
                                "value": ".*@(test|qa|staging)\\.com$",
                            }
                        ]
                    }
                ],
                "variationWeightsByKey": {"enabled": 100},
            }
        ],
    },
    # 8-10. Boring extras to push the list past per_page=5 and verify the
    #       skill's pagination loop terminates correctly.
    {
        "id": "ff-008",
        "key": "extra-flag-1",
        "name": "Extra flag 1 (pagination filler)",
        "description": "",
        "variationType": "BOOLEAN",
        "archived": False,
        "variations": _bool_variations(),
        "defaultVariation": "disabled",
        "allocations": [
            {
                "id": "alloc-008-1",
                "name": "All US",
                "allocationType": "FEATURE_GATE",
                "trafficExposure": 1.0,
                "targetingRules": [
                    {
                        "conditions": [
                            {
                                "attribute": "country",
                                "operator": "ONE_OF",
                                "value": ["US"],
                            }
                        ]
                    }
                ],
                "variationWeightsByKey": {"enabled": 100},
            }
        ],
    },
    {
        "id": "ff-009",
        "key": "extra-flag-2",
        "name": "Extra flag 2 (pagination filler)",
        "description": "",
        "variationType": "BOOLEAN",
        "archived": False,
        "variations": _bool_variations(),
        "defaultVariation": "disabled",
        "allocations": [
            {
                "id": "alloc-009-1",
                "name": "All UK",
                "allocationType": "FEATURE_GATE",
                "trafficExposure": 1.0,
                "targetingRules": [
                    {
                        "conditions": [
                            {
                                "attribute": "country",
                                "operator": "ONE_OF",
                                "value": ["UK"],
                            }
                        ]
                    }
                ],
                "variationWeightsByKey": {"enabled": 100},
            }
        ],
    },
    {
        "id": "ff-010",
        "key": "extra-flag-3",
        "name": "Extra flag 3 (pagination filler)",
        "description": "",
        "variationType": "BOOLEAN",
        "archived": False,
        "variations": _bool_variations(),
        "defaultVariation": "disabled",
        "allocations": [
            {
                "id": "alloc-010-1",
                "name": "All DE",
                "allocationType": "FEATURE_GATE",
                "trafficExposure": 1.0,
                "targetingRules": [
                    {
                        "conditions": [
                            {
                                "attribute": "country",
                                "operator": "ONE_OF",
                                "value": ["DE"],
                            }
                        ]
                    }
                ],
                "variationWeightsByKey": {"enabled": 100},
            }
        ],
    },
]


# Per-environment overrides. Default for any (flag_id, env_id) pair not
# listed here is enabled=True, allocations=flag.allocations.
ENV_OVERRIDES: dict[tuple[str, str], dict[str, Any]] = {
    # legacy-checkout-redesign is OFF in Production but ON in Staging/Test.
    ("ff-005", "env-prod"): {"enabled": False},
}


# ---------------------------------------------------------------------------
# HTTP layer
# ---------------------------------------------------------------------------

ROUTE_FLAG_LIST = re.compile(r"^/api/v1/feature-flags/?$")
ROUTE_FLAG_BY_ID = re.compile(r"^/api/v1/feature-flags/(?P<id>[^/]+)/?$")
ROUTE_FLAG_BY_ENV = re.compile(
    r"^/api/v1/feature-flags/(?P<id>[^/]+)/environments/(?P<env_id>[^/]+)/?$"
)
ROUTE_ENVIRONMENTS = re.compile(r"^/api/v1/environments/?$")


def _flag_summary(flag: dict[str, Any]) -> dict[str, Any]:
    """The /feature-flags list response returns summaries, not full configs."""
    return {
        "id": flag["id"],
        "key": flag["key"],
        "name": flag["name"],
        "description": flag.get("description", ""),
        "variationType": flag["variationType"],
        "archived": flag["archived"],
    }


def _env_view(flag: dict[str, Any], env_id: str) -> dict[str, Any] | None:
    env = next((e for e in ENVIRONMENTS if e["id"] == env_id), None)
    if env is None:
        return None
    overrides = ENV_OVERRIDES.get((flag["id"], env_id), {})
    return {
        "id": env_id,
        "name": env["name"],
        "enabled": overrides.get("enabled", True),
        "allocations": overrides.get("allocations", flag["allocations"]),
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "FakeEppo/0.1"
    per_page_default = 50

    def log_message(self, fmt: str, *args: Any) -> None:
        # Cleaner one-line log format than the default.
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
        token = self.headers.get("X-Eppo-Token", "")
        if not token:
            self._send(
                401,
                {"error": "Missing X-Eppo-Token header"},
            )
            return False
        return True

    def do_GET(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler API)
        if not self._check_auth():
            return

        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if ROUTE_ENVIRONMENTS.match(path):
            self._send(200, ENVIRONMENTS)
            return

        if ROUTE_FLAG_LIST.match(path):
            page = int(query.get("page", ["1"])[0])
            per_page = int(query.get("per_page", [str(self.per_page_default)])[0])
            start = (page - 1) * per_page
            end = start + per_page
            page_items = [_flag_summary(f) for f in FLAGS[start:end]]
            self._send(200, page_items)
            return

        m = ROUTE_FLAG_BY_ENV.match(path)
        if m:
            flag = next((f for f in FLAGS if f["id"] == m["id"]), None)
            if flag is None:
                self._send(404, {"error": f"Flag {m['id']} not found"})
                return
            view = _env_view(flag, m["env_id"])
            if view is None:
                self._send(
                    404, {"error": f"Environment {m['env_id']} not found"}
                )
                return
            self._send(200, view)
            return

        m = ROUTE_FLAG_BY_ID.match(path)
        if m:
            flag = next((f for f in FLAGS if f["id"] == m["id"]), None)
            if flag is None:
                self._send(404, {"error": f"Flag {m['id']} not found"})
                return
            self._send(200, flag)
            return

        self._send(404, {"error": f"No route for {path}"})

    def do_POST(self) -> None:  # noqa: N802
        self._send(405, {"error": "This fake server is read-only"})

    def do_PUT(self) -> None:  # noqa: N802
        self._send(405, {"error": "This fake server is read-only"})

    def do_DELETE(self) -> None:  # noqa: N802
        self._send(405, {"error": "This fake server is read-only"})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=3000)
    parser.add_argument(
        "--per-page-default",
        type=int,
        default=50,
        help="Page size used when the client doesn't pass per_page.",
    )
    args = parser.parse_args()

    Handler.per_page_default = args.per_page_default
    server = HTTPServer(("127.0.0.1", args.port), Handler)
    base = f"http://127.0.0.1:{args.port}/api/v1"
    print(f"Fake Eppo server listening on {base}")
    print(f"  {len(FLAGS)} fixture flags, {len(ENVIRONMENTS)} environments")
    print("  Point the migrate-eppo skill at this base URL when prompted.")
    print("  Set EPPO_API_KEY to anything (any non-empty value passes).")
    print("  Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
