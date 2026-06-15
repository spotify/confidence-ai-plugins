// AFTER — migrated Confidence setup (local-resolve, server side).
//
// One-time provider registration. The local-resolve provider resolves on the
// SERVER; the RSC <ConfidenceProvider> hands resolved values to client
// components, which read them offline via useFlag.

import { OpenFeature } from '@openfeature/server-sdk';
import { createConfidenceServerProvider } from '@spotify-confidence/openfeature-server-provider-local';

let registered: Promise<void> | null = null;

export function registerConfidence(): Promise<void> {
  if (!registered) {
    registered = OpenFeature.setProviderAndWait(
      createConfidenceServerProvider({
        flagClientSecret: process.env.CONFIDENCE_FLAG_CLIENT_SECRET!,
      }),
    );
  }
  return registered;
}
