# Phase 2 code-migration fixtures

Migrated **output** of the `migrate-eppo` Phase 2 (code) flow, used to
validate the skill against real Eppo SDK usage across every resolve mode.
Each fixture is the *post-migration* (Confidence) source — the upstream
Eppo originals are linked below for the before/after diff.

These are reference fixtures, not a runnable test suite: they pin the
expected transform output and the exact Confidence SDK surface each one
targets, so regressions in the skill's mapping tables are easy to spot.

## What each fixture covers

| Fixture | Source repo (Eppo) | Eppo SDK | Resolve mode | Confidence target | Verified |
|---------|--------------------|----------|--------------|-------------------|----------|
| `go-server` | `Eppo-exp/sdk-test-data` `package-testing/go-sdk-relay` | `golang-sdk/v6` | in-process | Go local-resolve provider | doc-verified (no Go toolchain locally) |
| `java-server` | `Eppo-exp/sdk-test-data` `package-testing/java-server-sdk-relay` | `cloud.eppo:eppo-server-sdk` | in-process | Java local-resolve provider | `./gradlew compileJava` BUILD SUCCESSFUL |
| `python-server` | `Eppo-exp/sdk-test-data` `package-testing/python-sdk-relay` | `eppo-server-sdk` | **remote** (no Python local-resolve) | `spotify-confidence-sdk` OpenFeature provider | `py_compile` + API existence check vs `spotify-confidence-sdk==3.0.1` |
| `nextjs-precomputed` | `heathermhargreaves/nextjs-precomputed-client` | `@eppo/node-server-sdk` + `@eppo/js-client-sdk` | server-precomputed | `@spotify-confidence/openfeature-server-provider-local` (`react-server`/`react-client`) | `tsc --noEmit` + `next lint` clean vs provider `0.14.1` |

A Kotlin/Android example (`Eppo-exp/android-sdk-kotlin-example`, cached-client
mode) was also validated earlier; it is not bundled here because it needs the
Android SDK to build.

## Resolve-mode coverage

- **in-process** — Go, Java (Eppo backend local eval → Confidence WASM local eval; unchanged)
- **cached client** — Kotlin (on-device eval → backend-resolved cached values)
- **server-precomputed** — Next.js (preserved: server resolves, client reads offline)
- **remote** — Python (⚠️ in-process → remote: each resolve becomes a service call)

## Notable transform points exercised here

- JS method-name variants (`getBooleanAssignment`) and the precomputed
  `getPrecomputedConfiguration` / `offlinePrecomputedInit` flow → `ConfidenceProvider` + `useFlag`
- Go PascalCase (`GetBooleanAssignment`) and ctx-first accessor signature
- Java `getDoubleAssignment` (numeric) / `getJSONStringAssignment` (JSON-as-string) → `getDoubleValue` / `getObjectValue`
- Python `get_float_value` (numeric) and remote init (`api.set_provider`, no `set_provider_and_wait`)
- Bandits (`getBanditAction`) dropped as BLOCKED — no Confidence equivalent
- Eppo readiness scaffolding removed (Go `Initialized()` channel, Java `buildAndInit()`, Python `wait_for_initialization()`)
- Flag keys rewritten to Confidence struct dot-paths (`flag.enabled` / `flag.value`)
