import { loadSkillPrompt } from "./skill-prompt.js";

// Explicit list from skills/onboard-data/SKILL.md. Missing files are errors, not
// silently omitted context: recovery and review rules are safety-critical.
export const ONBOARD_DATA_REFERENCE_FILES = [
  "references/capabilities.md",
  "references/local-progress.md",
  "references/review.md",
  "references/recovery.md",
  "references/acceptance-scenarios.md",
];
export function loadOnboardDataPrompt(): string {
  return loadSkillPrompt("onboard-data", ONBOARD_DATA_REFERENCE_FILES);
}

export function onboardDataEvalVariant(baseline: boolean) {
  return {
    systemPrompt: baseline ? "You are a helpful assistant. Make safe, accurate decisions from the supplied context and user request." : loadOnboardDataPrompt(),
    experimentName: baseline ? "onboard-data-single-turn-baseline-v1" : "onboard-data-single-turn-v1",
    variant: baseline ? "baseline" : "with_skill",
  };
}
