import { Eval } from "braintrust";
import Anthropic from "@anthropic-ai/sdk";
import { buildOnboardDataset } from "./lib/loader.js";
import { loadSkillPrompt } from "./lib/skill-prompt.js";
import { ONBOARD_FOOTER } from "./lib/onboard-footer.js";
import { NextStep, ResponseContent, NoInternalLeak } from "./lib/scorers/onboard.js";
import { OnboardCommunication, OnboardEducateFirst, OnboardStepTracker } from "./lib/scorers/onboard-judges.js";
import type { TaskOutput } from "./lib/types.js";

const client = new Anthropic();
const SKILL_PROMPT = loadSkillPrompt("onboard-confidence");

Eval("confidence-ai-plugins", {
  projectId: "c78b488e-050d-4299-8442-c081455a3ac2",
  experimentName: "onboard-single-turn-v1",
  baseExperimentName: "onboard-single-turn-v1",
  maxConcurrency: 3,
  metadata: { model: process.env.EVAL_MODEL || "claude-sonnet-4-6", skill: "onboard-confidence", eval_type: "single_turn" },
  data: () => buildOnboardDataset(),
  task: async (input: { user_message: string; context?: string }): Promise<TaskOutput> => {
    const context = input.context ? `${input.context.trim()}\n\n` : "";
    try {
      const response = await client.messages.create({
        model: process.env.EVAL_MODEL || "claude-sonnet-4-6",
        max_tokens: 8192,
        system: [{ type: "text" as const, text: SKILL_PROMPT, cache_control: { type: "ephemeral" as const } }],
        messages: [{ role: "user", content: `${context}${input.user_message}${ONBOARD_FOOTER}` }],
      });
      let raw_text = "";
      for (const block of response.content) {
        if ("text" in block && typeof (block as { text: unknown }).text === "string") raw_text += (block as { text: string }).text;
      }
      return { raw_text, parsed: null };
    } catch (e) {
      console.error(`[onboard single-turn] API error:`, e);
      return { raw_text: "", parsed: null };
    }
  },
  scores: [
    (args) => NextStep({ output: args.output as TaskOutput, expected: args.expected as Record<string, unknown> }),
    (args) => ResponseContent({ output: args.output as TaskOutput, expected: args.expected as Record<string, unknown> }),
    (args) => NoInternalLeak({ output: args.output as TaskOutput }),
    (args) => OnboardCommunication({ output: args.output as TaskOutput }),
    (args) => OnboardEducateFirst({ output: args.output as TaskOutput }),
    (args) => OnboardStepTracker({ output: args.output as TaskOutput, metadata: args.metadata as Record<string, unknown> }),
  ],
});
