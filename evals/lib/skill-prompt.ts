import { readFileSync } from "fs";
import { join } from "path";

export function loadSkillPrompt(skill: string): string {
  const skillPath = join(process.cwd(), "skills", skill, "SKILL.md");
  return readFileSync(skillPath, "utf-8");
}
