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
      model: "claude-sonnet-4-20250514",
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: `You are an eval judge. Score the following AI assistant response on this criterion:

CRITERION: ${criteria}

RESPONSE TO EVALUATE:
${text.slice(0, 6000)}

Reply with ONLY a JSON object: {"score": <0.0 to 1.0>, "reason": "<one sentence>"}`,
        },
      ],
    });

    const raw = response.content.find((b: { type: string }) => b.type === "text");
    const json = raw && "text" in raw ? (raw as { text: string }).text : "";
    const match = json.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return { name, score: parsed.score ?? 0, metadata: { reason: parsed.reason } };
    }
    return { name, score: 0, metadata: { reason: "failed_to_parse_judge_response" } };
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

export async function Visualization(args: { output: TaskOutput }) {
  return llmScore(
    "Visualization",
    "Does the response include a properly formatted step tracker or progress indicator using status markers like ○ (pending), ◉ (in progress), ✓ (done), ⏸ (awaiting user), or ⊘ (skipped)? Score 1.0 if a well-formatted tracker is present, 0.5 if partial, 0.0 if missing entirely.",
    args.output?.raw_text || "",
  );
}

export async function Communication(args: { output: TaskOutput }) {
  return llmScore(
    "Communication",
    "Does the response expose any internal implementation details that should be hidden from the user? Check for: MCP tool names (mcp__confidence__*), raw JSON targeting payloads with criteria/expression/ref-0, token values, API endpoint URLs, error codes, org IDs, JWT claims. Score 1.0 if clean (no internals leaked), 0.0 if internals are exposed.",
    args.output?.raw_text || "",
  );
}

export async function EducateFirst(args: { output: TaskOutput }) {
  return llmScore(
    "EducateFirst",
    "Does the response explain a concept (using a blockquote > or an introductory explanation) before taking the action? The skill should educate the user about what's happening and why before doing it. Score 1.0 if explanations come before actions, 0.5 if mixed, 0.0 if actions happen with no explanation.",
    args.output?.raw_text || "",
  );
}
