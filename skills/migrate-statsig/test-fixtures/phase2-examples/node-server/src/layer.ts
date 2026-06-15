// AFTER — migrated Statsig LAYER reads (Confidence, in-process).
//
// Statsig has no Confidence layer equivalent. Each layer parameter resolves
// through the EXPERIMENT FLAG that owns it (recorded in the Phase 1 plan), e.g.
// the `promo_layer` experiment migrated to the flag `promo-experiment`:
//
//   getLayer("promo_layer").get("title", d)    → "promo-experiment.title"
//   getLayer("promo_layer").get("discount", d) → "promo-experiment.discount"
//
// Caveat: this assumes both params belong to ONE experiment flag. If the layer
// spans multiple experiments (different params owned by different experiments),
// resolve each param through its own experiment flag. If a single param could be
// served by more than one experiment in the layer, the mapping is ambiguous —
// surface it for human review rather than guessing.

import { getConfidenceClient } from './confidence.js';

export async function handleRequest(userID: string) {
  const client = await getConfidenceClient();
  const context = { targetingKey: userID, user_id: userID };

  const title = await client.getStringValue('promo-experiment.title', 'Welcome', context);
  const discount = await client.getNumberValue('promo-experiment.discount', 0.1, context);

  return { title, discount };
}
