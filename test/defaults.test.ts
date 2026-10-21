import { test } from "bun:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import { LATEST_DEFAULT_SET } from "../src/config/defaultSets.ts";
import { PROJECT_STARTER_CONFIG, USER_STARTER_CONFIG } from "../src/config/starter.ts";
import { EFFORT_LADDER } from "../src/types.ts";

const EXPECTED: Record<string, [access: string, result: string, t3Role: string, mode: string, crossFamily: boolean, chain: string[]]> = {
  explore: ["read-only", "research", "research", "plan", false, ["codex/gpt-6-luna/low", "claudeAgent/claude-sonnet-5-5/low"]],
  research: ["read-only", "research", "research", "plan", false, ["codex/gpt-6.1-sol/low", "claudeAgent/claude-opus-5-5/low"]],
  plan: ["edit", "plan", "design", "default", false, ["claudeAgent/claude-opus-5-5/xhigh", "codex/gpt-6-astra/xhigh"]],
  "plan-review": ["read-only", "review", "review", "plan", true, ["codex/gpt-6-astra/high", "claudeAgent/claude-opus-5-5/high"]],
  execute: ["edit", "work", "implementation", "default", false, ["claudeAgent/claude-opus-5-5/medium", "codex/gpt-6.1-sol/xhigh"]],
  quick: ["edit", "work", "implementation", "default", false, ["codex/gpt-6-luna/high", "claudeAgent/claude-sonnet-5-5/low"]],
  deep: ["edit", "work", "implementation", "default", false, ["claudeAgent/claude-opus-5-5/max", "codex/gpt-6-astra/xhigh"]],
  review: ["read-only", "review", "review", "plan", true, ["codex/gpt-6-astra/high", "claudeAgent/claude-opus-5-5/high"]],
  oracle: ["read-only", "review", "review", "plan", true, ["codex/gpt-6-astra/high", "claudeAgent/claude-opus-5-5/high"]],
  verify: ["edit", "test", "test", "default", false, ["claudeAgent/claude-haiku-5-5/medium", "claudeAgent/claude-sonnet-5-5/low", "codex/gpt-6.1-sol/low"]],
  qa: ["edit", "test", "test", "default", false, ["codex/gpt-6.1-sol/medium", "claudeAgent/claude-sonnet-5-5/medium"]],
  guardrail: ["read-only", "guardrail", "review", "plan", false, ["claudeAgent/claude-opus-5-5/high", "codex/gpt-6-astra/high"]],
  writing: ["edit", "work", "implementation", "default", false, ["claudeAgent/claude-opus-5-5/high", "codex/gpt-6-astra/medium"]],
  design: ["edit", "work", "design", "default", false, ["claudeAgent/claude-opus-5-5/high"]],
  ui: ["edit", "work", "implementation", "default", false, ["claudeAgent/claude-opus-5-5/medium"]],
};

test("the defaults hold the 15 roles with the planned values", () => {
  assert.deepEqual(Object.keys(DEFAULT_CONFIG.roles).sort(), Object.keys(EXPECTED).sort());
  for (const [name, [access, result, t3Role, mode]] of Object.entries(EXPECTED)) {
    const role = DEFAULT_CONFIG.roles[name];
    assert.ok(role, name);
    assert.equal(role.access, access, name);
    assert.equal(role.result, result, name);
    assert.equal(role.t3Role, t3Role, name);
    assert.equal(role.interactionMode, mode, name);
    assert.equal(role.runtimeMode, "inherit", name);
    assert.ok(role.description.length > 0 && role.description.length <= 300, name);
  }
});

test("every default rung names the built-in provider instance of its driver, a model, and an effort", () => {
  for (const [name, role] of Object.entries(DEFAULT_CONFIG.roles)) {
    assert.equal(role.chain.length, EXPECTED[name]?.[5].length, name);
    for (const rung of role.chain) {
      assert.equal(rung.provider, rung.driver, name);
      assert.ok(rung.driver === "claudeAgent" || rung.driver === "codex", name);
      assert.ok(rung.model.length > 0, name);
      assert.ok(rung.effort !== undefined && EFFORT_LADDER.includes(rung.effort), name);
    }
  }
});

test("the default chains and crossFamily flags match the plan exactly", () => {
  assert.deepEqual(Object.keys(EXPECTED).sort(), Object.keys(DEFAULT_CONFIG.roles).sort());
  for (const [name, [, , , , crossFamily, rungs]] of Object.entries(EXPECTED)) {
    const role = DEFAULT_CONFIG.roles[name];
    assert.ok(role, name);
    const chain = rungs.map((text) => {
      const [driver, model, effort] = text.split("/");
      return { provider: driver, driver, model, effort };
    });
    assert.deepEqual(role.chain, chain, name);
    assert.equal(role.crossFamily, crossFamily, name);
  }
  assert.match(DEFAULT_CONFIG.roles.review?.description ?? "", /family that did not make the change/);
});

test("the design and ui roles run only on Opus, with no fallback", () => {
  assert.deepEqual(DEFAULT_CONFIG.roles.design, {
    description: "Design screens and flows in Paper, and write a design spec that UI units cite.",
    access: "edit",
    result: "work",
    t3Role: "design",
    interactionMode: "default",
    runtimeMode: "inherit",
    crossFamily: false,
    chain: [{ provider: "claudeAgent", driver: "claudeAgent", model: "claude-opus-5-5", effort: "high" }],
  });
  assert.deepEqual(DEFAULT_CONFIG.roles.ui, {
    description: "Implement one UI unit from its design spec, inside its scope.",
    access: "edit",
    result: "work",
    t3Role: "implementation",
    interactionMode: "default",
    runtimeMode: "inherit",
    crossFamily: false,
    chain: [{ provider: "claudeAgent", driver: "claudeAgent", model: "claude-opus-5-5", effort: "medium" }],
  });
});

test("the default visuals show the plan page", () => {
  assert.deepEqual(DEFAULT_CONFIG.visuals, { plan: true });
});

test("the default limits match the plan", () => {
  assert.deepEqual(DEFAULT_CONFIG.limits, { maxParallel: 6, maxTasksPerRun: 24, maxDepth: 1, maxReviewRounds: 4 });
  assert.equal(DEFAULT_CONFIG.version, 1);
});

// A minimal JSONC reader for this test only; src/config/jsonc.ts is the real one.
function stripJsonc(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\") out += text[++i] ?? "";
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      assert.notEqual(end, -1, "unterminated block comment");
      i = end + 1;
    } else {
      out += ch;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

for (const [name, text] of Object.entries({ USER_STARTER_CONFIG, PROJECT_STARTER_CONFIG })) {
  test(`${name} parses as JSONC and is sparse`, () => {
    const parsed = JSON.parse(stripJsonc(text)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(parsed).sort(), ["$schema", "defaults", "limits", "roles", "version"]);
    assert.equal(parsed.defaults, LATEST_DEFAULT_SET);
    assert.equal(parsed.$schema, "https://raw.githubusercontent.com/gabimoncha/oh-my-t3code/main/schema/omt.schema.json");
    assert.equal(parsed.version, 1);
    assert.deepEqual(parsed.roles, {});
    assert.deepEqual(parsed.limits, {});
    assert.match(text, /omt config show --defaults/);
    assert.match(text, /^  \/\/ "profile": "prototype",$/m);
    assert.match(text, /^  \/\/ "visuals": \{ "plan": false \},$/m);
  });
}
