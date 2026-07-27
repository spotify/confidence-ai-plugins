import type { TaskOutput } from "../types.js";
import { extractScope, extractShape } from "../classification-footer.js";

function findInText(text: string, candidates: string[]): string | null {
  const lower = text.toLowerCase();
  for (const c of candidates) {
    if (lower.includes(c.toLowerCase())) return c;
  }
  return null;
}

export function ScopeClassification(args: { output: TaskOutput; expected: Record<string, unknown> }) {
  const { output, expected } = args;
  const exp = (expected.scope as string)?.toLowerCase();
  if (!exp) return { name: "ScopeClassification", score: 1, metadata: { reason: "no_expected_scope" } };

  const text = output?.raw_text || "";

  // 1. Explicit verdict line requested by the harness footer (deterministic)
  const verdict = extractScope(text);
  if (verdict) {
    return { name: "ScopeClassification", score: verdict === exp ? 1 : 0, metadata: { expected: exp, actual: verdict, source: "verdict_line" } };
  }

  // 2. Structured JSON output, if the model produced one
  if (output?.parsed?.scope) {
    const actual = output.parsed.scope.toLowerCase();
    return { name: "ScopeClassification", score: actual === exp ? 1 : 0, metadata: { expected: exp, actual, source: "json" } };
  }

  // 3. Last resort: keyword signals in prose
  if (!text) return { name: "ScopeClassification", score: 0, metadata: { reason: "no_output" } };

  const scopeSignals: Record<string, string[]> = {
    migrate: ["can be migrated", "ready to migrate", "migrates cleanly", "in scope", "straightforward migration"],
    excluded: ["exclude", "excluded", "cannot be migrated", "skip", "not migratable", "partial rollout", "live a/b", "live experiment", "adaptive", "disabled", "inactive", "conclude the experiment", "finish the experiment"],
    blocked: ["blocked", "cannot be translated", "no confidence equivalent", "unsupported", "no working", "manual review", "manual migration"],
    archived: ["archived", "skipped by default"],
  };

  const found = findInText(text, scopeSignals[exp] || []);
  return { name: "ScopeClassification", score: found ? 1 : 0, metadata: { expected: exp, found_signal: found, source: "text_fallback" } };
}

export function FlagShape(args: { output: TaskOutput; expected: Record<string, unknown> }) {
  const { output, expected } = args;
  const exp = (expected.flag_shape as string)?.toLowerCase();
  if (!exp) return { name: "FlagShape", score: 1, metadata: { reason: "no_expected_shape" } };

  // Shape only matters for flags that will actually be created in
  // Confidence — for excluded/blocked/archived flags the verdict is moot.
  const scope = (expected.scope as string)?.toLowerCase();
  if (scope && scope !== "migrate") {
    return { name: "FlagShape", score: 1, metadata: { reason: "not_applicable_non_migrate" } };
  }

  const text = output?.raw_text || "";

  // 1. Explicit verdict line (deterministic)
  const verdict = extractShape(text);
  if (verdict) {
    return { name: "FlagShape", score: verdict === exp ? 1 : 0, metadata: { expected: exp, actual: verdict, source: "verdict_line" } };
  }

  // 2. Structured JSON output
  if (output?.parsed?.flag_shape) {
    const actual = output.parsed.flag_shape.toLowerCase();
    return { name: "FlagShape", score: actual === exp ? 1 : 0, metadata: { expected: exp, actual, source: "json" } };
  }

  // 3. Keyword fallback
  if (!text) return { name: "FlagShape", score: 0, metadata: { reason: "no_output" } };

  const shapeSignals: Record<string, string[]> = {
    boolean: ["boolean", "on/off", "on and off", "on` and `off", "on or off", "enabled/disabled", "true/false", "two variations", "simple toggle"],
    struct: ["struct", "variable", "properties", "named variant", "custom-named", "variation key", "string property", "payload", "multivariate"],
  };

  const found = findInText(text, shapeSignals[exp] || []);
  return { name: "FlagShape", score: found ? 1 : 0, metadata: { expected: exp, found_signal: found, source: "text_fallback" } };
}
