import { Eval } from "braintrust";
import Anthropic from "@anthropic-ai/sdk";
import { buildInstrumentEventsDataset } from "./lib/instrument-events-dataset.js";
import { loadSkillPrompt } from "./lib/skill-prompt.js";
import {
  EntityReferenceRequired,
  ValidEventName,
  NoMetricCalculation,
  HintExploreMetric,
  DomainRelevance,
  EntityRefOnCorrectField,
  UsesAskUserQuestion,
} from "./lib/scorers/instrument-events.js";
import { Tone, Visualization, EducateFirst } from "./lib/scorers/llm-judge.js";
import { ResponseContent, NoInternalLeak } from "./lib/scorers/onboard.js";
import type { TaskOutput } from "./lib/types.js";

const client = new Anthropic();
const SKILL_PROMPT = loadSkillPrompt("instrument-events");

Eval("confidence-ai-plugins", {
  projectId: "c78b488e-050d-4299-8442-c081455a3ac2",
  experimentName: "instrument-events-v1",
  baseExperimentName: "instrument-events-v1",
  maxConcurrency: 3,
  metadata: {
    model: process.env.EVAL_MODEL || "claude-sonnet-4-6",
    skill: "instrument-events",
    eval_type: "single_turn",
  },
  data: () => buildInstrumentEventsDataset(),
  task: async (input: { user_message: string; context?: string }): Promise<TaskOutput> => {
    const context = input.context ? `\n\nContext (from prior tool calls and project analysis):\n${input.context.trim()}\n\n` : "";
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
      console.error(`[instrument-events] API error:`, e);
      return { raw_text: "", parsed: null };
    }
  },
  scores: [
    (args) => EntityReferenceRequired({ output: args.output as TaskOutput }),
    (args) => ValidEventName({ output: args.output as TaskOutput }),
    (args) => NoMetricCalculation({ output: args.output as TaskOutput }),
    (args) => HintExploreMetric({ output: args.output as TaskOutput }),
    (args) => DomainRelevance({ output: args.output as TaskOutput }),
    (args) => EntityRefOnCorrectField({ output: args.output as TaskOutput }),
    (args) => UsesAskUserQuestion({ output: args.output as TaskOutput }),
    (args) => ResponseContent({ output: args.output as TaskOutput, expected: args.expected as Record<string, unknown> }),
    (args) => NoInternalLeak({ output: args.output as TaskOutput }),
    (args) => Tone({ output: args.output as TaskOutput }),
    (args) => Visualization({ output: args.output as TaskOutput, metadata: args.metadata as Record<string, unknown> }),
    (args) => EducateFirst({ output: args.output as TaskOutput }),
  ],
});
