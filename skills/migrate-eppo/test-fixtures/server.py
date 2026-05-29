#!/usr/bin/env python3
"""Fake Eppo REST API server for testing the migrate-eppo skill end-to-end.

Implements the read endpoints the skill calls:
  GET /api/v1/environments
  GET /api/v1/feature-flags?offset=N&limit=N&include_archived=true|false
  GET /api/v1/feature-flags/{id}
  GET /api/v1/feature-flags/{id}/environments/{environmentId}
  GET /api/v1/audiences
  GET /api/v1/audiences/{id}

JSON shapes are derived directly from Eppo's public OpenAPI 3.0 spec
(embedded inline in <https://eppo.cloud/api/docs/swagger-ui-init.js>;
no auth required to fetch). Field names, enum values, required-field
sets and pagination semantics match `PublicApiFeatureFlag` and friends
in that spec as of 2026-05-28.

Notable conventions:
  * snake_case everywhere (`variation_type`, `is_archived`, ...)
  * IDs are numeric (Eppo Object IDs)
  * Variation weights are an array of {variation_id, weight}, never a map
  * Condition `values` is always an array, even for single-value operators
  * Default value lives on the allocation marked `is_default: true`, NOT
    on the flag
  * Allocations are per-environment via `environment_id`; for fixtures
    where all envs share the same allocations we stamp env_id at serve
    time to avoid duplicate fixture data
  * The list endpoint returns a bare array (no wrapper), paginated via
    `offset` + `limit`

Fixture flags are curated to exercise every branch of the skill's
operator-mapping table and BLOCKED markers — see README.md. Flag #13
is archived (`is_archived: true`) and hidden from list results by
default to test the archive-filtering path.

Run:
    python3 server.py [--port 3000] [--limit-default 50]
"""

import argparse
import copy
import json
import re
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

CREATED_AT = "2026-01-15T12:00:00.000Z"
UPDATED_AT = "2026-05-20T09:30:00.000Z"


# ---------------------------------------------------------------------------
# Environments
# ---------------------------------------------------------------------------

ENVIRONMENTS: list[dict[str, Any]] = [
    {
        "id": 1,
        "name": "Production",
        "is_production": True,
        "sdk_key_count": 3,
        "client_token_count": 2,
        "created_at": CREATED_AT,
        "updated_at": UPDATED_AT,
    },
    {
        "id": 2,
        "name": "Staging",
        "is_production": False,
        "sdk_key_count": 1,
        "client_token_count": 1,
        "created_at": CREATED_AT,
        "updated_at": UPDATED_AT,
    },
    {
        "id": 3,
        "name": "Test",
        "is_production": False,
        "sdk_key_count": 1,
        "client_token_count": 0,
        "created_at": CREATED_AT,
        "updated_at": UPDATED_AT,
    },
]


# ---------------------------------------------------------------------------
# Variation helpers
# ---------------------------------------------------------------------------


def _bool_variations(base_id: int) -> list[dict[str, Any]]:
    """Stable {Enabled, Disabled} pair with deterministic IDs.

    base_id is offset by 0 for Enabled and 1 for Disabled so different
    flags get distinct variation IDs.
    """
    return [
        {"id": base_id, "name": "Enabled", "variant_key": "enabled"},
        {"id": base_id + 1, "name": "Disabled", "variant_key": "disabled"},
    ]


# ---------------------------------------------------------------------------
# Fixture flags
# ---------------------------------------------------------------------------
#
# Each entry is the canonical /feature-flags/{id} response body, MINUS the
# `environments` array — that's stamped on at serve time per ENV_OVERRIDES.
# Allocations here are environment-agnostic; the serve-time helper assigns
# `environment_id` for the env-specific endpoint.

FLAGS: list[dict[str, Any]] = [
    # 1. MATCHES with a clean suffix anchor → endsWithRule.
    {
        "id": 1,
        "key": "internal-tools-gate",
        "name": "Internal tools gate",
        "description": "Show internal tooling to Spotify employees only.",
        "is_archived": False,
        "variation_type": "BOOLEAN",
        "owner": None,
        "variations": _bool_variations(101),
        "allocations": [
            {
                "id": 1001,
                "key": "spotify-employees",
                "name": "Spotify employees",
                "created_at": CREATED_AT,
                "type": "FEATURE_GATE",
                "variation_weight": [{"variation_id": 101, "weight": 100}],
                "targeting_rules": [
                    {
                        "conditions": [
                            {
                                "operator": "MATCHES",
                                "attribute": "email",
                                "values": [".*@spotify\\.com$"],
                            }
                        ]
                    }
                ],
                "audiences": [],
                "percent_exposure": 100,
                "is_default": False,
                "experiment": None,
            },
            {
                "id": 1002,
                "key": "internal-tools-gate-default",
                "name": "Default off",
                "created_at": CREATED_AT,
                "type": "FEATURE_GATE",
                "variation_weight": [{"variation_id": 102, "weight": 100}],
                "targeting_rules": [],
                "audiences": [],
                "percent_exposure": 100,
                "is_default": True,
                "experiment": None,
            },
        ],
        "tag_names": ["internal"],
        "created_at": CREATED_AT,
        "updated_at": UPDATED_AT,
        "entity_id": 1,
        "type": "FEATURE_FLAG",
        "structured_metadata": [],
    },
    # 2. Waterfall (two allocations), Feature Gate + Experiment, ONE_OF
    #    set membership, multivariant 50/50 split.
    {
        "id": 2,
        "key": "pricing-experiment",
        "name": "Pricing page experiment",
        "description": "Test a new pricing layout against control.",
        "is_archived": False,
        "variation_type": "STRING",
        "owner": None,
        "variations": [
            {"id": 201, "name": "Control", "variant_key": "control"},
            {"id": 202, "name": "Treatment A", "variant_key": "treatment_a"},
            {"id": 203, "name": "Treatment B", "variant_key": "treatment_b"},
        ],
        "allocations": [
            {
                "id": 2001,
                "key": "internal-qa-force-on",
                "name": "Internal QA force-on",
                "created_at": CREATED_AT,
                "type": "FEATURE_GATE",
                "variation_weight": [{"variation_id": 202, "weight": 100}],
                "targeting_rules": [
                    {
                        "conditions": [
                            {
                                "operator": "MATCHES",
                                "attribute": "email",
                                "values": [".*@spotify\\.com$"],
                            }
                        ]
                    }
                ],
                "audiences": [],
                "percent_exposure": 100,
                "is_default": False,
                "experiment": None,
            },
            {
                "id": 2002,
                "key": "north-america-50-50",
                "name": "North America 50/50",
                "created_at": CREATED_AT,
                "type": "EXPERIMENT",
                "variation_weight": [
                    {"variation_id": 201, "weight": 50},
                    {"variation_id": 202, "weight": 50},
                ],
                "targeting_rules": [
                    {
                        "conditions": [
                            {
                                "operator": "ONE_OF",
                                "attribute": "country",
                                "values": ["US", "CA"],
                            }
                        ]
                    }
                ],
                "audiences": [],
                "percent_exposure": 100,
                "is_default": False,
                "experiment": {
                    "id": 9001,
                    "name": "Pricing layout A/B",
                    "status": "RUNNING",
                },
            },
            {
                "id": 2003,
                "key": "pricing-experiment-default",
                "name": "Default control",
                "created_at": CREATED_AT,
                "type": "FEATURE_GATE",
                "variation_weight": [{"variation_id": 201, "weight": 100}],
                "targeting_rules": [],
                "audiences": [],
                "percent_exposure": 100,
                "is_default": True,
                "experiment": None,
            },
        ],
        "tag_names": ["pricing", "experiment"],
        "created_at": CREATED_AT,
        "updated_at": UPDATED_AT,
        "entity_id": 1,
        "type": "FEATURE_FLAG",
        "structured_metadata": [],
    },
    # 3. NOT_ONE_OF + GTE numeric, AND combination within a single rule.
    #    Uses a numeric build number (distinct from the SemVer appVersion
    #    used by flag 6) so numeric vs version comparison stay separable.
    {
        "id": 3,
        "key": "legacy-search-rollout",
        "name": "Legacy search rollout",
        "description": "Roll out new search outside DE/FR for app build 28+.",
        "is_archived": False,
        "variation_type": "BOOLEAN",
        "owner": None,
        "variations": _bool_variations(301),
        "allocations": [
            {
                "id": 3001,
                "key": "eligible-users",
                "name": "Eligible users",
                "created_at": CREATED_AT,
                "type": "FEATURE_GATE",
                "variation_weight": [{"variation_id": 301, "weight": 100}],
                "targeting_rules": [
                    {
                        "conditions": [
                            {
                                "operator": "NOT_ONE_OF",
                                "attribute": "country",
                                "values": ["DE", "FR"],
                            },
                            {
                                "operator": "GTE",
                                "attribute": "appBuildNumber",
                                "values": ["28"],
                            },
                        ]
                    }
                ],
                "audiences": [],
                "percent_exposure": 100,
                "is_default": False,
                "experiment": None,
            },
            {
                "id": 3002,
                "key": "legacy-search-rollout-default",
                "name": "Default off",
                "created_at": CREATED_AT,
                "type": "FEATURE_GATE",
                "variation_weight": [{"variation_id": 302, "weight": 100}],
                "targeting_rules": [],
                "audiences": [],
                "percent_exposure": 100,
                "is_default": True,
                "experiment": None,
            },
        ],
        "tag_names": ["search"],
        "created_at": CREATED_AT,
        "updated_at": UPDATED_AT,
        "entity_id": 1,
        "type": "FEATURE_FLAG",
        "structured_metadata": [],
    },
    # 4. Subject-key targeting via the special `id` attribute. The skill
    #    must rewrite this to the chosen Confidence entity field.
    {
        "id": 4,
        "key": "subject-id-targeting",
        "name": "Specific test users",
        "description": "Allowlist of test user IDs.",
        "is_archived": False,
        "variation_type": "BOOLEAN",
        "owner": None,
        "variations": _bool_variations(401),
        "allocations": [
            {
                "id": 4001,
                "key": "test-allowlist",
                "name": "Test allowlist",
                "created_at": CREATED_AT,
                "type": "FEATURE_GATE",
                "variation_weight": [{"variation_id": 401, "weight": 100}],
                "targeting_rules": [
                    {
                        "conditions": [
                            {
                                "operator": "ONE_OF",
                                "attribute": "id",
                                "values": ["test-user-1", "test-user-2"],
                            }
                        ]
                    }
                ],
                "audiences": [],
                "percent_exposure": 100,
                "is_default": False,
                "experiment": None,
            },
            {
                "id": 4002,
                "key": "subject-id-targeting-default",
                "name": "Default off",
                "created_at": CREATED_AT,
                "type": "FEATURE_GATE",
                "variation_weight": [{"variation_id": 402, "weight": 100}],
                "targeting_rules": [],
                "audiences": [],
                "percent_exposure": 100,
                "is_default": True,
                "experiment": None,
            },
        ],
        "tag_names": [],
        "created_at": CREATED_AT,
        "updated_at": UPDATED_AT,
        "entity_id": 1,
        "type": "FEATURE_FLAG",
        "structured_metadata": [],
    },
    # 5. Disabled in Production via ENV_OVERRIDES below. Migration should
    #    still create the flag, but with all rules at 0% rollout so it
    #    doesn't activate accidentally.
    {
        "id": 5,
        "key": "legacy-checkout-redesign",
        "name": "Legacy checkout redesign",
        "description": "Old experiment that's been turned off.",
        "is_archived": False,
        "variation_type": "BOOLEAN",
        "owner": None,
        "variations": _bool_variations(501),
        "allocations": [
            {
                "id": 5001,
                "key": "us-test-cohort",
                "name": "US test cohort",
                "created_at": CREATED_AT,
                "type": "FEATURE_GATE",
                "variation_weight": [{"variation_id": 501, "weight": 100}],
                "targeting_rules": [
                    {
                        "conditions": [
                            {
                                "operator": "ONE_OF",
                                "attribute": "country",
                                "values": ["US"],
                            }
                        ]
                    }
                ],
                "audiences": [],
                "percent_exposure": 100,
                "is_default": False,
                "experiment": None,
            },
            {
                "id": 5002,
                "key": "legacy-checkout-redesign-default",
                "name": "Default off",
                "created_at": CREATED_AT,
                "type": "FEATURE_GATE",
                "variation_weight": [{"variation_id": 502, "weight": 100}],
                "targeting_rules": [],
                "audiences": [],
                "percent_exposure": 100,
                "is_default": True,
                "experiment": None,
            },
        ],
        "tag_names": ["legacy"],
        "created_at": CREATED_AT,
        "updated_at": UPDATED_AT,
        "entity_id": 1,
        "type": "FEATURE_FLAG",
        "structured_metadata": [],
    },
    # 6. SemVer → MIGRATABLE. `appVersion >= "1.2.0"` is detected as a
    #    version comparison (value matches the SemVer heuristic) and maps
    #    to a rangeRule with versionValue — Confidence has a first-class
    #    SemanticVersion value type. ANDed with a device set-membership.
    {
        "id": 6,
        "key": "mobile-only-feature",
        "name": "Mobile only feature",
        "description": "iOS/Android users on app v1.2.0+.",
        "is_archived": False,
        "variation_type": "BOOLEAN",
        "owner": None,
        "variations": _bool_variations(601),
        "allocations": [
            {
                "id": 6001,
                "key": "modern-mobile-clients",
                "name": "Modern mobile clients",
                "created_at": CREATED_AT,
                "type": "FEATURE_GATE",
                "variation_weight": [{"variation_id": 601, "weight": 100}],
                "targeting_rules": [
                    {
                        "conditions": [
                            {
                                "operator": "ONE_OF",
                                "attribute": "device",
                                "values": ["iOS", "Android"],
                            },
                            {
                                "operator": "GTE",
                                "attribute": "appVersion",
                                "values": ["1.2.0"],
                            },
                        ]
                    }
                ],
                "audiences": [],
                "percent_exposure": 100,
                "is_default": False,
                "experiment": None,
            },
            {
                "id": 6002,
                "key": "mobile-only-feature-default",
                "name": "Default off",
                "created_at": CREATED_AT,
                "type": "FEATURE_GATE",
                "variation_weight": [{"variation_id": 602, "weight": 100}],
                "targeting_rules": [],
                "audiences": [],
                "percent_exposure": 100,
                "is_default": True,
                "experiment": None,
            },
        ],
        "tag_names": ["mobile"],
        "created_at": CREATED_AT,
        "updated_at": UPDATED_AT,
        "entity_id": 1,
        "type": "FEATURE_FLAG",
        "structured_metadata": [],
    },
    # 7. Regex alternation → MIGRATABLE. MATCHES with a suffix-anchored
    #    alternation `.*@(test|qa|staging)\.com$` decomposes into one
    #    endsWithRule per branch (@test.com / @qa.com / @staging.com),
    #    OR'd together.
    {
        "id": 7,
        "key": "general-regex-flag",
        "name": "Non-prod email gate",
        "description": "Block production traffic from test/qa/staging email domains.",
        "is_archived": False,
        "variation_type": "BOOLEAN",
        "owner": None,
        "variations": _bool_variations(701),
        "allocations": [
            {
                "id": 7001,
                "key": "non-prod-emails",
                "name": "Non-prod emails",
                "created_at": CREATED_AT,
                "type": "FEATURE_GATE",
                "variation_weight": [{"variation_id": 701, "weight": 100}],
                "targeting_rules": [
                    {
                        "conditions": [
                            {
                                "operator": "MATCHES",
                                "attribute": "email",
                                "values": [".*@(test|qa|staging)\\.com$"],
                            }
                        ]
                    }
                ],
                "audiences": [],
                "percent_exposure": 100,
                "is_default": False,
                "experiment": None,
            },
            {
                "id": 7002,
                "key": "general-regex-flag-default",
                "name": "Default off",
                "created_at": CREATED_AT,
                "type": "FEATURE_GATE",
                "variation_weight": [{"variation_id": 702, "weight": 100}],
                "targeting_rules": [],
                "audiences": [],
                "percent_exposure": 100,
                "is_default": True,
                "experiment": None,
            },
        ],
        "tag_names": [],
        "created_at": CREATED_AT,
        "updated_at": UPDATED_AT,
        "entity_id": 1,
        "type": "FEATURE_FLAG",
        "structured_metadata": [],
    },
    # 8. IS_NULL serving a NON-default variant → MIGRATABLE via a
    #    ruleless presence criterion under `not`. A positive rule (plan in
    #    [premium, enterprise] → enabled) plus an IS_NULL allocation that
    #    turns the feature ON for subjects with no `plan` at all — a
    #    different outcome than the default (off). This can only migrate
    #    because Confidence has a real null check: emit
    #    `{ "attribute": { "attributeName": "plan" } }` referenced under
    #    `not`, assigned to `enabled`. (The old "drop the redundant rule"
    #    trick could NOT express this, since null subjects need a variant
    #    that differs from the default.)
    {
        "id": 8,
        "key": "missing-attribute-fallback",
        "name": "Missing attribute fallback",
        "description": "Premium/enterprise get the feature; subjects with no plan also get it; plan'd-but-unpaid are off.",
        "is_archived": False,
        "variation_type": "BOOLEAN",
        "owner": None,
        "variations": _bool_variations(801),
        "allocations": [
            {
                "id": 8001,
                "key": "paid-plans",
                "name": "Paid plans",
                "created_at": CREATED_AT,
                "type": "FEATURE_GATE",
                "variation_weight": [{"variation_id": 801, "weight": 100}],
                "targeting_rules": [
                    {
                        "conditions": [
                            {
                                "operator": "ONE_OF",
                                "attribute": "plan",
                                "values": ["premium", "enterprise"],
                            }
                        ]
                    }
                ],
                "audiences": [],
                "percent_exposure": 100,
                "is_default": False,
                "experiment": None,
            },
            {
                "id": 8002,
                "key": "no-plan-on",
                "name": "No plan attribute → on",
                "created_at": CREATED_AT,
                "type": "FEATURE_GATE",
                "variation_weight": [{"variation_id": 801, "weight": 100}],
                "targeting_rules": [
                    {
                        "conditions": [
                            {
                                "operator": "IS_NULL",
                                "attribute": "plan",
                                "values": [],
                            }
                        ]
                    }
                ],
                "audiences": [],
                "percent_exposure": 100,
                "is_default": False,
                "experiment": None,
            },
            {
                "id": 8003,
                "key": "missing-attribute-fallback-default",
                "name": "Default off",
                "created_at": CREATED_AT,
                "type": "FEATURE_GATE",
                "variation_weight": [{"variation_id": 802, "weight": 100}],
                "targeting_rules": [],
                "audiences": [],
                "percent_exposure": 100,
                "is_default": True,
                "experiment": None,
            },
        ],
        "tag_names": [],
        "created_at": CREATED_AT,
        "updated_at": UPDATED_AT,
        "entity_id": 1,
        "type": "FEATURE_FLAG",
        "structured_metadata": [],
    },
    # 9. SWITCHBACK BLOCKED. Eppo's switchback experiments rotate
    #    variations over time windows. Confidence doesn't model
    #    time-bucketed exposure; the whole flag should be BLOCKED.
    {
        "id": 9,
        "key": "delivery-pricing-switchback",
        "name": "Delivery pricing switchback",
        "description": "Time-windowed switchback experiment for surge pricing.",
        "is_archived": False,
        "variation_type": "STRING",
        "owner": None,
        "variations": [
            {"id": 901, "name": "Surge off", "variant_key": "surge_off"},
            {"id": 902, "name": "Surge on", "variant_key": "surge_on"},
        ],
        "allocations": [
            {
                "id": 9001,
                "key": "hourly-switchback",
                "name": "Hourly switchback",
                "created_at": CREATED_AT,
                "type": "SWITCHBACK",
                "variation_weight": [
                    {"variation_id": 901, "weight": 50},
                    {"variation_id": 902, "weight": 50},
                ],
                "targeting_rules": [],
                "audiences": [],
                "percent_exposure": 100,
                "is_default": False,
                "experiment": {
                    "id": 9101,
                    "name": "Delivery surge pricing switchback",
                    "status": "RUNNING",
                },
            },
            {
                "id": 9002,
                "key": "delivery-pricing-switchback-default",
                "name": "Default surge off",
                "created_at": CREATED_AT,
                "type": "FEATURE_GATE",
                "variation_weight": [{"variation_id": 901, "weight": 100}],
                "targeting_rules": [],
                "audiences": [],
                "percent_exposure": 100,
                "is_default": True,
                "experiment": None,
            },
        ],
        "tag_names": ["pricing", "switchback"],
        "created_at": CREATED_AT,
        "updated_at": UPDATED_AT,
        "entity_id": 1,
        "type": "FEATURE_FLAG",
        "structured_metadata": [],
    },
    # 10. Reusable audiences → MIGRATABLE via Confidence segments. The
    #     allocation references audience 7001 (IS_IN) and 7002
    #     (IS_NOT_IN). Each audience (fetched from /audiences/{id})
    #     becomes a Confidence segment; the rule is "in segment 7001 AND
    #     not in segment 7002". Audience definitions are in AUDIENCES.
    {
        "id": 10,
        "key": "premium-users-only",
        "name": "Premium users only",
        "description": "Targets the reusable Premium audience, excluding internal staff.",
        "is_archived": False,
        "variation_type": "BOOLEAN",
        "owner": None,
        "variations": _bool_variations(1001),
        "allocations": [
            {
                "id": 10001,
                "key": "exclude-internal-audience",
                "name": "Premium audience minus internal",
                "created_at": CREATED_AT,
                "type": "FEATURE_GATE",
                "variation_weight": [{"variation_id": 1001, "weight": 100}],
                "targeting_rules": [],
                "audiences": [
                    {"audience_id": 7001, "type": "IS_IN"},
                    {"audience_id": 7002, "type": "IS_NOT_IN"},
                ],
                "percent_exposure": 100,
                "is_default": False,
                "experiment": None,
            },
            {
                "id": 10002,
                "key": "premium-users-only-default",
                "name": "Default off",
                "created_at": CREATED_AT,
                "type": "FEATURE_GATE",
                "variation_weight": [{"variation_id": 1002, "weight": 100}],
                "targeting_rules": [],
                "audiences": [],
                "percent_exposure": 100,
                "is_default": True,
                "experiment": None,
            },
        ],
        "tag_names": ["premium"],
        "created_at": CREATED_AT,
        "updated_at": UPDATED_AT,
        "entity_id": 1,
        "type": "FEATURE_FLAG",
        "structured_metadata": [],
    },
    # 11. Generic regex → BLOCKED. `^user_[0-9]{4}$` uses a character
    #     class and quantifier; it is not a prefix/suffix/alternation, so
    #     it can't be decomposed into startsWith/endsWith rules.
    {
        "id": 11,
        "key": "regex-id-format",
        "name": "Structured id format gate",
        "description": "Only subjects whose id matches a strict numeric pattern.",
        "is_archived": False,
        "variation_type": "BOOLEAN",
        "owner": None,
        "variations": _bool_variations(1101),
        "allocations": [
            {
                "id": 11001,
                "key": "matching-ids",
                "name": "Matching ids",
                "created_at": CREATED_AT,
                "type": "FEATURE_GATE",
                "variation_weight": [{"variation_id": 1101, "weight": 100}],
                "targeting_rules": [
                    {
                        "conditions": [
                            {
                                "operator": "MATCHES",
                                "attribute": "id",
                                "values": ["^user_[0-9]{4}$"],
                            }
                        ]
                    }
                ],
                "audiences": [],
                "percent_exposure": 100,
                "is_default": False,
                "experiment": None,
            },
            {
                "id": 11002,
                "key": "regex-id-format-default",
                "name": "Default off",
                "created_at": CREATED_AT,
                "type": "FEATURE_GATE",
                "variation_weight": [{"variation_id": 1102, "weight": 100}],
                "targeting_rules": [],
                "audiences": [],
                "percent_exposure": 100,
                "is_default": True,
                "experiment": None,
            },
        ],
        "tag_names": [],
        "created_at": CREATED_AT,
        "updated_at": UPDATED_AT,
        "entity_id": 1,
        "type": "FEATURE_FLAG",
        "structured_metadata": [],
    },
    # 12. IS_NULL combined with another condition → MIGRATABLE. "country
    #     is null AND plan == free" maps to
    #     `and(not(ref_country_exists), ref_plan_eq_free)`: a ruleless
    #     presence criterion on `country` under `not`, ANDed with an
    #     eqRule on `plan`. Both conditions live in one Confidence rule.
    {
        "id": 12,
        "key": "null-and-condition",
        "name": "Null country free plan",
        "description": "Subjects with no country AND on the free plan.",
        "is_archived": False,
        "variation_type": "BOOLEAN",
        "owner": None,
        "variations": _bool_variations(1201),
        "allocations": [
            {
                "id": 12001,
                "key": "null-country-free",
                "name": "Null country, free plan",
                "created_at": CREATED_AT,
                "type": "FEATURE_GATE",
                "variation_weight": [{"variation_id": 1201, "weight": 100}],
                "targeting_rules": [
                    {
                        "conditions": [
                            {
                                "operator": "IS_NULL",
                                "attribute": "country",
                                "values": [],
                            },
                            {
                                "operator": "ONE_OF",
                                "attribute": "plan",
                                "values": ["free"],
                            },
                        ]
                    }
                ],
                "audiences": [],
                "percent_exposure": 100,
                "is_default": False,
                "experiment": None,
            },
            {
                "id": 12002,
                "key": "null-and-condition-default",
                "name": "Default off",
                "created_at": CREATED_AT,
                "type": "FEATURE_GATE",
                "variation_weight": [{"variation_id": 1202, "weight": 100}],
                "targeting_rules": [],
                "audiences": [],
                "percent_exposure": 100,
                "is_default": True,
                "experiment": None,
            },
        ],
        "tag_names": [],
        "created_at": CREATED_AT,
        "updated_at": UPDATED_AT,
        "entity_id": 1,
        "type": "FEATURE_FLAG",
        "structured_metadata": [],
    },
    # 13. Archived flag. Excluded from list results by default; only
    #     returned when `include_archived=true`. Tests that the skill's
    #     pagination/filtering correctly hides archived flags unless the
    #     user opts in.
    {
        "id": 13,
        "key": "old-onboarding-flow",
        "name": "Old onboarding flow",
        "description": "Archived experiment from Q1 — superseded by new onboarding.",
        "is_archived": True,
        "variation_type": "BOOLEAN",
        "owner": None,
        "variations": _bool_variations(1301),
        "allocations": [
            {
                "id": 13001,
                "key": "new-onboarding-rollout",
                "name": "New onboarding rollout",
                "created_at": CREATED_AT,
                "type": "FEATURE_GATE",
                "variation_weight": [{"variation_id": 1301, "weight": 100}],
                "targeting_rules": [
                    {
                        "conditions": [
                            {
                                "operator": "ONE_OF",
                                "attribute": "country",
                                "values": ["US"],
                            }
                        ]
                    }
                ],
                "audiences": [],
                "percent_exposure": 100,
                "is_default": False,
                "experiment": None,
            },
            {
                "id": 13002,
                "key": "old-onboarding-flow-default",
                "name": "Default off",
                "created_at": CREATED_AT,
                "type": "FEATURE_GATE",
                "variation_weight": [{"variation_id": 1302, "weight": 100}],
                "targeting_rules": [],
                "audiences": [],
                "percent_exposure": 100,
                "is_default": True,
                "experiment": None,
            },
        ],
        "tag_names": ["archived", "onboarding"],
        "created_at": CREATED_AT,
        "updated_at": UPDATED_AT,
        "entity_id": 1,
        "type": "FEATURE_FLAG",
        "structured_metadata": [],
    },
]


# ---------------------------------------------------------------------------
# Audiences (reusable targeting definitions → Confidence segments)
# ---------------------------------------------------------------------------
#
# Shape matches `PublicApiAudience` in Eppo's OpenAPI spec. Each audience's
# `targeting_rules[]` use the SAME condition shape as flag allocations, so
# the skill reuses its operator-mapping table to translate them.

AUDIENCES: list[dict[str, Any]] = [
    {
        "id": 7001,
        "name": "Premium subscribers",
        "description": "Subjects on a paid plan.",
        "team": "",
        "creator_email": "",
        "last_edited_by_email": "",
        "targeting_rules": [
            {
                "id": 70011,
                "conditions": [
                    {
                        "operator": "ONE_OF",
                        "attribute": "plan",
                        "values": ["premium", "enterprise"],
                    }
                ],
            }
        ],
        "allocation_count": 1,
        "created_at": CREATED_AT,
        "updated_at": UPDATED_AT,
        "archived_at": None,
        "is_archived": False,
    },
    {
        "id": 7002,
        "name": "Internal staff",
        "description": "Spotify employees, identified by email domain.",
        "team": "",
        "creator_email": "",
        "last_edited_by_email": "",
        "targeting_rules": [
            {
                "id": 70021,
                "conditions": [
                    {
                        "operator": "MATCHES",
                        "attribute": "email",
                        "values": [".*@spotify\\.com$"],
                    }
                ],
            }
        ],
        "allocation_count": 1,
        "created_at": CREATED_AT,
        "updated_at": UPDATED_AT,
        "archived_at": None,
        "is_archived": False,
    },
]


# Per-(flag_id, env_id) state overrides. Default is `active: True`. Only
# include entries that differ from the default.
ENV_OVERRIDES: dict[tuple[int, int], dict[str, Any]] = {
    (5, 1): {"active": False},  # legacy-checkout-redesign is OFF in Production
}


# ---------------------------------------------------------------------------
# HTTP layer
# ---------------------------------------------------------------------------

ROUTE_FLAG_LIST = re.compile(r"^/api/v1/feature-flags/?$")
ROUTE_FLAG_BY_ID = re.compile(r"^/api/v1/feature-flags/(?P<id>\d+)/?$")
ROUTE_FLAG_BY_ENV = re.compile(
    r"^/api/v1/feature-flags/(?P<id>\d+)/environments/(?P<env_id>\d+)/?$"
)
ROUTE_ENVIRONMENTS = re.compile(r"^/api/v1/environments/?$")
ROUTE_AUDIENCE_LIST = re.compile(r"^/api/v1/audiences/?$")
ROUTE_AUDIENCE_BY_ID = re.compile(r"^/api/v1/audiences/(?P<id>\d+)/?$")


def _env_status_summary(flag_id: int) -> list[dict[str, Any]]:
    """Build the per-flag `environments` array (statuses only, no allocations)."""
    out: list[dict[str, Any]] = []
    for env in ENVIRONMENTS:
        override = ENV_OVERRIDES.get((flag_id, env["id"]), {})
        out.append(
            {
                "id": env["id"],
                "name": env["name"],
                "active": override.get("active", True),
                "is_production": env["is_production"],
            }
        )
    return out


def _flag_full(flag: dict[str, Any], include_allocations: bool = True) -> dict[str, Any]:
    """Full flag definition as returned by GET /feature-flags/{id}."""
    out = copy.deepcopy(flag)
    out["environments"] = _env_status_summary(flag["id"])
    if not include_allocations:
        out["allocations"] = []
    return out


def _flag_env_view(flag: dict[str, Any], env_id: int) -> dict[str, Any] | None:
    """The PublicApiFeatureFlagEnvironmentWithAllocation response shape."""
    env = next((e for e in ENVIRONMENTS if e["id"] == env_id), None)
    if env is None:
        return None
    override = ENV_OVERRIDES.get((flag["id"], env_id), {})
    allocations_for_env = [
        {**copy.deepcopy(alloc), "environment_id": env_id}
        for alloc in flag["allocations"]
    ]
    return {
        "id": env["id"],
        "name": env["name"],
        "active": override.get("active", True),
        "is_production": env["is_production"],
        "allocations": allocations_for_env,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "FakeEppo/0.2"
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
        token = self.headers.get("X-Eppo-Token", "")
        if not token:
            self._send(401, {"error": "Missing X-Eppo-Token header"})
            return False
        return True

    def _bool_param(self, query: dict[str, list[str]], name: str, default: bool) -> bool:
        if name not in query:
            return default
        return query[name][0].lower() in ("true", "1", "yes")

    def do_GET(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler API)
        if not self._check_auth():
            return

        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if ROUTE_ENVIRONMENTS.match(path):
            self._send(200, ENVIRONMENTS)
            return

        if ROUTE_AUDIENCE_LIST.match(path):
            self._send(200, AUDIENCES)
            return

        m = ROUTE_AUDIENCE_BY_ID.match(path)
        if m:
            audience_id = int(m["id"])
            audience = next((a for a in AUDIENCES if a["id"] == audience_id), None)
            if audience is None:
                self._send(404, {"error": f"Audience {audience_id} not found"})
                return
            self._send(200, audience)
            return

        if ROUTE_FLAG_LIST.match(path):
            offset = int(query.get("offset", ["0"])[0])
            limit = int(query.get("limit", [str(self.limit_default)])[0])
            include_archived = self._bool_param(query, "include_archived", False)
            include_detailed = self._bool_param(
                query, "include_detailed_allocations", False
            )

            visible = [f for f in FLAGS if include_archived or not f["is_archived"]]
            page = visible[offset : offset + limit]
            response = [_flag_full(f, include_allocations=include_detailed) for f in page]
            self._send(200, response)
            return

        m = ROUTE_FLAG_BY_ENV.match(path)
        if m:
            flag_id = int(m["id"])
            env_id = int(m["env_id"])
            flag = next((f for f in FLAGS if f["id"] == flag_id), None)
            if flag is None:
                self._send(404, {"error": f"Flag {flag_id} not found"})
                return
            view = _flag_env_view(flag, env_id)
            if view is None:
                self._send(404, {"error": f"Environment {env_id} not found"})
                return
            self._send(200, view)
            return

        m = ROUTE_FLAG_BY_ID.match(path)
        if m:
            flag_id = int(m["id"])
            flag = next((f for f in FLAGS if f["id"] == flag_id), None)
            if flag is None:
                self._send(404, {"error": f"Flag {flag_id} not found"})
                return
            self._send(200, _flag_full(flag, include_allocations=True))
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
        "--limit-default",
        type=int,
        default=50,
        help="Page size used when the client doesn't pass `limit`.",
    )
    args = parser.parse_args()

    Handler.limit_default = args.limit_default
    server = HTTPServer(("127.0.0.1", args.port), Handler)
    base = f"http://127.0.0.1:{args.port}/api/v1"
    print(f"Fake Eppo server listening on {base}")
    print(
        f"  {len(FLAGS)} fixture flags, {len(AUDIENCES)} audiences, "
        f"{len(ENVIRONMENTS)} environments"
    )
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
