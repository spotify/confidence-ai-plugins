# Phase 2 code-migration fixtures (Statsig → Confidence)

Reference fixtures for the `migrate-statsig` Phase 2 (code) flow. Each
fixture pairs a **`before/`** (real Statsig SDK usage — the migration
input) with a migrated **`src/`** (the expected Confidence output). The
migrated source is type/compile-checked against the **real** Confidence
+ OpenFeature packages so regressions in the skill's mapping tables are
easy to spot.

These are reference fixtures, not a runnable test suite. The `before/`
files are excluded from compilation (no Statsig deps installed); they
exist so the transform has a realistic input and the diff is grounded in
real source.

## Fixtures

| Fixture | Statsig SDK (before) | Source resolve mode | Confidence target | Resolve-mode change | Verified |
|---------|----------------------|---------------------|-------------------|---------------------|----------|
| `node-server` | `@statsig/statsig-node-core` | in-process eval | JS local-resolve (`@spotify-confidence/openfeature-server-provider-local`) | none (in-process → in-process) | ✅ `tsc --noEmit` against provider `0.14.2` + `@openfeature/server-sdk` `1.21.0` |

### Planned (follow-up)

| Fixture | Statsig SDK | Source mode | Confidence target | Change | Validation |
|---------|-------------|-------------|-------------------|--------|------------|
| `python-server` | `statsig` (Python) | in-process eval | **remote** (`spotify-confidence` OpenFeature provider) | ⚠️ in-process → remote | `py_compile` + API existence check |
| `react-client` | `@statsig/react-bindings` | precomputed/cached | cached client / React provider | preserved | `tsc --noEmit` |
| `java-server` | Statsig Java server SDK | in-process eval | Java local-resolve provider | none | `javac` |
| `go-server` | `statsig-go` | in-process eval | Go local-resolve provider | none | doc-verified (no Go toolchain) |

## Resolve-mode coverage (target)

- **in-process** — node-server, java-server, go-server (Statsig server SDK local eval → Confidence WASM local eval; unchanged)
- **remote** — python-server (⚠️ Statsig in-process → Confidence remote: each resolve becomes a service call; no Python local-resolve provider)
- **cached client / precomputed** — react-client (Statsig precomputed client values → Confidence cached client)

## Transform points exercised

### node-server
- Flag keys → Confidence struct **dot-paths**, normalized to `[a-z0-9-]`:
  `checkGate("new_checkout")` → `"new-checkout.enabled"`;
  `getDynamicConfig("homepage_config").get("title", d)` → `"homepage-config.title"`;
  `getExperiment("checkout_button_experiment").get("buttonColor", d)` → `"checkout-button-experiment.buttonColor"`.
- `.get(param, default)` folds the **parameter into the path**; the default carries over to the OpenFeature default argument.
- **Server SDK** ⇒ evaluation context passed **per call** (`StatsigUser` → `{ targetingKey, ...attrs }`).
- **`undefined` context values must be omitted** — OpenFeature's `EvaluationContext` rejects `undefined`, so optional attributes are added conditionally, not set to `undefined`.
- Statsig readiness (`new Statsig(secret)` + `initialize()`) removed — `OpenFeature.setProviderAndWait` blocks until the resolver state is ready.

## Running the checks

```bash
# node-server
cd node-server && npm install && npm run typecheck
```
