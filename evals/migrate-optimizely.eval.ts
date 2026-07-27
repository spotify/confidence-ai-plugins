import { Eval } from "braintrust";
import Anthropic from "@anthropic-ai/sdk";
import { buildDataset } from "./lib/fixtures.js";
import { SYSTEM_PROMPT } from "./lib/system-prompt.js";
import {
  ScopeClassification,
  BlockedDetection,
  FlagShape,
  BackendSelection,
  TargetingPayloadStructure,
} from "./lib/scorers.js";
import type { EvalOutput, GroundTruth } from "./lib/types.js";

const HENDRIX_BASE_URL = process.env.HENDRIX_BASE_URL || "https://hendrix-genai.spotify.net/taskforce/glm-5-2";
const HENDRIX_API_KEY = process.env.HENDRIX_API_KEY || process.env.ANTHROPIC_API_KEY || "";

const client = new Anthropic({
  apiKey: HENDRIX_API_KEY,
  baseURL: HENDRIX_BASE_URL,
});

function parseJsonResponse(text: string): EvalOutput | null {
  let clean = text.trim();
  const fenceMatch = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) clean = fenceMatch[1].trim();
  try {
    return JSON.parse(clean) as EvalOutput;
  } catch {
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as EvalOutput;
      } catch {
        return null;
      }
    }
    return null;
  }
}

Eval("confidence-ai-plugins", {
  projectId: "c78b488e-050d-4299-8442-c081455a3ac2",
  experimentName: "optimizely-operator-mapping-v1",
  maxConcurrency: 3,
  metadata: {
    model: "claude-sonnet-4-20250514",
    skill: "migrate-optimizely",
    eval_type: "operator_mapping_accuracy",
  },

  data: buildDataset,

  task: async (input: { flag: Record<string, unknown> }) => {
    const flagJson = JSON.stringify(input.flag, null, 2);

    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Analyze this Optimizely flag definition and produce the Confidence migration output.\n\nFlag definition:\n${flagJson}`,
          },
        ],
      });

      const textBlock = response.content.find((b: { type: string }) => b.type === "text");
      const text = textBlock && "text" in textBlock ? (textBlock as { text: string }).text : "";
      const parsed = parseJsonResponse(text);
      if (!parsed) {
        console.error(`[${(input.flag as { key?: string }).key}] Failed to parse response: ${text.slice(0, 200)}`);
      }
      return parsed;
    } catch (e) {
      console.error(`[${(input.flag as { key?: string }).key}] API error:`, e);
      return null;
    }
  },

  scores: [
    (args: { input: unknown; output: unknown; expected?: unknown }) => ScopeClassification({
      input: args.input,
      output: args.output as EvalOutput | null,
      expected: args.expected as GroundTruth,
    }),
    (args: { input: unknown; output: unknown; expected?: unknown }) => BlockedDetection({
      input: args.input,
      output: args.output as EvalOutput | null,
      expected: args.expected as GroundTruth,
    }),
    (args: { input: unknown; output: unknown; expected?: unknown }) => FlagShape({
      input: args.input,
      output: args.output as EvalOutput | null,
      expected: args.expected as GroundTruth,
    }),
    (args: { input: unknown; output: unknown; expected?: unknown }) => BackendSelection({
      input: args.input,
      output: args.output as EvalOutput | null,
      expected: args.expected as GroundTruth,
    }),
    (args: { input: unknown; output: unknown; expected?: unknown }) => TargetingPayloadStructure({
      input: args.input,
      output: args.output as EvalOutput | null,
      expected: args.expected as GroundTruth,
    }),
  ],
});
