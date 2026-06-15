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

Prioritizing the **local-resolve providers** in
[spotify/confidence-resolver](https://github.com/spotify/confidence-resolver)
(`openfeature-provider/{go,java,js,python,rust,ruby}`).

| Fixture | Statsig SDK (before) | Source resolve mode | Confidence target (local SDK) | Resolve-mode change | Verified |
|---------|----------------------|---------------------|-------------------------------|---------------------|----------|
| `node-server` | `@statsig/statsig-node-core` | in-process eval | JS local-resolve (`@spotify-confidence/openfeature-server-provider-local`) | none (in-process → in-process) | ✅ `tsc --noEmit` against provider `0.14.2` + `@openfeature/server-sdk` `1.21.0` |
| `java-server` | `com.statsig:serversdk` | in-process eval | Java local-resolve (`com.spotify.confidence:openfeature-provider-local`) | none (in-process → in-process) | ✅ `mvn compile` BUILD SUCCESS against provider `0.15.1` (+ OpenFeature Java SDK) |
| `python-server` | `statsig` (Python) | in-process eval | Python local-resolve (`confidence-openfeature-provider`, alpha) | none (in-process → in-process) | ✅ `py_compile` + `verify_api.py` against provider `0.7.1` + `openfeature-sdk` |

### Planned (follow-up)

| Fixture | Statsig SDK | Source mode | Confidence target | Change | Validation |
|---------|-------------|-------------|-------------------|--------|------------|
| `go-server` | `statsig-go` | in-process eval | Go local-resolve provider | none | doc-verified (no Go toolchain) |
| `rust-server` | `statsig-rust` | in-process eval | Rust local-resolve provider | none | doc-verified (no Rust toolchain) |
| `react-client` | `@statsig/react-bindings` | precomputed/cached | cached client / React provider | preserved | `tsc --noEmit` |

## Resolve-mode coverage (target)

- **in-process** — node-server, java-server, **python-server**, go-server, rust-server (Statsig server SDK local eval → Confidence WASM local eval; unchanged). Python now has a local-resolve provider (`confidence-openfeature-provider`, alpha), so the server case is in-process, not remote.
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

### java-server
- Same flag-key → dot-path normalization and per-call context as node-server.
- Statsig typed getters → OpenFeature typed getters: `getString` → `getStringValue`, `getInt` → `getIntegerValue` (`getDoubleValue` for doubles, `getObjectValue` for JSON).
- `StatsigUser` → `MutableContext(userID)` + `ctx.add(...)`, adding attributes only when non-null.
- `Statsig.initializeAsync(secret).get()` readiness removed — handled by `setProviderAndWait`.
- Requires Java 17+ and OpenFeature Java SDK 1.20.2+ (pulled transitively by the provider).

### python-server
- Same flag-key → dot-path normalization and per-call context.
- `from confidence import ConfidenceProvider` + `api.set_provider_and_wait(provider)` (local-resolve, in-process) — NOT the remote provider; corrects the earlier "Python = remote" assumption.
- Statsig reads → OpenFeature typed getters: `check_gate` → `get_boolean_value`; `.get(str)` → `get_string_value`; `.get(int)` → `get_integer_value` (`get_float_value`/`get_object_value` as needed).
- `StatsigUser` → `EvaluationContext(targeting_key=..., attributes={...})`, including only present attributes.
- `statsig.initialize(secret)` readiness removed — handled by `set_provider_and_wait`.
- Requires Python 3.10+ and `openfeature-sdk` 0.10.0+.

## Running the checks

```bash
# node-server (JS local-resolve)
cd node-server && npm install && npm run typecheck

# java-server (Java local-resolve)
cd java-server && mvn compile
# (CI/offline note: this repo's Maven may be wired to an internal mirror; point
#  at Maven Central with: mvn -s <central-settings.xml> compile)

# python-server (Python local-resolve)
cd python-server && python3 -m py_compile src/*.py
pip install --target /tmp/pylocal -r requirements.txt
PYTHONPATH=/tmp/pylocal python3 verify_api.py
```
