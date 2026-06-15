// BEFORE — Statsig LAYER usage (Statsig Server Core). Reference only (not compiled).
//
// A Statsig layer groups several experiments that share a parameter namespace.
// `getLayer(user, "promo_layer").get(param, default)` reads a parameter owned by
// whichever experiment is currently allocated in that layer.
//
// Confidence has no layer primitive: Phase 1 migrates each experiment in the
// layer to its own flag (made mutually exclusive via an exclusivity group). So a
// layer parameter read maps to the experiment flag that owns that parameter.

import { Statsig, StatsigUser } from '@statsig/statsig-node-core';

const statsig = new Statsig(process.env.STATSIG_SERVER_SECRET!);

export async function handleRequest(userID: string) {
  await statsig.initialize();
  const user = new StatsigUser({ userID });

  const layer = statsig.getLayer(user, 'promo_layer');
  const title = layer.get('title', 'Welcome');
  const discount = layer.get('discount', 0.1);

  return { title, discount };
}
