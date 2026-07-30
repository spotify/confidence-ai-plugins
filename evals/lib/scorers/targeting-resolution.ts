import type { TaskOutput } from "../types.js";
import { resolve } from "../resolver.js";
import type { TargetingRule, CatchAll } from "../resolver.js";

interface TargetingPayload {
  targeting_rules: TargetingRule[];
  catch_all?: CatchAll;
}

interface Resolution {
  context: Record<string, unknown>;
  variant: string;
}

const POSITIVE_VARIANTS = new Set(["on", "enabled", "true"]);
const NEGATIVE_VARIANTS = new Set(["off", "disabled", "false"]);

function normalizeVariant(v: string): string {
  const lower = v.toLowerCase();
  if (POSITIVE_VARIANTS.has(lower)) return "on";
  if (NEGATIVE_VARIANTS.has(lower)) return "off";
  return lower;
}

function extractTargetingPayload(text: string): TargetingPayload | null {
  // Look for a fenced block tagged "targeting" or "targeting-json"
  const taggedMatch = text.match(/```(?:targeting-json|targeting)\s*([\s\S]*?)```/);
  if (taggedMatch) {
    try {
      return JSON.parse(taggedMatch[1].trim());
    } catch { /* fall through */ }
  }

  // Fall back to any fenced JSON block containing "targeting_rules"
  const jsonBlocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  for (const m of jsonBlocks) {
    const candidate = m[1].trim();
    if (candidate.includes("targeting_rules")) {
      try {
        return JSON.parse(candidate);
      } catch { /* try next block */ }
    }
  }

  // Last resort: bare JSON object with targeting_rules
  const bareMatch = text.match(/\{[\s\S]*"targeting_rules"[\s\S]*\}/);
  if (bareMatch) {
    try {
      return JSON.parse(bareMatch[0]);
    } catch { /* give up */ }
  }

  return null;
}

export function TargetingResolution(args: {
  output: TaskOutput;
  expected: Record<string, unknown>;
}) {
  const { output, expected } = args;
  const scope = (expected.scope as string)?.toLowerCase();

  if (scope !== "migrate") {
    return {
      name: "TargetingResolution",
      score: 1,
      metadata: { reason: "not_applicable_non_migrate" },
    };
  }

  const resolutions = expected.resolutions as Resolution[] | undefined;
  if (!resolutions || resolutions.length === 0) {
    return {
      name: "TargetingResolution",
      score: 1,
      metadata: { reason: "no_resolution_expectations" },
    };
  }

  const text = output?.raw_text || "";
  if (!text) {
    return {
      name: "TargetingResolution",
      score: 0,
      metadata: { reason: "no_output" },
    };
  }

  const payload = extractTargetingPayload(text);
  if (!payload) {
    return {
      name: "TargetingResolution",
      score: 0,
      metadata: { reason: "no_targeting_payload_found" },
    };
  }

  let passed = 0;
  const failures: string[] = [];
  const details: Array<{
    context: Record<string, unknown>;
    expected: string;
    actual: string;
    match: boolean;
  }> = [];

  for (const res of resolutions) {
    try {
      const result = resolve(payload.targeting_rules, payload.catch_all, res.context);

      const expectedNorm = normalizeVariant(res.variant);

      if (result.isProbabilistic) {
        const matchingRule = payload.targeting_rules[result.ruleIndex];
        const allocatedVariants = Object.keys(matchingRule.variantAllocations).map(normalizeVariant);
        const match = allocatedVariants.includes(expectedNorm);
        if (match) passed++;
        else failures.push(`context ${JSON.stringify(res.context)}: expected "${res.variant}" to be in allocations [${allocatedVariants.join(", ")}]`);
        details.push({ context: res.context, expected: res.variant, actual: `split(${allocatedVariants.join(",")})`, match });
      } else {
        const actualNorm = normalizeVariant(result.variant);
        const match = actualNorm === expectedNorm;
        if (match) passed++;
        else failures.push(`context ${JSON.stringify(res.context)}: expected "${res.variant}" (${expectedNorm}), got "${result.variant}" (${actualNorm})`);
        details.push({ context: res.context, expected: res.variant, actual: result.variant, match });
      }
    } catch (e) {
      failures.push(`context ${JSON.stringify(res.context)}: resolver error: ${(e as Error).message}`);
      details.push({ context: res.context, expected: res.variant, actual: `ERROR: ${(e as Error).message}`, match: false });
    }
  }

  return {
    name: "TargetingResolution",
    score: resolutions.length > 0 ? passed / resolutions.length : 1,
    metadata: { passed, total: resolutions.length, failures, details },
  };
}
