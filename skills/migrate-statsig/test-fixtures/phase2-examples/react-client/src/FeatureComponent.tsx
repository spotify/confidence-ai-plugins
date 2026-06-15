// AFTER — migrated client component. Replaces the Statsig hooks.
//
// Transform points exercised:
//   - Statsig hooks → Confidence `useFlag(path, default)` (react-client):
//       useGateValue("new_checkout")                   → useFlag("new-checkout.enabled", false)
//       useDynamicConfig("homepage_config").get(p, d)  → useFlag("homepage-config.<p>", d)
//       useExperiment("checkout_button_experiment")    → useFlag("checkout-button-experiment.<p>", d)
//   - Flag keys → struct dot-paths, normalized to [a-z0-9-]; the config/experiment
//     parameter folds INTO the path.
//   - Ambient context: no per-call user — the context was set once on the server
//     <ConfidenceProvider> (see layout.tsx). The hooks read prefetched values.

'use client';

import { useFlag } from '@spotify-confidence/openfeature-server-provider-local/react-client';

export function FeatureComponent() {
  const newCheckout = useFlag('new-checkout.enabled', false);
  const title = useFlag('homepage-config.title', 'Welcome');
  const maxItems = useFlag('homepage-config.maxItems', 10);
  const buttonColor = useFlag('checkout-button-experiment.buttonColor', 'blue');

  return (
    <div style={{ borderColor: buttonColor }}>
      {newCheckout ? <h1>{title}</h1> : <h2>{title}</h2>}
      <p>Max items: {maxItems}</p>
    </div>
  );
}
