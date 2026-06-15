// AFTER — migrated app shell (RSC). Replaces <StatsigProvider sdkKey user>.
//
// The Statsig user moves here as the evaluation context; resolution happens on
// the server. `flags` lists the flags to prefetch for the subtree.

import type { ReactNode } from 'react';
import { ConfidenceProvider } from '@spotify-confidence/openfeature-server-provider-local/react-server';
import { registerConfidence } from './confidence.js';

export default async function RootLayout({ children }: { children: ReactNode }) {
  await registerConfidence();

  // StatsigUser → evaluation context (userID → targetingKey; custom → attributes).
  // IMPORTANT: also set the Phase 1 ENTITY FIELD (here `user_id`) — the field the
  // migrated targeting rules bucket by. targetingKey alone is NOT aliased to it
  // by the resolver, so resolution falls back to DEFAULT. (Verified end-to-end.)
  const context = { targetingKey: 'user-123', user_id: 'user-123', country: 'US', plan: 'premium' };

  return (
    <ConfidenceProvider
      context={context}
      flags={['new-checkout', 'homepage-config', 'checkout-button-experiment']}
    >
      {children}
    </ConfidenceProvider>
  );
}
