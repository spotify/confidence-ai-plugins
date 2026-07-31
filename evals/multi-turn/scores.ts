import type { Scenario, Trace } from "./types.js";
import { llmScore } from "../lib/scorers/llm-judge.js";

export interface TaskOutput {
  trace: Trace;
  error?: string;
}

function summarizeToolCalls(trace: Trace): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const tc of trace.toolCalls) {
    const short = tc.name.replace("mcp__confidence_flags__", "");
    counts[short] = (counts[short] || 0) + 1;
  }
  return counts;
}

export function multiTurnScores() {
  return [
    (args: Record<string, unknown>) => {
      const { trace, error } = args.output as TaskOutput;
      const scenario = args.input as Scenario;

      if (error) {
        return { name: "AssertionsPassed", score: 0, metadata: { error } };
      }

      const results = scenario.assertions.map((a) => a(trace));
      const passed = results.filter((r) => r.passed).length;
      const total = results.length;

      if (passed < total) {
        const failed = results.filter((r) => !r.passed).map((r) => `${r.assertionName} — ${r.message}`);
        console.error(`  [${scenario.name}] ${passed}/${total} assertions passed. FAILED:\n    ${failed.join("\n    ")}`);
      }

      return {
        name: "AssertionsPassed",
        score: total > 0 ? passed / total : 1,
        metadata: {
          passed,
          total,
          results: results.map((r) => ({
            name: r.assertionName,
            passed: r.passed,
            message: r.message,
          })),
          numTurns: trace.result.numTurns,
          totalApiCalls: trace.result.totalApiCalls,
          toolCallsSummary: summarizeToolCalls(trace),
        },
      };
    },
  ];
}

/**
 * Onboarding multi-turn scores: the assertion scorer plus a conversation-level
 * judge over everything the user would see. Deterministic assertions can only
 * check leaks we enumerate; the judge catches the rest of the skill's
 * User-Facing Communication Rules.
 */
export function onboardMultiTurnScores() {
  return [
    ...multiTurnScores(),
    async (args: Record<string, unknown>) => {
      const { trace, error } = args.output as TaskOutput;
      if (error) return { name: "NoInternalLeak", score: 0, metadata: { error } };
      const userVisibleText = trace.textBlocks.map((tb) => tb.text).join("\n\n");
      return llmScore(
        "NoInternalLeak",
        `This is the full user-visible conversational output of an onboarding assistant running inside the Claude Code CLI (tool calls and their payloads are hidden from the user and NOT included here). The assistant must never expose internal technical details to the user: no raw JSON request/response bodies, no OAuth/Auth0 client IDs or config, no JWT tokens or fragments (strings starting with "eyJ"), no org IDs (org_...), no HTTP status codes or gRPC error codes as jargon (saying "something went wrong" is fine, "got a 400" is not), no MCP tool names like createFlag or getIdentityInfo, no curl commands, and no mention of telemetry.

Fine and expected — do NOT penalize: human-readable status updates, plain-English explanations, step trackers, workspace/flag/client names, the client secret shown once in the final summary, and the CLI instructions the skill mandates — telling the user to type /mcp, to click Authenticate next to confidence-flags or confidence-docs, referring to those two servers by name or to "MCP" as the way tools connect, showing MCP connection status, or referencing /onboard-confidence sub-commands. Those are user-facing CLI affordances, not leaks.

Score 1.0 = fully plain English, nothing internal leaked. 0.5 = one or two minor leaks (e.g. an HTTP code or an MCP tool name like createFlag mentioned in passing). 0.0 = raw payloads, tokens, or auth internals shown to the user.`,
        userVisibleText,
        1,
        24000,
      );
    },
  ];
}
