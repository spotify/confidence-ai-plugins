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

The server hosts two Optimizely projects on one port, selected by the
project id in the request:

  * {PROJECT_ID} — curated fixtures that exercise every branch of the
    skill's operator-mapping table and BLOCKED markers (see README.md)
  * {SUMMARY_EXPORT_PROJECT_ID} — a synthetic account modeling the
    Option B2 flattened-summary-export pattern: legacy variable-less
    a/b tests (paused and long-"running"), duplicate variation names,
    full and partial rollouts, no audiences (see README.md → "Summary
    export scenario")

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
# Summary-export scenario dataset (synthetic — models Option B2)
# ---------------------------------------------------------------------------
# Models an account whose export tool/token only produces rule *summaries*
# (`traffic_allocation` + `variation_names` — the same shape a
# `has_restricted_permissions: true` token returns). It does NOT include
# per-variation split, flag variables, or audiences. We reconstruct a
# faithful ruleset using Optimizely's documented defaults so the skill can
# run end-to-end against a representative account of this shape:
#   * manual N-way a/b split          → even split (2 arms = 50/50); this is
#                                        the SERVER's reconstruction default —
#                                        the skill's own file path never
#                                        assumes a split (scope policy)
#   * no flag variables               → variable-less flag; the SDK returns
#                                        the variation KEY (getVariationKey),
#                                        so each arm is a bare named variation
#   * empty `audience_ids`            → targets everyone
#   * paused experiments              → ruleset disabled → excluded by default
#                                        (opt-in migrates them OFF); running
#                                        entries exercise the scope policy:
#                                        live-vs-stale, duplicate-name
#                                        collapse, partial-% exclusion
#   * `default_variation_key: "off"`  → implicit off variation plus the arms
#
# All flag names/keys/ids below are synthetic — this is not any real
# account's data (see `summary-export-sample.json` for the matching
# synthetic Option B2 file used to test file-based input directly).

SUMMARY_EXPORT_PROJECT_ID = 5551000001
SUMMARY_EXPORT_ACCOUNT_ID = 5551000000

SUMMARY_EXPORT_ENVIRONMENTS = [
    {"key": "production", "name": "Production", "id": 5551000002, "archived": False, "priority": 1},
]


def _bare_ab_variations(arms: list[str]) -> list[dict[str, Any]]:
    """An `off` variation plus one bare (variable-less) variation per arm."""
    variations = [{"key": "off", "name": "Off", "variables": {}}]
    variations.extend({"key": arm, "name": arm, "variables": {}} for arm in arms)
    return variations


def _summary_export_ab_flag(
    flag_key: str, exp_name: str, exp_key: str, arms: list[str],
    *, enabled: bool = False, description: str = "",
) -> dict[str, Any]:
    """A variable-less a/b experiment targeting everyone, split evenly.

    Paused by default; pass enabled=True for the running-experiment
    (live-vs-stale) scenario.
    """
    n = len(arms)
    base = 10000 // n
    split = {arm: base for arm in arms}
    split[arms[-1]] += 10000 - base * n  # give rounding remainder to the last arm
    return {
        "key": flag_key,
        "name": exp_name,
        "description": description,
        "archived": False,
        "variable_definitions": {},
        "_variations": _bare_ab_variations(arms),
        "_enabled": enabled,
        "_default_variation_key": "off",
        "_rule_priorities": [exp_key],
        "_rules": {
            exp_key: _rule(exp_key, exp_name, "a/b", variations=split, enabled=enabled),
        },
    }


def _summary_export_rollout_flag(
    flag_key: str, name: str, rule_key: str, *, pct: int, description: str = "",
) -> dict[str, Any]:
    """A running targeted-delivery rollout to everyone (full or partial %)."""
    return {
        "key": flag_key,
        "name": name,
        "description": description,
        "archived": False,
        "variable_definitions": {},
        "_variations": [
            {"key": "off", "name": "Off", "variables": {}},
            {"key": "on", "name": "On", "variables": {}},
        ],
        "_enabled": True,
        "_default_variation_key": "off",
        "_rule_priorities": [rule_key],
        "_rules": {
            rule_key: _rule(rule_key, name, "targeted_delivery", pct=pct,
                            variations={"on": 10000}),
        },
    }


SUMMARY_EXPORT_FLAGS: list[dict[str, Any]] = [
    _summary_export_ab_flag(
        "flag-sample-checkout-btn", "Checkout Button Color",
        "checkout_button_color", ["control", "treatment"],
    ),
    _summary_export_ab_flag(
        "flag-sample-homepage-hero", "Homepage Hero Layout",
        "homepage_hero_layout", ["layout_a", "layout_b"],
    ),
    _summary_export_ab_flag(
        "flag-sample-search-rank", "Search Result Ranking",
        "search_result_ranking", ["variation_1", "variation_2"],
    ),
    _summary_export_ab_flag(
        "flag-sample-onboarding", "Onboarding Flow Steps",
        "onboarding_flow_steps", ["three_step", "five_step"],
    ),
    _summary_export_ab_flag(
        "flag-sample-pricing-copy", "Pricing Page Copy",
        "pricing_page_copy", ["original", "variation"],
    ),
    _summary_export_ab_flag(
        "flag-sample-email-subject", "Email Subject Line",
        "email_subject_line", ["subject_a", "subject_b"],
    ),
    # Running experiment whose two arms were later pinned to the SAME
    # content (a CMS pattern): distinct variation keys, identical display
    # names. The summary export flattens to duplicate `variation_names` —
    # the skill collapses it to a single fully-rolled-out variant. The
    # human-readable name lives in `description`, not the synthetic key.
    {
        "key": "CMSaa11bb22cc33dd44ee55f",
        "name": "CMS-aa11bb22-cc33-dd44-ee55-ff6677889900",
        "description": "Homepage banner refresh",
        "archived": False,
        "variable_definitions": {},
        "_variations": [
            {"key": "off", "name": "Off", "variables": {}},
            {"key": "variation_1", "name": "b47c20de-55a1-4c02-9e6f-8d21a7c3f410", "variables": {}},
            {"key": "variation_2", "name": "b47c20de-55a1-4c02-9e6f-8d21a7c3f410", "variables": {}},
        ],
        "_enabled": True,
        "_default_variation_key": "off",
        "_rule_priorities": ["CMS-aa11bb22-cc33-dd44-ee55-ff6677889900"],
        "_rules": {
            "CMS-aa11bb22-cc33-dd44-ee55-ff6677889900": _rule(
                "CMS-aa11bb22-cc33-dd44-ee55-ff6677889900",
                "CMS-aa11bb22-cc33-dd44-ee55-ff6677889900",
                "a/b", variations={"variation_1": 5000, "variation_2": 5000},
            ),
        },
    },
    # "Running" experiment with distinct arms — exercises the
    # live-vs-stale scope question (the export can't say whether anyone
    # still measures it) and the unknown-split exclusion on the file path.
    _summary_export_ab_flag(
        "flag-sample-video-autoplay", "Legacy Video Autoplay Test",
        "legacy_video_autoplay_test", ["autoplay_on", "autoplay_off"],
        enabled=True, description="Compare autoplay vs click-to-play video",
    ),
    # Stable 100% rollout → migrates under the default scope policy.
    _summary_export_rollout_flag(
        "flag-sample-dark-mode", "Dark Mode Rollout", "dark_mode_rollout",
        pct=10000, description="Dark mode for all users",
    ),
    # Partial 40% rollout → excluded under the default scope policy
    # (the included cohort can't be reproduced in Confidence).
    _summary_export_rollout_flag(
        "flag-sample-beta-search", "Beta Search Rollout", "beta_search_rollout",
        pct=4000, description="New search backend, gradual rollout",
    ),
]
SUMMARY_EXPORT_FLAGS_BY_KEY = {f["key"]: f for f in SUMMARY_EXPORT_FLAGS}
SUMMARY_EXPORT_AUDIENCES: list[dict[str, Any]] = []


# ---------------------------------------------------------------------------
# Datasets — the server serves one dataset per Optimizely project id, so both
# the curated operator-mapping fixtures and the summary-export scenario are
# reachable on the same port. The curated dataset stays the module-level
# default so `verify_migration.py` / `seed_optimizely.py` keep importing
# FLAGS/AUDIENCES.
# ---------------------------------------------------------------------------

class Dataset:
    def __init__(self, project_id, account_id, flags, audiences, environments):
        self.project_id = project_id
        self.account_id = account_id
        self.flags = flags
        self.flags_by_key = {f["key"]: f for f in flags}
        self.audiences = audiences
        self.audiences_by_id = {a["id"]: a for a in audiences}
        self.environments = environments


DEFAULT_DATASET = Dataset(PROJECT_ID, ACCOUNT_ID, FLAGS, AUDIENCES, ENVIRONMENTS)
SUMMARY_EXPORT_DATASET = Dataset(
    SUMMARY_EXPORT_PROJECT_ID, SUMMARY_EXPORT_ACCOUNT_ID,
    SUMMARY_EXPORT_FLAGS, SUMMARY_EXPORT_AUDIENCES, SUMMARY_EXPORT_ENVIRONMENTS,
)
DATASETS = {ds.project_id: ds for ds in (DEFAULT_DATASET, SUMMARY_EXPORT_DATASET)}


# ---------------------------------------------------------------------------
# Response shaping
# ---------------------------------------------------------------------------

def _flag_public(ds: Dataset, f: dict[str, Any], env_key: str = "production") -> dict[str, Any]:
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
        "project_id": ds.project_id,
        "account_id": ds.account_id,
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
            for env in ds.environments
        },
    }


def _ruleset_public(ds: Dataset, f: dict[str, Any], env_key: str) -> dict[str, Any]:
    enabled = f["_enabled"] if env_key == "production" else False
    rules = f["_rules"] if env_key == "production" else {}
    priorities = f["_rule_priorities"] if env_key == "production" else []
    return {
        "url": f"/projects/{ds.project_id}/flags/{f['key']}/environments/{env_key}/ruleset",
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


def _audience_public(ds: Dataset, a: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": a["id"],
        "name": a["name"],
        "description": a["description"],
        "conditions": a["conditions"],
        "archived": False,
        "is_classic": False,
        "project_id": ds.project_id,
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

    def _dataset_for_pid(self, pid: str) -> "Dataset | None":
        """Resolve the dataset for a path project id, 404-ing if unknown."""
        ds = DATASETS.get(int(pid))
        if ds is None:
            self._send(404, {"message": f"project {pid} not found"})
        return ds

    def _dataset_for_query_pid(self, query: dict[str, list[str]]) -> "Dataset":
        """Resolve the dataset for a `project_id` query param (v2 endpoints)."""
        raw = query.get("project_id", [str(PROJECT_ID)])[0]
        return DATASETS.get(int(raw), DEFAULT_DATASET)

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
            ds = self._dataset_for_pid(m["pid"])
            if ds is None:
                return
            f = ds.flags_by_key.get(m["key"])
            if f is None:
                self._send(404, {"message": f"flag {m['key']} not found"})
                return
            self._send(200, _ruleset_public(ds, f, m["env"]))
            return

        m = R_FLAG_VARIATIONS.match(path)
        if m:
            ds = self._dataset_for_pid(m["pid"])
            if ds is None:
                return
            f = ds.flags_by_key.get(m["key"])
            if f is None:
                self._send(404, {"message": f"flag {m['key']} not found"})
                return
            self._send(200, {"items": f["_variations"], "count": len(f["_variations"])})
            return

        m = R_FLAG_ONE.match(path)
        if m and not path.rstrip("/").endswith("/flags"):
            ds = self._dataset_for_pid(m["pid"])
            if ds is None:
                return
            f = ds.flags_by_key.get(m["key"])
            if f is None:
                self._send(404, {"message": f"flag {m['key']} not found"})
                return
            self._send(200, _flag_public(ds, f))
            return

        m = R_FLAGS_LIST.match(path)
        if m:
            ds = self._dataset_for_pid(m["pid"])
            if ds is None:
                return
            include_archived = self._bool_param(query, "archived")
            visible = [f for f in ds.flags if include_archived or not f["archived"]]
            self._send(200, self._paginate([_flag_public(ds, f) for f in visible], query, path))
            return

        m = R_AUDIENCE_ONE.match(path)
        if m:
            aid = int(m["id"])
            for ds in DATASETS.values():
                a = ds.audiences_by_id.get(aid)
                if a is not None:
                    self._send(200, _audience_public(ds, a))
                    return
            self._send(404, {"message": f"audience {m['id']} not found"})
            return

        m = R_AUDIENCES_LIST.match(path)
        if m:
            ds = self._dataset_for_query_pid(query)
            self._send(200, self._paginate([_audience_public(ds, a) for a in ds.audiences], query, path))
            return

        m = R_ENVIRONMENTS.match(path)
        if m:
            ds = self._dataset_for_query_pid(query)
            self._send(200, {"items": ds.environments, "count": len(ds.environments)})
            return

        m = R_PROJECTS.match(path)
        if m:
            self._send(200, {"items": [
                {"id": ds.project_id, "name": f"Fixture project {ds.project_id}", "status": "active"}
                for ds in DATASETS.values()
            ]})
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
    print(f"Fake Optimizely REST API listening on {base}")
    for ds in DATASETS.values():
        n_active = sum(1 for f in ds.flags if not f["archived"])
        label = "curated operator-mapping fixtures" if ds is DEFAULT_DATASET else "summary export scenario"
        print(f"  Project {ds.project_id} ({label}): "
              f"{len(ds.flags)} flags ({n_active} non-archived), "
              f"{len(ds.audiences)} audiences, {len(ds.environments)} environments")
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
