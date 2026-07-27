import { readFileSync } from "fs";
import { join } from "path";

export function loadSkillPrompt(): string {
  const skillPath = join(process.cwd(), "skills", "migrate-optimizely", "SKILL.md");
  return readFileSync(skillPath, "utf-8");
}
