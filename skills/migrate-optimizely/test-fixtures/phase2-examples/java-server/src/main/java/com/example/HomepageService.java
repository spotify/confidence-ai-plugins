package com.example;

import com.optimizely.ab.Optimizely;
import com.optimizely.ab.OptimizelyFactory;
import com.optimizely.ab.optimizelydecision.OptimizelyDecision;
import com.optimizely.ab.OptimizelyUserContext;

import java.util.Map;

public class HomepageService {

    private final Optimizely optimizely;

    public HomepageService() {
        // Datafile is fetched + polled in-process; evaluation is local.
        this.optimizely = OptimizelyFactory.newDefaultInstance(System.getenv("OPTIMIZELY_SDK_KEY"));
    }

    public Map<String, Object> render(String userId, String country, String plan, boolean isBeta) {
        OptimizelyUserContext user = optimizely.createUserContext(userId, Map.of(
                "country", country,
                "plan", plan,
                "is_beta", isBeta));

        // Boolean rollout flag.
        OptimizelyDecision beta = user.decide("beta_feature");
        boolean betaEnabled = beta.getEnabled();

        // Struct flag with variables.
        OptimizelyDecision sort = user.decide("product_sort");
        String algorithm = sort.getVariables().getValue("sort_algorithm", String.class);
        Boolean showAmounts = sort.getVariables().getValue("show_amounts", Boolean.class);

        // Conversion event.
        user.trackEvent("homepage_viewed");

        return Map.of(
                "betaEnabled", betaEnabled,
                "sortAlgorithm", algorithm,
                "showAmounts", showAmounts);
    }
}
