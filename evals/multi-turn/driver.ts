import Anthropic from "@anthropic-ai/sdk";
import type { Scenario, Trace, ToolCall, ToolResult, TextBlock, MockState } from "./types.js";
import { loadSkillPrompt } from "../lib/skill-prompt.js";
import { MOCK_TOOLS, dispatchTool, createMockState } from "./tools.js";
import { buildTrace } from "./trace.js";

const MAX_TOOL_ROUNDS_PER_TURN = 20;

const EVAL_PREAMBLE = `You are in an eval environment with mock MCP tools available.
- There is no filesystem — present plans inline in your response.
- Skip telemetry setup steps.
- The MCP tools (createFlag, addTargetingRule, resolveFlag, etc.) are available and functional.
- Proceed with the migration flow as instructed in the skill.

`;

export async function runConversation(scenario: Scenario): Promise<Trace> {
  const client = new Anthropic();
  const model = process.env.EVAL_MODEL || "claude-sonnet-4-6";
  const skillName = scenario.skill.replace("migrate-", "");
  const systemPrompt = EVAL_PREAMBLE + loadSkillPrompt(`migrate-${skillName}`);

  const state: MockState = createMockState();
  const messages: Anthropic.MessageParam[] = [];
  const toolCalls: ToolCall[] = [];
  const toolResults: ToolResult[] = [];
  const textBlocks: TextBlock[] = [];
  let position = 0;
  let totalApiCalls = 0;

  for (let turnIdx = 0; turnIdx < scenario.conversation.length; turnIdx++) {
    const userMessage = scenario.conversation[turnIdx];
    messages.push({ role: "user", content: userMessage });

    for (let round = 0; round < MAX_TOOL_ROUNDS_PER_TURN; round++) {
      totalApiCalls++;
      const response = await client.messages.create({
        model,
        max_tokens: 8192,
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        messages,
        tools: MOCK_TOOLS,
      });

      const assistantContent = response.content;

      for (const block of assistantContent) {
        if (block.type === "text") {
          textBlocks.push({ text: block.text, position: position++ });
        } else if (block.type === "tool_use") {
          toolCalls.push({
            name: block.name,
            input: block.input as Record<string, unknown>,
            id: block.id,
            position: position++,
          });
        }
      }

      if (response.stop_reason === "tool_use") {
        messages.push({ role: "assistant", content: assistantContent });

        const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
        for (const block of assistantContent) {
          if (block.type === "tool_use") {
            const resultText = dispatchTool(block.name, block.input as Record<string, unknown>, state);
            toolResults.push({
              toolCallId: block.id,
              toolName: block.name,
              text: resultText,
              position: position++,
            });
            toolResultBlocks.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: resultText,
            });
          }
        }
        messages.push({ role: "user", content: toolResultBlocks });
      } else {
        messages.push({ role: "assistant", content: assistantContent });
        break;
      }
    }
  }

  return buildTrace(messages, toolCalls, toolResults, textBlocks, scenario.conversation.length, totalApiCalls);
}
