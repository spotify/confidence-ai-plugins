#!/usr/bin/env python3
"""Fake Optimizely REST API server for testing the migrate-optimizely skill.

Implements the read endpoints the skill calls, across the two Optimizely
base paths (served together on one port):

  Flags API (/flags/v1):
    GET /flags/v1/projects/{pid}/flags?per_page=N&page=N
    GET /flags/v1/projects/{pid}/flags/{key}
    GET /flags/v1/projects/{pid}/flags/{key}/variations
    GET /flags/v1/projects/{pid}/flags/{key}/environments/{env}/ruleset

  Platform API v2 (/v2):
    GET /v2/audiences?project_id=N&per_page=N&page=N
    GET /v2/audiences/{id}
    GET /v2/environments?project_id=N
    GET /v2/projects

JSON shapes are derived from Optimizely's published Feature
Experimentation API docs
(<https://docs.developers.optimizely.com/feature-experimentation/reference>).

Notable conventions:
  * snake_case everywhere (`percentage_included`, `audience_conditions`)
  * IDs are integers; flag/rule/variation keys are strings
  * Percentages are BASIS POINTS out of 10000 (10000 = 100%, 5000 = 50%)
  * A ruleset has an ordered `rule_priorities` (first wins) and a
    `default_variation_key` served when no rule matches
  * A rule references audiences via `audience_conditions` (list-based
    condition language) + `audience_ids`; the custom-attribute leaves
    live in each AUDIENCE's `conditions` (a JSON-encoded string)
  * List endpoints wrap results under `items` with `page`/`total_pages`

Fixtures are curated to exercise every branch of the skill's
operator-mapping table and BLOCKED markers — see README.md.

Run:
    python3 server.py [--port 4100]
"""

import argparse
import json
import re
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

PROJECT_ID = 4100100100
ACCOUNT_ID = 4100200200

ENVIRONMENTS = [
    {"key": "production", "name": "Production", "id": 9001, "archived": False, "priority": 1},
    {"key": "development", "name": "Development", "id": 9002, "archived": False, "priority": 2},
]


def _cond(name: str, match_type: str, value: Any = None, ctype: str = "custom_attribute") -> dict:
    leaf: dict[str, Any] = {"type": ctype, "name": name, "match_type": match_type}
    if value is not None:
        leaf["value"] = value
    return leaf


# ---------------------------------------------------------------------------
# Audiences — the reusable targeting conditions. `conditions` is a
# JSON-encoded STRING of the list-based condition language; the leaves are
# {type: custom_attribute, name, match_type, value}.
# ---------------------------------------------------------------------------

def _conditions(*tree: Any) -> str:
    return json.dumps(list(tree))


AUDIENCES: list[dict[str, Any]] = [
    # 1. boolean exact → eqRule boolValue
    {
        "id": 1,
        "name": "Beta users",
        "description": "Users opted into beta.",
        "conditions": _conditions("and", ["or", ["or", _cond("is_beta", "exact", True)]]),
    },
    # 2. string set membership via OR of exact → setRule
    {
        "id": 2,
        "name": "North America",
        "description": "US or Canada.",
        "conditions": _conditions(
            "and", ["or", _cond("country", "exact", "US"), _cond("country", "exact", "CA")]
        ),
    },
    # 3. semver_ge (version range) AND string exact, in one audience
    {
        "id": 3,
        "name": "Modern mobile",
        "description": "iOS on app v1.2.0+.",
        "conditions": _conditions(
            "and",
            ["or", ["or", _cond("app_version", "semver_ge", "1.2.0")]],
            ["or", ["or", _cond("os", "exact", "ios")]],
        ),
    },
    # 4. numeric le → rangeRule endInclusive
    {
        "id": 4,
        "name": "Recent purchasers",
        "description": "Ordered within 14 days.",
        "conditions": _conditions("and", ["or", ["or", _cond("days_since_last_order", "le", 14)]]),
    },
    # 5. substring → BLOCKED (no Confidence substring rule)
    {
        "id": 5,
        "name": "Test email substring",
        "description": "Email contains @test.",
        "conditions": _conditions("and", ["or", ["or", _cond("email", "substring", "@test")]]),
    },
    # 6. regex → BLOCKED (no general regex rule)
    {
        "id": 6,
        "name": "Regex email",
        "description": "Email matches a regex.",
        "conditions": _conditions("and", ["or", ["or", _cond("email", "regex", ".*@test\\.com")]]),
    },
    # 7. boolean exact (authenticated)
    {
        "id": 7,
        "name": "Authenticated users",
        "description": "Logged-in users.",
        "conditions": _conditions("and", ["or", ["or", _cond("is_logged_in", "exact", True)]]),
    },
    # 9. boolean exact (internal) — used negated in a combo
    {
        "id": 9,
        "name": "Internal staff",
        "description": "Internal employees.",
        "conditions": _conditions("and", ["or", ["or", _cond("is_internal", "exact", True)]]),
    },
    # 10. exists (presence) → BLOCKED (no working Confidence presence operator)
    {
        "id": 10,
        "name": "Has plan",
        "description": "Any plan attribute set.",
        "conditions": _conditions("and", ["or", ["or", _cond("plan", "exists")]]),
    },
    # 11. non-custom_attribute leaf → BLOCKED (no Confidence equivalent)
    {
        "id": 11,
        "name": "Chrome users",
        "description": "Browser-based audience (Web-style).",
        "conditions": _conditions("and", ["or", ["or", _cond("browser", "exact", "gc", ctype="browser")]]),
    },
]

AUDIENCES_BY_ID = {a["id"]: a for a in AUDIENCES}


# ---------------------------------------------------------------------------
# Variations — per flag, the named variation objects (with variable values).
# Boolean flags carry the implicit on/off variations with no variables.
# ---------------------------------------------------------------------------

BOOL_VARIATIONS = [
    {"key": "on", "name": "On", "variables": {}},
    {"key": "off", "name": "Off", "variables": {}},
]

SORT_VARIATIONS = [
    {
        "key": "off",
        "name": "Off",
        "variables": {
            "sort_algorithm": {"value": "popular_first"},
            "show_amounts": {"value": "false"},
        },
    },
    {
        "key": "on",
        "name": "On",
        "variables": {
            "sort_algorithm": {"value": "personalized"},
            "show_amounts": {"value": "true"},
        },
    },
]

MAB_VARIATIONS = [
    {"key": "off", "name": "Off", "variables": {}},
    {"key": "on", "name": "On", "variables": {}},
    {"key": "on_hide", "name": "On Hide", "variables": {}},
]


def _rule(
    key: str,
    name: str,
    rule_type: str,
    *,
    pct: int = 10000,
    variations: dict[str, int],
    audience_ids: list[int] | None = None,
    audience_conditions: list | None = None,
    enabled: bool = True,
    distribution_mode: str = "manual",
) -> dict[str, Any]:
    audience_ids = audience_ids or []
    if audience_conditions is None:
        audience_conditions = ["or", *[{"audience_id": a} for a in audience_ids]] if audience_ids else []
    return {
        "key": key,
        "name": name,
        "type": rule_type,
        "enabled": enabled,
        "percentage_included": pct,
        "distribution_mode": distribution_mode,
        "audience_conditions": audience_conditions,
        "audience_ids": audience_ids,
        "variations": {
            vk: {"key": vk, "percentage_included": vp, "variation_id": 1000 + i}
            for i, (vk, vp) in enumerate(variations.items())
        },
    }


# ---------------------------------------------------------------------------
# Flags — each carries variable_definitions, environments (with `enabled`),
# its variations, and a per-environment ruleset (rules + priorities +
# default_variation).
# ---------------------------------------------------------------------------

FLAGS: list[dict[str, Any]] = [
    # 1. Boolean flag, single 100% targeted-delivery rule to everyone.
    {
        "key": "new-homepage",
        "name": "New homepage",
        "description": "100% rollout to everyone.",
        "archived": False,
        "variable_definitions": {},
        "_variations": BOOL_VARIATIONS,
        "_enabled": True,
        "_default_variation_key": "off",
        "_rule_priorities": ["everyone"],
        "_rules": {
            "everyone": _rule("everyone", "Everyone", "targeted_delivery", variations={"on": 10000}),
        },
    },
    # 2. Boolean, 25% targeted-delivery to a boolean audience.
    {
        "key": "beta_feature",
        "name": "Beta feature",
        "description": "25% rollout to beta users.",
        "archived": False,
        "variable_definitions": {},
        "_variations": BOOL_VARIATIONS,
        "_enabled": True,
        "_default_variation_key": "off",
        "_rule_priorities": ["beta_rollout"],
        "_rules": {
            "beta_rollout": _rule(
                "beta_rollout", "Beta rollout", "targeted_delivery",
                pct=2500, variations={"on": 10000}, audience_ids=[1],
            ),
        },
    },
    # 3. Boolean, 100% to a set-membership audience (country US/CA).
    {
        "key": "na_promo",
        "name": "NA promo",
        "description": "Promo for US/CA.",
        "archived": False,
        "variable_definitions": {},
        "_variations": BOOL_VARIATIONS,
        "_enabled": True,
        "_default_variation_key": "off",
        "_rule_priorities": ["na_only"],
        "_rules": {
            "na_only": _rule(
                "na_only", "NA only", "targeted_delivery",
                variations={"on": 10000}, audience_ids=[2],
            ),
        },
    },
    # 4. Boolean, version-range + string audience (semver_ge AND exact).
    {
        "key": "mobile_checkout",
        "name": "Mobile checkout",
        "description": "iOS on v1.2.0+.",
        "archived": False,
        "variable_definitions": {},
        "_variations": BOOL_VARIATIONS,
        "_enabled": True,
        "_default_variation_key": "off",
        "_rule_priorities": ["modern_ios"],
        "_rules": {
            "modern_ios": _rule(
                "modern_ios", "Modern iOS", "targeted_delivery",
                variations={"on": 10000}, audience_ids=[3],
            ),
        },
    },
    # 5. Boolean, numeric le audience.
    {
        "key": "winback_banner",
        "name": "Winback banner",
        "description": "Recent purchasers only.",
        "archived": False,
        "variable_definitions": {},
        "_variations": BOOL_VARIATIONS,
        "_enabled": True,
        "_default_variation_key": "off",
        "_rule_priorities": ["recent"],
        "_rules": {
            "recent": _rule(
                "recent", "Recent purchasers", "targeted_delivery",
                variations={"on": 10000}, audience_ids=[4],
            ),
        },
    },
    # 6. substring audience → BLOCKED.
    {
        "key": "substring_gate",
        "name": "Substring gate",
        "description": "Email contains a substring — not migratable.",
        "archived": False,
        "variable_definitions": {},
        "_variations": BOOL_VARIATIONS,
        "_enabled": True,
        "_default_variation_key": "off",
        "_rule_priorities": ["substr"],
        "_rules": {
            "substr": _rule(
                "substr", "Substring", "targeted_delivery",
                variations={"on": 10000}, audience_ids=[5],
            ),
        },
    },
    # 7. Flag WITH variables, a/b experiment 50/50 (two variations).
    {
        "key": "product_sort",
        "name": "Product sort",
        "description": "Sort algorithm experiment.",
        "archived": False,
        "variable_definitions": {
            "sort_algorithm": {"key": "sort_algorithm", "type": "string", "default_value": "popular_first"},
            "show_amounts": {"key": "show_amounts", "type": "boolean", "default_value": "false"},
        },
        "_variations": SORT_VARIATIONS,
        "_enabled": True,
        "_default_variation_key": "off",
        "_rule_priorities": ["sort_experiment"],
        "_rules": {
            "sort_experiment": _rule(
                "sort_experiment", "Sort experiment", "a/b",
                variations={"off": 5000, "on": 5000},
            ),
        },
    },
    # 8. a/b with partial allocation (50%) + an everyone fallback rule →
    #    REST backend (non-allocated traffic must fall through).
    {
        "key": "pricing_test",
        "name": "Pricing test",
        "description": "50% into the experiment, rest fall through to a default rollout.",
        "archived": False,
        "variable_definitions": {},
        "_variations": BOOL_VARIATIONS,
        "_enabled": True,
        "_default_variation_key": "off",
        "_rule_priorities": ["price_ab", "fallback_on"],
        "_rules": {
            "price_ab": _rule(
                "price_ab", "Price A/B", "a/b",
                pct=5000, variations={"off": 5000, "on": 5000}, audience_ids=[7],
            ),
            "fallback_on": _rule(
                "fallback_on", "Fallback rollout", "targeted_delivery",
                variations={"on": 10000},
            ),
        },
    },
    # 9. multi_armed_bandit → adaptive split, snapshot + note.
    {
        "key": "headline_mab",
        "name": "Headline MAB",
        "description": "Multi-armed bandit over three headlines.",
        "archived": False,
        "variable_definitions": {},
        "_variations": MAB_VARIATIONS,
        "_enabled": True,
        "_default_variation_key": "off",
        "_rule_priorities": ["mab"],
        "_rules": {
            "mab": _rule(
                "mab", "Headline bandit", "multi_armed_bandit",
                variations={"off": 3333, "on": 3333, "on_hide": 3334},
                distribution_mode="stats_accelerator",
            ),
        },
    },
    # 10. Disabled ruleset → migrate OFF.
    {
        "key": "legacy_banner",
        "name": "Legacy banner",
        "description": "Turned off in production.",
        "archived": False,
        "variable_definitions": {},
        "_variations": BOOL_VARIATIONS,
        "_enabled": False,
        "_default_variation_key": "off",
        "_rule_priorities": ["us_only"],
        "_rules": {
            "us_only": _rule(
                "us_only", "US only", "targeted_delivery",
                variations={"on": 10000}, audience_ids=[2],
            ),
        },
    },
    # 11. Combo audience: authenticated AND NOT internal → inline both,
    #     internal negated.
    {
        "key": "members_dashboard",
        "name": "Members dashboard",
        "description": "Authenticated non-staff.",
        "archived": False,
        "variable_definitions": {},
        "_variations": BOOL_VARIATIONS,
        "_enabled": True,
        "_default_variation_key": "off",
        "_rule_priorities": ["members"],
        "_rules": {
            "members": _rule(
                "members", "Members", "targeted_delivery",
                variations={"on": 10000},
                audience_ids=[7, 9],
                audience_conditions=["and", {"audience_id": 7}, ["not", {"audience_id": 9}]],
            ),
        },
    },
    # 12. exists audience → BLOCKED (no working Confidence presence operator).
    {
        "key": "plan_badge",
        "name": "Plan badge",
        "description": "Anyone with a plan attribute set.",
        "archived": False,
        "variable_definitions": {},
        "_variations": BOOL_VARIATIONS,
        "_enabled": True,
        "_default_variation_key": "off",
        "_rule_priorities": ["has_plan"],
        "_rules": {
            "has_plan": _rule(
                "has_plan", "Has plan", "targeted_delivery",
                variations={"on": 10000}, audience_ids=[10],
            ),
        },
    },
    # 13. Non-custom_attribute audience (browser) → BLOCKED.
    {
        "key": "browser_gate",
        "name": "Browser gate",
        "description": "Chrome-only (Web-style audience).",
        "archived": False,
        "variable_definitions": {},
        "_variations": BOOL_VARIATIONS,
        "_enabled": True,
        "_default_variation_key": "off",
        "_rule_priorities": ["chrome"],
        "_rules": {
            "chrome": _rule(
                "chrome", "Chrome", "targeted_delivery",
                variations={"on": 10000}, audience_ids=[11],
            ),
        },
    },
    # 14. Archived flag — hidden from list unless opted in.
    {
        "key": "old_experiment",
        "name": "Old experiment",
        "description": "Archived experiment from last quarter.",
        "archived": True,
        "variable_definitions": {},
        "_variations": BOOL_VARIATIONS,
        "_enabled": False,
        "_default_variation_key": "off",
        "_rule_priorities": ["us_only"],
        "_rules": {
            "us_only": _rule(
                "us_only", "US only", "targeted_delivery",
                variations={"on": 10000}, audience_ids=[2],
            ),
        },
    },
]

FLAGS_BY_KEY = {f["key"]: f for f in FLAGS}


# ---------------------------------------------------------------------------
# Response shaping
# ---------------------------------------------------------------------------

def _flag_public(f: dict[str, Any], env_key: str = "production") -> dict[str, Any]:
    """The flag object as the List/Fetch Flags endpoints return it."""
    rules_detail = [
        {
            "key": rk,
            "name": f["_rules"][rk]["name"],
            "type": f["_rules"][rk]["type"],
            "enabled": f["_rules"][rk]["enabled"],
            "audience_ids": f["_rules"][rk]["audience_ids"],
            "traffic_allocation": f["_rules"][rk]["percentage_included"],
            "distribution_mode": f["_rules"][rk]["distribution_mode"],
        }
        for rk in f["_rule_priorities"]
    ]
    return {
        "key": f["key"],
        "name": f["name"],
        "description": f["description"],
        "archived": f["archived"],
        "variable_definitions": f["variable_definitions"],
        "id": abs(hash(f["key"])) % 10_000_000,
        "urn": f"flags.flags.optimizely.com::{f['key']}",
        "project_id": PROJECT_ID,
        "account_id": ACCOUNT_ID,
        "environments": {
            env["key"]: {
                "key": env["key"],
                "name": env["name"],
                "enabled": f["_enabled"] if env["key"] == "production" else False,
                "priority": env["priority"],
                "status": "running" if f["_enabled"] else "draft",
                "rules_summary": {},
                "rules_detail": rules_detail if env["key"] == "production" else [],
                "id": env["id"],
            }
            for env in ENVIRONMENTS
        },
    }


def _ruleset_public(f: dict[str, Any], env_key: str) -> dict[str, Any]:
    enabled = f["_enabled"] if env_key == "production" else False
    rules = f["_rules"] if env_key == "production" else {}
    priorities = f["_rule_priorities"] if env_key == "production" else []
    return {
        "url": f"/projects/{PROJECT_ID}/flags/{f['key']}/environments/{env_key}/ruleset",
        "rules": rules,
        "rule_priorities": priorities,
        "id": abs(hash(f["key"] + env_key)) % 10_000_000,
        "archived": False,
        "enabled": enabled,
        "flag_key": f["key"],
        "environment_key": env_key,
        "default_variation_key": f["_default_variation_key"],
        "default_variation_name": f["_default_variation_key"].title(),
        "status": "running" if enabled else "paused",
    }


def _audience_public(a: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": a["id"],
        "name": a["name"],
        "description": a["description"],
        "conditions": a["conditions"],
        "archived": False,
        "is_classic": False,
        "project_id": PROJECT_ID,
    }


# ---------------------------------------------------------------------------
# HTTP layer
# ---------------------------------------------------------------------------

R_FLAGS_LIST = re.compile(r"^/flags/v1/projects/(?P<pid>\d+)/flags/?$")
R_FLAG_ONE = re.compile(r"^/flags/v1/projects/(?P<pid>\d+)/flags/(?P<key>[^/]+)/?$")
R_FLAG_VARIATIONS = re.compile(r"^/flags/v1/projects/(?P<pid>\d+)/flags/(?P<key>[^/]+)/variations/?$")
R_RULESET = re.compile(
    r"^/flags/v1/projects/(?P<pid>\d+)/flags/(?P<key>[^/]+)/environments/(?P<env>[^/]+)/ruleset/?$"
)
R_AUDIENCES_LIST = re.compile(r"^/v2/audiences/?$")
R_AUDIENCE_ONE = re.compile(r"^/v2/audiences/(?P<id>\d+)/?$")
R_ENVIRONMENTS = re.compile(r"^/v2/environments/?$")
R_PROJECTS = re.compile(r"^/v2/projects/?$")


class Handler(BaseHTTPRequestHandler):
    server_version = "FakeOptimizely/0.1"
    per_page_default = 100

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
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            self._send(401, {"message": "Missing or malformed Authorization header"})
            return False
        return True

    def _bool_param(self, query: dict[str, list[str]], name: str) -> bool:
        return name in query and query[name][0].lower() in ("true", "1", "yes")

    def _paginate(self, items: list, query: dict[str, list[str]], url: str) -> dict:
        per_page = int(query.get("per_page", [str(self.per_page_default)])[0])
        page = int(query.get("page", ["1"])[0])
        total = len(items)
        total_pages = max(1, (total + per_page - 1) // per_page)
        start = (page - 1) * per_page
        window = items[start : start + per_page]
        return {
            "items": window,
            "page": page,
            "total_pages": total_pages,
            "count": len(window),
            "total_count": total,
            "url": url,
        }

    def do_GET(self) -> None:  # noqa: N802
        if not self._check_auth():
            return
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        m = R_RULESET.match(path)
        if m:
            f = FLAGS_BY_KEY.get(m["key"])
            if f is None:
                self._send(404, {"message": f"flag {m['key']} not found"})
                return
            self._send(200, _ruleset_public(f, m["env"]))
            return

        m = R_FLAG_VARIATIONS.match(path)
        if m:
            f = FLAGS_BY_KEY.get(m["key"])
            if f is None:
                self._send(404, {"message": f"flag {m['key']} not found"})
                return
            self._send(200, {"items": f["_variations"], "count": len(f["_variations"])})
            return

        m = R_FLAG_ONE.match(path)
        if m and not path.rstrip("/").endswith("/flags"):
            f = FLAGS_BY_KEY.get(m["key"])
            if f is None:
                self._send(404, {"message": f"flag {m['key']} not found"})
                return
            self._send(200, _flag_public(f))
            return

        m = R_FLAGS_LIST.match(path)
        if m:
            include_archived = self._bool_param(query, "archived")
            visible = [f for f in FLAGS if include_archived or not f["archived"]]
            self._send(200, self._paginate([_flag_public(f) for f in visible], query, path))
            return

        m = R_AUDIENCE_ONE.match(path)
        if m:
            a = AUDIENCES_BY_ID.get(int(m["id"]))
            if a is None:
                self._send(404, {"message": f"audience {m['id']} not found"})
                return
            self._send(200, _audience_public(a))
            return

        m = R_AUDIENCES_LIST.match(path)
        if m:
            self._send(200, self._paginate([_audience_public(a) for a in AUDIENCES], query, path))
            return

        m = R_ENVIRONMENTS.match(path)
        if m:
            self._send(200, {"items": ENVIRONMENTS, "count": len(ENVIRONMENTS)})
            return

        m = R_PROJECTS.match(path)
        if m:
            self._send(200, {"items": [{"id": PROJECT_ID, "name": "Fixture project", "status": "active"}]})
            return

        self._send(404, {"message": f"No route for {path}"})

    def _readonly(self) -> None:
        self._send(405, {"message": "This fake server is read-only"})

    do_POST = do_PUT = do_PATCH = do_DELETE = lambda self: self._readonly()  # noqa: E731


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=4100)
    args = parser.parse_args()

    server = HTTPServer(("127.0.0.1", args.port), Handler)
    base = f"http://127.0.0.1:{args.port}"
    n_active = sum(1 for f in FLAGS if not f["archived"])
    print(f"Fake Optimizely REST API listening on {base}")
    print(f"  {len(FLAGS)} flags ({n_active} non-archived), {len(AUDIENCES)} audiences, "
          f"{len(ENVIRONMENTS)} environments")
    print(f"  Project ID: {PROJECT_ID}")
    print("  Point the migrate-optimizely skill at this base URL when prompted.")
    print("  Set OPTIMIZELY_API_TOKEN to anything (any Bearer value passes).")
    print("  Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
