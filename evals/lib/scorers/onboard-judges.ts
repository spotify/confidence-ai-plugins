import type { TaskOutput } from "../types.js";
import { llmScore } from "./llm-judge.js";

/** The eval footer forces a trailing `Next step: <sub-command>.<step>`
 * verdict line for the deterministic NextStep scorer. It's harness-injected,
 * not something the skill would show a user — strip it before judging. */
function withoutVerdictLine(text: string): string {
  return text.replace(/^\s*next step:\s*\S+\s*$/gim, "").trim();
}

export async function OnboardCommunication(args: { output: TaskOutput }) {
  return llmScore(
    "OnboardCommunication",
    `This is a user-facing response from a Confidence onboarding assistant running inside the Claude Code CLI. The assistant must speak plain English and hide all technical plumbing.

Fine and expected: friendly status updates ("Opening your browser to log in...", "Creating your workspace..."), plain-English explanations of concepts (workspace names, regions, feature flags), step trackers, workspace/flag/client names, the confidence.spotify.com URL, email addresses the user provided, and validation rules stated in words ("3-21 characters, lowercase letters..."). ALSO fine: instructions the skill mandates the assistant give the user about their own CLI — telling them to type /mcp, to click Authenticate next to confidence-flags, or to run /onboard-confidence sub-commands. Those are user-facing commands, not internal leaks; do not penalize them.

Penalize: raw JSON request/response bodies shown to the user, HTTP status codes or gRPC error codes used as jargon ("got a 400", "code 9"), OAuth/Auth0 internals (client IDs, token scoping, org IDs, JWT claims), MCP tool names (like createFlag or getIdentityInfo) or curl commands in prose, mention of telemetry, or asking the user for internal identifiers (org IDs, external IDs).

Score 1.0 = fully plain English, nothing internal. 0.5 = one or two minor leaks (an HTTP code or tool name in passing). 0.0 = raw payloads or auth internals dominate.`,
    withoutVerdictLine(args.output?.raw_text || ""),
  );
}

export async function OnboardEducateFirst(args: { output: TaskOutput }) {
  return llmScore(
    "OnboardEducateFirst",
    `The onboarding skill follows an EDUCATE-then-ASK pattern: before asking the user for input or presenting a choice, it briefly explains the concept involved (what a workspace name is and its rules, that the region cannot be changed later, what a service account is, what targeting rules do, etc.).

Evaluate: if this response asks the user for input or presents choices, is the relevant concept explained first, in plain English? If the response is purely informational (an error explanation, a status display, a completion summary), explanation woven into the message counts as educating. EXCEPTION: the flow's opening question — whether the user wants to create a new account or sign in to an existing one — needs no concept explanation; the skill mandates asking it immediately. Do not penalize that. Simple routing/confirmation questions ("should I send the invitations?") also need no lecture.

Score 1.0 = concept clearly explained before (or while) asking, or no explanation was needed. 0.5 = a concept-laden question asked with only a thin or partial explanation. 0.0 = demands input on an unexplained concept.`,
    withoutVerdictLine(args.output?.raw_text || ""),
  );
}

/**
 * Only scored on cases tagged `interactive` — flow starts and step
 * transitions, where the skill mandates a visual step tracker.
 */
export function OnboardStepTracker(args: { output: TaskOutput; metadata?: Record<string, unknown> }) {
  const tags = (args.metadata?.tags as string[]) || [];
  if (!tags.includes("interactive")) {
    return { name: "OnboardStepTracker", score: 1, metadata: { reason: "not_applicable" } };
  }
  return llmScore(
    "OnboardStepTracker",
    "Does the response include a visual step tracker for the onboarding flow, listing the flow's steps with status markers — ● (completed), ▶ (in progress), ○ (pending) or similar? Score 1.0 if a well-formatted tracker with the flow's steps is present, 0.5 if there is a partial or unformatted progress indication, 0.0 if there is no step tracker at all.",
    args.output?.raw_text || "",
  );
}
