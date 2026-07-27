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

const client = new Anthropic();

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

Eval("confidence-migration-optimizely", {
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

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    return parseJsonResponse(text);
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
