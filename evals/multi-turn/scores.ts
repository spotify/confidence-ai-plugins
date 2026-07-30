import type { Scenario, Trace } from "./types.js";

export interface TaskOutput {
  trace: Trace;
  error?: string;
}

function summarizeToolCalls(trace: Trace): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const tc of trace.toolCalls) {
    const short = tc.name.replace("mcp__confidence_flags__", "");
    counts[short] = (counts[short] || 0) + 1;
  }
  return counts;
}

export function multiTurnScores() {
  return [
    (args: Record<string, unknown>) => {
      const { trace, error } = args.output as TaskOutput;
      const scenario = args.input as Scenario;

      if (error) {
        return { name: "AssertionsPassed", score: 0, metadata: { error } };
      }

      const results = scenario.assertions.map((a) => a(trace));
      const passed = results.filter((r) => r.passed).length;
      const total = results.length;

      return {
        name: "AssertionsPassed",
        score: total > 0 ? passed / total : 1,
        metadata: {
          passed,
          total,
          results: results.map((r) => ({
            name: r.assertionName,
            passed: r.passed,
            message: r.message,
          })),
          numTurns: trace.result.numTurns,
          totalApiCalls: trace.result.totalApiCalls,
          toolCallsSummary: summarizeToolCalls(trace),
        },
      };
    },
  ];
}
