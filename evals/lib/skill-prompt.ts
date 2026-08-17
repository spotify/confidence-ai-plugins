import { existsSync, readFileSync } from "fs";
import { join } from "path";

export function loadSkillPrompt(skill: string, extraFiles: string[] = []): string {
  const dir = join(process.cwd(), "skills", skill);
  const chunks = [readFileSync(join(dir, "SKILL.md"), "utf-8")];
  for (const file of extraFiles) {
    const path = join(dir, file);
    if (!existsSync(path)) throw new Error(`Missing skill file: ${path}`);
    chunks.push(readFileSync(path, "utf-8"));
  }
  return chunks.join("\n\n---\n\n");
}
