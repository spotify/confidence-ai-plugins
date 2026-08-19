import type { TaskOutput } from "../types.js";
import { llmScore } from "./llm-judge.js";

/**
 * Deterministic: every createEventDefinition tool call must include
 * semanticType.entityReference on at least one field.
 */
export function EntityReferenceRequired(args: { output: TaskOutput }) {
  const text = args.output?.raw_text || "";
  if (!text) return { name: "EntityReferenceRequired", score: 0, metadata: { reason: "no_output" } };

  // Check if there are any createEventDefinition tool calls
  const toolCallPattern = /createEventDefinition|create.*event.*definition/i;
  if (!toolCallPattern.test(text)) {
    return { name: "EntityReferenceRequired", score: 1, metadata: { reason: "no_event_definition_created" } };
  }

  // Check for entity reference in any form — JSON key, prose description, or schema
  const hasEntityRef = /entityReference|entity_reference|entity.reference|semantic[Tt]ype|entity:\s*["']?entities\//i.test(text);
  // Also check for the pattern in JSON schema blocks
  const hasEntityInSchema = /["']entity["']\s*:\s*["']entities\//i.test(text);
  const found = hasEntityRef || hasEntityInSchema;
  return {
    name: "EntityReferenceRequired",
    score: found ? 1 : 0,
    metadata: { reason: found ? "entity_reference_found" : "entity_reference_missing" },
  };
}

/**
 * Deterministic: event names must match [a-z0-9-]{4,63}.
 */
export function ValidEventName(args: { output: TaskOutput }) {
  const text = args.output?.raw_text || "";
  if (!text) return { name: "ValidEventName", score: 0, metadata: { reason: "no_output" } };

  // Extract event names from createEventDefinition calls or proposals
  const eventIdMatches = text.match(/eventDefinitionId['":\s]+([a-zA-Z0-9_-]+)/g) ||
    text.match(/event.*definition.*['":]([a-zA-Z0-9_-]+)/gi) || [];

  if (eventIdMatches.length === 0) {
    // Try to find event names in backticks from proposals
    const backtickNames = [...text.matchAll(/`([a-z0-9-]{2,80})`/g)].map(m => m[1])
      .filter(n => n.includes("-") && !n.startsWith("http") && !n.includes("/"));
    if (backtickNames.length === 0) {
      return { name: "ValidEventName", score: 1, metadata: { reason: "no_event_names_found" } };
    }
    const valid = backtickNames.filter(n => /^[a-z0-9-]{4,63}$/.test(n));
    const score = valid.length / backtickNames.length;
    return {
      name: "ValidEventName",
      score,
      metadata: { total: backtickNames.length, valid: valid.length, names: backtickNames },
    };
  }

  // Extract the actual IDs
  const ids = eventIdMatches.map(m => {
    const match = m.match(/['":\s]+([a-zA-Z0-9_-]+)$/);
    return match ? match[1] : "";
  }).filter(Boolean);

  const valid = ids.filter(id => /^[a-z0-9-]{4,63}$/.test(id));
  const score = ids.length > 0 ? valid.length / ids.length : 1;
  return {
    name: "ValidEventName",
    score,
    metadata: { total: ids.length, valid: valid.length, ids },
  };
}

/**
 * Deterministic: instrument-events must NOT make metric calculation
 * tool calls or generate Metric Explorer URLs.
 */
export function NoMetricCalculation(args: { output: TaskOutput }) {
  const text = args.output?.raw_text || "";
  if (!text) return { name: "NoMetricCalculation", score: 0, metadata: { reason: "no_output" } };

  const violations: string[] = [];

  if (/createMetricCalculation/i.test(text)) violations.push("createMetricCalculation");
  if (/queryMetricCalculation/i.test(text)) violations.push("queryMetricCalculation");
  if (/getMetricCalculation/i.test(text)) violations.push("getMetricCalculation");
  if (/metrics\/explorer\?/i.test(text)) violations.push("metric_explorer_url");

  return {
    name: "NoMetricCalculation",
    score: violations.length === 0 ? 1 : 0,
    metadata: { violations },
  };
}

/**
 * Deterministic: instrument-events must mention explore-metric skill
 * as a next step.
 */
export function HintExploreMetric(args: { output: TaskOutput }) {
  const text = args.output?.raw_text || "";
  if (!text) return { name: "HintExploreMetric", score: 0, metadata: { reason: "no_output" } };

  const hasExplicit = /explore-metric/i.test(text);
  const hasConceptual = /metric.*preview|preview.*metric|explore.*metric|metric.*explorer/i.test(text);
  const found = hasExplicit || hasConceptual;
  return {
    name: "HintExploreMetric",
    score: hasExplicit ? 1 : hasConceptual ? 0.5 : 0,
    metadata: { reason: hasExplicit ? "explicit_hint" : hasConceptual ? "conceptual_hint" : "no_hint" },
  };
}

/**
 * LLM judge: proposed events must be domain-specific, not generic.
 * Only scored when the response actually proposes events.
 */
export async function DomainRelevance(args: { output: TaskOutput }) {
  const text = args.output?.raw_text || "";
  // Skip if the response doesn't propose any events (e.g., still at scanning step)
  if (!text || (!/event.*definition|track.*event|propose|schema.*field/i.test(text) && !/`[a-z]+-[a-z]+`/i.test(text))) {
    return { name: "DomainRelevance", score: 1, metadata: { reason: "no_events_proposed_yet" } };
  }
  return llmScore(
    "DomainRelevance",
    `The assistant is proposing events to track in a user's application. Events must be DOMAIN-SPECIFIC — they should reflect the actual business domain of the application, not be generic/reusable across any app.

GOOD event names (domain-specific): "purchase-completed", "lesson-completed", "experiment-launched", "recipe-saved", "playlist-created", "invoice-sent"

BAD event names (generic): "user-action", "button-clicked", "page-viewed", "api-call", "form-submitted", "item-selected", "data-loaded"

Score 1.0 = all proposed events are clearly domain-specific. 0.5 = mix of domain-specific and generic. 0.0 = mostly generic events that could apply to any app.`,
    args.output?.raw_text || "",
  );
}

/**
 * LLM judge: entity reference must be on an identifier field,
 * not a descriptive field. Only scored when schemas are present.
 */
export async function EntityRefOnCorrectField(args: { output: TaskOutput }) {
  const text = args.output?.raw_text || "";
  if (!text || !/schema|entityReference|entity_reference|semanticType|stringSchema/i.test(text)) {
    return { name: "EntityRefOnCorrectField", score: 1, metadata: { reason: "no_schema_in_response" } };
  }
  return llmScore(
    "EntityRefOnCorrectField",
    `The assistant is creating an event definition with an entity reference (semanticType.entityReference). The entity reference identifies which field represents the unit of analysis (e.g., a user, visitor, or organization).

The entity reference MUST be on an identifier field — a field whose values uniquely identify entities:
CORRECT: visitor_id, user_id, org_id, account_id, session_id, customer_id

The entity reference must NOT be on a descriptive/categorical field:
WRONG: action, status, currency, payment_method, event_type, category, country

If the response includes a schema with semanticType.entityReference, check that it's on the right field. Score 1.0 if entity reference is on an identifier field. 0.5 if ambiguous. 0.0 if on a descriptive field or missing entirely when an identifier field exists in the schema.`,
    args.output?.raw_text || "",
  );
}

/**
 * Deterministic: the response must use AskUserQuestion for choices,
 * not numbered lists in plain text.
 */
export function UsesAskUserQuestion(args: { output: TaskOutput }) {
  const text = args.output?.raw_text || "";
  if (!text) return { name: "UsesAskUserQuestion", score: 0, metadata: { reason: "no_output" } };

  // Check for numbered list patterns that suggest inline choices
  const numberedListChoice = /(?:^|\n)\s*[1-9]\.\s+\*?\*?[A-Z].*(?:—|-).*(?:\n\s*[2-9]\.\s+)/m;
  const hasNumberedChoice = numberedListChoice.test(text);

  // Check for AskUserQuestion usage
  const hasAskUser = /AskUserQuestion|Which.*do you want|Which.*would you like/i.test(text);

  if (!hasNumberedChoice) {
    return { name: "UsesAskUserQuestion", score: 1, metadata: { reason: "no_inline_choices" } };
  }

  return {
    name: "UsesAskUserQuestion",
    score: hasAskUser ? 0.5 : 0,
    metadata: { reason: hasNumberedChoice ? "numbered_list_choices_in_text" : "ok", hasAskUser },
  };
}
