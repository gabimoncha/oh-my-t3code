import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import { mergeLayer } from "../../src/config/merge.ts";
import type { Rung } from "../../src/types.ts";

const RUNG: Rung = { driver: "codex", model: "gpt-6-astra", effort: "high" };

test("an empty layer returns an equal copy, and never mutates the base", () => {
  const before = structuredClone(DEFAULT_CONFIG);
  const { config, issues } = mergeLayer(DEFAULT_CONFIG, {}, "src");
  assert.deepEqual(issues, []);
  assert.deepEqual(config, DEFAULT_CONFIG);
  assert.notEqual(config, DEFAULT_CONFIG);
  config.roles.review?.chain.push(RUNG);
  config.limits.maxDepth = 3;
  assert.deepEqual(DEFAULT_CONFIG, before);
});

test("a role set to null is removed", () => {
  const { config, issues } = mergeLayer(DEFAULT_CONFIG, { roles: { oracle: null } }, "src");
  assert.equal(config.roles.oracle, undefined);
  assert.equal("oracle" in config.roles, false);
  assert.deepEqual(issues, []);
  assert.ok(DEFAULT_CONFIG.roles.oracle);
});

test("removing a role that does not exist is a warning", () => {
  const { issues } = mergeLayer(DEFAULT_CONFIG, { roles: { nope: null } }, "src");
  assert.deepEqual(issues.map((issue) => [issue.path, issue.severity]), [["roles.nope", "warning"]]);
});

test("an existing role is merged field by field, and chain replaces the old chain", () => {
  const { config } = mergeLayer(
    DEFAULT_CONFIG,
    { roles: { review: { runtimeMode: "auto", chain: [RUNG] } } },
    "src",
  );
  const base = DEFAULT_CONFIG.roles.review;
  assert.ok(base);
  assert.deepEqual(config.roles.review, { ...base, runtimeMode: "auto", chain: [RUNG] });
});

test("a field-only override keeps the old chain", () => {
  const { config } = mergeLayer(DEFAULT_CONFIG, { roles: { execute: { description: "New." } } }, "src");
  assert.equal(config.roles.execute?.description, "New.");
  assert.deepEqual(config.roles.execute?.chain, DEFAULT_CONFIG.roles.execute?.chain);
});

test("a layer keeps, sets, or overrides crossFamily on an existing role", () => {
  const { config } = mergeLayer(
    DEFAULT_CONFIG,
    { roles: { review: { crossFamily: false }, test: { crossFamily: true }, oracle: { description: "Gate." } } },
    "src",
  );
  assert.equal(config.roles.review?.crossFamily, false);
  assert.deepEqual(config.roles.review?.chain, DEFAULT_CONFIG.roles.review?.chain);
  assert.equal(config.roles.test?.crossFamily, true);
  assert.equal(config.roles.oracle?.crossFamily, true);
  const second = mergeLayer(config, { roles: { review: { crossFamily: true } } }, "project");
  assert.equal(second.config.roles.review?.crossFamily, true);
});

test("a new role keeps a given crossFamily and leaves it unset otherwise", () => {
  const { config } = mergeLayer(
    DEFAULT_CONFIG,
    { roles: { audit: { description: "Audit.", access: "read-only", crossFamily: true, chain: [RUNG] } } },
    "src",
  );
  assert.equal(config.roles.audit?.crossFamily, true);
  const plain = mergeLayer(DEFAULT_CONFIG, { roles: { audit: { description: "A.", access: "edit", chain: [RUNG] } } }, "src");
  assert.equal("crossFamily" in (plain.config.roles.audit ?? {}), false);
});

test("a new edit role gets the edit defaults", () => {
  const { config, issues } = mergeLayer(
    DEFAULT_CONFIG,
    { roles: { builder: { description: "Build.", access: "edit", chain: [RUNG] } } },
    "src",
  );
  assert.deepEqual(issues, []);
  assert.deepEqual(config.roles.builder, {
    description: "Build.",
    access: "edit",
    result: "work",
    t3Role: "implementation",
    interactionMode: "default",
    runtimeMode: "inherit",
    chain: [RUNG],
  });
});

test("a new read-only role gets the read-only defaults, and given fields win", () => {
  const { config } = mergeLayer(
    DEFAULT_CONFIG,
    { roles: { scout: { description: "Look.", access: "read-only", t3Role: "review", chain: [RUNG] } } },
    "src",
  );
  assert.deepEqual(config.roles.scout, {
    description: "Look.",
    access: "read-only",
    result: "research",
    t3Role: "review",
    interactionMode: "plan",
    runtimeMode: "inherit",
    chain: [RUNG],
  });
});

test("a new role without description, access, or chain is dropped with an error", () => {
  const { config, issues } = mergeLayer(DEFAULT_CONFIG, { roles: { half: { access: "edit" } } }, "src");
  assert.equal(config.roles.half, undefined);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.path, "roles.half");
  assert.equal(issues[0]?.severity, "error");
  assert.equal(issues[0]?.source, "src");
  assert.match(issues[0]?.message ?? "", /missing: description, chain$/);
});

test("a role removed in one layer can be added back as a new role in a later one", () => {
  const first = mergeLayer(DEFAULT_CONFIG, { roles: { quick: null } }, "user").config;
  const half = mergeLayer(first, { roles: { quick: { chain: [RUNG] } } }, "project");
  assert.equal(half.config.roles.quick, undefined);
  assert.equal(half.issues[0]?.severity, "error");
});

test("each limit field replaces the old value", () => {
  const { config } = mergeLayer(DEFAULT_CONFIG, { limits: { maxParallel: 8 } }, "src");
  assert.deepEqual(config.limits, { ...DEFAULT_CONFIG.limits, maxParallel: 8 });
});

test("the result does not share arrays with the layer", () => {
  const chain = [RUNG];
  const { config } = mergeLayer(DEFAULT_CONFIG, { roles: { review: { chain } } }, "src");
  chain.push(RUNG);
  assert.equal(config.roles.review?.chain.length, 1);
});

test("visuals merge per key", () => {
  const { config, issues } = mergeLayer(DEFAULT_CONFIG, { visuals: { plan: false } }, "src");
  assert.deepEqual(issues, []);
  assert.deepEqual(config.visuals, { plan: false });
  assert.deepEqual(DEFAULT_CONFIG.visuals, { plan: true });
  assert.deepEqual(mergeLayer(config, { visuals: {} }, "src").config.visuals, { plan: false });
  assert.deepEqual(mergeLayer(config, { visuals: { plan: true } }, "src").config.visuals, { plan: true });
});
