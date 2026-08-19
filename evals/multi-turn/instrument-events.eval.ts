import { Eval } from "braintrust";
import { loadMultiTurnScenarios } from "./loader.js";
import { runConversation } from "./driver.js";
import { instrumentEventsMultiTurnScores } from "./instrument-events-scores.js";
import type { Scenario } from "./types.js";

interface TaskOutput {
  trace: import("./types.js").Trace;
  error?: string;
}

Eval("confidence-ai-plugins", {
  projectId: "c78b488e-050d-4299-8442-c081455a3ac2",
  experimentName: "instrument-events-multi-turn-v1",
  baseExperimentName: "instrument-events-multi-turn-v1",
  maxConcurrency: 2,
  metadata: {
    model: process.env.EVAL_MODEL || "claude-sonnet-4-6",
    skill: "instrument-events",
    eval_type: "multi_turn",
  },

  data: () => {
    const scenarios = loadMultiTurnScenarios("instrument-events");
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

  scores: instrumentEventsMultiTurnScores(),
});
