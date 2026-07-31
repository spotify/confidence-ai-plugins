import type Anthropic from "@anthropic-ai/sdk";
import type { Trace, ToolCall, ToolResult, TextBlock, TraceResult } from "./types.js";

export function buildTrace(
  messages: Anthropic.MessageParam[],
  toolCalls: ToolCall[],
  toolResults: ToolResult[],
  textBlocks: TextBlock[],
  numTurns: number,
  totalApiCalls: number,
): Trace {
  return {
    messages,
    toolCalls,
    toolResults,
    textBlocks,
    result: {
      success: true,
      numTurns,
      totalApiCalls,
    },
  };
}

export function getToolCallsByName(trace: Trace, name: string): ToolCall[] {
  return trace.toolCalls.filter((tc) => tc.name === name);
}

export function getAllText(trace: Trace): string {
  // AskUserQuestion inputs are shown to the user (questions + option labels),
  // so text assertions — including leak checks — must cover them too.
  const askText = trace.toolCalls
    .filter((tc) => tc.name === "AskUserQuestion")
    .map((tc) => JSON.stringify(tc.input));
  return [...trace.textBlocks.map((tb) => tb.text), ...askText].join("\n");
}

export function getFinalText(trace: Trace): string {
  let lastToolPos = -1;
  for (const tc of trace.toolCalls) lastToolPos = Math.max(lastToolPos, tc.position);
  for (const tr of trace.toolResults) lastToolPos = Math.max(lastToolPos, tr.position);
  return trace.textBlocks
    .filter((tb) => tb.position > lastToolPos)
    .map((tb) => tb.text)
    .join("\n");
}
