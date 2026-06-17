import os

from optimizely import optimizely

# Datafile fetched + polled in-process; evaluation is local.
optimizely_client = optimizely.Optimizely(sdk_key=os.environ["OPTIMIZELY_SDK_KEY"])


def render_homepage(user_id, country, plan, is_beta):
    user = optimizely_client.create_user_context(
        user_id,
        {"country": country, "plan": plan, "is_beta": is_beta},
    )

    # Boolean rollout flag.
    beta = user.decide("beta_feature")
    beta_enabled = beta.enabled

    # Struct flag with variables.
    sort = user.decide("product_sort")
    algorithm = sort.variables["sort_algorithm"]
    show_amounts = sort.variables["show_amounts"]

    # Conversion event.
    user.track_event("homepage_viewed")

    return {
        "beta_enabled": beta_enabled,
        "sort_algorithm": algorithm,
        "show_amounts": show_amounts,
    }
