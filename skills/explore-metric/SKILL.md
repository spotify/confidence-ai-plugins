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

## User-Facing Communication Rules

- **Use AskUserQuestion for all choices** — never numbered lists in plain text
- **Every question MUST have a recommended default.** Analyze the available data and make an informed suggestion. Put the recommended option first with "(Recommended)" appended to its label. The user should be able to accept defaults and keep moving without having to think from scratch.
- **Start from the business question**, not the data model. Ask what the user wants to measure before diving into fact tables and columns.

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

### 1. Understand what to measure

Before jumping to fact tables, ask the user what they're trying to understand. If the user provided a specific event or fact table as an argument, skip this step.

If no argument was provided, use AskUserQuestion:

> What do you want to measure?

Examine the available fact tables and metrics to suggest the most relevant options. For example:
- **Checkout conversion** — are users completing purchases? (Recommended if a checkout fact table exists)
- **Click-through rate** — are users clicking? (Recommended if click/impression measures exist)
- **Revenue impact** — how much are users spending?
- **Something else** — describe what you want to measure

Use the answer to guide fact table selection and metric kind in subsequent steps.

### 2. Resolve the fact table

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

If the user answered the business question in Step 1:
- Call `mcp__confidence-flags__listFactTables`
- Match the user's intent to the best fact table(s) based on display names, measures, and dimensions
- Present the top matches via AskUserQuestion with the best match marked as "(Recommended)"

### 3. Inspect the fact table

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

### 4. Choose metric configuration

Use AskUserQuestion to let the user configure the metric. **Suggest the best default based on the business question and available measures.**

**Metric kind:**
- **Conversion** — did the entity trigger at least 1 event? (COUNT ≥ 1)
- **Consumption** — total of a numeric field per entity (SUM)
- **Average** — mean of a numeric field per entity (AVG)
- **Ratio** — ratio of two measures (e.g., clicks/impressions)

Mark the recommended kind based on context:
- If the user asked about conversion/activation → recommend **Conversion**
- If the fact table has revenue/amount measures → recommend **Consumption**
- If the fact table has both click and impression measures → recommend **Ratio** (CTR)
- If unsure → recommend **Conversion** (simplest, always works)

If the user picks consumption, average, or a kind that needs a measure column, ask which measure to use (from the fact table's measures list) with the most relevant one marked "(Recommended)".

### 5. Exposure table handling

**Do NOT include the `exposure` parameter in the generated URL.**

The Metric Explorer requires the fact table's data partitions to overlap with the exposure table's data partitions. There is no MCP tool to verify this overlap (it requires the `QueryAvailableTimeRange` gRPC endpoint). Picking an exposure table blindly causes "No available time range for this metric" errors when the data doesn't overlap.

Instead, let the user select the experiment in the Metric Explorer UI, where the dropdown only shows experiments with valid data ranges.

Tell the user:
> The link opens the Metric Explorer with your fact table and metric kind
> pre-filled. Select an experiment from the dropdown in the UI — it only
> shows experiments with overlapping data, so you won't hit time range errors.

### 6. Generate the Metric Explorer URL

**Base URL:** `https://app.confidence.spotify.com/metrics/explorer`

**URL parameters:**

| Param | URL key | Value |
|-------|---------|-------|
| Fact table | `factTable` | `factTables/{id}` (URL-encoded) |
| Entity | `entity` | `entities/{id}` (URL-encoded) |
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

Examples of WRONG encoding (will break the UI):
- `factTable=factTables/purchase-completed` ✗
- `entity=entities/visitor` ✗

Always include these required params: `factTable`, `entity`, `kind`, `agg`, `aggOp=none`.

**Do NOT include `exposure` in the URL.** The Metric Explorer requires the fact table and exposure table data partitions to overlap, and there is no MCP tool or public API to verify this overlap (`QueryAvailableTimeRange` is behind an internal GraphQL BFF). Including an exposure table blindly causes "No available time range" errors. Let the user select the experiment in the UI dropdown, which only shows valid options.

**Present the link:**

```
───── Metric Explorer ────────────────────────────────────

  📊 Revenue per visitor
     Kind: consumption  │  Measure: amount  │  Agg: SUM

  https://app.confidence.spotify.com/metrics/explorer?factTable=factTables%2Fpurchase-completed&entity=entities%2Fvisitor&kind=consumption&measurement=amount&agg=sum&aggOp=none

  In the Metric Explorer:
    1. Select an experiment from the dropdown
    2. Click "Calculate" to preview the metric
    3. Review the chart and diagnostics
    4. Click "Create" to save it as a real metric

────────────────────────────────────────────────────────────
```

### 7. Offer additional metrics

After presenting the first URL, ask:

> Want to explore another metric on this fact table, or a different event?

Options:
- **Another metric on this fact table** — go back to step 4
- **Different event or fact table** — go back to step 1
- **Done (Recommended)** — end the skill

---

## Rules

- **Never run metric calculations in the terminal** — the Metric Explorer UI handles calculation, timing, and visualization. This skill only generates the URL.
- **Always URL-encode resource names** — `factTables/x` becomes `factTables%2Fx`
- **The URL must be on a SINGLE LINE** — never split across multiple lines. The user must be able to click it directly.
- **NEVER include `exposure` in the URL** — there is no MCP tool or public API to verify that the exposure table's data partitions overlap with the fact table's data (`QueryAvailableTimeRange` is behind an internal GraphQL BFF at `graphql-konfidens.spotify.com`). Including an exposure table blindly causes "No available time range for this metric" errors. Let the user select the experiment in the Metric Explorer UI dropdown.
- **If multiple entities** exist on the fact table, ask the user which one to use
- **Handle missing data gracefully** — if no fact table or no measures exist, explain what's missing and what the user can do
- **Every AskUserQuestion MUST have a recommended default** — analyze context and suggest the best option first with "(Recommended)" in the label
- **Start from the business question** — don't force the user to think in terms of fact tables and aggregation types. Translate their intent into the right configuration.
