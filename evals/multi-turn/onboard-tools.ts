import type Anthropic from "@anthropic-ai/sdk";
import type { MockState, Scenario, AskAnswerDef, BashResponseDef, ToolResponseDef } from "./types.js";
import type { SkillHarness } from "./driver.js";
import { MOCK_TOOLS, dispatchTool } from "./tools.js";

export const SIGNUP_CLIENT_ID = "82qMvwZvqd3t3S0gRDvs8R53TehQXSJY";
export const REGULAR_CLIENT_ID = "2fG3H4RhlAbIZm9Rfn32zTaILH7w1X4w";

function mockJwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none", typ: "JWT" })}.${b64(claims)}.mocksignature`;
}

/** Token from the signup client — no org claims yet. */
export const MOCK_SIGNUP_JWT = mockJwt({
  email: "jane+test@acme.com",
  exp: 9999999999,
});

/** Org-scoped token from the regular client after account creation. */
export const MOCK_ORG_JWT = mockJwt({
  "https://confidence.dev/region": "EU",
  "https://confidence.dev/account_name": "accounts/acme-mock",
  org_id: "org_mock123",
  email: "jane+test@acme.com",
  exp: 9999999999,
});

export const MOCK_CLIENT_SECRET = "mock-client-secret-abc123";

const ONBOARD_PREAMBLE = `You are in an eval environment. The tools available to you (Bash, AskUserQuestion, and the MCP tools) are fully functional — use them exactly as the skill instructs.
- The skill base directory is /mock/skills/onboard-confidence — the bundled auth.py lives there.
- Browser-based login is simulated: the auth script completes immediately and prints its result on stdout.
- The confidence-flags and confidence-docs MCP tools are connected and functional, unless a tool call result tells you otherwise.
- Do NOT skip telemetry — follow the skill's telemetry instructions exactly.
- Present all summaries and step trackers inline in your response.

`;

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
      dangerouslyDisableSandbox: { type: "boolean", description: "Run outside the sandbox" },
      timeout: { type: "number", description: "Timeout in milliseconds" },
      run_in_background: { type: "boolean", description: "Run in the background" },
    },
    required: ["command"],
  },
};

const ASK_USER_QUESTION_TOOL: Anthropic.Tool = {
  name: "AskUserQuestion",
  description:
    "Ask the user one or more multiple-choice questions. Presents options as selectable items and returns the user's selections.",
  input_schema: {
    type: "object" as const,
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question: { type: "string", description: "The complete question to ask" },
            header: { type: "string", description: "Short label (max 12 chars)" },
            options: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string", description: "Display text of the choice" },
                  description: { type: "string", description: "What this option means" },
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

const mcpToolDef = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
): Anthropic.Tool => ({
  name: `mcp__confidence_flags__${name}`,
  description,
  input_schema: { type: "object" as const, properties, required },
});

const ONBOARD_MCP_TOOLS: Anthropic.Tool[] = [
  mcpToolDef("getIdentityInfo", "Get the current user's identity and account memberships.", {}),
  mcpToolDef(
    "createClient",
    "Create an SDK client.",
    {
      displayName: { type: "string", description: "Human-readable client name" },
      clientType: { type: "string", description: "frontend or backend" },
    },
    ["displayName"],
  ),
  mcpToolDef(
    "getClientSecret",
    "Retrieve the client secret for a client. Only returned once.",
    { clientName: { type: "string", description: "Client resource name" } },
    ["clientName"],
  ),
  mcpToolDef(
    "createClientCredential",
    "Create a new credential (secret) for a client.",
    {
      clientName: { type: "string", description: "Client resource name" },
      displayName: { type: "string", description: "Credential display name" },
    },
    ["clientName"],
  ),
  mcpToolDef(
    "inviteUser",
    "Invite a user to the account by email.",
    {
      email: { type: "string", description: "Email address to invite" },
      disableInvitationEmail: { type: "string", description: "true to skip the invitation email" },
    },
    ["email"],
  ),
  mcpToolDef("checkWarehouseExists", "Check whether a data warehouse is already configured.", {}),
  mcpToolDef(
    "validateWarehouseConfig",
    "Validate a data warehouse configuration before creating it.",
    {
      warehouseType: { type: "string", description: "bigquery, snowflake, databricks, or redshift" },
      configJson: { type: "string", description: "JSON warehouse config" },
    },
    ["warehouseType", "configJson"],
  ),
  mcpToolDef(
    "createWarehouse",
    "Create a data warehouse connection.",
    {
      warehouseType: { type: "string", description: "bigquery, snowflake, databricks, or redshift" },
      configJson: { type: "string", description: "JSON warehouse config" },
    },
    ["warehouseType", "configJson"],
  ),
  mcpToolDef(
    "createFlagAppliedConnection",
    "Create a connector that writes flag-assignment data to the warehouse.",
    {
      warehouseType: { type: "string", description: "Warehouse type" },
      configJson: { type: "string", description: "JSON connection config incl. table" },
    },
    ["warehouseType", "configJson"],
  ),
  mcpToolDef(
    "createEventConnection",
    "Create a connector that writes custom events to the warehouse.",
    {
      warehouseType: { type: "string", description: "Warehouse type" },
      configJson: { type: "string", description: "JSON connection config incl. tablePrefix" },
    },
    ["warehouseType", "configJson"],
  ),
  mcpToolDef(
    "createAssignmentTable",
    "Create an assignment table for metric analysis.",
    {
      displayName: { type: "string", description: "Assignment table display name" },
      sql: { type: "string", description: "SQL selecting assignment rows" },
      entityColumn: { type: "string", description: "Entity column name" },
      timestampColumn: { type: "string", description: "Timestamp column name" },
      exposureKeyColumn: { type: "string", description: "Exposure key column name" },
      variantKeyColumn: { type: "string", description: "Variant key column name" },
    },
    ["displayName", "sql"],
  ),
  {
    name: "mcp__confidence_docs__searchDocumentation",
    description: "Search the Confidence documentation.",
    input_schema: {
      type: "object" as const,
      properties: { query: { type: "string", description: "Search query" } },
      required: ["query"],
    },
  },
  {
    name: "mcp__confidence_docs__getCodeSnippetAndSdkIntegrationTips",
    description: "Get SDK integration code snippets for a platform.",
    input_schema: {
      type: "object" as const,
      properties: { platform: { type: "string", description: "e.g. JavaScript, Python, Swift" } },
      required: ["platform"],
    },
  },
];

const ONBOARD_TOOLS: Anthropic.Tool[] = [
  BASH_TOOL,
  ASK_USER_QUESTION_TOOL,
  ...ONBOARD_MCP_TOOLS,
  ...MOCK_TOOLS,
];

// ---------------------------------------------------------------------------
// Bash mock: regex-routed canned responses
// ---------------------------------------------------------------------------

interface BashRoute {
  match: RegExp;
  response: string;
}

const DEFAULT_BASH_ROUTES: BashRoute[] = [
  {
    match: new RegExp(`auth\\.py\\s+${SIGNUP_CLIENT_ID}`),
    response: `WAITING_FOR_LOGIN\nTOKEN:${MOCK_SIGNUP_JWT}\nREFRESH_TOKEN:mock-refresh-token-signup`,
  },
  {
    match: new RegExp(`auth\\.py\\s+${REGULAR_CLIENT_ID}`),
    response: `WAITING_FOR_LOGIN\nTOKEN:${MOCK_ORG_JWT}\nREFRESH_TOKEN:mock-refresh-token-org`,
  },
  {
    match: /userinfo/,
    response: JSON.stringify({ email: "jane+test@acme.com", name: "Jane Doe", email_verified: true }),
  },
  { match: /loginIdAvailability/, response: JSON.stringify({ available: true }) },
  { match: /country:validate/, response: JSON.stringify({ allowed: true }) },
  { match: /agentTelemetryKey/, response: "" },
  { match: /events:publish/, response: "" },
  {
    match: /\/v1\/accounts/,
    response: `${JSON.stringify({ name: "accounts/acme-mock", externalId: "ext-123", loginId: "acme", displayName: "Acme Inc" })}\n200`,
  },
  { match: /learningProgress/, response: "{}" },
  // Token save (echo > file) must be matched before the python token check.
  { match: /echo\s+"?ey[\w.-]*"?\s*>.*confidence_token/, response: "" },
  {
    match: /python3[\s\S]*confidence_token/,
    response: "VALID\nREGION=EU\nORG=org_mock123\nACCOUNT=accounts/acme-mock",
  },
  { match: /which gcloud/, response: "/usr/local/bin/gcloud" },
  { match: /which bq/, response: "/usr/local/bin/bq" },
  { match: /(ls|find|cat).*\/mock\/skills/, response: "auth.py\nSKILL.md" },
  {
    match: /ls .*TMPDIR/,
    response: "confidence_token\nconfidence_refresh_token\nconfidence_session_id\nconfidence_telemetry_key\nconfidence_step_start",
  },
  { match: /bq query/, response: JSON.stringify([{ count: "42" }]) },
  { match: /bq (mk|update)/, response: "Dataset created." },
  { match: /gcloud /, response: "Updated IAM policy." },
  { match: /date \+%s/, response: "" },
];

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

interface OnboardState {
  base: MockState;
  clientCounter: number;
  bashOverrideIndices: number[];
  toolOverrideIndices: Map<string, number>;
}

function createOnboardState(scenario: Scenario): OnboardState {
  return {
    base: {
      flags: new Map(),
      clients: [],
      contextFields: ["visitor_id"],
    },
    clientCounter: 0,
    bashOverrideIndices: scenario.bashResponses.map(() => 0),
    toolOverrideIndices: new Map(),
  };
}

function handleBash(command: string, overrides: BashResponseDef[], state: OnboardState): string {
  for (let i = 0; i < overrides.length; i++) {
    if (new RegExp(overrides[i].match).test(command)) {
      const responses = overrides[i].responses;
      const idx = Math.min(state.bashOverrideIndices[i], responses.length - 1);
      state.bashOverrideIndices[i]++;
      return responses[idx];
    }
  }
  for (const route of DEFAULT_BASH_ROUTES) {
    if (route.match.test(command)) return route.response;
  }
  // Plain echo/printf (models sometimes probe whether the shell works):
  // echo the literal back so the shell behaves believably.
  const echoMatch = command.match(/^\s*(?:echo|printf)\s+"?([^"\n;|&]*)"?/);
  if (echoMatch) return echoMatch[1].trim();
  console.warn(`[onboard-mock] unrouted bash command: ${command.slice(0, 120)}`);
  return "";
}

interface AskQuestion {
  question?: string;
  header?: string;
  options?: Array<{ label?: string; description?: string }>;
}

function handleAskUserQuestion(
  input: Record<string, unknown>,
  askAnswers: AskAnswerDef[],
): string {
  const questions = (input.questions as AskQuestion[]) || [];
  const answers = questions.map((q) => {
    const haystack = `${q.question ?? ""} ${q.header ?? ""} ${(q.options ?? [])
      .map((o) => o.label ?? "")
      .join(" ")}`;
    const scripted = askAnswers.find((a) => new RegExp(a.match, "i").test(haystack));
    let answer = scripted?.answer;
    if (answer === undefined) {
      answer = q.options?.[0]?.label ?? "yes";
      console.warn(
        `[onboard-mock] no scripted answer for question "${(q.question ?? "").slice(0, 80)}" — defaulting to "${answer}"`,
      );
    }
    return `"${q.question ?? q.header}" → "${answer}"`;
  });
  return `User has answered the questions: ${answers.join(", ")}`;
}

function handleMcpTool(shortName: string, input: Record<string, unknown>, state: OnboardState): string {
  switch (shortName) {
    case "getIdentityInfo":
      return JSON.stringify({
        user: { name: "users/mock-user", fullName: "Jane Doe", email: "jane+test@acme.com" },
        account: "accounts/acme-mock",
        accountMemberships: [
          { account: "accounts/acme-mock", displayName: "Acme Inc", loginId: "acme", region: "EU" },
        ],
        identity: { name: "identities/mock", displayName: "Jane Doe" },
      });
    case "createClient": {
      state.clientCounter++;
      const client = {
        name: `clients/mock-client-${state.clientCounter}`,
        displayName: (input.displayName as string) || "Unnamed client",
      };
      state.base.clients.push(client);
      return JSON.stringify({ ...client, clientType: input.clientType ?? "frontend" });
    }
    case "getClientSecret":
      return JSON.stringify({ clientSecret: MOCK_CLIENT_SECRET });
    case "createClientCredential":
      return JSON.stringify({
        name: `${input.clientName}/clientCredentials/cred-1`,
        clientSecret: { secret: MOCK_CLIENT_SECRET },
      });
    case "inviteUser": {
      const email = (input.email as string) || "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return `Error: invalid email address: '${email}'`;
      }
      return `Invitation sent to ${email}. Invitation URL: https://confidence.spotify.com/invite/mock`;
    }
    case "checkWarehouseExists":
      return JSON.stringify({ exists: false });
    case "validateWarehouseConfig":
      return JSON.stringify({
        successful: true,
        validation: [
          { check: "connection", status: "OK" },
          { check: "permissions", status: "OK" },
        ],
      });
    case "createWarehouse":
      return JSON.stringify({ name: "dataWarehouses/mock-warehouse" });
    case "createFlagAppliedConnection":
      return JSON.stringify({ name: "flagAppliedConnections/mock-fac" });
    case "createEventConnection":
      return JSON.stringify({ name: "eventConnections/mock-ec" });
    case "createAssignmentTable":
      return JSON.stringify({ name: "assignmentTables/mock-at" });
    case "searchDocumentation":
      return "Feature flags let you control functionality without deploying. Targeting rules assign variants to users based on evaluation context. Experiments compare variants using metrics with statistical rigor.";
    case "getCodeSnippetAndSdkIntegrationTips":
      return `// Confidence SDK setup for ${input.platform ?? "your platform"}\nconst confidence = Confidence.create({ clientSecret: "<CLIENT_SECRET>" });\nconst flag = await confidence.resolveFlag("my-flag", defaultValue);`;
    default:
      return dispatchTool(`mcp__confidence_flags__${shortName}`, input, state.base);
  }
}

export const onboardHarness: SkillHarness = {
  preamble: ONBOARD_PREAMBLE,
  skillDirs: (scenario: Scenario) => scenario.skills ?? [scenario.skill],
  tools: ONBOARD_TOOLS,
  createDispatcher: (scenario: Scenario) => {
    const state = createOnboardState(scenario);
    return (name: string, input: Record<string, unknown>): string => {
      if (name === "Bash") {
        return handleBash((input.command as string) || "", scenario.bashResponses, state);
      }
      if (name === "AskUserQuestion") {
        return handleAskUserQuestion(input, scenario.askAnswers);
      }

      const shortName = name.replace(/^mcp__confidence_(flags|docs)__/, "");

      // Scenario-scripted override for any MCP tool (e.g. a failing
      // getIdentityInfo before the user authenticates the MCP server).
      const override = scenario.toolResponses.find((t) => t.tool === shortName);
      if (override) {
        const idx = Math.min(state.toolOverrideIndices.get(shortName) ?? 0, override.responses.length - 1);
        state.toolOverrideIndices.set(shortName, idx + 1);
        return override.responses[idx];
      }

      return handleMcpTool(shortName, input, state);
    };
  },
};
