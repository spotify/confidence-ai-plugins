export interface ExploreMetricCase {
  name: string;
  tags: string[];
  user_message: string;
  context?: string;
  expected: Record<string, unknown>;
}

export function buildExploreMetricDataset(): Array<{
  input: { user_message: string; context?: string };
  expected: Record<string, unknown>;
  metadata: { name: string; tags: string[] };
}> {
  return CASES.map((c) => ({
    input: { user_message: c.user_message, context: c.context },
    expected: c.expected,
    metadata: { name: c.name, tags: c.tags },
  }));
}

const CASES: ExploreMetricCase[] = [
  // ── Eval 3: correct-kind-mapping ──────────────────────
  {
    name: "correct-kind-mapping-conversion",
    tags: ["kind-mapping", "hard"],
    user_message:
      "I want to measure how many visitors made at least one purchase.",
    context: `Fact table: factTables/purchase-completed
  Display name: Fact table for event purchase-completed
  Timestamp column: _event_time
  Entities: visitor_id -> entities/visitor
  Measures: amount, item_count
  Dimensions: currency, payment_method

Exposure tables matching entities/visitor:
- exposureTables/abc123 — "Exposure for Checkout Redesign" — data until 2026-08-18`,
    expected: {
      expected_kind: "conversion",
    },
  },
  {
    name: "correct-kind-mapping-consumption",
    tags: ["kind-mapping", "hard"],
    user_message:
      "I want to measure total revenue per visitor.",
    context: `Fact table: factTables/purchase-completed
  Display name: Fact table for event purchase-completed
  Timestamp column: _event_time
  Entities: visitor_id -> entities/visitor
  Measures: amount, item_count
  Dimensions: currency, payment_method

Exposure tables matching entities/visitor:
- exposureTables/abc123 — "Exposure for Checkout Redesign" — data until 2026-08-18`,
    expected: {
      expected_kind: "consumption",
    },
  },

  // ── Eval 5: valid-explorer-url ────────────────────────
  {
    name: "valid-explorer-url",
    tags: ["url", "hard"],
    user_message:
      "Generate a Metric Explorer link for the purchase-completed event. I want to see total revenue (sum of amount) per visitor.",
    context: `Fact table: factTables/purchase-completed
  Display name: Fact table for event purchase-completed
  Timestamp column: _event_time
  Entities: visitor_id -> entities/visitor
  Measures: amount, item_count
  Dimensions: currency, payment_method

Exposure tables matching entities/visitor:
- exposureTables/bed86624e687c05638a42199c4344b7b — "Exposure for Checkout Redesign" — data until 2026-08-18`,
    expected: {
      expected_kind: "consumption",
    },
  },

  // ── Eval 8: exposure-table-entity-match ───────────────
  {
    name: "exposure-table-entity-match",
    tags: ["exposure-match", "medium"],
    user_message:
      "Explore metric for the signup-completed event. Show me conversion rate.",
    context: `Fact table: factTables/signup-completed
  Entities: visitor_id -> entities/visitor
  Measures: (none)
  Dimensions: referral_source

Exposure tables:
- exposureTables/org-exp — "Exposure for Pricing Test" — entity: entities/organization — data until 2026-08-18
- exposureTables/vis-recent — "Exposure for New Onboarding" — entity: entities/visitor — data until 2026-08-17
- exposureTables/session-exp — "Exposure for Session Recording" — entity: entities/session — data until 2026-08-18
- exposureTables/vis-old — "Exposure for Old A/B Test" — entity: entities/visitor — data until 2026-07-01`,
    expected: {
      expected_exposure: "exposureTables/vis-recent",
      expected_kind: "conversion",
    },
  },

  // ── Eval 10: no-fact-table-explains-why ────────────────
  {
    name: "no-fact-table-explains-why",
    tags: ["diagnostics", "hard"],
    user_message:
      "Explore metric for my-custom-event.",
    context: `listFactTables result: no fact table matching "my-custom-event" found.

getEventDefinition result for my-custom-event:
  Name: eventDefinitions/my-custom-event
  Schema:
    - action: string
    - value: double
    - source: string
  Usage: 500 events published
  (No entity reference / semanticType on any field)`,
    expected: {
      response_includes_any: ["entity reference", "entity", "auto fact table creation", "not enabled"],
    },
  },
];
