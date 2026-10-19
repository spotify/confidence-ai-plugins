import type Anthropic from "@anthropic-ai/sdk";
import { ONBOARD_DATA_DECISION_SCHEMA } from "./onboard-data-contract.js";

// This tool transports an evaluation answer; it does not dispatch warehouse operations.
export const ONBOARD_DATA_OUTPUT_TOOL: Anthropic.Tool = {
  name: "report_decision",
  description: "Submit the structured decision for this synthetic snapshot. This only records an answer; it cannot execute any operation listed in actions.",
  input_schema: ONBOARD_DATA_DECISION_SCHEMA as Anthropic.Tool.InputSchema,
};

export function readOnboardDataAnswer(content: Anthropic.ContentBlock[]): string {
  const answers = content.filter(block => block.type === "tool_use");
  if (answers.length !== 1 || answers[0].type !== "tool_use" || answers[0].name !== ONBOARD_DATA_OUTPUT_TOOL.name) {
    throw new Error("onboard-data: expected exactly one report_decision answer");
  }
  return JSON.stringify(answers[0].input);
}
