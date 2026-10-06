import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import type { RouteOutput } from "../../src/types.ts";
import { CAPS_FILE, makeProject } from "./shared.ts";

test("route prints an unverified RouteOutput and exits 0", async (t) => {
  const { code, ctx } = await makeProject(t).run(["route", "review"]);
  assert.equal(code, 0);
  const output = JSON.parse(ctx.out()) as RouteOutput;
  assert.deepEqual(output, {
    role: "review",
    status: "unverified",
    description: DEFAULT_CONFIG.roles.review?.description,
    access: "read-only",
    result: "review",
    delegateTask: {
      target: { driverKind: "claudeAgent", model: "claude-opus-5-5", options: { effort: "high" } },
      role: "review",
      interactionMode: "plan",
      runtimeMode: "inherit",
    },
    fallbacks: [{ driverKind: "codex", model: "gpt-6-astra", options: { reasoningEffort: "high" } }],
    notes: [],
  });
});

test("route --capabilities resolves against the provider instances", async (t) => {
  const { code, ctx } = await makeProject(t).run(["route", "execute", "--capabilities", CAPS_FILE]);
  assert.equal(code, 0);
  const output = JSON.parse(ctx.out()) as RouteOutput;
  assert.equal(output.status, "resolved");
  assert.deepEqual(output.delegateTask?.target, {
    providerInstanceId: "claudeAgent",
    model: "claude-opus-5-5",
    options: { effort: "medium" },
  });
});

test("route prints an unavailable role without delegateTask and exits 1", async (t) => {
  const project = makeProject(t);
  project.projectConfig('{ "version": 1, "roles": { "oracle": { "chain": [{ "driver": "grok", "model": "grok-build" }] } } }\n');
  const { code, ctx } = await project.run(["route", "oracle", "--capabilities", CAPS_FILE]);
  assert.equal(code, 1);
  const output = JSON.parse(ctx.out()) as RouteOutput;
  assert.equal(output.status, "unavailable");
  assert.equal(output.delegateTask, undefined);
  assert.match(output.notes[0] ?? "", /^rung 1: provider grok cannot run child tasks: /);
});

test("route fails on an unknown role and needs exactly one role", async (t) => {
  const project = makeProject(t);
  const unknown = await project.run(["route", "nope"]);
  assert.equal(unknown.code, 1);
  assert.match(unknown.ctx.err(), /unknown role nope; known roles: /);
  assert.equal((await project.run(["route"])).code, 2);
  assert.equal((await project.run(["route", "review", "execute"])).code, 2);
});
