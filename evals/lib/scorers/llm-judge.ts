import Anthropic from "@anthropic-ai/sdk";
import type { TaskOutput } from "../types.js";

const HENDRIX_BASE_URL = process.env.HENDRIX_BASE_URL || "https://hendrix-genai.spotify.net/taskforce/glm-5-2";
const HENDRIX_API_KEY = process.env.HENDRIX_API_KEY || process.env.ANTHROPIC_API_KEY || "";

const judge = new Anthropic({ apiKey: HENDRIX_API_KEY, baseURL: HENDRIX_BASE_URL });

async function llmScore(
  name: string,
  criteria: string,
  text: string,
): Promise<{ name: string; score: number; metadata?: Record<string, unknown> }> {
  if (!text) return { name, score: 0, metadata: { reason: "no_output" } };

  try {
    const response = await judge.messages.create({
      model: process.env.EVAL_MODEL || "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `{"score": 0.5, "reason": "example"} — use this exact format.

Score this response on: ${criteria}

Response (truncated):
${text.slice(0, 4000)}

Output ONLY: {"score": <0.0-1.0>, "reason": "<one sentence>"}`,
        },
      ],
    });

    let allText = "";
    for (const block of response.content) {
      if ("text" in block && typeof (block as { text: unknown }).text === "string") allText += (block as { text: string }).text;
      if ("thinking" in block && typeof (block as { thinking: unknown }).thinking === "string") allText += (block as { thinking: string }).thinking;
    }
    const match = allText.match(/\{\s*"score"\s*:\s*[\d.]+[\s\S]*?\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      const score = typeof parsed.score === "number" ? parsed.score : 0;
      console.log(`  [${name}] score=${score} reason=${parsed.reason || "none"}`);
      return { name, score, metadata: { reason: parsed.reason } };
    }
    console.error(`  [${name}] PARSE FAIL: ${allText.slice(0, 300)}`);
    return { name, score: 0, metadata: { reason: "failed_to_parse_judge_response", raw: allText.slice(0, 200) } };
  } catch (e) {
    return { name, score: 0, metadata: { reason: `judge_error: ${e}` } };
  }
}

export async function Tone(args: { output: TaskOutput }) {
  return llmScore(
    "Tone",
    "Does the response use plain English to describe targeting rules? Does it avoid technical jargon like operator names (eqRule, setRule, rangeRule), rule type identifiers, or JSON structure syntax? Score 1.0 if fully plain English, 0.0 if it exposes internal technical terms.",
    args.output?.raw_text || "",
  );
}

export function Visualization(args: { output: TaskOutput; metadata?: Record<string, unknown> }) {
  const tags = (args.metadata?.tags as string[]) || [];
  if (!tags.includes("interactive") && !tags.includes("visualization")) {
    return { name: "Visualization", score: 1, metadata: { reason: "not_applicable_for_single_flag_analysis" } };
  }
  return llmScore(
    "Visualization",
    "Does the response include a properly formatted step tracker or progress indicator using status markers like ○ (pending), ◉ (in progress), ✓ (done), ⏸ (awaiting user), or ⊘ (skipped)? Score 1.0 if a well-formatted tracker is present, 0.5 if partial, 0.0 if missing entirely.",
    args.output?.raw_text || "",
  );
}

export async function Communication(args: { output: TaskOutput }) {
  return llmScore(
    "Communication",
    `The AI assistant should describe flag targeting in PLAIN ENGLISH in the conversational output shown to the user. However, it IS allowed to include machine-readable MCP command payloads (JSON with criteria/expression/ref-0, addTargetingRule, createFlag) inside a plan file section or code block — those are for machine execution, not user-facing.

Score based on the CONVERSATIONAL parts (outside code blocks):
- Score 1.0 if the conversational text uses plain English ("country is US or CA", "25% rollout to beta users") and technical payloads only appear inside code blocks or plan file sections.
- Score 0.5 if there's some mixing — conversational text mentions internal terms alongside plain English.
- Score 0.0 if the conversational text directly shows raw targeting payloads, MCP tool names (mcp__confidence__*), or internal operator names (eqRule, setRule) outside of code blocks.`,
    args.output?.raw_text || "",
  );
}

export async function EducateFirst(args: { output: TaskOutput }) {
  return llmScore(
    "EducateFirst",
    "Does the response explain a concept (using a blockquote > or an introductory explanation) before taking the migration action? Ignore any telemetry or session-setup bash scripts at the start — those are infrastructure, not user-facing actions. Focus on whether the MIGRATION-RELATED content (flag analysis, classification, targeting description) is preceded by an explanation of what the flag is and why it's being classified this way. Score 1.0 if explanations come before migration actions, 0.5 if mixed, 0.0 if migration actions happen with no explanation.",
    args.output?.raw_text || "",
  );
}
