"""BEFORE - original Statsig usage (Statsig Python server SDK, `statsig`).

Migration INPUT. NOT part of the validated `src/` (Statsig deps not installed);
kept for the before/after diff and as a realistic transform input.

Resolve mode: Statsig server SDK = in-process eval. Target: Confidence Python
local-resolve provider (alpha) = in-process too -> NO resolve-mode change.
"""

import os
from dataclasses import dataclass

import statsig
from statsig import StatsigUser


@dataclass
class RequestUser:
    user_id: str
    email: str | None = None
    country: str | None = None
    plan: str | None = None


def handle_request(req: RequestUser) -> dict:
    statsig.initialize(os.environ["STATSIG_SERVER_SECRET"])

    user = StatsigUser(
        user_id=req.user_id,
        email=req.email,
        custom={"country": req.country, "plan": req.plan},
    )

    # Boolean feature gate.
    new_checkout = statsig.check_gate(user, "new_checkout")

    # Dynamic config - typed parameter reads with defaults.
    homepage = statsig.get_config(user, "homepage_config")
    title = homepage.get("title", "Welcome")
    max_items = homepage.get("maxItems", 10)

    # Experiment - typed parameter read with default.
    experiment = statsig.get_experiment(user, "checkout_button_experiment")
    button_color = experiment.get("buttonColor", "blue")

    return {
        "new_checkout": new_checkout,
        "title": title,
        "max_items": max_items,
        "button_color": button_color,
    }
