import assert from "node:assert/strict";
import { test } from "node:test";
import { mapEffort } from "../../src/routing/effort.ts";
import type { OptionDescriptor } from "../../src/types.ts";

function select(id: string, choices: string[]): OptionDescriptor {
  return { id, type: "select", options: choices.map((choice) => ({ id: choice })) };
}

const CLAUDE = [
  select("effort", ["low", "medium", "high", "xhigh", "max", "ultrathink"]),
  select("contextWindow", ["200k", "1m"]),
  { id: "fastMode", type: "boolean" },
];
const LUNA = [select("reasoningEffort", ["low", "medium", "high", "xhigh"])];
const PI = [select("thinking", ["off", "minimal", "low", "medium", "high", "xhigh"])];

test("uses the exact choice when the model offers it", () => {
  assert.deepEqual(mapEffort("medium", CLAUDE, "claudeAgent"), { options: { effort: "medium" } });
  assert.deepEqual(mapEffort("off", PI, "pi"), { options: { thinking: "off" } });
});

test("maps to the highest ladder choice below the request", () => {
  assert.deepEqual(mapEffort("max", LUNA, "codex"), {
    options: { reasoningEffort: "xhigh" },
    note: "effort max mapped to xhigh for option reasoningEffort",
  });
});

test("maps to the lowest ladder choice above when none is below", () => {
  assert.deepEqual(mapEffort("minimal", CLAUDE, "claudeAgent"), {
    options: { effort: "low" },
    note: "effort minimal mapped to low for option effort",
  });
});

test("never picks choices that are not on the ladder", () => {
  const odd = [select("effort", ["default", "ultrathink", "high", "ultra"])];
  assert.deepEqual(mapEffort("max", odd, "claudeAgent").options, { effort: "high" });
  assert.deepEqual(mapEffort("low", odd, "claudeAgent").options, { effort: "high" });
});

test("follows the option id priority order", () => {
  const descriptors = [select("thinking", ["low", "high"]), select("reasoning", ["low", "medium"])];
  assert.deepEqual(mapEffort("medium", descriptors, "cursor"), { options: { reasoning: "medium" } });
  for (const id of ["reasoning_effort", "variant"]) {
    assert.deepEqual(mapEffort("high", [select(id, ["high"])], "x"), { options: { [id]: "high" } });
  }
});

test("skips descriptors that are not selects or have no ladder choices", () => {
  const descriptors = [
    { id: "effort", type: "boolean" },
    select("reasoningEffort", ["ultra", "default"]),
    select("thinking", ["low", "medium"]),
  ];
  assert.deepEqual(mapEffort("medium", descriptors, "x"), { options: { thinking: "medium" } });
});

test("reports when the model advertises no effort option", () => {
  const expected = { options: {}, note: "effort high not applied: the model advertises no effort option" };
  assert.deepEqual(mapEffort("high", [], "cursor"), expected);
  assert.deepEqual(mapEffort("high", [select("contextWindow", ["200k"])], "claudeAgent"), expected);
});

test("driver table without capabilities", () => {
  const cases: [string, Parameters<typeof mapEffort>[0], Record<string, string>, string | undefined][] = [
    ["claudeAgent", "high", { effort: "high" }, undefined],
    ["claudeAgent", "off", { effort: "low" }, "effort off mapped to low for option effort"],
    ["claudeAgent", "max", { effort: "max" }, undefined],
    ["codex", "minimal", { reasoningEffort: "low" }, "effort minimal mapped to low for option reasoningEffort"],
    ["codex", "xhigh", { reasoningEffort: "xhigh" }, undefined],
    ["grok", "minimal", { reasoningEffort: "minimal" }, undefined],
    ["pi", "off", { thinking: "off" }, undefined],
    ["opencode", "max", { variant: "xhigh" }, "effort max mapped to xhigh for option variant"],
    ["opencode", "off", { variant: "low" }, "effort off mapped to low for option variant"],
    ["opencode", "medium", { variant: "medium" }, undefined],
  ];
  for (const [driver, effort, options, note] of cases) {
    const expected = note === undefined ? { options } : { options, note };
    assert.deepEqual(mapEffort(effort, undefined, driver), expected, `${driver} ${effort}`);
  }
});

test("unknown drivers get no options", () => {
  assert.deepEqual(mapEffort("high", undefined, "cursor"), {
    options: {},
    note: "effort high not applied: unknown option for driver cursor",
  });
  assert.deepEqual(mapEffort("high", undefined, "toString").options, {});
});
