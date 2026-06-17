# Phase 2 code-transformation examples

Small, realistic apps that use the Optimizely SDKs the way real codebases
do. They give the `migrate-optimizely plan code` / `execute` flow
something concrete to scan and transform. They are **source fixtures**,
not run end-to-end here — the point is the shape of the Optimizely usage,
not a working build.

The flag keys match the Phase 1 fixtures (`server.py`) so the two phases
line up: `product_sort` (struct flag with variables), `beta_feature`
(boolean rollout), `na_promo` (boolean, audience-targeted).

| Example | SDK / package | API generation | Side | Exercises |
|---------|---------------|----------------|------|-----------|
| `node-decide-server/` | `@optimizely/optimizely-sdk` (Node) | Decide API | server | `createUserContext` + `decide`, `decision.enabled` / `decision.variables`, `trackEvent`, `onReady` wait → server per-call context (in-process → in-process, mode preserved) |
| `node-legacy-fullstack/` | `@optimizely/optimizely-sdk` (Node) | legacy Full Stack | server | `isFeatureEnabled`, `getFeatureVariable*`, `activate` (variation-key switch — flagged for review), `track`, notification listener (delete) |
| `react-client/` | `@optimizely/react-sdk` | Decide + legacy | client | `<OptimizelyProvider>`, `useDecision`, `<OptimizelyFeature>` → ambient context + `useFlag` |
| `java-server/` | `com.optimizely.ab:core-api` | Decide API | server | `createUserContext` + `decide`, `decision.getVariables().getValue(..)`, `MutableContext` (in-process → in-process, mode preserved) |
| `python-server/` | `optimizely-sdk` | Decide API | server | `create_user_context` + `decide`, `decision.variables[..]` → prefer the **local-resolve** provider `confidence-openfeature-provider` (Alpha; `ConfidenceProvider` + `set_provider_and_wait`, in-process → in-process). Remote `spotify-confidence-sdk` is the fallback (⚠️ resolve-mode change) |
| `openfeature-provider-swap/` | `@openfeature/*` + custom `OptimizelyProvider` | **already on OpenFeature** | client (React) | **Provider swap, NOT a rewrite** (the custom-provider pattern): `useFlag` call sites are untouched; only `provider.ts` + the `OpenFeature.setProvider(...)` registration change. Exercises re-homing the custom provider's on/off-string + anonymous-suppression semantics on top of the Confidence provider |

## Two migration styles

- **Call-site rewrite** — the app calls the Optimizely SDK directly
  (`decide`, `isFeatureEnabled`, …). The transform rewrites call sites to
  OpenFeature + Confidence. This is the `node-*`, `java-server`,
  `python-server`, and `react-client` examples.
- **Provider swap** — the app is *already* on OpenFeature (standard
  `useFlag` / `get*Value` call sites, Optimizely hidden behind a
  registered provider). Migration only swaps the registered provider to
  Confidence; **call sites don't change**. This is the
  `openfeature-provider-swap` example (the custom-provider pattern).

`/migrate-optimizely plan code` detects which style applies (Step 1b) and
plans accordingly.

## Expected transform (summary)

- **Flag key → resolve path.** Confidence flags are structs; reads become
  `<confidence-flag>.<property>`. Phase 1 normalizes underscores to
  hyphens, so `product_sort` → `product-sort` and
  `decision.variables["sort_algorithm"]` →
  `getStringValue("product-sort.sort_algorithm", default, ctx)`.
  `decision.enabled` / `isFeatureEnabled("beta_feature", …)` →
  `getBooleanValue("beta-feature.enabled", false, ctx)`.
- **Context model.** The Node servers pass `userId` + attributes per
  call → fold into the evaluation context argument. The React app sets
  context once (`<OptimizelyProvider user={…}>` → `<ConfidenceProvider>`
  + ambient context) and `useDecision` becomes `useFlag`.
- **`activate` / `getVariation`** return a variation key; the legacy
  example switches on it (`if (variation === "treatment")`). That is
  flagged for **human review** — prefer reading the variable that drives
  behavior over branching on a raw variant label.
- **Tracking.** `track` / `trackEvent` map to Confidence's `track` API
  (not OpenFeature). Keep the event keys.
- **Delete scaffolding.** `onReady()` waits, notification listeners,
  datafile polling, and event-dispatcher config all go away — Confidence
  handles readiness and exposure logging itself.

Drive it with `/migrate-optimizely plan code` pointed at one of these
directories, then review the generated
`.claude/plans/optimizely-code-migration-<date>.md`.
