// AFTER — migrated Confidence setup (Java LOCAL-resolve / in-process).
//
// Replaces Statsig's Statsig.initializeAsync(secret).get() readiness with the
// Confidence local-resolve provider. setProviderAndWait blocks until the initial
// resolver state is fetched, so the hand-rolled init wait is gone.

package com.example;

import com.spotify.confidence.sdk.OpenFeatureLocalResolveProvider;
import dev.openfeature.sdk.Client;
import dev.openfeature.sdk.OpenFeatureAPI;

public final class ConfidenceClient {

  private static Client client;

  private ConfidenceClient() {}

  public static synchronized Client get() {
    if (client == null) {
      OpenFeatureLocalResolveProvider provider =
          new OpenFeatureLocalResolveProvider(System.getenv("CONFIDENCE_FLAG_CLIENT_SECRET"));
      OpenFeatureAPI.getInstance().setProviderAndWait(provider);
      client = OpenFeatureAPI.getInstance().getClient();
    }
    return client;
  }
}
