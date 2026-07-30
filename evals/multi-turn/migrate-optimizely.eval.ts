import { Eval } from "braintrust";
import { loadMultiTurnScenarios } from "./loader.js";
import { runConversation } from "./driver.js";
import type { Scenario, Trace } from "./types.js";

interface TaskOutput {
  trace: Trace;
  error?: string;
}

Eval("confidence-ai-plugins", {
  projectId: "c78b488e-050d-4299-8442-c081455a3ac2",
  experimentName: "optimizely-multi-turn-v1",
  baseExperimentName: "optimizely-multi-turn-v1",
  maxConcurrency: 2,
  metadata: {
    model: process.env.EVAL_MODEL || "claude-sonnet-4-6",
    skill: "migrate-optimizely",
    eval_type: "multi_turn",
  },

  data: () => {
    const scenarios = loadMultiTurnScenarios("optimizely");
    return scenarios.map((s) => ({
      input: s,
      expected: { assertionCount: s.assertions.length },
      metadata: { name: s.name, description: s.description, tags: s.tags },
    }));
  },

  task: async (input: Scenario): Promise<TaskOutput> => {
    try {
      const trace = await runConversation(input);
      return { trace };
    } catch (e) {
      console.error(`[${input.name}] Error:`, e);
      return {
        trace: {
          messages: [],
          toolCalls: [],
          toolResults: [],
          textBlocks: [],
          result: { success: false, numTurns: 0, totalApiCalls: 0 },
        },
        error: (e as Error).message,
      };
    }
  },

  scores: [
    (args) => {
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
  ],
});

function summarizeToolCalls(trace: Trace): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const tc of trace.toolCalls) {
    const short = tc.name.replace("mcp__confidence_flags__", "");
    counts[short] = (counts[short] || 0) + 1;
  }
  return counts;
}
