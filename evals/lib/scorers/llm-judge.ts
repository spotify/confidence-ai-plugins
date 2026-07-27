import Anthropic from "@anthropic-ai/sdk";
import type { TaskOutput } from "../types.js";

const judge = new Anthropic();

async function llmScore(
  name: string,
  criteria: string,
  text: string,
  attempt = 1,
): Promise<{ name: string; score: number; metadata?: Record<string, unknown> }> {
  if (!text) return { name, score: 0, metadata: { reason: "no_output" } };

  try {
    const response = await judge.messages.create({
      model: process.env.EVAL_MODEL || "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `Score this response on: ${criteria}

Response (truncated):
${text.slice(0, 4000)}

Your reply must END with a single line of JSON containing two keys, "score" (a number between 0.0 and 1.0) and "reason" (one short sentence in your own words describing what you observed). Nothing after that line.`,
        },
      ],
    });

    let allText = "";
    for (const block of response.content) {
      if ("text" in block && typeof (block as { text: unknown }).text === "string") allText += (block as { text: string }).text;
      if ("thinking" in block && typeof (block as { thinking: unknown }).thinking === "string") allText += (block as { thinking: string }).thinking;
    }
    // Extract the score with a direct regex — never JSON.parse the whole
    // object: the judge's free-text `reason` routinely contains unescaped
    // quotes that make it invalid JSON, and a parse crash must not zero
    // out an otherwise-valid verdict.
    // Take the LAST match — the judge's thinking may restate the requested
    // format (or an example) before the actual verdict line at the end.
    const scoreMatches = [...allText.matchAll(/"score"\s*:\s*([\d.]+)/g)];
    const scoreMatch = scoreMatches.length ? scoreMatches[scoreMatches.length - 1] : null;
    if (scoreMatch) {
      const score = Math.max(0, Math.min(1, parseFloat(scoreMatch[1])));
      const reasonMatches = [...allText.matchAll(/"reason"\s*:\s*"([^"]{0,300})/g)];
      const reason = reasonMatches.length ? reasonMatches[reasonMatches.length - 1][1] : "";
      console.log(`  [${name}] score=${score} reason=${reason || "none"}`);
      return { name, score, metadata: { reason } };
    }
    if (attempt < 2) {
      console.error(`  [${name}] parse fail, retrying once`);
      return llmScore(name, criteria, text, attempt + 1);
    }
    console.error(`  [${name}] PARSE FAIL: ${allText.slice(0, 300)}`);
    return { name, score: 0, metadata: { reason: "failed_to_parse_judge_response", raw: allText.slice(0, 200) } };
  } catch (e) {
    if (attempt < 2) return llmScore(name, criteria, text, attempt + 1);
    return { name, score: 0, metadata: { reason: `judge_error: ${e}` } };
  }
}

export async function Tone(args: { output: TaskOutput }) {
  return llmScore(
    "Tone",
    `Evaluate ONLY the conversational prose (ignore fenced code blocks — machine-readable payloads belong there and are fine). Also fine in prose: backticked references to the user's OWN field/flag names (like \`is_beta\`, \`country\`, \`my-flag\`), plain percentages, AND spelled-out rule descriptors in plain words — "an equals rule", "a value-set rule", "a numeric range rule", "an ends-with rule", "the variant split", "create the flag", "add the targeting rule". Those ARE plain English; do not penalize them.

Penalize only literal code identifiers and tool names appearing in prose: camelCase operator names (eqRule, setRule, rangeRule, startsWithRule, endsWithRule, boolValue, stringValue, variantAllocations, criteria/expression/ref-0), MCP tool names (createFlag, addFlagToClient, addTargetingRule, resolveFlag), source-platform internal field names used as jargon (percentage_included, passPercentage, percent_exposure, targetValue, rollout_percentage, aggregation_group_type_index), or raw JSON structures outside code blocks.

Score 1.0 = prose fully plain English. 0.5 = some literal code identifiers mixed into prose. 0.0 = prose dominated by code identifiers or raw payloads.`,
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

Score based on the CONVERSATIONAL parts (outside code blocks). Spelled-out descriptors in plain words ("an equals rule", "a value-set rule", "an ends-with rule", "create the flag", "add the targeting rule") are plain English — do not penalize them.
- Score 1.0 if the conversational text uses plain English ("country is US or CA", "25% rollout to beta users") and technical payloads only appear inside code blocks or plan file sections.
- Score 0.5 if there's some mixing — conversational text contains literal code identifiers (eqRule, setRule, variantAllocations) or tool names (createFlag, addTargetingRule) alongside plain English.
- Score 0.0 if the conversational text directly shows raw targeting payloads or is dominated by internal identifiers outside of code blocks.`,
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
