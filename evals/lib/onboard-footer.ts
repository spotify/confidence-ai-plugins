/**
 * Appended by the eval harness to every onboarding single-turn case message.
 * Forces an explicit, machine-parseable "what happens next" verdict so the
 * NextStep scorer can score deterministically instead of guessing from prose.
 */
export const ONBOARD_FOOTER = `

(No tools are available in this context — skip telemetry and any setup/auth commands, and reply with exactly what you would say to the user next. If you would normally present choices with AskUserQuestion, present the same options as a short list instead.)

THE VERY LAST LINE of your response MUST be this (nothing may follow it):
Next step: <sub-command>.<step>

where <sub-command> is one of: create-account | invite-user | create-client | setup-wizard | setup-warehouse | learn | status
and <step> is a short kebab-case name for the step you will do NEXT (examples: create-account.login, create-account.workspace-name, setup-wizard.get-started, invite-user.invitation-details, status.display).`;

const NEXT_STEP_RE = /^\s*next step:\s*(\S+)/gim;

export function extractNextStep(text: string): string | null {
  let m: RegExpExecArray | null;
  let last: string | null = null;
  NEXT_STEP_RE.lastIndex = 0;
  while ((m = NEXT_STEP_RE.exec(text)) !== null) last = m[1].toLowerCase();
  return last;
}
