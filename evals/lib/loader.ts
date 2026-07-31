import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import type { TestCase, OnboardTestCase } from "./types.js";

export function loadCases(skill: string): TestCase[] {
  const casesDir = join(process.cwd(), "evals", "cases", skill);
  const files = readdirSync(casesDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  return files.map((f) => {
    const raw = readFileSync(join(casesDir, f), "utf-8");
    return parse(raw) as TestCase;
  });
}

export function buildDataset(skill: string) {
  const cases = loadCases(skill);
  return cases.map((c) => ({
    input: c.input,
    expected: c.expected,
    metadata: { name: c.name, description: c.description, tags: c.tags },
  }));
}

export function buildOnboardDataset() {
  const casesDir = join(process.cwd(), "evals", "cases", "onboard");
  const files = readdirSync(casesDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  return files.map((f) => {
    const c = parse(readFileSync(join(casesDir, f), "utf-8")) as OnboardTestCase;
    return {
      input: c.input,
      expected: c.expected,
      metadata: { name: c.name, description: c.description, tags: c.tags },
    };
  });
}
