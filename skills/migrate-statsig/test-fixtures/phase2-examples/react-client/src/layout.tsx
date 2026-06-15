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
  const context = { targetingKey: 'user-123', country: 'US', plan: 'premium' };

  return (
    <ConfidenceProvider
      context={context}
      flags={['new-checkout', 'homepage-config', 'checkout-button-experiment']}
    >
      {children}
    </ConfidenceProvider>
  );
}
