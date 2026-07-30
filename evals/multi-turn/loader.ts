import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import type { Scenario, AssertionDef } from "./types.js";
import { parseAssertion } from "./assertions.js";

interface RawScenario {
  name: string;
  description: string;
  skill: string;
  tags?: string[];
  source_flags?: Record<string, unknown>[];
  conversation: string[];
  assertions?: AssertionDef[];
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
      tags: raw.tags || [],
      sourceFlags: raw.source_flags || [],
      conversation: raw.conversation,
      assertions: (raw.assertions || []).map(parseAssertion),
    };
  });
}
