import type Anthropic from "@anthropic-ai/sdk";
import type { Scenario, AskAnswerDef, BashResponseDef, ToolResponseDef } from "./types.js";
import type { SkillHarness } from "./driver.js";

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const BASH_TOOL: Anthropic.Tool = {
  name: "Bash",
  description: "Executes a bash command and returns its output.",
  input_schema: {
    type: "object" as const,
    properties: {
      command: { type: "string", description: "The command to execute" },
      description: { type: "string", description: "Description of what this command does" },
      dangerouslyDisableSandbox: { type: "boolean" },
      timeout: { type: "number" },
    },
    required: ["command"],
  },
};

const ASK_USER_QUESTION_TOOL: Anthropic.Tool = {
  name: "AskUserQuestion",
  description: "Ask the user one or more multiple-choice questions.",
  input_schema: {
    type: "object" as const,
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            header: { type: "string" },
            options: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  description: { type: "string" },
                },
                required: ["label"],
              },
            },
            multiSelect: { type: "boolean" },
          },
          required: ["question", "header", "options"],
        },
      },
    },
    required: ["questions"],
  },
};

const mcpTool = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
): Anthropic.Tool => ({
  name: `mcp__confidence_flags__${name}`,
  description,
  input_schema: { type: "object" as const, properties, required },
});

const INSTRUMENT_MCP_TOOLS: Anthropic.Tool[] = [
  mcpTool("getIdentityInfo", "Get the current user's identity.", {}),
  mcpTool("listEventDefinitions", "List all event definitions.", {
    pageToken: { type: "string" },
  }),
  mcpTool(
    "createEventDefinition",
    "Create an event definition with typed schema. Include semanticType.entityReference on identifier fields.",
    {
      eventDefinitionId: { type: "string", description: "Event ID (4-63 chars, [a-z0-9-])" },
      schema: { type: "string", description: "JSON schema with field types and optional entity references" },
      owner: { type: "string" },
    },
    ["eventDefinitionId", "schema"],
  ),
  mcpTool("getEventDefinition", "Get event definition details.", {
    name: { type: "string" },
  }, ["name"]),
  mcpTool("deleteEventDefinition", "Delete an event definition.", {
    name: { type: "string" },
  }, ["name"]),
  mcpTool("queryEventsUsage", "Query hourly event publish counts.", {
    eventDefinitionName: { type: "string" },
    daysBack: { type: "string" },
  }, ["eventDefinitionName"]),
  mcpTool("listFactTables", "List all fact tables.", {
    pageToken: { type: "string" },
  }),
  mcpTool("listEntities", "List all entities.", {
    pageToken: { type: "string" },
  }),
  mcpTool("checkWarehouseExists", "Check if a warehouse is configured.", {}),
  mcpTool("listExposureTables", "List all exposure tables.", {
    pageToken: { type: "string" },
  }),
  {
    name: "mcp__confidence_docs__searchDocumentation",
    description: "Search the Confidence documentation.",
    input_schema: {
      type: "object" as const,
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
];

const INSTRUMENT_TOOLS: Anthropic.Tool[] = [
  BASH_TOOL,
  ASK_USER_QUESTION_TOOL,
  ...INSTRUMENT_MCP_TOOLS,
];

// ---------------------------------------------------------------------------
// Mock responses
// ---------------------------------------------------------------------------

const MOCK_IDENTITY = JSON.stringify({
  name: "identities/mock-user",
  displayName: "Test User",
  type: "user",
  user: { email: "test@example.com" },
});

const MOCK_ENTITIES = `Found 3 entity(ies):
- Name: entities/user (User, primary key: string)
- Name: entities/visitor (Visitor, primary key: string)
- Name: entities/organization (Organization, primary key: string)`;

const MOCK_EMPTY_EVENT_DEFS = "There are no event definitions in this account.";

const MOCK_WAREHOUSE_EXISTS = "A data warehouse is configured for this account.";

const MOCK_EXPOSURE_TABLES = `Found 2 exposure table(s):
- Name: exposureTables/abc123
  Display name: Exposure for Checkout Test
  Entity: entities/visitor
  State: TABLE_STATE_ACTIVE
  Data delivered until: 2026-08-18T00:00:00Z
- Name: exposureTables/def456
  Display name: Exposure for Pricing Test
  Entity: entities/organization
  State: TABLE_STATE_ACTIVE
  Data delivered until: 2026-08-17T00:00:00Z`;

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

interface InstrumentState {
  createdEvents: Map<string, string>;
  toolOverrideIndices: Map<string, number>;
  bashOverrideIndices: number[];
}

function createState(scenario: Scenario): InstrumentState {
  return {
    createdEvents: new Map(),
    toolOverrideIndices: new Map(),
    bashOverrideIndices: scenario.bashResponses.map(() => 0),
  };
}

function handleBash(command: string, overrides: BashResponseDef[], state: InstrumentState): string {
  for (let i = 0; i < overrides.length; i++) {
    if (new RegExp(overrides[i].match).test(command)) {
      const responses = overrides[i].responses;
      const idx = Math.min(state.bashOverrideIndices[i], responses.length - 1);
      state.bashOverrideIndices[i]++;
      return responses[idx];
    }
  }
  if (/agentTelemetryKey/.test(command)) return "";
  if (/events:publish/.test(command)) return "";
  if (/date \+%s/.test(command)) return String(Math.floor(Date.now() / 1000));
  if (/uuidgen/.test(command)) return "mock-session-uuid";
  if (/cat.*confidence_/.test(command)) return "mock-value";
  if (/package\.json/.test(command)) return '{"name":"test-app","dependencies":{"react":"^18"}}';
  if (/grep|find|ls/.test(command)) return "";
  return "";
}

function handleAsk(input: Record<string, unknown>, askAnswers: AskAnswerDef[]): string {
  const questions = input.questions as Array<{ question: string; header?: string; options?: Array<{ label: string }> }>;
  if (!questions?.length) return "No questions provided.";

  const results: Record<string, string> = {};
  for (const q of questions) {
    const qText = `${q.question} ${q.header || ""} ${(q.options || []).map(o => o.label).join(" ")}`;
    let answered = false;
    for (const ans of askAnswers) {
      if (new RegExp(ans.match, "i").test(qText)) {
        results[q.question] = ans.answer;
        answered = true;
        break;
      }
    }
    if (!answered && q.options?.length) {
      results[q.question] = q.options[0].label;
    }
  }
  return `Your questions have been answered: ${JSON.stringify(results)}`;
}

function handleMcp(toolName: string, input: Record<string, unknown>, overrides: ToolResponseDef[], state: InstrumentState): string {
  const shortName = toolName.replace("mcp__confidence_flags__", "");

  for (const override of overrides) {
    if (override.tool === shortName) {
      const idx = state.toolOverrideIndices.get(shortName) ?? 0;
      const responses = override.responses;
      const response = responses[Math.min(idx, responses.length - 1)];
      state.toolOverrideIndices.set(shortName, idx + 1);
      return response;
    }
  }

  switch (shortName) {
    case "getIdentityInfo":
      return MOCK_IDENTITY;
    case "listEntities":
      return MOCK_ENTITIES;
    case "listEventDefinitions":
      if (state.createdEvents.size > 0) {
        const defs = [...state.createdEvents.entries()].map(
          ([id, schema]) => `- Name: eventDefinitions/${id}\n  Schema: ${schema}\n  Events published: 0`
        ).join("\n\n");
        return `Found ${state.createdEvents.size} event definition(s):\n\n${defs}`;
      }
      return MOCK_EMPTY_EVENT_DEFS;
    case "createEventDefinition": {
      const id = input.eventDefinitionId as string || "unknown";
      const schema = input.schema as string || "{}";
      state.createdEvents.set(id, schema);
      const hasEntityRef = /entityReference|entity_reference/i.test(schema);
      return `Successfully created event definition.\nName: eventDefinitions/${id}\nSchema fields: ${schema}\n${hasEntityRef ? "(entity reference detected)" : "(no entity reference)"}`;
    }
    case "getEventDefinition": {
      const name = (input.name as string || "").replace("eventDefinitions/", "");
      const schema = state.createdEvents.get(name);
      if (schema) return `Event Definition: eventDefinitions/${name}\nSchema: ${schema}\nUsage: Publish count: 0`;
      return `Event definition not found: ${name}`;
    }
    case "checkWarehouseExists":
      return MOCK_WAREHOUSE_EXISTS;
    case "listFactTables": {
      if (state.createdEvents.size > 0) {
        const tables = [...state.createdEvents.keys()].map(
          id => `- Name: factTables/${id}\n  Display name: Fact table for event ${id}\n  Timestamp column: _event_time\n  Entities: visitor_id -> entities/visitor\n  Measures: amount\n  Dimensions: action\n  State: TABLE_STATE_ACTIVE`
        ).join("\n\n");
        return `Found ${state.createdEvents.size} fact table(s):\n\n${tables}`;
      }
      return "There are no fact tables defined in this account.";
    }
    case "listExposureTables":
      return MOCK_EXPOSURE_TABLES;
    case "queryEventsUsage":
      return `Events usage for ${input.eventDefinitionName} (last 1 day(s)):\nTotal events published: 0\nTotal validation failures: 0`;
    default:
      if (toolName.includes("confidence_docs")) return "Documentation results: Use confidence.track('event-name', payload) to send events.";
      return `Unknown tool: ${toolName}`;
  }
}

// ---------------------------------------------------------------------------
// Harness export
// ---------------------------------------------------------------------------

export const instrumentEventsHarness: SkillHarness = {
  preamble: `You are in an eval environment. The tools available to you (Bash, AskUserQuestion, and the MCP tools) are fully functional — use them exactly as the skill instructs.
- The confidence-flags MCP tools are connected and functional.
- Do NOT skip telemetry — follow the skill's telemetry instructions.
- Present all summaries and step trackers inline in your response.
- ALWAYS mention /confidence:explore-metric as next step for metric preview.
- ALWAYS include semanticType.entityReference on at least one string field when creating event definitions.

`,
  skillDirs: (scenario: Scenario) => scenario.skills ?? ["instrument-events"],
  tools: INSTRUMENT_TOOLS,
  createDispatcher: (scenario: Scenario) => {
    const state = createState(scenario);
    return (name: string, input: Record<string, unknown>) => {
      if (name === "Bash") return handleBash(input.command as string, scenario.bashResponses, state);
      if (name === "AskUserQuestion") return handleAsk(input, scenario.askAnswers);
      if (name.startsWith("mcp__")) return handleMcp(name, input, scenario.toolResponses, state);
      return `Unknown tool: ${name}`;
    };
  },
};
