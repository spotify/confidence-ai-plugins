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
  experimentName: "statsig-multi-turn-v1",
  baseExperimentName: "statsig-multi-turn-v1",
  maxConcurrency: 2,
  metadata: {
    model: process.env.EVAL_MODEL || "claude-sonnet-4-6",
    skill: "migrate-statsig",
    eval_type: "multi_turn",
  },

  data: () => {
    const scenarios = loadMultiTurnScenarios("statsig");
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
        trace: { messages: [], toolCalls: [], toolResults: [], textBlocks: [], result: { success: false, numTurns: 0, totalApiCalls: 0 } },
        error: (e as Error).message,
      };
    }
  },

  scores: [
    (args) => {
      const { trace, error } = args.output as TaskOutput;
      const scenario = args.input as Scenario;
      if (error) return { name: "AssertionsPassed", score: 0, metadata: { error } };
      const results = scenario.assertions.map((a) => a(trace));
      const passed = results.filter((r) => r.passed).length;
      const total = results.length;
      return {
        name: "AssertionsPassed",
        score: total > 0 ? passed / total : 1,
        metadata: { passed, total, results: results.map((r) => ({ name: r.assertionName, passed: r.passed, message: r.message })), numTurns: trace.result.numTurns, totalApiCalls: trace.result.totalApiCalls },
      };
    },
  ],
});
