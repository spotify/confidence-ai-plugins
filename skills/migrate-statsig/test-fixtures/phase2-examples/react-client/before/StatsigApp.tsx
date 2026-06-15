// BEFORE — original Statsig usage (Statsig React, @statsig/react-bindings).
//
// Migration INPUT. NOT compiled (excluded from tsconfig; @statsig/react-bindings
// not installed). Kept for the before/after diff.
//
// Resolve mode: Statsig React client = precomputed values fetched from Statsig's
// backend and read locally. Target: Confidence local-resolve React
// (server-precomputed / RSC) → server resolves, client reads offline.
// ⚠️ Resolution moves to the server; client reads stay local/offline.

import type { ReactNode } from 'react';
import {
  StatsigProvider,
  useGateValue,
  useExperiment,
  useDynamicConfig,
} from '@statsig/react-bindings';

export function App({ children }: { children: ReactNode }) {
  return (
    <StatsigProvider
      sdkKey="client-xxxxx"
      user={{ userID: 'user-123', custom: { country: 'US', plan: 'premium' } }}
    >
      {children}
    </StatsigProvider>
  );
}

export function FeatureComponent() {
  // Boolean gate.
  const newCheckout = useGateValue('new_checkout');

  // Dynamic config — typed parameter reads with defaults.
  const homepage = useDynamicConfig('homepage_config');
  const title = homepage.get('title', 'Welcome');
  const maxItems = homepage.get('maxItems', 10);

  // Experiment — typed parameter read with default.
  const experiment = useExperiment('checkout_button_experiment');
  const buttonColor = experiment.get('buttonColor', 'blue');

  return (
    <div style={{ borderColor: buttonColor }}>
      {newCheckout ? <h1>{title}</h1> : <h2>{title}</h2>}
      <p>Max items: {maxItems}</p>
    </div>
  );
}
