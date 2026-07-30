import type { TaskOutput } from "../types.js";

const FLAG_NAME_RE = /flag[:\s]+[`"']?([a-z0-9_-]+)[`"']?/gi;
const VALID_FLAG_NAME = /^[a-z0-9-]+$/;

export function NamingRules(args: { output: TaskOutput; expected: Record<string, unknown> }) {
  const text = args.output?.raw_text || "";
  if (!text) return { name: "NamingRules", score: 0, metadata: { reason: "no_output" } };

  const flagNames: string[] = [];
  let match;
  while ((match = FLAG_NAME_RE.exec(text)) !== null) {
    flagNames.push(match[1]);
  }

  if (flagNames.length === 0) {
    return { name: "NamingRules", score: 1, metadata: { reason: "no_flag_names_found" } };
  }

  const violations = flagNames.filter((n) => !VALID_FLAG_NAME.test(n));

  return {
    name: "NamingRules",
    score: violations.length === 0 ? 1 : 1 - violations.length / flagNames.length,
    metadata: { flag_names: flagNames, violations },
  };
}
