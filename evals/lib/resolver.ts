/**
 * Local Confidence targeting-rule resolver.
 *
 * Evaluates criteria + expression payloads against a context map,
 * then walks the rule waterfall to determine which variant resolves.
 * No network, no MCP — pure logic mirroring the Confidence resolver's
 * deterministic matching (bucketing/hashing is NOT modelled).
 */

// ── Value extraction ────────────────────────────────────────────────

type ConfidenceValue =
  | { stringValue: string }
  | { numberValue: number }
  | { boolValue: boolean }
  | { versionValue: { version: string } }
  | { timestampValue: string };

function unwrapValue(v: ConfidenceValue): string | number | boolean {
  if ("stringValue" in v) return v.stringValue;
  if ("numberValue" in v) return v.numberValue;
  if ("boolValue" in v) return v.boolValue;
  if ("versionValue" in v) return v.versionValue.version;
  if ("timestampValue" in v) return v.timestampValue;
  throw new Error(`unknown value shape: ${JSON.stringify(v)}`);
}

function parseVersion(s: string): number[] {
  return String(s).split("-")[0].split(".").map(Number);
}

function compareVersions(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function isVersionValue(v: Record<string, unknown>): boolean {
  return "versionValue" in v;
}

// ── Criterion evaluation ────────────────────────────────────────────

interface Criterion {
  attribute: {
    attributeName: string;
    eqRule?: { value: ConfidenceValue };
    setRule?: { values: ConfidenceValue[] };
    rangeRule?: {
      startInclusive?: ConfidenceValue;
      startExclusive?: ConfidenceValue;
      endInclusive?: ConfidenceValue;
      endExclusive?: ConfidenceValue;
    };
    startsWithRule?: { value: string };
    endsWithRule?: { value: string };
    anyRule?: { rule: Record<string, unknown> };
    allRule?: { rule: Record<string, unknown> };
  };
}

type Context = Record<string, unknown>;

function evalCriterion(criterion: Criterion, ctx: Context): boolean {
  const attr = criterion.attribute;
  const ctxValue = ctx[attr.attributeName];

  if (attr.eqRule) {
    if (ctxValue === undefined || ctxValue === null) return false;
    const target = unwrapValue(attr.eqRule.value);
    return ctxValue === target;
  }

  if (attr.setRule) {
    if (ctxValue === undefined || ctxValue === null) return false;
    const targets = attr.setRule.values.map(unwrapValue);
    return targets.includes(ctxValue as string | number | boolean);
  }

  if (attr.rangeRule) {
    if (ctxValue === undefined || ctxValue === null) return false;
    const rule = attr.rangeRule;
    const useVersion =
      (rule.startInclusive && isVersionValue(rule.startInclusive as Record<string, unknown>)) ||
      (rule.startExclusive && isVersionValue(rule.startExclusive as Record<string, unknown>)) ||
      (rule.endInclusive && isVersionValue(rule.endInclusive as Record<string, unknown>)) ||
      (rule.endExclusive && isVersionValue(rule.endExclusive as Record<string, unknown>));

    if (useVersion) {
      const v = parseVersion(String(ctxValue));
      if (rule.startInclusive) {
        const bound = parseVersion(String(unwrapValue(rule.startInclusive)));
        if (compareVersions(v, bound) < 0) return false;
      }
      if (rule.startExclusive) {
        const bound = parseVersion(String(unwrapValue(rule.startExclusive)));
        if (compareVersions(v, bound) <= 0) return false;
      }
      if (rule.endInclusive) {
        const bound = parseVersion(String(unwrapValue(rule.endInclusive)));
        if (compareVersions(v, bound) > 0) return false;
      }
      if (rule.endExclusive) {
        const bound = parseVersion(String(unwrapValue(rule.endExclusive)));
        if (compareVersions(v, bound) >= 0) return false;
      }
      return true;
    }

    const v = Number(ctxValue);
    if (rule.startInclusive && v < Number(unwrapValue(rule.startInclusive))) return false;
    if (rule.startExclusive && v <= Number(unwrapValue(rule.startExclusive))) return false;
    if (rule.endInclusive && v > Number(unwrapValue(rule.endInclusive))) return false;
    if (rule.endExclusive && v >= Number(unwrapValue(rule.endExclusive))) return false;
    return true;
  }

  if (attr.startsWithRule) {
    if (ctxValue === undefined || ctxValue === null) return false;
    return String(ctxValue).startsWith(attr.startsWithRule.value);
  }

  if (attr.endsWithRule) {
    if (ctxValue === undefined || ctxValue === null) return false;
    return String(ctxValue).endsWith(attr.endsWithRule.value);
  }

  if (attr.anyRule) {
    if (ctxValue === undefined || ctxValue === null) return false;
    if (!Array.isArray(ctxValue)) return false;
    const innerRule = attr.anyRule.rule;
    return ctxValue.some((item) =>
      evalCriterion({ attribute: { attributeName: "__item", ...innerRule } } as Criterion, { __item: item }),
    );
  }

  if (attr.allRule) {
    if (ctxValue === undefined || ctxValue === null) return true;
    if (!Array.isArray(ctxValue)) return true;
    const innerRule = attr.allRule.rule;
    return ctxValue.every((item) =>
      evalCriterion({ attribute: { attributeName: "__item", ...innerRule } } as Criterion, { __item: item }),
    );
  }

  throw new Error(`no recognized rule in criterion for "${attr.attributeName}"`);
}

// ── Expression evaluation ───────────────────────────────────────────

interface Expression {
  ref?: string;
  and?: { operands: Expression[] };
  or?: { operands: Expression[] };
  not?: Expression;
}

function evalExpression(
  expr: Expression,
  criteria: Record<string, Criterion>,
  ctx: Context,
): boolean {
  if (expr.ref !== undefined) {
    const criterion = criteria[expr.ref];
    if (!criterion) throw new Error(`unknown criterion ref "${expr.ref}"`);
    return evalCriterion(criterion, ctx);
  }
  if (expr.and) {
    return expr.and.operands.every((op) => evalExpression(op, criteria, ctx));
  }
  if (expr.or) {
    return expr.or.operands.some((op) => evalExpression(op, criteria, ctx));
  }
  if (expr.not) {
    return !evalExpression(expr.not, criteria, ctx);
  }
  throw new Error(`unrecognized expression shape: ${JSON.stringify(expr)}`);
}

// ── Rule matching ───────────────────────────────────────────────────

export interface TargetingRule {
  targetingKey?: string;
  payload?: {
    criteria: Record<string, Criterion>;
    expression: Expression;
  };
  variantAllocations: Record<string, number>;
}

export interface CatchAll {
  variant: string;
  allocation: number;
}

export interface ResolveResult {
  variant: string;
  ruleIndex: number;
  isCatchAll: boolean;
  isProbabilistic: boolean;
}

/**
 * Resolve a set of targeting rules against a context.
 * Returns the variant from the first matching rule.
 * A rule with no payload (empty/missing criteria) matches all contexts (catch-all).
 */
export function resolve(
  rules: TargetingRule[],
  catchAll: CatchAll | undefined,
  ctx: Context,
): ResolveResult {
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    let matches = true;

    if (rule.payload && rule.payload.criteria && rule.payload.expression) {
      const hasCriteria = Object.keys(rule.payload.criteria).length > 0;
      if (hasCriteria) {
        matches = evalExpression(rule.payload.expression, rule.payload.criteria, ctx);
      }
    }

    if (matches) {
      const allocations = rule.variantAllocations;
      const variants = Object.keys(allocations);
      const singleVariant = variants.length === 1 || variants.some((v) => allocations[v] === 100);

      if (singleVariant) {
        const winner = variants.find((v) => allocations[v] === 100) || variants[0];
        return { variant: winner, ruleIndex: i, isCatchAll: false, isProbabilistic: false };
      }

      // Multi-variant split — we can't determine which variant without bucketing.
      // Return the first variant but mark as probabilistic.
      return { variant: variants[0], ruleIndex: i, isCatchAll: false, isProbabilistic: true };
    }
  }

  if (catchAll) {
    return { variant: catchAll.variant, ruleIndex: -1, isCatchAll: true, isProbabilistic: false };
  }

  return { variant: "__no_match", ruleIndex: -1, isCatchAll: false, isProbabilistic: false };
}
