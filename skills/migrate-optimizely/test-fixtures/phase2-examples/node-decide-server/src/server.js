const express = require('express');
const optimizelySdk = require('@optimizely/optimizely-sdk');

const optimizely = optimizelySdk.createInstance({
  sdkKey: process.env.OPTIMIZELY_SDK_KEY,
  datafileOptions: { autoUpdate: true, updateInterval: 60000 },
});

const app = express();

// Server-side readiness gate — Optimizely needs the datafile before the
// first decide. (Confidence's setProviderAndWait replaces this.)
let ready = false;
optimizely.onReady().then(() => {
  ready = true;
});

function userContextFor(req) {
  const userId = req.header('x-user-id') || 'anonymous';
  const attributes = {
    country: req.header('x-country'),
    plan: req.header('x-plan'),
    is_beta: req.header('x-beta') === 'true',
  };
  return optimizely.createUserContext(userId, attributes);
}

app.get('/homepage', (req, res) => {
  if (!ready) return res.status(503).json({ error: 'flags not ready' });

  const user = userContextFor(req);

  // Boolean rollout flag.
  const beta = user.decide('beta_feature');

  // Struct flag with variables (sort_algorithm: string, show_amounts: boolean).
  const sort = user.decide('product_sort');
  const algorithm = sort.variables['sort_algorithm'];
  const showAmounts = sort.variables['show_amounts'];

  // Conversion event.
  user.trackEvent('homepage_viewed', { source: 'web' });

  res.json({
    betaEnabled: beta.enabled,
    sortAlgorithm: algorithm,
    showAmounts,
    sortVariation: sort.variationKey,
  });
});

app.get('/promo', (req, res) => {
  const user = userContextFor(req);
  const promo = user.decide('na_promo');
  res.json({ promoEnabled: promo.enabled });
});

app.listen(3000, () => console.log('listening on :3000'));
