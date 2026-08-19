import { Eval } from "braintrust";
import Anthropic from "@anthropic-ai/sdk";
import { buildExploreMetricDataset } from "./lib/explore-metric-dataset.js";
import { loadSkillPrompt } from "./lib/skill-prompt.js";
import {
  ValidExplorerURL,
  CorrectKindMapping,
  ExposureTableEntityMatch,
  ExplainsNoFactTable,
} from "./lib/scorers/explore-metric.js";
import { Tone } from "./lib/scorers/llm-judge.js";
import { NoInternalLeak } from "./lib/scorers/onboard.js";
import type { TaskOutput } from "./lib/types.js";

const client = new Anthropic();
const SKILL_PROMPT = loadSkillPrompt("explore-metric");

Eval("confidence-ai-plugins", {
  projectId: "c78b488e-050d-4299-8442-c081455a3ac2",
  experimentName: "explore-metric-v1",
  baseExperimentName: "explore-metric-v1",
  maxConcurrency: 3,
  metadata: {
    model: process.env.EVAL_MODEL || "claude-sonnet-4-6",
    skill: "explore-metric",
    eval_type: "single_turn",
  },
  data: () => buildExploreMetricDataset(),
  task: async (input: { user_message: string; context?: string }): Promise<TaskOutput> => {
    const context = input.context ? `\n\nContext (from prior MCP tool calls):\n${input.context.trim()}\n\n` : "";
    try {
      const response = await client.messages.create({
        model: process.env.EVAL_MODEL || "claude-sonnet-4-6",
        max_tokens: 8192,
        system: [{ type: "text" as const, text: SKILL_PROMPT, cache_control: { type: "ephemeral" as const } }],
        messages: [{ role: "user", content: `${context}${input.user_message}` }],
      });
      let raw_text = "";
      for (const block of response.content) {
        if ("text" in block && typeof (block as { text: unknown }).text === "string") raw_text += (block as { text: string }).text;
      }
      return { raw_text, parsed: null };
    } catch (e) {
      console.error(`[explore-metric] API error:`, e);
      return { raw_text: "", parsed: null };
    }
  },
  scores: [
    (args) => ValidExplorerURL({ output: args.output as TaskOutput }),
    (args) => CorrectKindMapping({ output: args.output as TaskOutput, expected: args.expected as Record<string, unknown> }),
    (args) => ExposureTableEntityMatch({ output: args.output as TaskOutput, expected: args.expected as Record<string, unknown> }),
    (args) => ExplainsNoFactTable({ output: args.output as TaskOutput, metadata: args.metadata as Record<string, unknown> }),
    (args) => NoInternalLeak({ output: args.output as TaskOutput }),
    (args) => Tone({ output: args.output as TaskOutput }),
  ],
});
