import type Anthropic from "@anthropic-ai/sdk";

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  id: string;
  position: number;
}

export interface ToolResult {
  toolCallId: string;
  toolName: string;
  text: string;
  position: number;
}

export interface TextBlock {
  text: string;
  position: number;
}

export interface TraceResult {
  success: boolean;
  numTurns: number;
  totalApiCalls: number;
}

export interface Trace {
  messages: Anthropic.MessageParam[];
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  textBlocks: TextBlock[];
  result: TraceResult;
}

export interface AssertionResult {
  passed: boolean;
  message: string;
  assertionName: string;
}

export type Assertion = (trace: Trace) => AssertionResult | Promise<AssertionResult>;

export interface AssertionDef {
  type: string;
  tool_name?: string;
  pattern?: string;
  case_sensitive?: boolean;
  regex?: boolean;
  first?: string;
  second?: string;
  min_count?: number;
  max_count?: number;
  arg_name?: string;
  criteria?: string;
  threshold?: number;
}

export interface MockFlag {
  name: string;
  variants: string[];
  rules: Array<{
    payload?: { criteria: Record<string, unknown>; expression: Record<string, unknown> };
    variantAllocations: Record<string, number>;
  }>;
}

export interface MockState {
  flags: Map<string, MockFlag>;
  clients: Array<{ name: string; displayName: string }>;
  contextFields: string[];
}

/** Scripted answer for a mocked AskUserQuestion call. `match` is a regex
 * tested against the question text, header, and option labels; the first
 * matching entry supplies the answer. Unmatched questions fall back to the
 * first option (usually the happy path) with a console warning. */
export interface AskAnswerDef {
  match: string;
  answer: string;
}

/** Scripted response override for the mocked Bash tool. `match` is a regex
 * tested against the command; `responses` are consumed in order across the
 * conversation (the last one repeats once exhausted). Overrides are checked
 * before the built-in default routes. */
export interface BashResponseDef {
  match: string;
  responses: string[];
}

/** Scripted response override for a mock MCP tool, by short tool name
 * (e.g. "getIdentityInfo"). Consumed in order; last repeats. */
export interface ToolResponseDef {
  tool: string;
  responses: string[];
}

export interface Scenario {
  name: string;
  description: string;
  skill: string;
  /** SKILL.md files to load as the system prompt. Defaults to [skill].
   * Multiple entries are concatenated (e.g. a dispatcher skill plus the
   * skill it hands off to). */
  skills?: string[];
  /** Extra markdown files from the first skill directory (e.g. `access.md`). */
  promptFiles?: string[];
  tags: string[];
  sourceFlags: Record<string, unknown>[];
  conversation: string[];
  assertions: Assertion[];
  askAnswers: AskAnswerDef[];
  bashResponses: BashResponseDef[];
  toolResponses: ToolResponseDef[];
}
