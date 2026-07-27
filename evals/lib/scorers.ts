import type { GroundTruth, EvalOutput } from "./types.js";

interface ScorerArgs {
  input: unknown;
  output: EvalOutput | null;
  expected: GroundTruth;
}

function safe(fn: (args: ScorerArgs) => { name: string; score: number; metadata?: Record<string, unknown> }) {
  return (args: ScorerArgs) => {
    try {
      return fn(args);
    } catch (e) {
      return { name: fn.name || "unknown", score: 0, metadata: { error: String(e) } };
    }
  };
}

export const ScopeClassification = safe(({ output, expected }: ScorerArgs) => {
  if (!output) return { name: "ScopeClassification", score: 0, metadata: { reason: "no_output" } };
  const actual = output.scope?.toLowerCase();
  const exp = expected.scope;
  return {
    name: "ScopeClassification",
    score: actual === exp ? 1 : 0,
    metadata: { expected: exp, actual },
  };
});

export const BlockedDetection = safe(({ output, expected }: ScorerArgs) => {
  if (!output) return { name: "BlockedDetection", score: 0 };
  if (expected.scope !== "blocked") {
    return { name: "BlockedDetection", score: 1, metadata: { reason: "not_applicable" } };
  }
  const actualScope = output.scope?.toLowerCase();
  if (actualScope !== "blocked") {
    return { name: "BlockedDetection", score: 0, metadata: { reason: "missed_blocked", expected_reason: expected.blocked_reason } };
  }
  const actualReason = output.blocked_reason?.toLowerCase() || "";
  const expectedReason = expected.blocked_reason?.toLowerCase() || "";
  if (actualReason.includes(expectedReason) || expectedReason.includes(actualReason)) {
    return { name: "BlockedDetection", score: 1 };
  }
  const bothMentionSameCategory =
    (actualReason.includes("substring") && expectedReason.includes("substring")) ||
    (actualReason.includes("exist") && expectedReason.includes("exist")) ||
    (actualReason.includes("regex") && expectedReason.includes("regex")) ||
    (actualReason.includes("browser") && expectedReason.includes("browser")) ||
    (actualReason.includes("custom_attribute") && expectedReason.includes("custom_attribute"));

  return {
    name: "BlockedDetection",
    score: bothMentionSameCategory ? 1 : 0.5,
    metadata: { expected_reason: expectedReason, actual_reason: actualReason },
  };
});

export const FlagShape = safe(({ output, expected }: ScorerArgs) => {
  if (!output) return { name: "FlagShape", score: 0 };
  return {
    name: "FlagShape",
    score: output.flag_shape?.toLowerCase() === expected.flag_shape ? 1 : 0,
    metadata: { expected: expected.flag_shape, actual: output.flag_shape },
  };
});

export const BackendSelection = safe(({ output, expected }: ScorerArgs) => {
  if (!output) return { name: "BackendSelection", score: 0 };
  if (expected.scope !== "migrate") {
    return { name: "BackendSelection", score: 1, metadata: { reason: "not_applicable" } };
  }
  const actual = output.backend?.toUpperCase();
  const exp = expected.backend?.toUpperCase();
  return {
    name: "BackendSelection",
    score: actual === exp ? 1 : 0,
    metadata: { expected: exp, actual },
  };
});

export const TargetingPayloadStructure = safe(({ output, expected }: ScorerArgs) => {
  if (!output) return { name: "TargetingPayloadStructure", score: 0 };
  if (expected.scope !== "migrate") {
    return { name: "TargetingPayloadStructure", score: 1, metadata: { reason: "not_applicable" } };
  }

  const rules = output.targeting_rules;
  if (!rules || !Array.isArray(rules) || rules.length === 0) {
    return { name: "TargetingPayloadStructure", score: 0, metadata: { reason: "no_targeting_rules" } };
  }

  let subscores = 0;
  let total = 0;

  for (const rule of rules) {
    const r = rule as Record<string, unknown>;
    total++;
    if (r.variantAllocations && typeof r.variantAllocations === "object") {
      const allocs = r.variantAllocations as Record<string, number>;
      const sum = Object.values(allocs).reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 100) <= 1) subscores++;
    }
  }

  const hasCatchAll = rules.some((r: unknown) => {
    const rule = r as Record<string, unknown>;
    return !rule.payload || (typeof rule.payload === "object" && Object.keys(rule.payload as object).length === 0);
  });
  if (hasCatchAll) {
    total++;
    subscores++;
  } else {
    total++;
  }

  return {
    name: "TargetingPayloadStructure",
    score: total > 0 ? subscores / total : 0,
    metadata: { rules_count: rules.length, valid_allocations: subscores, has_catch_all: hasCatchAll },
  };
});
