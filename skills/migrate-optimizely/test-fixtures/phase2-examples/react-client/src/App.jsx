import React from 'react';
import {
  createInstance,
  OptimizelyProvider,
  useDecision,
  OptimizelyFeature,
} from '@optimizely/react-sdk';

const optimizely = createInstance({ sdkKey: process.env.REACT_APP_OPTIMIZELY_SDK_KEY });

// Ambient user context: set once at the provider, not per read.
export function App({ currentUser }) {
  return (
    <OptimizelyProvider
      optimizely={optimizely}
      user={{
        id: currentUser.id,
        attributes: { country: currentUser.country, plan: currentUser.plan, is_beta: currentUser.isBeta },
      }}
    >
      <Homepage />
    </OptimizelyProvider>
  );
}

function Homepage() {
  // Decide API via hook — boolean rollout.
  const [betaDecision] = useDecision('beta_feature');

  // Decide API — struct flag with variables.
  const [sortDecision] = useDecision('product_sort');
  const algorithm = sortDecision.variables['sort_algorithm'];
  const showAmounts = sortDecision.variables['show_amounts'];

  return (
    <main>
      {betaDecision.enabled && <BetaBanner />}
      <ProductList algorithm={algorithm} showAmounts={showAmounts} />

      {/* Legacy render-prop component. */}
      <OptimizelyFeature feature="na_promo">
        {(enabled) => (enabled ? <PromoBanner /> : null)}
      </OptimizelyFeature>
    </main>
  );
}

function BetaBanner() {
  return <div className="beta">Beta</div>;
}
function PromoBanner() {
  return <div className="promo">Promo</div>;
}
function ProductList({ algorithm, showAmounts }) {
  return <div data-algorithm={algorithm} data-amounts={String(showAmounts)} />;
}
