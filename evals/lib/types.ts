export interface GroundTruth {
  flag_shape: "boolean" | "struct";
  scope: "migrate" | "blocked" | "excluded" | "archived";
  blocked_reason: string | null;
  backend: "MCP" | "REST" | null;
}

export interface FlagFixture {
  key: string;
  name: string;
  description: string;
  archived: boolean;
  variable_definitions: Record<string, unknown>;
  variations: Array<{ key: string; name?: string; variables?: Record<string, unknown> }>;
  ruleset: {
    enabled: boolean;
    default_variation_key: string;
    rule_priorities: string[];
    rules: Record<string, {
      key: string;
      name: string;
      type: string;
      enabled: boolean;
      percentage_included: number;
      distribution_mode: string;
      audience_conditions: unknown[];
      audience_ids: number[];
      variations: Record<string, { key: string; percentage_included: number; variation_id: number }>;
    }>;
  } | null;
  referenced_audiences: Record<string, {
    id: number;
    name: string;
    conditions: string;
  }>;
  ground_truth: GroundTruth;
}

export interface FixtureData {
  environment: string;
  flags: FlagFixture[];
}

export interface EvalInput {
  flag: FlagFixture;
}

export interface EvalOutput {
  flag_shape: string;
  scope: string;
  blocked_reason: string | null;
  backend: string | null;
  targeting_rules?: unknown[];
  variants?: unknown[];
}
