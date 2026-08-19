export interface InstrumentEventsCase {
  name: string;
  tags: string[];
  user_message: string;
  context?: string;
  expected: Record<string, unknown>;
}

export function buildInstrumentEventsDataset(): Array<{
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

const STEP4_PREAMBLE = `You have already completed Steps 1-3. The project has been scanned, existing instrumentation discovered, and event candidates identified. The user has selected the events they want. You are now at Step 4: Create event definitions. Proceed with creating the event definitions and continue through the remaining steps.`;

const CASES: InstrumentEventsCase[] = [
  // ── Eval 1: entity-reference-required ─────────────────
  {
    name: "entity-reference-required",
    tags: ["entity-ref", "hard"],
    user_message:
      "Create the event definition for purchase-completed with fields: user_id (string, identifies the buyer), amount (number), currency (string), and item_count (integer).",
    context: `${STEP4_PREAMBLE}

Available entities from listEntities:
- entities/user (User, primary key: string)
- entities/visitor (Visitor, primary key: string)

The app uses @spotify-confidence/sdk with confidence.track().
The user selected these events: purchase-completed.`,
    expected: {
      response_includes: ["entityReference", "entity"],
    },
  },

  // ── Eval 2: no-generic-events ─────────────────────────
  {
    name: "no-generic-events",
    tags: ["domain-relevance", "hard"],
    user_message:
      "What events should I track in my app? Suggest the most valuable ones and propose them with schemas.",
    context: `You are at Step 3: Propose events & metrics.

Project: Online cooking recipe platform (React + Node.js)
README: "RecipeBox lets users browse, save, and share cooking recipes. Users can create collections, rate recipes, and follow other cooks."

Key files found:
- src/recipes/RecipeDetail.tsx — displays a recipe with ingredients, steps, ratings
- src/collections/CollectionPage.tsx — user's saved recipe collections
- src/social/FollowButton.tsx — follow/unfollow other cooks
- src/recipes/RatingForm.tsx — 1-5 star rating submission
- src/search/SearchResults.tsx — recipe search with filters

Existing tracking: none. No analytics SDK installed.
Available entities: entities/user (User), entities/visitor (Visitor).

Propose domain-specific events with schemas including entity references. Remember to also mention /confidence:explore-metric as the next step for metric preview.`,
    expected: {
      response_excludes: ["user-action", "button-click", "page-view", "api-call", "data-loaded"],
    },
  },

  // ── Eval 4: entity-ref-on-correct-field ───────────────
  {
    name: "entity-ref-on-correct-field",
    tags: ["entity-ref", "hard"],
    user_message:
      "Create an event definition called 'checkout-completed' with these fields: visitor_id (the shopper), payment_method (card, paypal, etc), currency (USD, EUR), status (success, failed), and total_amount (the purchase total). Use the Visitor entity for the entity reference.",
    context: `${STEP4_PREAMBLE}

Available entities from listEntities:
- entities/visitor (Visitor, primary key: string)
- entities/user (User, primary key: string)

Remember: the entity reference (semanticType.entityReference) must go on the identifier field (visitor_id), NOT on descriptive fields (payment_method, currency, status). Also mention /confidence:explore-metric as next step.`,
    expected: {
      response_includes: ["visitor_id"],
    },
  },

  // ── Eval 7: no-op-already-instrumented ────────────────
  {
    name: "no-op-already-instrumented",
    tags: ["no-op", "hard"],
    user_message:
      "Instrument my app with event tracking.",
    context: `You are at Step 2: Discover existing instrumentation. Proceed through the remaining steps.

Project: React dashboard app.

Existing confidence.track() calls found in the codebase:
- src/dashboard/DashboardPage.tsx:45 — confidence.track('dashboard-viewed', { user_id, dashboard_id })
- src/reports/ReportGenerator.tsx:89 — confidence.track('report-generated', { user_id, report_type, duration_ms })
- src/settings/SettingsPage.tsx:23 — confidence.track('settings-updated', { user_id, changed_fields })
- src/auth/LoginHandler.tsx:67 — confidence.track('login-completed', { user_id, auth_method })
- src/auth/SignupHandler.tsx:34 — confidence.track('signup-completed', { user_id, referral_source })

Existing event definitions from listEventDefinitions:
- eventDefinitions/dashboard-viewed (schema: user_id, dashboard_id) — 45,000 events published
- eventDefinitions/report-generated (schema: user_id, report_type, duration_ms) — 12,000 events published
- eventDefinitions/settings-updated (schema: user_id, changed_fields) — 3,400 events published
- eventDefinitions/login-completed (schema: user_id, auth_method) — 89,000 events published
- eventDefinitions/signup-completed (schema: user_id, referral_source) — 5,600 events published

All key user actions are already tracked. The app has 5 track() calls matching 5 event definitions, all with data flowing. Remember to mention /confidence:explore-metric for metric preview.`,
    expected: {
      response_includes_any: ["already instrumented", "well covered", "nothing to add", "fully tracked", "no gaps", "already tracked", "no new events"],
    },
  },

  // ── Eval 9: event-name-validation ─────────────────────
  {
    name: "event-name-validation",
    tags: ["naming", "medium"],
    user_message:
      "Create event definitions for these events: 'User Purchase', 'api_call_failed', 'OK', and 'My Super Long Event Name That Probably Exceeds The Sixty Three Character Maximum Allowed By Confidence'.",
    context: `${STEP4_PREAMBLE}

Available entities: entities/user (User). Use user_id as entity reference for all events.
Remember: event IDs must be 4-63 chars, lowercase letters, digits, and hyphens only. Fix invalid names silently. Also mention /confidence:explore-metric.`,
    expected: {},
  },

  // ── Eval 6: no-metric-calculation-in-instrument ───────
  {
    name: "no-metric-calculation-in-instrument",
    tags: ["separation", "hard"],
    user_message:
      "Instrument my app to track purchase events and show me what the metrics would look like.",
    context: `You are at Step 3. The user wants metrics too, but this skill only handles instrumentation.

Project: E-commerce React app.
Key file: src/checkout/CheckoutPage.tsx — handles order completion.
Available entities: entities/visitor (Visitor).
Warehouse: configured.
Existing event definitions: none.

IMPORTANT: Do NOT run metric calculations or generate Metric Explorer URLs. For metrics, tell the user about /confidence:explore-metric.`,
    expected: {
      response_includes_any: ["explore-metric"],
    },
  },

  // ── Eval 11: ux-step-tracker ──────────────────────────
  {
    name: "ux-step-tracker",
    tags: ["ux", "interactive"],
    user_message:
      "Instrument my app with event tracking. Start the analysis.",
    context: `Project: React app with @spotify-confidence/sdk installed.
README: "TaskFlow is a project management tool for teams. Users create projects, assign tasks, track progress, and collaborate."
Key files: src/tasks/TaskBoard.tsx, src/projects/ProjectPage.tsx, src/teams/TeamSettings.tsx
Existing tracking: none.
Available entities: entities/user (User).

Start from Step 1 and show the step tracker. Remember to mention /confidence:explore-metric.`,
    expected: {},
  },

  // ── Eval 12: ux-educate-then-ask ──────────────────────
  {
    name: "ux-educate-then-ask",
    tags: ["ux", "educate"],
    user_message:
      "Set up event tracking for my payment processing API.",
    context: `You are at Step 3: Propose events & metrics.

Project: Node.js API server.
README: "Payment processing API for merchants. Handles charges, refunds, disputes, and payouts."
Key files: src/payments/processPayment.ts, src/refunds/processRefund.ts, src/disputes/handleDispute.ts
Existing tracking: none.
Available entities: entities/merchant (Merchant), entities/user (User).

Propose events with schemas. Explain concepts before asking the user to choose. Remember to mention /confidence:explore-metric.`,
    expected: {},
  },
];
