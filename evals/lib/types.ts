export interface TestCase {
  name: string;
  description: string;
  tags: string[];
  input: {
    user_message: string;
    flag: Record<string, unknown>;
  };
  expected: {
    scope: string;
    flag_shape: string;
    blocked_reason?: string | null;
    plan_includes?: string[];
    plan_excludes?: string[];
    targeting_rules?: Array<Record<string, unknown>>;
    catch_all?: { variant: string; allocation: number };
    resolutions?: Array<{
      context: Record<string, unknown>;
      variant: string;
    }>;
  };
}

export interface TaskOutput {
  raw_text: string;
  parsed: ParsedOutput | null;
}

export interface ParsedOutput {
  flag_shape?: string;
  scope?: string;
  blocked_reason?: string | null;
  backend?: string | null;
  targeting_rules?: unknown[];
  variants?: unknown[];
}
