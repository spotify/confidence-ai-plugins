// BEFORE — original Statsig usage (Statsig Java server SDK, com.statsig:serversdk).
//
// Migration INPUT. NOT compiled (lives outside src/main/java; Statsig deps not
// installed) — kept for the before/after diff and as a realistic transform input.
//
// Resolve mode: Statsig server SDK = in-process eval. Target: Confidence Java
// local-resolve = in-process too → NO resolve-mode change.

package com.example.before;

import com.statsig.sdk.Statsig;
import com.statsig.sdk.StatsigUser;

public final class StatsigApp {

  public record RequestUser(String userID, String email, String country, String plan) {}

  public Result handleRequest(RequestUser req) throws Exception {
    Statsig.initializeAsync(System.getenv("STATSIG_SERVER_SECRET")).get();

    StatsigUser user = new StatsigUser(req.userID());
    user.setEmail(req.email());
    user.setCustom(java.util.Map.of(
        "country", req.country(),
        "plan", req.plan()));

    // Boolean feature gate.
    boolean newCheckout = Statsig.checkGateSync(user, "new_checkout");

    // Dynamic config — typed parameter reads with defaults.
    var homepage = Statsig.getConfigSync(user, "homepage_config");
    String title = homepage.getString("title", "Welcome");
    int maxItems = homepage.getInt("maxItems", 10);

    // Experiment — typed parameter read with default.
    var experiment = Statsig.getExperimentSync(user, "checkout_button_experiment");
    String buttonColor = experiment.getString("buttonColor", "blue");

    return new Result(newCheckout, title, maxItems, buttonColor);
  }

  public record Result(boolean newCheckout, String title, int maxItems, String buttonColor) {}
}
