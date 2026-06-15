// AFTER — migrated request handler (Confidence, server-side / per-call context).
//
// Transform points exercised here:
//  - Flag keys → Confidence struct dot-paths, normalized to [a-z0-9-]:
//      checkGate("new_checkout")                    → "new-checkout.enabled"
//      getDynamicConfig("homepage_config").get(p)   → "homepage-config.<p>"
//      getExperiment("checkout_button_experiment")  → "checkout-button-experiment.<p>"
//  - Server SDK ⇒ evaluation context passed PER CALL (StatsigUser → context):
//      userID → targetingKey; email/country/plan → attributes.
//  - .get(param, default) folds the parameter INTO the path; the default is
//    carried over as the OpenFeature default argument.
//  - Statsig readiness wait removed (handled by setProviderAndWait).

import type { EvaluationContext } from '@openfeature/server-sdk';
import { getConfidenceClient } from './confidence.js';

export type RequestUser = {
  userID: string;
  email?: string;
  country?: string;
  plan?: string;
};

function toContext(req: RequestUser): EvaluationContext {
  // StatsigUser → Confidence evaluation context. OpenFeature's
  // EvaluationContext rejects `undefined` values, so omit absent attributes
  // rather than setting them to undefined.
  const context: EvaluationContext = { targetingKey: req.userID };
  if (req.email !== undefined) context.email = req.email;
  if (req.country !== undefined) context.country = req.country;
  if (req.plan !== undefined) context.plan = req.plan;
  return context;
}

export async function handleRequest(req: RequestUser) {
  const client = await getConfidenceClient();
  const context = toContext(req);

  // Boolean gate → boolean value at "<flag>.enabled".
  const newCheckout = await client.getBooleanValue('new-checkout.enabled', false, context);

  // Dynamic config params → typed values at "<flag>.<param>".
  const title = await client.getStringValue('homepage-config.title', 'Welcome', context);
  const maxItems = await client.getNumberValue('homepage-config.maxItems', 10, context);

  // Experiment param → typed value at "<flag>.<param>".
  const buttonColor = await client.getStringValue(
    'checkout-button-experiment.buttonColor',
    'blue',
    context,
  );

  return { newCheckout, title, maxItems, buttonColor };
}
