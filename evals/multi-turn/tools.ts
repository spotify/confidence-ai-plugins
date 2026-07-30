import type Anthropic from "@anthropic-ai/sdk";
import type { MockState, MockFlag } from "./types.js";
import { resolve } from "../lib/resolver.js";
import type { TargetingRule, CatchAll } from "../lib/resolver.js";

export function createMockState(): MockState {
  return {
    flags: new Map(),
    clients: [{ name: "clients/test-app-id", displayName: "test-app" }],
    contextFields: ["user_id"],
  };
}

const toolDef = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
): Anthropic.Tool => ({
  name: `mcp__confidence_flags__${name}`,
  description,
  input_schema: {
    type: "object" as const,
    properties,
    required,
  },
});

export const MOCK_TOOLS: Anthropic.Tool[] = [
  toolDef("listClients", "List all SDK clients for the account.", {}),
  toolDef(
    "createFlag",
    "Create a feature flag with schema, variants, and client attachment.",
    {
      flagName: { type: "string", description: "Flag name (kebab-case)" },
      description: { type: "string", description: "Flag description" },
      clientName: { type: "string", description: "Client resource name" },
      schemaObject: { type: "string", description: "JSON schema string" },
      variants: { type: "string", description: "JSON array of variants" },
    },
    ["flagName", "clientName", "schemaObject", "variants"],
  ),
  toolDef(
    "addTargetingRule",
    "Add a targeting rule with criteria/expression payload and variant allocations.",
    {
      flagName: { type: "string", description: "Flag name" },
      variantAllocations: { type: "string", description: "JSON map of variant→percent" },
      payload: { type: "string", description: "JSON targeting payload with criteria + expression" },
      targetingKey: { type: "string", description: "Bucketing key" },
      rolloutPercentage: { type: "string", description: "Rollout percentage 0-100 (default 100)" },
    },
    ["flagName", "variantAllocations"],
  ),
  toolDef(
    "addFlagToClient",
    "Associate a flag with a client.",
    {
      flagName: { type: "string", description: "Flag name" },
      clientName: { type: "string", description: "Client resource name" },
    },
    ["flagName", "clientName"],
  ),
  toolDef(
    "resolveFlag",
    "Resolve a flag for a given context to test it works correctly.",
    {
      flagName: { type: "string", description: "Flag name" },
      clientName: { type: "string", description: "Client resource name" },
      entity: { type: "string", description: "Entity type" },
      entityValue: { type: "string", description: "Entity value" },
      context: { type: "string", description: "JSON evaluation context" },
    },
    ["flagName", "clientName"],
  ),
  toolDef(
    "addContextField",
    "Add a context field to the evaluation context schema.",
    {
      fieldName: { type: "string", description: "Field name" },
      fieldType: { type: "string", description: "Field type (string, number, boolean)" },
      entityType: { type: "string", description: "Entity type reference" },
    },
    ["fieldName", "fieldType"],
  ),
  toolDef(
    "getContextSchema",
    "Get the evaluation context schema for a client.",
    {
      clientName: { type: "string", description: "Client resource name" },
    },
    [],
  ),
  toolDef(
    "archiveFlag",
    "Archive a feature flag.",
    {
      flagName: { type: "string", description: "Flag name" },
    },
    ["flagName"],
  ),
  toolDef(
    "listFlags",
    "List all feature flags.",
    {},
  ),
  toolDef(
    "getFlag",
    "Get details of a specific feature flag.",
    {
      flagName: { type: "string", description: "Flag name" },
    },
    ["flagName"],
  ),
  toolDef(
    "batchCreateFlags",
    "Create multiple flags in a single call.",
    {
      clientName: { type: "string", description: "Client resource name" },
      flags: { type: "string", description: "JSON array of flag definitions" },
    },
    ["clientName", "flags"],
  ),
  toolDef(
    "batchAddTargetingRules",
    "Add targeting rules to multiple flags in a single call.",
    {
      rules: { type: "string", description: "JSON array of rule definitions" },
      targetingKey: { type: "string", description: "Bucketing key" },
    },
    ["rules"],
  ),
  toolDef(
    "addFlagVariant",
    "Add a variant to an existing flag.",
    {
      flagName: { type: "string", description: "Flag name" },
      variantName: { type: "string", description: "Variant name" },
      variantValue: { type: "string", description: "JSON value for the variant" },
    },
    ["flagName", "variantName", "variantValue"],
  ),
  toolDef(
    "updateFlagSchema",
    "Update the schema of an existing flag.",
    {
      flagName: { type: "string", description: "Flag name" },
      schemaObject: { type: "string", description: "JSON schema string" },
    },
    ["flagName", "schemaObject"],
  ),
];

function normalizeFlagName(name: string): string {
  return name.replace(/^flags\//, "");
}

function handleListClients(state: MockState): string {
  return JSON.stringify({ clients: state.clients });
}

function handleCreateFlag(input: Record<string, unknown>, state: MockState): string {
  const flagName = normalizeFlagName(input.flagName as string);
  let variants: string[] = ["on", "off"];
  try {
    const parsed = JSON.parse(input.variants as string);
    if (Array.isArray(parsed)) {
      variants = parsed.map((v: Record<string, unknown>) => (v.name as string || v.displayName as string || "unknown").replace(/.*\/variants\//, ""));
    }
  } catch { /* use defaults */ }

  state.flags.set(flagName, { name: flagName, variants, rules: [] });
  return `Flag 'flags/${flagName}' created successfully with variants: ${variants.join(", ")}. Flag is now attached to client.`;
}

function handleAddTargetingRule(input: Record<string, unknown>, state: MockState): string {
  const flagName = normalizeFlagName(input.flagName as string);
  const flag = state.flags.get(flagName);

  let payload: MockFlag["rules"][0]["payload"] | undefined;
  if (input.payload) {
    try {
      payload = typeof input.payload === "string" ? JSON.parse(input.payload) : input.payload as MockFlag["rules"][0]["payload"];
    } catch { /* no payload = catch-all */ }
  }

  let allocations: Record<string, number> = {};
  try {
    allocations = typeof input.variantAllocations === "string"
      ? JSON.parse(input.variantAllocations)
      : input.variantAllocations as Record<string, number>;
  } catch { /* empty */ }

  const rule = { payload, variantAllocations: allocations };
  if (flag) {
    flag.rules.push(rule);
  }

  const allocationDesc = Object.entries(allocations)
    .map(([v, p]) => `'${v}' at ${p}%`)
    .join(", ");
  let msg = `Created a conditional targeting rule with allocation: ${allocationDesc}`;
  if (input.rolloutPercentage && Number(input.rolloutPercentage) < 100) {
    msg += ` (rollout: ${input.rolloutPercentage}%)`;
  }
  return msg;
}

function handleResolveFlag(input: Record<string, unknown>, state: MockState): string {
  const flagName = normalizeFlagName(input.flagName as string);
  const flag = state.flags.get(flagName);
  if (!flag) return JSON.stringify({ error: `Flag '${flagName}' not found` });

  let ctx: Record<string, unknown> = {};
  try {
    ctx = typeof input.context === "string" ? JSON.parse(input.context) : (input.context as Record<string, unknown>) || {};
  } catch { /* empty context */ }

  const rules: TargetingRule[] = flag.rules.map((r) => ({
    payload: r.payload as TargetingRule["payload"],
    variantAllocations: r.variantAllocations,
  }));

  const lastRule = flag.rules[flag.rules.length - 1];
  let catchAll: CatchAll | undefined;
  if (lastRule && !lastRule.payload) {
    const variant = Object.keys(lastRule.variantAllocations)[0];
    catchAll = { variant, allocation: 100 };
  }

  try {
    const result = resolve(rules, catchAll, ctx);
    return JSON.stringify({
      flag: `flags/${flagName}`,
      variant: result.variant,
      reason: result.isCatchAll ? "catch-all (default)" : `rule match (rule ${result.ruleIndex})`,
    });
  } catch (e) {
    return JSON.stringify({ flag: `flags/${flagName}`, error: (e as Error).message });
  }
}

function handleAddContextField(input: Record<string, unknown>, state: MockState): string {
  const fieldName = input.fieldName as string;
  state.contextFields.push(fieldName);
  return `Context field '${fieldName}' added successfully.`;
}

function handleGetContextSchema(state: MockState): string {
  const fields = state.contextFields.map((f) => ({ name: f, type: "string" }));
  return JSON.stringify({ fields });
}

function handleListFlags(state: MockState): string {
  const flags = Array.from(state.flags.values()).map((f) => ({
    name: `flags/${f.name}`,
    displayName: f.name,
    variants: f.variants,
    rulesCount: f.rules.length,
  }));
  return JSON.stringify({ flags });
}

export function dispatchTool(
  name: string,
  input: Record<string, unknown>,
  state: MockState,
): string {
  const shortName = name.replace(/^mcp__confidence_flags__/, "");

  switch (shortName) {
    case "listClients": return handleListClients(state);
    case "createFlag": return handleCreateFlag(input, state);
    case "addTargetingRule": return handleAddTargetingRule(input, state);
    case "addFlagToClient": return `Flag '${input.flagName}' added to client '${input.clientName}'.`;
    case "resolveFlag": return handleResolveFlag(input, state);
    case "addContextField": return handleAddContextField(input, state);
    case "getContextSchema": return handleGetContextSchema(state);
    case "archiveFlag": return `Flag '${input.flagName}' archived successfully.`;
    case "listFlags": return handleListFlags(state);
    case "getFlag": {
      const fn = normalizeFlagName(input.flagName as string);
      const f = state.flags.get(fn);
      return f ? JSON.stringify({ name: `flags/${fn}`, variants: f.variants, rulesCount: f.rules.length }) : `Flag '${fn}' not found.`;
    }
    case "batchCreateFlags": {
      try {
        const flags = JSON.parse(input.flags as string) as Array<Record<string, unknown>>;
        const results = flags.map((f) => handleCreateFlag({ ...f, clientName: input.clientName }, state));
        return `Batch created ${flags.length} flags.\n${results.join("\n")}`;
      } catch { return "Batch create failed: invalid JSON."; }
    }
    case "batchAddTargetingRules": {
      try {
        const rules = JSON.parse(input.rules as string) as Array<Record<string, unknown>>;
        const results = rules.map((r) => handleAddTargetingRule(r, state));
        return `Batch added ${rules.length} targeting rules.\n${results.join("\n")}`;
      } catch { return "Batch add rules failed: invalid JSON."; }
    }
    case "addFlagVariant": return `Variant '${input.variantName}' added to flag '${input.flagName}'.`;
    case "updateFlagSchema": return `Schema updated for flag '${input.flagName}'.`;
    default:
      console.warn(`[mock] unrecognized tool: ${name}`);
      return `Tool '${name}' executed successfully.`;
  }
}
