# Changelog

## [0.9.0](https://github.com/spotify/confidence-ai-plugins/compare/v0.8.0...v0.9.0) (2026-08-21)


### Features

* **migrate-optimizely:** auto-map exists/substring with evals ([#68](https://github.com/spotify/confidence-ai-plugins/issues/68)) ([1e8918c](https://github.com/spotify/confidence-ai-plugins/commit/1e8918ca2a9f2637672099665634e757abee9d2f))


### Bug Fixes

* **skills:** improve instrument-events and explore-metric interactivity and reliability ([#69](https://github.com/spotify/confidence-ai-plugins/issues/69)) ([e2021ae](https://github.com/spotify/confidence-ai-plugins/commit/e2021aea02169f55fa7cdbd6d9a03610410ab58f))

## [0.8.0](https://github.com/spotify/confidence-ai-plugins/compare/v0.7.0...v0.8.0) (2026-08-19)


### Features

* add Codex marketplace.json for OpenAI plugin directory distribution ([9e8bc1d](https://github.com/spotify/confidence-ai-plugins/commit/9e8bc1dccbfa3ee70725a2aa5bebeb1faceb8f35))
* add Codex marketplace.json for OpenAI plugin distribution ([#63](https://github.com/spotify/confidence-ai-plugins/issues/63)) ([9e8bc1d](https://github.com/spotify/confidence-ai-plugins/commit/9e8bc1dccbfa3ee70725a2aa5bebeb1faceb8f35))
* add instrument-events and explore-metric skills with evals ([#67](https://github.com/spotify/confidence-ai-plugins/issues/67)) ([522fc63](https://github.com/spotify/confidence-ai-plugins/commit/522fc63eedd9557820807353867387cdbd7cf4c9))
* **migrate-optimizely:** add full phase 0-2 plan/adjust/execute flow ([#65](https://github.com/spotify/confidence-ai-plugins/issues/65)) ([f59de52](https://github.com/spotify/confidence-ai-plugins/commit/f59de5266f96311bcbe462b4483263c42bb0859e))

## [Unreleased]

### Features

* **migrate-optimizely:** Bare `/migrate-optimizely` (no args) defaults to **`plan access`** — start Phase 0 from the beginning. Explicit subcommands unchanged.
* **migrate-optimizely:** Add multi-turn evals for default `plan access` entry, access consent gate, `plan access` no-writes, and `adjust flags` no-create; existing flag conversations now answer the source-method opening question.
* **migrate-optimizely:** Phase 0–2 each support plan / **adjust** / execute. Flag clients live inside **`plan access` Step 4** (no separate `plan clients` command). After every `plan *` completes, a **required exit ask** offers adjust (or tick/execute/done). **`execute flags` must end with a Phase 1 resolve gate** — every migrated flag resolve-verified (not a 3–5 spot-check). See [README — Optimizely → Confidence](./README.md#optimizely--confidence), [`SKILL.md`](./skills/migrate-optimizely/SKILL.md), and [`access.md`](./skills/migrate-optimizely/access.md).
* **migrate-optimizely:** `plan flags` **auto-tells** the user when Optimizely **exists** or **substring** appears, and records the Confidence map: **exists → IS NOT NULL** (not exists → IS NULL); **substring → starts with / ends with** (prefix vs suffix). Mid-string contains and **regex** stay BLOCKED. Execute imports the auto-map; do not treat exists/prefix-suffix substring as unresolved BLOCKED. Evals: `plan-badge` expects IS NOT NULL (migrate) with `resolutions`; `substring-gate` stays BLOCKED for mid-string `@test`; `version-substring-starts-with` and `locale-suffix-ends-with` cover the auto-maps with TargetingResolution. Local eval resolver treats empty `eqRule` value as equals-null.
* **migrate-optimizely:** Production waterfall / `_rulesets` targeting-rules import must show a live `Execute Flags · targeting rules` progress bar (not milestone-only `... created N` logs); same for segment prep, catch-alls, and resolve verify.
* **migrate-optimizely:** Execute progress bars must appear in the **chat transcript** (collapsed shell / giant heredoc / silent background waits alone are not enough); agents poll a progress file and paste the latest `█`/`░` line every ~15–30s.
* **migrate-optimizely:** Targeting-rules import is a **separate** execute phase with its own chat-visible `Execute Flags · targeting rules` bar (canonical progress-file emitter); skipping planned rules, catch-all-only runs, or folding rules into the create bar is a bug.
* **migrate-optimizely:** After flag create completes, agents **must** surface a next-step handoff recommending **Start targeting-rules import** before resolve gate or `plan code`.
* **migrate-optimizely:** After rules import completes, agents **must** surface a next-step handoff recommending **Start resolve-verify all flags** (segment match on every migrated flag) — that gate **definitively validates Phase 1** before `plan code`.
* **migrate-optimizely:** Plan/execute **must** auto-translate Optimizely **exists** → **IS NOT NULL** and **substring** → **starts with / ends with**, and tell the user in `plan flags`. **regex** and mid-string contains stay **BLOCKED**. Never silently skip the audit. Never emit ruleless presence criteria.
* **migrate-optimizely:** Prefer **Flags MCP first** for Flag clients / flag writes; fall back to IAM/Flags REST when MCP is `needsAuth` or errors. Users/groups/policies/invites remain **IAM REST only** (no IAM MCP).
* **migrate-optimizely:** Confidence **empty rules ≠ everyone**. `plan flags` must list flags with no Optimizely rules under **auto everyone catch-all**; `execute flags` must **automatically** add/enable that catch-all whenever a migrated flag still has zero enabled rules.

## [0.7.0](https://github.com/spotify/confidence-ai-plugins/compare/v0.6.1...v0.7.0) (2026-08-03)


### Features

* add analyze project skill ([#56](https://github.com/spotify/confidence-ai-plugins/issues/56)) ([a6e3760](https://github.com/spotify/confidence-ai-plugins/commit/a6e3760e5c274dd273e6e4677235422f98f01f4a))
* add evals for migrations ([#58](https://github.com/spotify/confidence-ai-plugins/issues/58)) ([bcd2021](https://github.com/spotify/confidence-ai-plugins/commit/bcd2021c54ca0c8f5fca100c97d23b2833b4fd0a))
* add per-project batch flow, quota docs, and variant safety ([#55](https://github.com/spotify/confidence-ai-plugins/issues/55)) ([56c0ea7](https://github.com/spotify/confidence-ai-plugins/commit/56c0ea762accb4fa3d941df8c1205ae96c36e19d))
* adopt batch MCP tools and enrich migration telemetry ([#53](https://github.com/spotify/confidence-ai-plugins/issues/53)) ([c96d060](https://github.com/spotify/confidence-ai-plugins/commit/c96d060b79e8b8068dab3ba4489be2343b7f2caf))
* enrich telemetry with progress fields, honest sentiment, and error tracking ([#57](https://github.com/spotify/confidence-ai-plugins/issues/57)) ([597db15](https://github.com/spotify/confidence-ai-plugins/commit/597db158b8c2fc7c5421618d968d495b12190534))
* multi-turn eval harness with mocked MCP (all 4 skills) ([#61](https://github.com/spotify/confidence-ai-plugins/issues/61)) ([b4f0a33](https://github.com/spotify/confidence-ai-plugins/commit/b4f0a33623d3335aa826ab8c16ef41538419caaa))
* onboarding skill evals — single-turn + multi-turn with mocked tools ([#62](https://github.com/spotify/confidence-ai-plugins/issues/62)) ([b8bdd15](https://github.com/spotify/confidence-ai-plugins/commit/b8bdd156bcb386a02f8566e2775541ac3c52e3c0))
* phase 1 corrections + targeting-resolution scorer ([#60](https://github.com/spotify/confidence-ai-plugins/issues/60)) ([5203ea1](https://github.com/spotify/confidence-ai-plugins/commit/5203ea13167789cd01ffc9c33c5f637a4c3f385d))


### Bug Fixes

* remove automatic eval run on push to main ([#59](https://github.com/spotify/confidence-ai-plugins/issues/59)) ([5acdacd](https://github.com/spotify/confidence-ai-plugins/commit/5acdacd0a79e43a84d27d4633ce373e3437f4539))

## [0.6.1](https://github.com/spotify/confidence-ai-plugins/compare/v0.6.0...v0.6.1) (2026-07-14)


### Bug Fixes

* add name field to SKILL.md frontmatter and link migration guides ([#50](https://github.com/spotify/confidence-ai-plugins/issues/50)) ([7e0b7bb](https://github.com/spotify/confidence-ai-plugins/commit/7e0b7bb92a863567d45196d7e75b317081818305))
* skills CLI compatibility + docs links ([7e0b7bb](https://github.com/spotify/confidence-ai-plugins/commit/7e0b7bb92a863567d45196d7e75b317081818305))

## [0.6.0](https://github.com/spotify/confidence-ai-plugins/compare/v0.5.0...v0.6.0) (2026-07-10)


### Features

* convert onboarding skill to MCP-only ([#45](https://github.com/spotify/confidence-ai-plugins/issues/45)) ([6d9cb85](https://github.com/spotify/confidence-ai-plugins/commit/6d9cb850361f2909bbaaa96a02fd846b16c16d08))
* **migrate-optimizely:** add migration scope policy and bulk execution mode ([#46](https://github.com/spotify/confidence-ai-plugins/issues/46)) ([7061682](https://github.com/spotify/confidence-ai-plugins/commit/70616827972e0c0d1c629848149b12bf561a2806))

## [0.5.0](https://github.com/spotify/confidence-ai-plugins/compare/v0.4.2...v0.5.0) (2026-07-08)


### Features

* add telemetry to all skills ([#40](https://github.com/spotify/confidence-ai-plugins/issues/40)) ([7c2c7f0](https://github.com/spotify/confidence-ai-plugins/commit/7c2c7f0e2e8d975770b47c667af808c21b214a1c))
* **migrate-optimizely:** support migration from exported JSON files ([#41](https://github.com/spotify/confidence-ai-plugins/issues/41)) ([4a736af](https://github.com/spotify/confidence-ai-plugins/commit/4a736af8388c662dffb4521b18d28cbb8828250e))


### Bug Fixes

* **migrate-optimizely:** document named-variant flag shape in Phase 1 ([#44](https://github.com/spotify/confidence-ai-plugins/issues/44)) ([d0911b4](https://github.com/spotify/confidence-ai-plugins/commit/d0911b494f9dd0171dd867bee206d83d189bd9de))

## [0.4.2](https://github.com/spotify/confidence-ai-plugins/compare/v0.4.1...v0.4.2) (2026-06-24)


### Bug Fixes

* use original logo.svg filename with Confidence logo ([#38](https://github.com/spotify/confidence-ai-plugins/issues/38)) ([c8162f4](https://github.com/spotify/confidence-ai-plugins/commit/c8162f40d5656ac4997bf12eef7bc017b0d28c44))

## [0.4.1](https://github.com/spotify/confidence-ai-plugins/compare/v0.4.0...v0.4.1) (2026-06-18)


### Bug Fixes

* add Cursor marketplace.json with correct description ([#35](https://github.com/spotify/confidence-ai-plugins/issues/35)) ([9e491a4](https://github.com/spotify/confidence-ai-plugins/commit/9e491a471ce4c271783ed7529d2aef6354e59039))

## [0.4.0](https://github.com/spotify/confidence-ai-plugins/compare/v0.3.0...v0.4.0) (2026-06-17)


### Features

* add agent telemetry to onboarding skill ([#32](https://github.com/spotify/confidence-ai-plugins/issues/32)) ([b8d0f81](https://github.com/spotify/confidence-ai-plugins/commit/b8d0f81d62133800f5264a5b9cf7533e99b2f7f0))
* add onboarding skill and command ([#19](https://github.com/spotify/confidence-ai-plugins/issues/19)) ([2da1d97](https://github.com/spotify/confidence-ai-plugins/commit/2da1d97dfb319335d9d85f9da8c090c82d296a60))
* **migrate-eppo:** standalone Eppo→Confidence migration kit (flags + code) ([#17](https://github.com/spotify/confidence-ai-plugins/issues/17)) ([11a45aa](https://github.com/spotify/confidence-ai-plugins/commit/11a45aaafeb23d999999ad9365090738a3dd932e))
* **migrate-optimizely:** Optimizely→Confidence migration kit (flags + code) ([#27](https://github.com/spotify/confidence-ai-plugins/issues/27)) ([4c337a6](https://github.com/spotify/confidence-ai-plugins/commit/4c337a6e17bbc1b72168a4d62110f752e72b02ff))
* **migrate-statsig:** Phase 2 — code transformation (plan code) ([068a9b5](https://github.com/spotify/confidence-ai-plugins/commit/068a9b50e1b30431a171ebe3b2b7574a2fb5e941))
* **migrate-statsig:** Statsig→Confidence migration — Phase 2: code transformation ([#25](https://github.com/spotify/confidence-ai-plugins/issues/25)) ([068a9b5](https://github.com/spotify/confidence-ai-plugins/commit/068a9b50e1b30431a171ebe3b2b7574a2fb5e941))
* **migrate-statsig:** Statsig→Confidence migration kit — Phase 1: flag definitions ([#23](https://github.com/spotify/confidence-ai-plugins/issues/23)) ([6dbef8d](https://github.com/spotify/confidence-ai-plugins/commit/6dbef8d77019887abac46e43b1a87761e328a41c))
* OpenFeature provider-swap path for Phase 2 (eppo, posthog, statsig) ([#31](https://github.com/spotify/confidence-ai-plugins/issues/31)) ([9dd5e0b](https://github.com/spotify/confidence-ai-plugins/commit/9dd5e0b92ec487eabc666b86cf6a728f4b33481f))


### Bug Fixes

* Fix MCP Servers table — use the working mcp.confidence.dev host ([#26](https://github.com/spotify/confidence-ai-plugins/issues/26)) ([4854807](https://github.com/spotify/confidence-ai-plugins/commit/4854807c4461dba686f2b8b69d0955a83ac6ff7e))

## [0.3.0](https://github.com/spotify/confidence-ai-plugins/compare/v0.2.3...v0.3.0) (2026-06-10)


### Features

* add multi-client plugin support for Cursor, Codex, and Gemini CLI ([#20](https://github.com/spotify/confidence-ai-plugins/issues/20)) ([c7d291c](https://github.com/spotify/confidence-ai-plugins/commit/c7d291cd86f36eee81c25c27afa9e17af6bf1db1))

## [0.2.3](https://github.com/spotify/confidence-ai-plugins/compare/v0.2.2...v0.2.3) (2026-05-25)


### Bug Fixes

* correct targeting payload format in migration skill ([#15](https://github.com/spotify/confidence-ai-plugins/issues/15)) ([ff9fa09](https://github.com/spotify/confidence-ai-plugins/commit/ff9fa094836a6ef27228b5ffb00685ba7a81b91f))
* correct targeting payload format in migration skill and plan ([ff9fa09](https://github.com/spotify/confidence-ai-plugins/commit/ff9fa094836a6ef27228b5ffb00685ba7a81b91f))

## [0.2.2](https://github.com/spotify/confidence-ai-plugins/compare/v0.2.1...v0.2.2) (2026-05-25)


### Bug Fixes

* **migrate-posthog:** correct multivariant splits and resolve verification ([#9](https://github.com/spotify/confidence-ai-plugins/issues/9)) ([848e1ab](https://github.com/spotify/confidence-ai-plugins/commit/848e1ab3e6fb3a376265bbc297aa92cadaa7037b))
