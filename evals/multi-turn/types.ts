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

export type Assertion = (trace: Trace) => AssertionResult;

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

export interface Scenario {
  name: string;
  description: string;
  skill: string;
  tags: string[];
  sourceFlags: Record<string, unknown>[];
  conversation: string[];
  assertions: Assertion[];
}
