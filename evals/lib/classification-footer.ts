/**
 * Appended by the eval harness to every test-case user message (all skills).
 * Forces an explicit, machine-parseable verdict so ScopeClassification and
 * FlagShape score deterministically instead of guessing from prose.
 */
export const CLASSIFICATION_FOOTER = `

At the very end of your response, add these two lines exactly (pick one value each):
Classification: migrate | excluded | blocked | archived
Flag shape: boolean | struct

Label definitions (apply YOUR skill's Migration Scope Policy to decide which applies) — migrate: migrated by default, no user decision needed. excluded: not migrated by default per the scope policy, even if it could be migrated after an explicit user opt-in. blocked: uses targeting Confidence cannot express. archived: the source flag is archived (takes precedence over every other category). boolean: simple on/off. struct: named variants or typed variables/payloads.`;

const SCOPE_RE = /^\s*classification:\s*(migrate|excluded|blocked|archived)\b/gim;
const SHAPE_RE = /^\s*flag shape:\s*(boolean|struct)\b/gim;

function lastMatch(re: RegExp, text: string): string | null {
  let m: RegExpExecArray | null;
  let last: string | null = null;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) last = m[1].toLowerCase();
  return last;
}

export function extractScope(text: string): string | null {
  return lastMatch(SCOPE_RE, text);
}

export function extractShape(text: string): string | null {
  return lastMatch(SHAPE_RE, text);
}
