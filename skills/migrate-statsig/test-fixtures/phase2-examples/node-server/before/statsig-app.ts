// BEFORE — original Statsig usage (Statsig Server Core, @statsig/statsig-node-core).
//
// This file is the migration INPUT. It is intentionally NOT compiled (it's
// excluded from tsconfig and the Statsig deps aren't installed) — it exists so
// the `migrate-statsig plan code` flow has a realistic "before" to transform,
// and so the README before/after diff is grounded in real source.
//
// Resolve mode: Statsig server SDK = in-process eval (downloads project config,
// evaluates locally). Target: Confidence JS local-resolve = in-process too →
// NO resolve-mode change.

import { Statsig, StatsigUser } from '@statsig/statsig-node-core';

const statsig = new Statsig(process.env.STATSIG_SERVER_SECRET!);

let ready: Promise<void> | null = null;
function ensureReady(): Promise<void> {
  if (!ready) ready = statsig.initialize();
  return ready;
}

export type RequestUser = {
  userID: string;
  email?: string;
  country?: string;
  plan?: string;
};

export async function handleRequest(req: RequestUser) {
  await ensureReady();

  const user = new StatsigUser({
    userID: req.userID,
    email: req.email,
    // Statsig auto-derives country from IP server-side; here it's explicit.
    custom: { country: req.country, plan: req.plan },
  });

  // Boolean feature gate.
  const newCheckout = statsig.checkGate(user, 'new_checkout');

  // Dynamic config — typed parameter reads with defaults.
  const homepage = statsig.getDynamicConfig(user, 'homepage_config');
  const title = homepage.get('title', 'Welcome');
  const maxItems = homepage.get('maxItems', 10);

  // Experiment — typed parameter read with default.
  const experiment = statsig.getExperiment(user, 'checkout_button_experiment');
  const buttonColor = experiment.get('buttonColor', 'blue');

  return { newCheckout, title, maxItems, buttonColor };
}
