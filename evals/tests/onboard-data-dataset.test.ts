import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildOnboardDataDataset, loadOnboardDataCases } from "../lib/onboard-data-dataset.js";
import { loadOnboardDataPrompt, onboardDataEvalVariant, ONBOARD_DATA_REFERENCE_FILES } from "../lib/onboard-data-prompt.js";

const cases = loadOnboardDataCases();
test("loads 10–15 nonempty synthetic cases without importing provider SDKs", () => {
  assert.ok(cases.length >= 10 && cases.length <= 15);
  const dataset = buildOnboardDataDataset();
  assert.equal(dataset.length, cases.length);
  assert.equal(new Set(dataset.map(c => c.metadata.name)).size, dataset.length);
  for (const c of dataset) {
    assert.ok(c.input.user_message.trim());
    assert.ok(c.input.context.trim());
    assert.equal(c.metadata.synthetic, true);
    assert.equal(JSON.parse(c.input.context).synthetic, true);
    assert.ok(c.expected);
  }
  for (const tag of ["optional-goal", "paging", "finite-approval", "hidden-warnings", "pending", "subset", "status", "read-only", "readiness", "unknown-outcome", "no-recreate", "retry", "edits", "exclusion", "dependency-gate", "refresh", "no-delete", "context", "partial-completion", "no-required-question", "durable-progress"]) {
    assert.ok(cases.some(c => c.tags.includes(tag)), `missing coverage for ${tag}`);
  }
});
test("scale fixture really contains 300 distinct metadata tables and warnings outside the approval page", () => {
  const c = cases.find(c => c.name === "finite-300-table-review")!;
  const snapshot = JSON.parse(c.input.context);
  assert.equal(snapshot.discovery.total, 300);
  assert.equal(snapshot.discovery.inventory.length, 300);
  assert.equal(new Set(snapshot.discovery.inventory.map((t: { id: string }) => t.id)).size, 300);
  assert.equal(c.expected.review!.page_count, 15);
  assert.equal(c.expected.review!.page_size, 20);
  assert.equal(c.expected.review!.scope.length, 20);
  assert.deepEqual(c.expected.review!.scope, snapshot.page.ids);
  assert.ok(c.expected.review!.warnings.length > 0);
  assert.ok(c.expected.review!.warnings.every(id => !snapshot.page.ids.includes(id)));
  assert.equal(c.expected.review!.pending.length, 300);
  assert.deepEqual(c.expected.review!.pending, snapshot.discovery.inventory.map((t: { id: string }) => t.id));
  assert.deepEqual(c.expected.review!.warnings, snapshot.discovery.inventory.filter((t: { warnings: string[] }) => t.warnings.length).map((t: { id: string }) => t.id));
});
test("fixtures contain metadata, not sample rows or credentials", () => {
  function inspect(v: unknown): void {
    if (!v || typeof v !== "object") return;
    for (const [key, value] of Object.entries(v)) {
      assert.ok(!/^(sample_rows|access_token|refresh_token|api_key|password|credentials)$/i.test(key), `sensitive fixture key ${key}`);
      inspect(value);
    }
  }
  for (const c of cases) inspect(JSON.parse(c.input.context));
});
test("loads complete skill plus all five declared references, failing closed if absent", () => {
  const skill = readFileSync(join(process.cwd(), "skills/onboard-data/SKILL.md"), "utf8");
  const prompt = loadOnboardDataPrompt();
  assert.ok(prompt.startsWith(skill));
  assert.equal(ONBOARD_DATA_REFERENCE_FILES.length, 5);
  for (const file of ONBOARD_DATA_REFERENCE_FILES) {
    assert.ok(skill.includes(file), `reference not declared in skill: ${file}`);
    const content = readFileSync(join(process.cwd(), "skills/onboard-data", file), "utf8");
    assert.ok(content.trim()); assert.ok(prompt.includes(content));
  }
});
test("paired baseline has a distinct experiment and never requires skill files", () => {
  const withSkill = onboardDataEvalVariant(false);
  assert.equal(withSkill.variant, "with_skill");
  assert.equal(withSkill.systemPrompt, loadOnboardDataPrompt());
  const dir = mkdtempSync(join(tmpdir(), "onboard-data-baseline-"));
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    const baseline = onboardDataEvalVariant(true);
    assert.equal(baseline.variant, "baseline");
    assert.notEqual(baseline.experimentName, withSkill.experimentName);
    assert.match(baseline.systemPrompt, /helpful assistant/);
    assert.ok(!baseline.systemPrompt.includes("SLMD"));
    assert.throws(() => onboardDataEvalVariant(false), /ENOENT/);
  } finally { process.chdir(cwd); rmSync(dir, { recursive: true, force: true }); }
});
test("dataset loader rejects empty directories, empty fixtures and duplicate case names", () => {
  const dir = mkdtempSync(join(tmpdir(), "onboard-data-fixtures-"));
  try {
    assert.throws(() => loadOnboardDataCases(dir), /no cases/);
    writeFileSync(join(dir, "empty.json"), "[]");
    assert.throws(() => loadOnboardDataCases(dir), /nonempty/);
    writeFileSync(join(dir, "empty.json"), JSON.stringify([cases[0], cases[0]]));
    assert.throws(() => loadOnboardDataCases(dir), /duplicate case name/);
    writeFileSync(join(dir, "empty.json"), JSON.stringify([{}]));
    assert.throws(() => loadOnboardDataCases(dir), /malformed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("dataset loader rejects malformed expected contract and missing tracked decisions", () => {
  const dir = mkdtempSync(join(tmpdir(), "onboard-data-fixtures-"));
  try {
    const bad = structuredClone(cases[0]);
    bad.expected.actions = [{ operation: "create", targets: ["unexpected"], timing: "now", prerequisites: ["approval"] }];
    writeFileSync(join(dir, "bad.json"), JSON.stringify([bad]));
    assert.throws(() => loadOnboardDataCases(dir), /unresolved prerequisites/);
    const missing = structuredClone(cases[0]); missing.expected.tables = [];
    writeFileSync(join(dir, "bad.json"), JSON.stringify([missing]));
    assert.throws(() => loadOnboardDataCases(dir), /tracked_ids/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
