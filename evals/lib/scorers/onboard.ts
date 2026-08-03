import type { TaskOutput } from "../types.js";
import { extractNextStep } from "../onboard-footer.js";

function stripFencedBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "");
}

/**
 * Deterministic: the `Next step:` verdict line matches the case's expected
 * pattern. Cases without a pattern are not scored on this dimension.
 */
export function NextStep(args: { output: TaskOutput; expected: Record<string, unknown> }) {
  const pattern = args.expected.next_step_pattern as string | undefined;
  if (!pattern) return { name: "NextStep", score: 1, metadata: { reason: "no_expected_pattern" } };

  const text = args.output?.raw_text || "";
  if (!text) return { name: "NextStep", score: 0, metadata: { reason: "no_output" } };

  const nextStep = extractNextStep(text);
  if (!nextStep) return { name: "NextStep", score: 0, metadata: { reason: "verdict_line_missing" } };

  const matched = new RegExp(pattern, "i").test(nextStep);
  return {
    name: "NextStep",
    score: matched ? 1 : 0,
    metadata: { expected_pattern: pattern, actual: nextStep },
  };
}

/**
 * Deterministic content checks, like PlanContent but with an "any of"
 * variant for wording that legitimately varies:
 * - response_includes: every string must appear (full text)
 * - response_includes_any: at least one string must appear (full text)
 * - response_excludes: none may appear in prose (fenced blocks stripped)
 */
export function ResponseContent(args: { output: TaskOutput; expected: Record<string, unknown> }) {
  const text = args.output?.raw_text || "";
  if (!text) return { name: "ResponseContent", score: 0, metadata: { reason: "no_output" } };

  const includes = (args.expected.response_includes as string[]) || [];
  const includesAny = (args.expected.response_includes_any as string[]) || [];
  const excludes = (args.expected.response_excludes as string[]) || [];

  if (includes.length === 0 && includesAny.length === 0 && excludes.length === 0) {
    return { name: "ResponseContent", score: 1, metadata: { reason: "no_assertions" } };
  }

  const lower = text.toLowerCase();
  const proseLower = stripFencedBlocks(text).toLowerCase();

  let passed = 0;
  let total = 0;
  const failures: string[] = [];

  for (const s of includes) {
    total++;
    if (lower.includes(s.toLowerCase())) passed++;
    else failures.push(`missing: "${s}"`);
  }

  if (includesAny.length > 0) {
    total++;
    if (includesAny.some((s) => lower.includes(s.toLowerCase()))) passed++;
    else failures.push(`missing all of: ${includesAny.map((s) => `"${s}"`).join(", ")}`);
  }

  for (const s of excludes) {
    total++;
    if (!proseLower.includes(s.toLowerCase())) passed++;
    else failures.push(`should not contain: "${s}"`);
  }

  return {
    name: "ResponseContent",
    score: total > 0 ? passed / total : 1,
    metadata: { passed, total, failures },
  };
}

/** Never allowed anywhere in a user-visible response. */
const HARD_LEAKS = [
  "82qMvwZvqd3t3S0gRDvs8R53TehQXSJY",
  "2fG3H4RhlAbIZm9Rfn32zTaILH7w1X4w",
  "eyJ", // JWT fragment
  "Bearer ",
];

/** Not allowed in conversational prose (fenced blocks stripped first). */
const PROSE_LEAKS = [
  "org_id",
  "curl ",
  "auth.py",
  "$TMPDIR",
  "dangerouslyDisableSandbox",
  "telemetry",
  "mcp__confidence",
];

/**
 * Deterministic denylist for the skill's User-Facing Communication Rules —
 * tokens, OAuth internals, and infrastructure jargon must never reach the
 * user. Per-case additions go in response_excludes.
 */
export function NoInternalLeak(args: { output: TaskOutput }) {
  const text = args.output?.raw_text || "";
  if (!text) return { name: "NoInternalLeak", score: 0, metadata: { reason: "no_output" } };

  const prose = stripFencedBlocks(text).toLowerCase();
  const failures: string[] = [];

  for (const s of HARD_LEAKS) {
    if (text.toLowerCase().includes(s.toLowerCase())) failures.push(`hard leak: "${s}"`);
  }
  for (const s of PROSE_LEAKS) {
    if (prose.includes(s.toLowerCase())) failures.push(`prose leak: "${s}"`);
  }

  // Binary: any leak is a failure — a fractional score would let a single
  // leaked token slip past the ≥90% quality gate.
  return {
    name: "NoInternalLeak",
    score: failures.length === 0 ? 1 : 0,
    metadata: { failures },
  };
}
