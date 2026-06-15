"""AFTER - migrated request handler (Confidence Python, server-side / per-call context).

Transform points exercised here:
  - Flag keys -> Confidence struct dot-paths, normalized to [a-z0-9-]:
      check_gate("new_checkout")                    -> "new-checkout.enabled"
      get_config("homepage_config").get(p, d)       -> "homepage-config.<p>"
      get_experiment("checkout_button_experiment")  -> "checkout-button-experiment.<p>"
  - Statsig reads -> OpenFeature typed getters:
      check_gate -> get_boolean_value; .get(str) -> get_string_value;
      .get(int) -> get_integer_value (get_float_value / get_object_value as needed).
  - Server SDK => evaluation context built PER CALL (StatsigUser -> EvaluationContext):
      user_id -> targeting_key; email/country/plan -> attributes (omit None).
  - Statsig `statsig.initialize()` readiness removed (handled by set_provider_and_wait).
"""

from dataclasses import dataclass

from openfeature.evaluation_context import EvaluationContext

from confidence_client import get_client


@dataclass
class RequestUser:
    user_id: str
    email: str | None = None
    country: str | None = None
    plan: str | None = None


def to_context(req: RequestUser) -> EvaluationContext:
    # StatsigUser -> Confidence evaluation context; include only present attributes.
    # IMPORTANT: set the Phase 1 ENTITY FIELD (here `user_id`) — that is the field
    # the migrated targeting rules bucket by. OpenFeature's targeting_key is NOT
    # auto-aliased to it by the local resolver, so a context with only
    # targeting_key resolves to DEFAULT. (Verified end-to-end against a real
    # Confidence project.)
    attributes: dict[str, object] = {"user_id": req.user_id}
    if req.email is not None:
        attributes["email"] = req.email
    if req.country is not None:
        attributes["country"] = req.country
    if req.plan is not None:
        attributes["plan"] = req.plan
    return EvaluationContext(targeting_key=req.user_id, attributes=attributes)


def handle_request(req: RequestUser) -> dict:
    client = get_client()
    context = to_context(req)

    new_checkout = client.get_boolean_value("new-checkout.enabled", False, context)

    title = client.get_string_value("homepage-config.title", "Welcome", context)
    max_items = client.get_integer_value("homepage-config.maxItems", 10, context)

    button_color = client.get_string_value(
        "checkout-button-experiment.buttonColor", "blue", context
    )

    return {
        "new_checkout": new_checkout,
        "title": title,
        "max_items": max_items,
        "button_color": button_color,
    }
