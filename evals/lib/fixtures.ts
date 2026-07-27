import { readFileSync } from "fs";
import { join } from "path";
import type { FixtureData, FlagFixture } from "./types.js";

const FIXTURE_PATH = join(process.cwd(), "evals", "fixtures", "optimizely-flags.json");

export function loadFixtures(): FixtureData {
  const raw = readFileSync(FIXTURE_PATH, "utf-8");
  return JSON.parse(raw) as FixtureData;
}

export function buildDataset() {
  const data = loadFixtures();
  return data.flags.map((flag: FlagFixture) => ({
    input: { flag },
    expected: flag.ground_truth,
    metadata: {
      flag_key: flag.key,
      description: flag.description,
      has_variables: Object.keys(flag.variable_definitions).length > 0,
      rule_count: flag.ruleset?.rule_priorities.length ?? 0,
    },
  }));
}
