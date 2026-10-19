import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Decision, OnboardDataCase } from "./onboard-data-contract.js";
import { parseOnboardDataDecision } from "./onboard-data-scorer.js";

// Braintrust bundles evals as CommonJS; import.meta.url is unavailable there.
// Like loadSkillPrompt, resolve from the repository root used by the npm scripts.
export const ONBOARD_DATA_CASES_DIR = join(process.cwd(), "evals", "cases", "onboard-data");

export function loadOnboardDataCases(dir = ONBOARD_DATA_CASES_DIR): OnboardDataCase[] {
  const files = readdirSync(dir).filter(name => name.endsWith(".json")).sort();
  const cases: OnboardDataCase[] = [];
  for (const file of files) {
    const values: unknown = JSON.parse(readFileSync(join(dir, file), "utf8"));
    if (!Array.isArray(values) || !values.length) throw new Error(`${file}: expected nonempty case array`);
    for (const value of values) {
      const c = value as OnboardDataCase;
      if (!c || typeof c.name !== "string" || !c.name.trim() || !Array.isArray(c.tags) || !c.tags.length || c.tags.some(t => typeof t !== "string" || !t.trim()) || typeof c.input?.user_message !== "string" || !c.input.user_message.trim() || typeof c.input.context !== "string" || !c.input.context.trim() || !c.expected || !Array.isArray(c.expected.actions)) throw new Error(`${file}: malformed case`);
      // Reuse the strict output contract for expected values. Expand optional
      // action-rule metadata away, rather than importing any model eval module.
      const { actions, ...rest } = c.expected;
      const decision: Decision = { ...rest, actions: actions.map(({ required: _required, ...a }) => a) };
      parseOnboardDataDecision(JSON.stringify(decision));
      for (const rule of actions) if (rule.required !== undefined && typeof rule.required !== "boolean") throw new Error(`${file}: invalid required action flag`);
      const snapshot = JSON.parse(c.input.context);
      if (!Array.isArray(snapshot.tracked_ids) || new Set(snapshot.tracked_ids).size !== snapshot.tracked_ids.length || snapshot.tracked_ids.some((id: unknown) => typeof id !== "string")) throw new Error(`${file}: invalid tracked_ids`);
      const ids = c.expected.tables.map(t => t.id).sort();
      if (JSON.stringify(ids) !== JSON.stringify([...snapshot.tracked_ids].sort())) throw new Error(`${file}: expected decisions must cover tracked_ids exactly`);
      if (!c.tags.includes("synthetic") || snapshot.synthetic !== true) throw new Error(`${file}: cases must be synthetic`);
      cases.push(c);
    }
  }
  if (!cases.length) throw new Error("onboard-data: no cases loaded");
  if (new Set(cases.map(c => c.name)).size !== cases.length) throw new Error("onboard-data: duplicate case name");
  return cases;
}

export function buildOnboardDataDataset() {
  return loadOnboardDataCases().map(({ name, tags, input, expected }) => ({ input, expected, metadata: { name, tags, synthetic: true } }));
}
