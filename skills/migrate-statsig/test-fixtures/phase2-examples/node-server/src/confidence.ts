// AFTER — migrated Confidence setup (JS local-resolve / in-process).
//
// Replaces Statsig's `new Statsig(secret)` + `initialize()` readiness with the
// Confidence OpenFeature server provider. `setProviderAndWait` blocks until the
// initial resolver state is fetched, so the hand-rolled readiness gate is gone.

import { OpenFeature, type Client } from '@openfeature/server-sdk';
import { createConfidenceServerProvider } from '@spotify-confidence/openfeature-server-provider-local';

let clientPromise: Promise<Client> | null = null;

export function getConfidenceClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const provider = createConfidenceServerProvider({
        flagClientSecret: process.env.CONFIDENCE_FLAG_CLIENT_SECRET!,
      });
      await OpenFeature.setProviderAndWait(provider);
      return OpenFeature.getClient();
    })();
  }
  return clientPromise;
}
