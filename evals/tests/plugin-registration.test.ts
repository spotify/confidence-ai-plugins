import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { ValidExplorerURL } from "../lib/scorers/explore-metric.js";
import { ONBOARD_DATA_OUTPUT_TOOL, readOnboardDataAnswer } from "../lib/onboard-data-output-tool.js";

const read = (path: string) => readFileSync(resolve(path), "utf8");
const json = (path: string) => JSON.parse(read(path));

test("data MCP registration agrees across plugin hosts without removing flags/docs", () => {
  const mcp = json(".mcp.json").mcpServers;
  const gemini = json("gemini-extension.json");
  assert.deepEqual(Object.keys(mcp).sort(), ["confidence-data", "confidence-docs", "confidence-flags"]);
  assert.equal(mcp["confidence-data"].url, "https://mcp.confidence.dev/mcp/data");
  assert.equal(mcp["confidence-data"].headers["x-confidence-mcp-consumer"], "plugin");
  for (const name of Object.keys(mcp)) {
    assert.equal(gemini.mcpServers[name].command, "npx");
    assert.ok(gemini.mcpServers[name].args.some((arg: string) => arg.includes(mcp[name].url)));
  }
  assert.ok(gemini.settings.some((setting: { envVar: string }) => setting.envVar === "CONFIDENCE_MCP_DATA_URL"));
  // Claude discovers the root .mcp.json by convention; Cursor/Codex reference it explicitly.
  assert.equal(json(".claude-plugin/plugin.json").name, "confidence");
  for (const file of [".cursor-plugin/plugin.json", ".codex-plugin/plugin.json"]) {
    const config = json(file);
    assert.equal(config.mcpServers, "./.mcp.json");
  }
});

test("onboard-data command delegates to one canonical skill and exposes follow-up operations", () => {
  const command = read("commands/onboard-data.md");
  const frontmatter = parse(command.split("---")[1]);
  assert.equal(frontmatter.name, "onboard-data");
  assert.ok(command.includes("skills/onboard-data/SKILL.md"));
  const skill = read("skills/onboard-data/SKILL.md");
  assert.equal(parse(skill.split("---")[1]).name, "onboard-data");
  for (const operation of ["resume", "status", "retry", "resolve", "include", "replace", "refresh"]) {
    assert.ok(frontmatter["argument-hint"].includes(operation), operation);
    assert.ok(skill.includes(operation), operation);
  }
  for (const file of ["README.md", "AGENTS.md", "CLAUDE.md", "GEMINI.md"]) {
    assert.ok(read(file).includes("/confidence:onboard-data"), file);
    assert.ok(read(file).includes("confidence-data"), file);
  }
});

test("command delegation uses the installed skill even from an unrelated project", () => {
  const root = resolve(".");
  const command = read("commands/onboard-data.md");
  const target = command.match(/`(\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/onboard-data\/SKILL\.md)`/)?.[1];
  assert.ok(target, "Claude command must anchor the initial read to its installed plugin");
  const project = mkdtempSync(join(tmpdir(), "onboard-data-project-"));
  try {
    mkdirSync(join(project, "skills/onboard-data"), { recursive: true });
    writeFileSync(join(project, "skills/onboard-data/SKILL.md"), "unrelated project skill");
    const installed = target.replace("${CLAUDE_PLUGIN_ROOT}", root);
    assert.equal(readFileSync(resolve(project, installed), "utf8"), read("skills/onboard-data/SKILL.md"));
    assert.ok(command.includes("absolute installed skill directory"));
    assert.ok(command.includes("ask for it"));
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("eval CLI fails before model calls if a required safety reference cannot load", () => {
  const root = resolve(".");
  const project = mkdtempSync(join(tmpdir(), "onboard-data-eval-"));
  try {
    mkdirSync(join(project, "skills/onboard-data/references"), { recursive: true });
    for (const file of ["SKILL.md", "references/capabilities.md", "references/local-progress.md", "references/review.md", "references/acceptance-scenarios.md"]) {
      writeFileSync(join(project, "skills/onboard-data", file), read(`skills/onboard-data/${file}`));
    }
    const scripts = json("package.json").scripts;
    for (const name of ["eval:onboard-data", "eval:onboard-data:local"]) {
      assert.ok(scripts[name].includes("--terminate-on-failure"), name);
    }
    const result = spawnSync(process.execPath, [
      join(root, "node_modules/braintrust/dist/cli.js"), "eval", "--terminate-on-failure",
      "--no-send-logs", join(root, "evals/onboard-data.eval.ts"),
    ], {
      cwd: project,
      env: { PATH: process.env.PATH, HOME: project, ONBOARD_DATA_BASELINE: "0" },
      encoding: "utf8", timeout: 20_000,
    });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /Missing skill file:.*recovery\.md/);
    assert.ok(!(result.stdout + result.stderr).includes("Processing 1 evaluators"));
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("onboard-data skill references resolve within its installed directory", () => {
  const skill = read("skills/onboard-data/SKILL.md");
  const references = [...skill.matchAll(/references\/[a-z0-9-]+\.md/g)].map(match => match[0]);
  assert.ok(references.length > 0);
  for (const reference of references) {
    assert.ok(existsSync(resolve("skills/onboard-data", reference)), reference);
  }
});

test("structured eval answer transport requires exactly one named output, not a warehouse call", () => {
  const answer = { decision: "blocked" };
  const block = { type: "tool_use" as const, name: ONBOARD_DATA_OUTPUT_TOOL.name, id: "answer", input: answer };
  assert.equal(readOnboardDataAnswer([block]), JSON.stringify(answer));
  assert.throws(() => readOnboardDataAnswer([{ type: "text", text: "```json {} ```", citations: null }]), /exactly one/);
  assert.throws(() => readOnboardDataAnswer([block, block]), /exactly one/);
  assert.throws(() => readOnboardDataAnswer([{ ...block, name: "createFactTable" }]), /exactly one/);
  assert.equal(ONBOARD_DATA_OUTPUT_TOOL.input_schema.additionalProperties, false);
});

test("Metric Explorer URL scorer parses query parameters before validating their values", () => {
  const prefix = "https://app.confidence.spotify.com/metrics/explorer?factTable=factTables%2Fevents&entity=entities%2Fuser";
  const score = (query: string) => ValidExplorerURL({ output: { raw_text: prefix + query, parsed: null } });
  assert.equal(score("&kind=consumption&agg=sum").score, 1);
  assert.ok(score("&kind=invalid&agg=invalid").score < 1);
  assert.ok(score("&kind=consumption").score < 1);
});
