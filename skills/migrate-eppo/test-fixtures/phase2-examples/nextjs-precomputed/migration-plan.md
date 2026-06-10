# Eppo to Confidence Code Migration Plan

**Created:** 2026-06-01
**Scope:** Code transformation only
**Language:** TypeScript
**Framework:** Next.js 15 (App Router, React 19 Server Components)

---

## Generation Status

| Step | Status | Result |
|------|--------|--------|
| 1. Detect language | ● done | Next.js 15 App Router + React 19 + TS |
| 2. Fetch SDK guide | ● done | Confidence JS local-resolve + React (RSC) integration |
| 3. Scan codebase | ● done | 5 Eppo files, precomputed (server→client) pattern |
| 4. Transform rules | ● done | precompute → `<ConfidenceProvider>` + `useFlag` |
| 5. Group by flag | ● done | 1 flag (`NEXT_PUBLIC_EPPO_FLAG_KEY`, boolean) |

**Overall:** ready to execute

---

## 1. SDK Setup

### Resolve mode

| | |
|---|---|
| **Source mode** | server-precomputed (Eppo `@eppo/node-server-sdk` resolves server-side for a bound subject; `@eppo/js-client-sdk` reads precomputed values offline on the client) |
| **Target mode** | server-precomputed (Confidence React local-resolve provider — server resolves via WASM, client reads via React Context) |
| **Change** | ✅ unchanged — resolve mode is preserved |

**Resolve mode is preserved.** Both before and after, flags resolve on the
server (for a bound subject) and the client reads resolved values without a
per-read network call or a client-side ruleset. The Eppo "precompute on the
server → hydrate an offline client SDK" architecture maps directly onto
Confidence's `<ConfidenceProvider>` (server resolves) + `useFlag` (client reads
from React Context) flow. No surface moves from local to remote or vice versa.

### Install

```bash
yarn add @spotify-confidence/openfeature-server-provider-local @openfeature/server-sdk
yarn remove @eppo/node-server-sdk @eppo/js-client-sdk
```

Requirements: Node.js 18+ with WebAssembly support (already satisfied — Next.js 15 / Node 18+).

### API Reference (from MCP: confidence-docs — JS local resolve + Next.js)

Provider init (server, module side-effect):

```typescript
// src/lib/confidence.ts
import { OpenFeature } from '@openfeature/server-sdk';
import { createConfidenceServerProvider } from '@spotify-confidence/openfeature-server-provider-local';

const provider = createConfidenceServerProvider({
  flagClientSecret: process.env.CONFIDENCE_FLAG_CLIENT_SECRET!,
});

await OpenFeature.setProviderAndWait(provider);
```

Server boundary (layout) — context replaces the precomputed config string:

```tsx
import { ConfidenceProvider } from '@spotify-confidence/openfeature-server-provider-local/react-server';
import './lib/confidence';

<ConfidenceProvider context={context}>{children}</ConfidenceProvider>
```

Client read:

```tsx
'use client';
import { useFlag } from '@spotify-confidence/openfeature-server-provider-local/react-client';

const enabled = useFlag('<flag-key>.enabled', false);
```

Server read (optional, in RSC):

```tsx
import { getFlag } from '@spotify-confidence/openfeature-server-provider-local/react-server';
const enabled = await getFlag('<flag-key>.enabled', false, { targetingKey });
```

### Create Confidence Wrapper

**File:** `src/lib/confidence.ts` (provider init) + use `<ConfidenceProvider>` directly in `src/app/layout.tsx`.

**Must match source API surface:**

| Eppo method (source) | Confidence equivalent (target) |
|----------------------|--------------------------------|
| `EppoSDK.init({ apiKey, assignmentLogger })` + `EppoSDK.getInstance()` | `createConfidenceServerProvider({ flagClientSecret })` + `OpenFeature.setProviderAndWait(provider)` |
| `getPrecomputedConfiguration(userId, attrs)` (server action → config string) | build `context = { targetingKey: userId, ...attrs }` and pass to `<ConfidenceProvider context={context}>` |
| `offlinePrecomputedInit({ precomputedConfiguration })` (client) | removed — `<ConfidenceProvider>` boundary replaces it |
| `getPrecomputedInstance().getBooleanAssignment(flagKey, false)` | `useFlag('<flag-key>.enabled', false)` |
| `assignmentLogger` / `window.dispatchEvent('eppo-assignment')` bridge | removed — Confidence logs exposure automatically |

---

## 2. Transform Rules

### Source Files

| File | Find | Replace |
|------|------|---------|
| `src/lib/getEppoClient.ts` | `import * as EppoSDK from '@eppo/node-server-sdk'` + `EppoSDK.init(...)` + `EppoSDK.getInstance()` | **Delete file.** Replaced by `src/lib/confidence.ts` (provider init + `setProviderAndWait`). |
| `src/lib/confidence.ts` (new) | — | `createConfidenceServerProvider({ flagClientSecret: process.env.CONFIDENCE_FLAG_CLIENT_SECRET! })` + `await OpenFeature.setProviderAndWait(provider)` |
| `src/lib/getPrecomputedConfiguration.ts` | `'use server'` action returning `eppoClient.getPrecomputedConfiguration(userId, subjectAttributes)` | Reduce to a context builder: `getEvaluationContext()` returning `{ targetingKey: \`test-user-...\`, }`. No precompute string. |
| `src/components/EppoProviderWrapper.tsx` | server wrapper fetching config + rendering `<EppoRandomizationProvider precomputedConfiguration={config}>` | Render `<ConfidenceProvider context={await getEvaluationContext()}>{children}</ConfidenceProvider>` (import `ConfidenceProvider` from `/react-server`; import `./lib/confidence` for init side-effect). |
| `src/components/EppoRandomizationProvider.tsx` | `'use client'` + `offlinePrecomputedInit({ precomputedConfiguration, assignmentLogger })` + `window.dispatchEvent('eppo-assignment')` | **Delete file.** Boundary + context now live in `<ConfidenceProvider>`; exposure logging is automatic. |
| `src/components/FeatureFlagTest.tsx` | `import * as EppoSdk from '@eppo/js-client-sdk'` + `EppoSdk.getPrecomputedInstance()` + `client.getBooleanAssignment(flagKey, false)` inside `useEffect` + `window.addEventListener('eppo-assignment', …)` | `import { useFlag } from '@spotify-confidence/openfeature-server-provider-local/react-client'` + `const flagValue = useFlag(\`${flagKey}.enabled\`, false)`. Remove `useEffect`, the event listener, and the `assignmentData` bridge state. |

### Test Files

None present in this repo.

---

## 3. Files to Transform

Grouped by flag key — single flag: **`NEXT_PUBLIC_EPPO_FLAG_KEY`** (boolean).

- **Confidence resolve path:** `<NEXT_PUBLIC_EPPO_FLAG_KEY>.enabled`
  *(boolean flag → Phase 1 `createFlag` default schema → `enabled` property)*
- **Evaluation site:** `src/components/FeatureFlagTest.tsx:26` — `getBooleanAssignment(flagKey, false)` (client, precomputed read, 2-arg)
- **Subject + attrs source:** `src/lib/getPrecomputedConfiguration.ts:6-9` — `userId = test-user-<random>`, `subjectAttributes = {}` (server-bound)
- **RSC boundary:** `src/components/EppoProviderWrapper.tsx` (server) → `src/components/EppoRandomizationProvider.tsx` (client). Collapses into one `<ConfidenceProvider>`.
- **Entry:** `src/app/layout.tsx:31` wraps the app in the provider wrapper.

⚠️ **Phase 1 dependency:** the flag key is supplied at runtime via the
`NEXT_PUBLIC_EPPO_FLAG_KEY` env var, so the concrete Confidence flag (and its
resolve path property) must exist from the Phase 1 flag migration. Confirm the
migrated flag is a boolean with an `enabled` property before executing; if
Phase 1 used a non-default schema, adjust `.enabled` to the actual property.

⚠️ **`NEXT_PUBLIC_` prefix:** `NEXT_PUBLIC_EPPO_SDK_KEY` is exposed to the
browser. The Confidence `flagClientSecret` is a **backend** secret and must NOT
use a `NEXT_PUBLIC_` prefix — use `CONFIDENCE_FLAG_CLIENT_SECRET` (server-only).

---

## 4. Progress

| # | Item | Status |
|---|------|--------|
| 0 | SDK Setup (install + `src/lib/confidence.ts`) | :white_circle: |
| 1 | `NEXT_PUBLIC_EPPO_FLAG_KEY` → `<flag>.enabled` (`useFlag`) | :white_circle: |
