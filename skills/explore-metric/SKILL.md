---
name: explore-metric
description: Explore and preview metrics for any event or fact table. Generates a pre-filled Metric Explorer URL with fact table, entity, exposure table, metric kind, and aggregation — so the user can click through to the UI, hit Calculate, and create the metric. Use when the user asks to explore a metric, preview a metric, create a metric from an event, or says /explore-metric.
argument-hint: "[event-name or fact-table-name]"
---

# Explore Metric

Generate a pre-filled Metric Explorer URL for any event or fact table, so the user can preview and create metrics in the Confidence UI with one click.

## Goal

Bridge the gap between raw event data and actionable experiment metrics. The user has events flowing — this skill helps them turn that data into a metric they can attach to experiments, by generating a ready-to-use Metric Explorer link with everything pre-filled.

---

## Prerequisites

### Confidence Flags MCP

Test: `mcp__confidence-flags__getIdentityInfo` (no args)

If not available, install it:

```
claude mcp add confidence-flags --transport http --url https://mcp.confidence.dev/mcp/flags
```

---

## Flow

### 1. Resolve the fact table

If the user provides an **event name** (e.g., `purchase-completed`):
- Call `mcp__confidence-flags__listFactTables` and search for a fact table matching that event name
- If not found, check `mcp__confidence-flags__getEventDefinition` to verify the event exists. If the event definition exists but has no fact table, you MUST diagnose why:

  **Diagnosis 1 — Missing entity reference:** Inspect the event definition's schema fields. If NO field has a `semanticType` with an `entityReference`, explain:
  > This event definition doesn't have an entity reference on any field.
  > A fact table is only auto-created when at least one string field has a
  > `semanticType.entityReference` — this tells the system which field
  > identifies the unit of analysis (e.g., visitor, user, organization).
  >
  > To fix this, update the event definition and add an entity reference
  > to the identifier field (like `visitor_id` or `user_id`), or re-create
  > the event with `/confidence:instrument-events`.

  **Diagnosis 2 — Auto creation not enabled:** If the schema HAS entity references but still no fact table, explain:
  > Auto fact table creation may not be enabled for this account. You can
  > create a fact table manually in the Confidence UI under Admin → Fact Tables.

If the user provides a **fact table name** (e.g., `factTables/purchase-completed`):
- Use it directly

If the user provides **no argument**:
- Call `mcp__confidence-flags__listFactTables` and `mcp__confidence-flags__listEventDefinitions`
- Present the available fact tables (filter to event-derived ones — those with `_event_time` as timestamp column) and let the user pick via AskUserQuestion

### 2. Inspect the fact table

From the fact table, extract:
- **Entity** and its mapping (e.g., `visitor_id → entities/visitor`)
- **Measures** (numeric columns available for aggregation)
- **Dimensions** (string/bool columns available for filtering)
- **Timestamp column**

Present:
```
───── Fact Table ──────────────────────────────────────────
  Name:       factTables/purchase-completed
  Entity:     visitor_id → Visitor
  Measures:   amount, item_count
  Dimensions: currency, action
────────────────────────────────────────────────────────────
```

### 3. Choose metric configuration

Use AskUserQuestion to let the user configure the metric:

**Metric kind:**
- **Conversion** — did the entity trigger at least 1 event? (COUNT ≥ 1)
- **Consumption** — total of a numeric field per entity (SUM)
- **Average** — mean of a numeric field per entity (AVG)
- **Count** — number of events per entity (COUNT)

If the user picks consumption, average, or a kind that needs a measure column, ask which measure to use (from the fact table's measures list).

### 4. Find exposure tables

Call `mcp__confidence-flags__listExposureTables` and filter to:
- Same entity as the fact table
- State is `TABLE_STATE_ACTIVE`
- Has `exposureDataDeliveredUntilTime` (meaning data exists)

Sort by most recent data delivery time. Pick the best match.

If no matching exposure tables exist:
> No active experiments found for the Visitor entity. The Metric Explorer
> requires an experiment to be running. You can still create the metric
> manually in the UI, or start an experiment first.

Generate the URL without the `exposure` param — the user can select one in the UI.

### 5. Generate the Metric Explorer URL

**Base URL:** `https://app.confidence.spotify.com/metrics/explorer`

**URL parameters:**

| Param | URL key | Value |
|-------|---------|-------|
| Fact table | `factTable` | `factTables/{id}` (URL-encoded) |
| Entity | `entity` | `entities/{id}` (URL-encoded) |
| Exposure table | `exposure` | `exposureTables/{id}` (URL-encoded) |
| Metric kind | `kind` | `conversion`, `consumption`, `average`, `ratio`, `ctr` |
| Measure column | `measurement` | column name (for consumption/average) |
| Aggregation | `agg` | `count`, `sum`, `avg`, `min`, `max`, `countDistinct` |
| Aggregation operator | `aggOp` | `none` (default), `gte`, `gt`, `eq`, `lt`, `lte` |
| Aggregation window | `window` | `3600s` (1 hour, default for closed window) |

**Kind → default aggregation mapping:**

| Kind | Default agg | Default measure |
|------|-------------|-----------------|
| `conversion` | `count` | — (counts entities) |
| `consumption` | `sum` | user-selected measure |
| `average` | `avg` | user-selected measure |
| `count` → use `conversion` kind | `count` | — |

**URL encoding is CRITICAL.** The `/` in resource names MUST be encoded as `%2F`. Without this, the URL breaks.

Examples of CORRECT encoding:
- `factTable=factTables%2Fpurchase-completed` ✓
- `entity=entities%2Fenk6xv5ido8wqotjxkcz` ✓
- `exposure=exposureTables%2Fbed86624e687c05638a42199c4344b7b` ✓

Examples of WRONG encoding (will break the UI):
- `factTable=factTables/purchase-completed` ✗
- `entity=entities/visitor` ✗

Always include these required params: `factTable`, `entity`, `kind`, `agg`, `aggOp=none`.

**Present the link:**

```
───── Metric Explorer ────────────────────────────────────

  📊 Revenue per visitor
     Kind: consumption  │  Measure: amount  │  Agg: SUM

  https://app.confidence.spotify.com/metrics/explorer?factTable=factTables%2Fpurchase-completed&entity=entities%2Fvisitor&exposure=exposureTables%2Fabc123&kind=consumption&measurement=amount&agg=sum&aggOp=none

  In the Metric Explorer:
    1. Click "Calculate" to preview the metric
    2. Review the chart and diagnostics
    3. Click "Create" to save it as a real metric

  Note: If you see "No available time range", the event
  data hasn't landed in the warehouse yet. The event
  connector batches data hourly — wait and retry.

────────────────────────────────────────────────────────────
```

### 6. Offer additional metrics

After presenting the first URL, ask:

> Want to explore another metric on this fact table, or a different event?

Options:
- **Another metric on this fact table** — go back to step 3
- **Different event or fact table** — go back to step 1
- **Done** — end the skill

---

## Rules

- **Never run metric calculations in the terminal** — the Metric Explorer UI handles calculation, timing, and visualization. This skill only generates the URL.
- **Always URL-encode resource names** — `factTables/x` becomes `factTables%2Fx`
- **The URL must be on a SINGLE LINE** — never split across multiple lines. The user must be able to click it directly.
- **Pick the most recent exposure table** matching the entity — sorted by `exposureDataDeliveredUntilTime` descending
- **If multiple entities** exist on the fact table, ask the user which one to use
- **Handle missing data gracefully** — if no fact table, no exposure table, or no measures exist, explain what's missing and what the user can do
