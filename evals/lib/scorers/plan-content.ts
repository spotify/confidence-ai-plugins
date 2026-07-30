import type { TaskOutput } from "../types.js";

function stripFencedBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "");
}

export function PlanContent(args: { output: TaskOutput; expected: Record<string, unknown> }) {
  const { output, expected } = args;
  const text = output?.raw_text || "";
  if (!text) return { name: "PlanContent", score: 0, metadata: { reason: "no_output" } };

  const includes = (expected.plan_includes as string[]) || [];
  const excludes = (expected.plan_excludes as string[]) || [];

  if (includes.length === 0 && excludes.length === 0) {
    return { name: "PlanContent", score: 1, metadata: { reason: "no_assertions" } };
  }

  // plan_includes checks the full text (keywords should appear somewhere).
  // plan_excludes checks only prose (code blocks stripped) so that
  // targeting payloads in fenced JSON don't trigger false failures.
  const proseOnly = stripFencedBlocks(text);

  let passed = 0;
  let total = 0;
  const failures: string[] = [];

  for (const s of includes) {
    total++;
    if (text.toLowerCase().includes(s.toLowerCase())) {
      passed++;
    } else {
      failures.push(`missing: "${s}"`);
    }
  }

  for (const s of excludes) {
    total++;
    if (!proseOnly.toLowerCase().includes(s.toLowerCase())) {
      passed++;
    } else {
      failures.push(`should not contain: "${s}"`);
    }
  }

  return {
    name: "PlanContent",
    score: total > 0 ? passed / total : 1,
    metadata: { passed, total, failures },
  };
}
