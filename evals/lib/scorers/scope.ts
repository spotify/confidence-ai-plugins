import type { TaskOutput } from "../types.js";

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

  if (output?.parsed?.scope) {
    const actual = output.parsed.scope.toLowerCase();
    return { name: "ScopeClassification", score: actual === exp ? 1 : 0, metadata: { expected: exp, actual, source: "json" } };
  }

  const text = output?.raw_text || "";
  if (!text) return { name: "ScopeClassification", score: 0, metadata: { reason: "no_output" } };

  const scopeSignals: Record<string, string[]> = {
    migrate: ["migrate", "migratable", "can be migrated", "ready to migrate", "in scope"],
    excluded: ["exclude", "excluded", "cannot be migrated", "skip", "not migratable", "partial rollout", "live a/b", "adaptive", "disabled"],
    blocked: ["blocked", "cannot be translated", "no confidence equivalent", "unsupported", "no working"],
    archived: ["archived", "skipped", "hidden"],
  };

  const signals = scopeSignals[exp] || [];
  const found = findInText(text, signals);

  return {
    name: "ScopeClassification",
    score: found ? 1 : 0,
    metadata: { expected: exp, found_signal: found, source: "text" },
  };
}

export function FlagShape(args: { output: TaskOutput; expected: Record<string, unknown> }) {
  const { output, expected } = args;
  const exp = (expected.flag_shape as string)?.toLowerCase();
  if (!exp) return { name: "FlagShape", score: 1, metadata: { reason: "no_expected_shape" } };

  if (output?.parsed?.flag_shape) {
    const actual = output.parsed.flag_shape.toLowerCase();
    return { name: "FlagShape", score: actual === exp ? 1 : 0, metadata: { expected: exp, actual, source: "json" } };
  }

  const text = output?.raw_text || "";
  if (!text) return { name: "FlagShape", score: 0, metadata: { reason: "no_output" } };

  const shapeSignals: Record<string, string[]> = {
    boolean: ["boolean", "on/off", "on and off", "on` and `off", "on or off", "enabled/disabled", "true/false", "two variations", "variations `on`", "variations: on"],
    struct: ["struct", "variable", "properties", "named variant", "custom-named", "sort_algorithm", "variant_a", "variant_b", "variation key", "string property"],
  };

  const signals = shapeSignals[exp] || [];
  const found = findInText(text, signals);

  return {
    name: "FlagShape",
    score: found ? 1 : 0,
    metadata: { expected: exp, found_signal: found, source: "text" },
  };
}
