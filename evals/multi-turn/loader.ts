import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import type { Scenario, AssertionDef, AskAnswerDef, BashResponseDef, ToolResponseDef } from "./types.js";
import { parseAssertion } from "./assertions.js";

interface RawScenario {
  name: string;
  description: string;
  skill: string;
  skills?: string[];
  prompt_files?: string[];
  tags?: string[];
  source_flags?: Record<string, unknown>[];
  conversation: string[];
  assertions?: AssertionDef[];
  ask_answers?: AskAnswerDef[];
  bash_responses?: BashResponseDef[];
  tool_responses?: ToolResponseDef[];
}

export function loadMultiTurnScenarios(skill: string): Scenario[] {
  const casesDir = join(process.cwd(), "evals", "cases", "multi-turn", skill);
  const files = readdirSync(casesDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  return files.map((f) => {
    const raw = parse(readFileSync(join(casesDir, f), "utf-8")) as RawScenario;
    return {
      name: raw.name,
      description: raw.description,
      skill: raw.skill,
      skills: raw.skills,
      promptFiles: raw.prompt_files || [],
      tags: raw.tags || [],
      sourceFlags: raw.source_flags || [],
      conversation: raw.conversation,
      assertions: (raw.assertions || []).map(parseAssertion),
      askAnswers: raw.ask_answers || [],
      bashResponses: raw.bash_responses || [],
      toolResponses: raw.tool_responses || [],
    };
  });
}
