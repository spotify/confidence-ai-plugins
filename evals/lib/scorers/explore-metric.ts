import type { TaskOutput } from "../types.js";
import { llmScore } from "./llm-judge.js";

/**
 * Deterministic: the Metric Explorer URL must have correct encoding
 * and all required parameters.
 */
export function ValidExplorerURL(args: { output: TaskOutput }) {
  const text = args.output?.raw_text || "";
  if (!text) return { name: "ValidExplorerURL", score: 0, metadata: { reason: "no_output" } };

  // Extract URL — might be split across lines with & at line starts
  let urlMatch = text.match(/https:\/\/app\.confidence\.spotify\.com\/metrics\/explorer\?[^\s)]+/);
  if (!urlMatch) {
    // Try joining multi-line URLs (skill might format with line breaks for readability)
    const joined = text.replace(/\n\s*&/g, "&");
    urlMatch = joined.match(/https:\/\/app\.confidence\.spotify\.com\/metrics\/explorer\?[^\s)]+/);
  }
  if (!urlMatch) {
    // Last resort: check if URL components are present separately
    const hasBase = /app\.confidence\.spotify\.com\/metrics\/explorer/i.test(text);
    const hasFactTable = /factTable=factTables/i.test(text);
    if (hasBase && hasFactTable) {
      // URL exists but is formatted in a way we can't parse — score partial
      return { name: "ValidExplorerURL", score: 0.5, metadata: { reason: "url_found_but_unparseable" } };
    }
    return { name: "ValidExplorerURL", score: 0, metadata: { reason: "no_explorer_url_found" } };
  }

  const url = urlMatch[0];
  const failures: string[] = [];

  // Check URL encoding — resource names should use %2F
  // But also accept encoded URLs where the whole value is encoded
  const rawSlashInFactTable = /factTable=factTables\/[^&%]/.test(url);
  const rawSlashInEntity = /entity=entities\/[^&%]/.test(url);
  const rawSlashInExposure = /exposure=exposureTables\/[^&%]/.test(url);
  if (rawSlashInFactTable) failures.push("factTable_not_encoded");
  if (rawSlashInEntity) failures.push("entity_not_encoded");
  if (rawSlashInExposure) failures.push("exposure_not_encoded");

  // Check required params exist (handle both encoded and unencoded)
  const paramString = url.split("?")[1] || "";
  const hasFactTable = /factTable=/.test(paramString);
  const hasEntity = /entity=/.test(paramString);
  const hasKind = /kind=/.test(paramString);
  const hasAgg = /\bagg=/.test(paramString);
  if (!hasFactTable) failures.push("missing_factTable");
  if (!hasEntity) failures.push("missing_entity");
  if (!hasKind) failures.push("missing_kind");
  if (!hasAgg) failures.push("missing_agg");

  // Check kind is valid
  const kind = params.get("kind");
  const validKinds = ["conversion", "consumption", "average", "ratio", "ctr"];
  if (kind && !validKinds.includes(kind)) failures.push(`invalid_kind: ${kind}`);

  // Check agg is valid
  const agg = params.get("agg");
  const validAggs = ["count", "countDistinct", "approxCountDistinct", "sum", "avg", "min", "max"];
  if (agg && !validAggs.includes(agg)) failures.push(`invalid_agg: ${agg}`);

  const score = failures.length === 0 ? 1 : Math.max(0, 1 - failures.length * 0.2);
  return {
    name: "ValidExplorerURL",
    score,
    metadata: { url: url.slice(0, 200), failures },
  };
}

/**
 * Deterministic: the kind value must match the user's intent.
 */
export function CorrectKindMapping(args: { output: TaskOutput; expected: Record<string, unknown> }) {
  const expectedKind = args.expected?.expected_kind as string | undefined;
  if (!expectedKind) return { name: "CorrectKindMapping", score: 1, metadata: { reason: "no_expected_kind" } };

  const text = args.output?.raw_text || "";
  if (!text) return { name: "CorrectKindMapping", score: 0, metadata: { reason: "no_output" } };

  // Extract kind from URL or from metric configuration
  const urlKindMatch = text.match(/kind=([a-z]+)/);
  const proseKindMatch = text.match(/[Kk]ind:\s*([a-z]+)/);
  const actualKind = urlKindMatch?.[1] || proseKindMatch?.[1] || "";

  const matched = actualKind === expectedKind;
  return {
    name: "CorrectKindMapping",
    score: matched ? 1 : 0,
    metadata: { expected: expectedKind, actual: actualKind || "not_found" },
  };
}

/**
 * Deterministic: the exposure table in the URL must match the
 * fact table's entity.
 */
export function ExposureTableEntityMatch(args: { output: TaskOutput; expected: Record<string, unknown> }) {
  const expectedExposure = args.expected?.expected_exposure as string | undefined;
  if (!expectedExposure) return { name: "ExposureTableEntityMatch", score: 1, metadata: { reason: "no_expected" } };

  const text = args.output?.raw_text || "";
  if (!text) return { name: "ExposureTableEntityMatch", score: 0, metadata: { reason: "no_output" } };

  // Extract exposure param from URL
  const match = text.match(/exposure=([^&\s]+)/);
  if (!match) {
    return { name: "ExposureTableEntityMatch", score: 0, metadata: { reason: "no_exposure_in_url" } };
  }

  const actualExposure = decodeURIComponent(match[1]);
  const matched = actualExposure === expectedExposure;

  return {
    name: "ExposureTableEntityMatch",
    score: matched ? 1 : 0,
    metadata: { expected: expectedExposure, actual: actualExposure },
  };
}

/**
 * LLM judge: when no fact table exists, the response must explain
 * why and suggest a fix (missing entity reference or auto-creation
 * not enabled).
 */
export async function ExplainsNoFactTable(args: { output: TaskOutput; metadata?: Record<string, unknown> }) {
  const tags = (args.metadata?.tags as string[]) || [];
  if (!tags.includes("diagnostics")) {
    return { name: "ExplainsNoFactTable", score: 1, metadata: { reason: "not_applicable" } };
  }
  return llmScore(
    "ExplainsNoFactTable",
    `The user asked to explore a metric for an event, but no fact table exists for that event. The assistant must explain WHY — not just say "not found."

Valid explanations:
- The event definition is missing an entity reference (semanticType.entityReference) which is required for auto fact table creation
- Auto fact table creation may not be enabled for this account
- The event definition doesn't exist at all

The assistant should also suggest a fix — how to add an entity reference, or how to create a fact table manually.

Score 1.0 = clear explanation of root cause + actionable fix. 0.5 = mentions the issue but no clear fix. 0.0 = just says "not found" or gives no explanation.`,
    args.output?.raw_text || "",
  );
}
