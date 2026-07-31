import type { Trace, Assertion, AssertionResult, AssertionDef } from "./types.js";
import { getToolCallsByName, getAllText } from "./trace.js";

export function toolCalled(toolName: string): Assertion {
  return (trace: Trace): AssertionResult => {
    const found = getToolCallsByName(trace, toolName).length > 0;
    return {
      passed: found,
      message: found ? "" : `Expected tool '${toolName}' to be called`,
      assertionName: `toolCalled(${toolName})`,
    };
  };
}

export function toolNotCalled(toolName: string): Assertion {
  return (trace: Trace): AssertionResult => {
    const found = getToolCallsByName(trace, toolName).length > 0;
    return {
      passed: !found,
      message: found ? `Expected tool '${toolName}' NOT to be called` : "",
      assertionName: `toolNotCalled(${toolName})`,
    };
  };
}

export function toolCalledCount(toolName: string, min: number, max?: number): Assertion {
  return (trace: Trace): AssertionResult => {
    const count = getToolCallsByName(trace, toolName).length;
    const inRange = count >= min && (max === undefined || count <= max);
    const rangeStr = max !== undefined ? `[${min}, ${max}]` : `>= ${min}`;
    return {
      passed: inRange,
      message: inRange ? "" : `Expected ${toolName} call count in ${rangeStr}, got ${count}`,
      assertionName: `toolCalledCount(${toolName}, ${rangeStr})`,
    };
  };
}

export function textContains(pattern: string, opts?: { caseSensitive?: boolean; regex?: boolean }): Assertion {
  return (trace: Trace): AssertionResult => {
    const text = getAllText(trace);
    let found: boolean;
    if (opts?.regex) {
      const flags = opts.caseSensitive === false ? "i" : "";
      found = new RegExp(pattern, flags).test(text);
    } else {
      const haystack = opts?.caseSensitive === false ? text.toLowerCase() : text;
      const needle = opts?.caseSensitive === false ? pattern.toLowerCase() : pattern;
      found = haystack.includes(needle);
    }
    return {
      passed: found,
      message: found ? "" : `Expected text to contain '${pattern}'`,
      assertionName: `textContains(${pattern})`,
    };
  };
}

export function textNotContains(pattern: string, opts?: { caseSensitive?: boolean }): Assertion {
  return (trace: Trace): AssertionResult => {
    const text = getAllText(trace);
    const haystack = opts?.caseSensitive === false ? text.toLowerCase() : text;
    const needle = opts?.caseSensitive === false ? pattern.toLowerCase() : pattern;
    const found = haystack.includes(needle);
    return {
      passed: !found,
      message: found ? `Expected text NOT to contain '${pattern}'` : "",
      assertionName: `textNotContains(${pattern})`,
    };
  };
}

export function toolCalledBefore(first: string, second: string): Assertion {
  return (trace: Trace): AssertionResult => {
    const firstCalls = getToolCallsByName(trace, first);
    const secondCalls = getToolCallsByName(trace, second);
    if (firstCalls.length === 0 || secondCalls.length === 0) {
      return {
        passed: false,
        message: `Cannot verify order: ${first} calls=${firstCalls.length}, ${second} calls=${secondCalls.length}`,
        assertionName: `toolCalledBefore(${first}, ${second})`,
      };
    }
    const firstPos = Math.min(...firstCalls.map((tc) => tc.position));
    const secondPos = Math.min(...secondCalls.map((tc) => tc.position));
    return {
      passed: firstPos < secondPos,
      message: firstPos < secondPos ? "" : `Expected ${first} (pos ${firstPos}) before ${second} (pos ${secondPos})`,
      assertionName: `toolCalledBefore(${first}, ${second})`,
    };
  };
}

export function toolCallArgContains(toolName: string, argName: string, pattern: string): Assertion {
  return (trace: Trace): AssertionResult => {
    const calls = getToolCallsByName(trace, toolName);
    const found = calls.some((tc) => {
      const val = tc.input[argName];
      return typeof val === "string" && val.toLowerCase().includes(pattern.toLowerCase());
    });
    return {
      passed: found,
      message: found ? "" : `No ${toolName} call has '${argName}' containing '${pattern}'`,
      assertionName: `toolCallArgContains(${toolName}, ${argName}, ${pattern})`,
    };
  };
}

export function textBeforeTool(pattern: string, toolName: string): Assertion {
  return (trace: Trace): AssertionResult => {
    const lowerPattern = pattern.toLowerCase();
    const matchingText = trace.textBlocks.find((tb) =>
      tb.text.toLowerCase().includes(lowerPattern),
    );
    const toolCall = getToolCallsByName(trace, toolName)[0];

    if (!matchingText) {
      return {
        passed: false,
        message: `Text containing '${pattern}' not found`,
        assertionName: `textBeforeTool(${pattern}, ${toolName})`,
      };
    }
    if (!toolCall) {
      return {
        passed: false,
        message: `Tool '${toolName}' was never called`,
        assertionName: `textBeforeTool(${pattern}, ${toolName})`,
      };
    }
    const passed = matchingText.position < toolCall.position;
    return {
      passed,
      message: passed ? "" : `Text '${pattern}' (pos ${matchingText.position}) should appear before ${toolName} (pos ${toolCall.position})`,
      assertionName: `textBeforeTool(${pattern}, ${toolName})`,
    };
  };
}

export function textContainsQuestion(pattern: string): Assertion {
  return (trace: Trace): AssertionResult => {
    const text = getAllText(trace).toLowerCase();
    const hasPattern = text.includes(pattern.toLowerCase());
    const hasQuestion = text.includes("?");
    const passed = hasPattern && hasQuestion;
    return {
      passed,
      message: passed ? "" : `Expected text to contain '${pattern}' with a question mark (confirmation ask)`,
      assertionName: `textContainsQuestion(${pattern})`,
    };
  };
}

const ASSERTION_FACTORIES: Record<string, (def: AssertionDef) => Assertion> = {
  tool_called: (d) => toolCalled(d.tool_name!),
  tool_not_called: (d) => toolNotCalled(d.tool_name!),
  tool_called_count: (d) => toolCalledCount(d.tool_name!, d.min_count ?? 1, d.max_count),
  text_contains: (d) => textContains(d.pattern!, { caseSensitive: d.case_sensitive, regex: d.regex }),
  text_not_contains: (d) => textNotContains(d.pattern!, { caseSensitive: d.case_sensitive }),
  tool_called_before: (d) => toolCalledBefore(d.first!, d.second!),
  tool_call_arg_contains: (d) => toolCallArgContains(d.tool_name!, d.arg_name!, d.pattern!),
  text_before_tool: (d) => textBeforeTool(d.pattern!, d.tool_name!),
  text_contains_question: (d) => textContainsQuestion(d.pattern!),
};

export function parseAssertion(def: AssertionDef): Assertion {
  const factory = ASSERTION_FACTORIES[def.type];
  if (!factory) throw new Error(`Unknown assertion type: ${def.type}`);
  return factory(def);
}
