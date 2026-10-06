import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import { PROJECT_STARTER_CONFIG, USER_STARTER_CONFIG } from "../src/config/starter.ts";
import { EFFORT_LADDER } from "../src/types.ts";

const EXPECTED: Record<string, [access: string, result: string, t3Role: string, mode: string]> = {
  explore: ["read-only", "research", "research", "plan"],
  research: ["read-only", "research", "research", "plan"],
  plan: ["edit", "plan", "design", "default"],
  "plan-review": ["read-only", "review", "review", "plan"],
  execute: ["edit", "work", "implementation", "default"],
  quick: ["edit", "work", "implementation", "default"],
  deep: ["edit", "work", "implementation", "default"],
  review: ["read-only", "review", "review", "plan"],
  oracle: ["read-only", "review", "review", "plan"],
  test: ["edit", "test", "test", "default"],
  writing: ["edit", "work", "implementation", "default"],
};

test("the defaults hold the 11 roles with the values from spec section 6.4", () => {
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

test("every default rung uses driver, a model, and an effort", () => {
  for (const [name, role] of Object.entries(DEFAULT_CONFIG.roles)) {
    assert.equal(role.chain.length, 2, name);
    for (const rung of role.chain) {
      assert.equal(rung.provider, undefined, name);
      assert.ok(rung.driver === "claudeAgent" || rung.driver === "codex", name);
      assert.ok(rung.model.length > 0, name);
      assert.ok(rung.effort !== undefined && EFFORT_LADDER.includes(rung.effort), name);
    }
  }
  assert.deepEqual(DEFAULT_CONFIG.roles.review?.chain, [
    { driver: "claudeAgent", model: "claude-opus-5-5", effort: "high" },
    { driver: "codex", model: "gpt-6-astra", effort: "high" },
  ]);
  assert.deepEqual(DEFAULT_CONFIG.roles.oracle?.chain[0], { driver: "codex", model: "gpt-6-astra", effort: "high" });
});

test("the default limits match the spec", () => {
  assert.deepEqual(DEFAULT_CONFIG.limits, { maxParallel: 4, maxTasksPerRun: 24, maxDepth: 1, maxReviewRounds: 3 });
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
    assert.deepEqual(Object.keys(parsed).sort(), ["$schema", "limits", "roles", "version"]);
    assert.equal(parsed.$schema, "https://raw.githubusercontent.com/gabimoncha/oh-my-t3code/main/schema/omt.schema.json");
    assert.equal(parsed.version, 1);
    assert.deepEqual(parsed.roles, {});
    assert.deepEqual(parsed.limits, {});
    assert.match(text, /omt config show --defaults/);
  });
}
