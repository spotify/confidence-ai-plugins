const optimizelySdk = require('@optimizely/optimizely-sdk');

const optimizely = optimizelySdk.createInstance({
  sdkKey: process.env.OPTIMIZELY_SDK_KEY,
});

// Notification listener bridging Optimizely decisions to the analytics
// pipeline. Confidence logs exposure automatically — this is deleted on
// migration.
optimizely.notificationCenter.addNotificationListener(
  optimizelySdk.enums.NOTIFICATION_TYPES.DECISION,
  ({ type, userId, decisionInfo }) => {
    analytics.track('optimizely_decision', { type, userId, ...decisionInfo });
  }
);

function renderHomepage(userId, attributes) {
  // Legacy feature gate (boolean).
  const betaOn = optimizely.isFeatureEnabled('beta_feature', userId, attributes);

  // Legacy feature variables on a struct flag.
  const algorithm = optimizely.getFeatureVariableString(
    'product_sort',
    'sort_algorithm',
    userId,
    attributes
  );
  const showAmounts = optimizely.getFeatureVariableBoolean(
    'product_sort',
    'show_amounts',
    userId,
    attributes
  );

  // Legacy experiment API: returns a variation key and logs an impression.
  // The code switches on the raw variation key — flagged for human review
  // in the migration plan.
  const variation = optimizely.activate('checkout_redesign', userId, attributes);
  const newCheckout = variation === 'treatment';

  optimizely.track('homepage_viewed', userId, attributes);

  return { betaOn, algorithm, showAmounts, newCheckout };
}

module.exports = { renderHomepage };
