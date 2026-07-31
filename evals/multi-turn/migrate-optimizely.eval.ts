import { Eval } from "braintrust";
import { loadMultiTurnScenarios } from "./loader.js";
import { runConversation } from "./driver.js";
import { multiTurnScores } from "./scores.js";
import type { TaskOutput } from "./scores.js";
import type { Scenario } from "./types.js";

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

  scores: multiTurnScores(),
});
