// AFTER — migrated request handler (Confidence Java, server-side / per-call context).
//
// Transform points exercised here:
//  - Flag keys → Confidence struct dot-paths, normalized to [a-z0-9-]:
//      checkGate("new_checkout")                      → "new-checkout.enabled"
//      getConfig("homepage_config").getString(p,d)    → "homepage-config.<p>"
//      getExperiment("checkout_button_experiment")    → "checkout-button-experiment.<p>"
//  - Statsig typed getters → OpenFeature typed getters:
//      getString → getStringValue, getInt → getIntegerValue (getDoubleValue for doubles).
//  - Server SDK ⇒ evaluation context built PER CALL (StatsigUser → MutableContext):
//      userID → targeting key; email/country/plan → attributes (omit nulls).
//  - Statsig readiness wait removed (handled by setProviderAndWait).

package com.example;

import dev.openfeature.sdk.Client;
import dev.openfeature.sdk.MutableContext;

public final class App {

  public record RequestUser(String userID, String email, String country, String plan) {}

  public record Result(boolean newCheckout, String title, int maxItems, String buttonColor) {}

  private static MutableContext toContext(RequestUser req) {
    // StatsigUser → Confidence evaluation context. Add attributes only when
    // present (don't add null values).
    // IMPORTANT: set the Phase 1 ENTITY FIELD (here `user_id`) — that is the
    // field the migrated targeting rules bucket by. The MutableContext targeting
    // key alone is NOT aliased to it by the local resolver, so a context with
    // only the targeting key resolves to DEFAULT. (Verified end-to-end.)
    MutableContext ctx = new MutableContext(req.userID());
    ctx.add("user_id", req.userID());
    if (req.email() != null) {
      ctx.add("email", req.email());
    }
    if (req.country() != null) {
      ctx.add("country", req.country());
    }
    if (req.plan() != null) {
      ctx.add("plan", req.plan());
    }
    return ctx;
  }

  public Result handleRequest(RequestUser req) {
    Client client = ConfidenceClient.get();
    MutableContext ctx = toContext(req);

    boolean newCheckout = client.getBooleanValue("new-checkout.enabled", false, ctx);

    String title = client.getStringValue("homepage-config.title", "Welcome", ctx);
    int maxItems = client.getIntegerValue("homepage-config.maxItems", 10, ctx);

    String buttonColor =
        client.getStringValue("checkout-button-experiment.buttonColor", "blue", ctx);

    return new Result(newCheckout, title, maxItems, buttonColor);
  }
}
