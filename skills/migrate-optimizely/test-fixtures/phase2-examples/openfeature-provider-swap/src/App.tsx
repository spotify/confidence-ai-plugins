/**
 * Call sites are STANDARD OpenFeature (useFlag). The provider-swap
 * migration leaves this entire file untouched — only provider.ts and the
 * registration below change (Optimizely provider → Confidence provider).
 */
import React, { useEffect } from 'react';
import { OpenFeature } from '@openfeature/web-sdk';
import { OpenFeatureProvider, useFlag } from '@openfeature/react-sdk';
import { OptimizelyProvider } from './provider';

// --- The ONLY lines that change on migration: the provider registration. ---
OpenFeature.setProvider(new OptimizelyProvider(process.env.OPTIMIZELY_SDK_KEY ?? ''));
// On migration → OpenFeature.setProvider(createConfidenceWebProvider({ flagClientSecret: ... }))

export function App({ currentUser }: { currentUser: { email: string; group: string } }) {
  useEffect(() => {
    OpenFeature.setContext({
      targetingKey: currentUser.email,
      nike_email: currentUser.email,
      nike_group_id: currentUser.group,
    });
  }, [currentUser]);

  return (
    <OpenFeatureProvider>
      <Homepage />
    </OpenFeatureProvider>
  );
}

function Homepage() {
  // Standard OpenFeature React hooks — unchanged by the migration.
  const analytics = useFlag('analytics', 'off');
  const classification = useFlag('nike_classification', 'on');
  const showAnalytics = String(analytics.value ?? 'off').toLowerCase().trim() === 'on';

  return (
    <main>
      {showAnalytics && <Analytics />}
      <div data-classification={classification.value} />
    </main>
  );
}

function Analytics() {
  return <div className="analytics" />;
}
