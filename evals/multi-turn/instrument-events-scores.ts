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

export function instrumentEventsMultiTurnScores() {
  return [
    // ── Assertion scorer ────────────────────────────────
    async (args: Record<string, unknown>) => {
      const { trace, error } = args.output as TaskOutput;
      const scenario = args.input as Scenario;

      if (error) {
        return { name: "AssertionsPassed", score: 0, metadata: { error } };
      }

      const results = await Promise.all(scenario.assertions.map((a) => a(trace)));
      const passed = results.filter((r) => r.passed).length;
      const total = results.length;

      if (passed < total) {
        const failed = results
          .filter((r) => !r.passed)
          .map((r) => `${r.assertionName} — ${r.message}`);
        console.error(
          `  [${scenario.name}] ${passed}/${total} assertions passed. FAILED:\n    ${failed.join("\n    ")}`,
        );
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

    // ── No internal leak judge ──────────────────────────
    async (args: Record<string, unknown>) => {
      const { trace, error } = args.output as TaskOutput;
      if (error) return { name: "NoInternalLeak", score: 0, metadata: { error } };
      const userVisibleText = trace.textBlocks.map((tb) => tb.text).join("\n\n");
      return llmScore(
        "NoInternalLeak",
        `This is the full user-visible output of an event instrumentation assistant running in the Claude Code CLI. Tool calls and their payloads are hidden from the user and NOT included here. The assistant must never expose:
- Raw JSON request/response bodies
- MCP tool names like createEventDefinition, listFactTables, getIdentityInfo
- Internal identifiers (org IDs, identity names like "identities/...")
- curl commands or API endpoints
- Telemetry details

Fine and expected (do NOT penalize):
- Event definition names and schemas shown in plain English
- Entity names like "Visitor" or "User" AND their resource paths like "entities/visitor", "entities/user"
- Fact table names like "factTables/purchase-completed" — these are user-visible resource identifiers
- Event definition resource names like "eventDefinitions/purchase-completed"
- Event field names like "visitor_id", "amount"
- The term "semanticType" or "entityReference" when explaining what an entity reference is
- Step trackers and progress indicators
- References to /confidence:explore-metric or /confidence:instrument-events (user-facing commands)
- The confidence.track() API shown in code blocks (it's the SDK the user will use)
- Schema type names (stringSchema, doubleSchema) inside code blocks or when explaining schema types

Score 1.0 = fully plain English. 0.5 = one or two minor leaks. 0.0 = raw payloads or tool names dominate.`,
        userVisibleText,
        1,
        24000,
      );
    },

    // ── UX quality judge ────────────────────────────────
    async (args: Record<string, unknown>) => {
      const { trace, error } = args.output as TaskOutput;
      if (error) return { name: "UXQuality", score: 0, metadata: { error } };
      const userVisibleText = trace.textBlocks.map((tb) => tb.text).join("\n\n");
      return llmScore(
        "UXQuality",
        `Evaluate the overall UX quality of this event instrumentation flow:

1. STEP TRACKER: Does it show a visual step tracker with status markers (○ pending, ◉ in progress, ✓ done)?
2. EDUCATE FIRST: Does it explain concepts before asking for input?
3. TONE: Is the language friendly, clear, and jargon-free?
4. FLOW: Does the conversation flow logically from analysis → proposal → implementation → verification?
5. EXPLORE-METRIC HINT: Does it mention /confidence:explore-metric as the next step for metrics?

Score 1.0 = excellent UX on all dimensions. 0.5 = decent but missing some elements. 0.0 = poor UX.`,
        userVisibleText,
        1,
        24000,
      );
    },
  ];
}
