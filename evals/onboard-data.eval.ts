import { Eval } from "braintrust";
import Anthropic from "@anthropic-ai/sdk";
import { buildOnboardDataDataset } from "./lib/onboard-data-dataset.js";
import { ONBOARD_DATA_CONTRACT, type Expected } from "./lib/onboard-data-contract.js";
import { onboardDataEvalVariant } from "./lib/onboard-data-prompt.js";
import { OnboardDataSafeDecision } from "./lib/onboard-data-scorer.js";
import { ONBOARD_DATA_OUTPUT_TOOL, readOnboardDataAnswer } from "./lib/onboard-data-output-tool.js";

const client = new Anthropic();
const baseline = process.env.ONBOARD_DATA_BASELINE === "1";
const { systemPrompt, experimentName, variant } = onboardDataEvalVariant(baseline);
const model = process.env.EVAL_MODEL || "claude-sonnet-4-6";

Eval("confidence-ai-plugins", {
  projectId: "c78b488e-050d-4299-8442-c081455a3ac2",
  experimentName,
  baseExperimentName: experimentName,
  maxConcurrency: 3,
  metadata: { model, skill: "onboard-data", variant, eval_type: "single_turn", synthetic: true, tool_execution: false },
  data: () => buildOnboardDataDataset(),
  task: async (input: { user_message: string; context: string }) => {
    // Let provider errors fail the eval rather than turn outages into skill scores.
    const response = await client.messages.create({
      model,
      max_tokens: 8192,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Synthetic verified runtime and prior-state snapshot (not live tools):\n${input.context}\n\nUser request:\n${input.user_message}\n\n${ONBOARD_DATA_CONTRACT}\nSubmit the JSON object using report_decision. This tool only transports your answer; no warehouse operation executes.` }],
      tools: [ONBOARD_DATA_OUTPUT_TOOL],
      tool_choice: { type: "tool", name: ONBOARD_DATA_OUTPUT_TOOL.name },
    });
    if (response.stop_reason === "max_tokens") throw new Error("onboard-data response truncated; increase max_tokens");
    return { raw_text: readOnboardDataAnswer(response.content) };
  },
  scores: [args => {
    const output = args.output as { raw_text: string };
    const result = OnboardDataSafeDecision({ output, expected: args.expected as Expected });
    if (process.env.ONBOARD_DATA_DEBUG === "1" && result.score === 0) {
      console.error(JSON.stringify({ input: args.input, errors: result.metadata.errors, output }));
    }
    return result;
  }],
});
