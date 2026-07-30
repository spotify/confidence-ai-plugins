import { Eval } from "braintrust";
import Anthropic from "@anthropic-ai/sdk";
import { buildDataset } from "./lib/loader.js";
import { loadSkillPrompt } from "./lib/skill-prompt.js";
import { CLASSIFICATION_FOOTER } from "./lib/classification-footer.js";
import { ScopeClassification, FlagShape } from "./lib/scorers/scope.js";
import { PlanContent } from "./lib/scorers/plan-content.js";
import { NamingRules } from "./lib/scorers/naming.js";
import { Tone, Visualization, Communication, EducateFirst } from "./lib/scorers/llm-judge.js";
import { TargetingResolution } from "./lib/scorers/targeting-resolution.js";
import type { TaskOutput, ParsedOutput } from "./lib/types.js";

const client = new Anthropic();
const SKILL_PROMPT = loadSkillPrompt("migrate-statsig");

function parseJsonFromText(text: string): ParsedOutput | null {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1].trim() : text.trim();
  try { return JSON.parse(candidate); } catch {
    const m = candidate.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
    return null;
  }
}

Eval("confidence-ai-plugins", {
  projectId: "c78b488e-050d-4299-8442-c081455a3ac2",
  experimentName: "statsig-full-skill-v1",
  baseExperimentName: "statsig-full-skill-v1",
  maxConcurrency: 3,
  metadata: { model: process.env.EVAL_MODEL || "claude-sonnet-4-6", skill: "migrate-statsig", eval_type: "full_skill" },
  data: () => buildDataset("statsig"),
  task: async (input: { user_message: string; flag: Record<string, unknown> }): Promise<TaskOutput> => {
    const flagJson = JSON.stringify(input.flag, null, 2);
    try {
      const response = await client.messages.create({
        model: process.env.EVAL_MODEL || "claude-sonnet-4-6", max_tokens: 8192, system: [{ type: "text" as const, text: SKILL_PROMPT, cache_control: { type: "ephemeral" as const } }],
        messages: [{ role: "user", content: `${input.user_message}\n\nFlag definition:\n${flagJson}${CLASSIFICATION_FOOTER}` }],
      });
      let raw_text = "";
      for (const block of response.content) {
        if ("text" in block && typeof (block as { text: unknown }).text === "string") raw_text += (block as { text: string }).text;
      }
      if (!raw_text) {
        for (const block of response.content) {
          if ("thinking" in block && typeof (block as { thinking: unknown }).thinking === "string") raw_text += (block as { thinking: string }).thinking;
        }
      }
      return { raw_text, parsed: parseJsonFromText(raw_text) };
    } catch (e) {
      console.error(`[${input.flag.key}] API error:`, e);
      return { raw_text: "", parsed: null };
    }
  },
  scores: [
    (args) => ScopeClassification({ output: args.output as TaskOutput, expected: args.expected as Record<string, unknown> }),
    (args) => FlagShape({ output: args.output as TaskOutput, expected: args.expected as Record<string, unknown> }),
    (args) => PlanContent({ output: args.output as TaskOutput, expected: args.expected as Record<string, unknown> }),
    (args) => NamingRules({ output: args.output as TaskOutput, expected: args.expected as Record<string, unknown> }),
    (args) => Tone({ output: args.output as TaskOutput }),
    (args) => Visualization({ output: args.output as TaskOutput, metadata: args.metadata as Record<string, unknown> }),
    (args) => Communication({ output: args.output as TaskOutput }),
    (args) => EducateFirst({ output: args.output as TaskOutput }),
    (args) => TargetingResolution({ output: args.output as TaskOutput, expected: args.expected as Record<string, unknown> }),
  ],
});
