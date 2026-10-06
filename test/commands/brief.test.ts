import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { requestId } from "../../src/ledger/ledger.ts";
import type { BriefJsonOutput } from "../../src/types.ts";
import { CAPS_FILE, makeProject } from "./shared.ts";

const DELEGATE_TASK_FIELDS = ["task", "title", "target", "role", "interactionMode", "runtimeMode", "mode"];

function parse(text: string): BriefJsonOutput {
  return JSON.parse(text) as BriefJsonOutput;
}

test("brief prints the rendered brief with every given section", async (t) => {
  const { code, ctx } = await makeProject(t).run([
    "brief",
    "execute",
    "--task",
    "Add the endpoint.",
    "--context",
    "The API lives in src/api.",
    "--scope",
    "src/api",
    "--done",
    "the test passes",
    "--verify",
    "pnpm test",
    "--plan",
    "auth",
    "--unit",
    "U3",
    "--round",
    "2",
  ]);
  assert.equal(code, 0);
  const text = ctx.out();
  assert.match(text, /^<!-- omt-brief v1 role=execute round=2 depth=1\/1 plan=auth unit=U3 -->\n/);
  for (const heading of ["# Role: execute", "# Task", "# Context", "# Scope", "# Constraints", "# Done when", "# Verify", "# Final message"]) {
    assert.match(text, new RegExp(`^${heading}$`, "m"), heading);
  }
  assert.match(text, /^STATUS: DONE \| BLOCKED \| ESCALATE$/m);
  assert.doesNotMatch(text, /^# Prior rounds$/m);
});

test("brief --json holds exactly the delegate_task fields, without clientRequestId by default", async (t) => {
  const { code, ctx } = await makeProject(t).run(["brief", "review", "--task", "Check the diff.", "--json"]);
  assert.equal(code, 0);
  const output = parse(ctx.out());
  assert.deepEqual(Object.keys(output), ["delegateTask", "fallbacks"]);
  assert.deepEqual(Object.keys(output.delegateTask).sort(), [...DELEGATE_TASK_FIELDS].sort());
  assert.equal(output.delegateTask.mode, "async");
  assert.equal(output.delegateTask.role, "review");
  assert.equal(output.delegateTask.interactionMode, "plan");
  assert.equal(output.delegateTask.runtimeMode, "inherit");
  assert.equal(output.delegateTask.title, "review: Check the diff.");
  assert.deepEqual(output.delegateTask.target, { driverKind: "claudeAgent", model: "claude-opus-5-5", options: { effort: "high" } });
  assert.deepEqual(output.fallbacks, [{ driverKind: "codex", model: "gpt-6-astra", options: { reasoningEffort: "high" } }]);
  assert.match(output.delegateTask.task, /^<!-- omt-brief v1 role=review round=1 depth=1\/1 -->/);
});

test("brief --json adds clientRequestId only with both --plan and --unit", async (t) => {
  const project = makeProject(t);
  const both = parse(
    (await project.run(["brief", "review", "--task", "x", "--plan", "auth", "--unit", "U3", "--round", "2", "--attempt", "3", "--json"])).ctx.out(),
  );
  assert.equal(both.delegateTask.clientRequestId, requestId("auth", "U3", "review", 2, 3));
  assert.equal(both.delegateTask.clientRequestId, "omt:auth:U3:review:r2:a3");
  assert.deepEqual(Object.keys(both.delegateTask).sort(), [...DELEGATE_TASK_FIELDS, "clientRequestId"].sort());

  const planOnly = parse((await project.run(["brief", "review", "--task", "x", "--plan", "auth", "--json"])).ctx.out());
  assert.equal("clientRequestId" in planOnly.delegateTask, false);
  const unitOnly = parse((await project.run(["brief", "review", "--task", "x", "--unit", "U3", "--json"])).ctx.out());
  assert.equal("clientRequestId" in unitOnly.delegateTask, false);
});

test("brief --json follows the title rule", async (t) => {
  const project = makeProject(t);
  const title = async (args: string[]) =>
    parse((await project.run(["brief", "review", "--json", ...args])).ctx.out()).delegateTask.title;
  assert.equal(await title(["--task", "\n  token refresh  \nmore", "--unit", "U3", "--round", "2"]), "review U3 r2: token refresh");
  assert.equal(await title(["--task", "token refresh", "--unit", "U3"]), "review U3: token refresh");
  assert.equal(await title(["--task", "token refresh", "--title", "My title"]), "My title");
  assert.equal((await title(["--task", "x".repeat(200)])).length, 72);
  assert.equal((await title(["--task", "x", "--title", "y".repeat(100)])).length, 72);
});

test("brief reads the task from stdin or a file", async (t) => {
  const project = makeProject(t);
  const fromStdin = await project.run(["brief", "execute", "--task-file", "-"], { stdin: "Task from stdin.\n" });
  assert.equal(fromStdin.code, 0);
  assert.match(fromStdin.ctx.out(), /^# Task\n\nTask from stdin\.$/m);
  const file = join(project.root, "task.md");
  writeFileSync(file, "Task from a file.\n");
  const fromFile = await project.run(["brief", "execute", "--task-file", file]);
  assert.match(fromFile.ctx.out(), /^# Task\n\nTask from a file\.$/m);
  const prior = join(project.root, "prior.md");
  writeFileSync(prior, "Finding 1 is fixed.\n");
  const withPrior = await project.run(["brief", "review", "--task", "x", "--prior-file", prior]);
  assert.match(withPrior.ctx.out(), /^# Prior rounds\n\nFinding 1 is fixed\.$/m);
});

test("brief rejects bad usage with exit 2", async (t) => {
  const project = makeProject(t);
  for (const argv of [
    ["brief"],
    ["brief", "execute"],
    ["brief", "execute", "--task", "x", "--task-file", "-"],
    ["brief", "execute", "--task", "  "],
    ["brief", "execute", "--task", "x", "--round", "0"],
    ["brief", "execute", "--task-file", "-", "--context-file", "-"],
    ["brief", "execute", "extra", "--task", "x"],
  ]) {
    assert.equal((await project.run(argv)).code, 2, argv.join(" "));
  }
});

test("brief fails on an unknown role and on an unavailable role with --json", async (t) => {
  const project = makeProject(t);
  const unknown = await project.run(["brief", "nope", "--task", "x"]);
  assert.equal(unknown.code, 1);
  assert.match(unknown.ctx.err(), /unknown role nope/);

  project.projectConfig('{ "version": 1, "roles": { "oracle": { "chain": [{ "driver": "grok", "model": "grok-build" }] } } }\n');
  const unavailable = await project.run(["brief", "oracle", "--task", "x", "--json", "--capabilities", CAPS_FILE]);
  assert.equal(unavailable.code, 1);
  assert.equal(unavailable.ctx.out(), "");
  assert.match(unavailable.ctx.err(), /role oracle is unavailable/);
  assert.match(unavailable.ctx.err(), /rung 1: provider grok cannot run child tasks/);
});

test("brief --json --capabilities resolves the target against T3", async (t) => {
  const { code, ctx } = await makeProject(t).run(["brief", "execute", "--task", "x", "--json", "--capabilities", CAPS_FILE]);
  assert.equal(code, 0);
  assert.deepEqual(parse(ctx.out()).delegateTask.target, {
    providerInstanceId: "claudeAgent",
    model: "claude-opus-5-5",
    options: { effort: "medium" },
  });
});

test("brief rejects an invalid --plan or --unit with exit code 2", async (t) => {
  const project = makeProject(t);
  for (const flags of [["--plan", "a -->"], ["--plan", "a b"], ["--plan", "A"], ["--unit", "U 1"], ["--unit", "u".repeat(65)]]) {
    const { code, ctx } = await project.run(["brief", "execute", "--task", "x", ...flags]);
    assert.equal(code, 2, flags.join(" "));
    assert.match(ctx.err(), /invalid --(plan|unit)/);
  }
});

test("brief --max-depth overrides the config max depth, and a deeper --depth is a usage error", async (t) => {
  const project = makeProject(t);
  const raised = await project.run(["brief", "execute", "--task", "x", "--depth", "2", "--max-depth", "3"]);
  assert.equal(raised.code, 0, raised.ctx.err());
  assert.match(raised.ctx.out(), /depth=2\/3/);
  assert.match(raised.ctx.out(), /You may delegate with the T3 delegate_task tool\. Give each child depth 3, and pass --max-depth 3 to omt brief\.$/m);

  const tooDeep = await project.run(["brief", "execute", "--task", "x", "--depth", "2"]);
  assert.equal(tooDeep.code, 2);
  assert.match(tooDeep.ctx.err(), /^hint: .*--max-depth/m);

  for (const bad of ["4", "-1", "x"]) {
    assert.equal((await project.run(["brief", "execute", "--task", "x", "--max-depth", bad])).code, 2, bad);
  }
});

test("brief adds the evidence line for edit roles only", async (t) => {
  const project = makeProject(t);
  const edit = await project.run(["brief", "execute", "--task", "x"]);
  assert.equal(edit.code, 0);
  const line = `- Evidence: save command output and logs under ${join(project.cwd, ".omt", "evidence")}/.`;
  assert.ok(edit.ctx.out().split("\n").includes(line), edit.ctx.out());
  const readOnly = await project.run(["brief", "review", "--task", "x"]);
  assert.equal(readOnly.code, 0);
  assert.doesNotMatch(readOnly.ctx.out(), /Evidence:/);
});

test("brief exits 1 when the rendered task is longer than 120,000 characters", async (t) => {
  const { code, ctx } = await makeProject(t).run(["brief", "execute", "--task", "x", "--context", "c".repeat(120_000)]);
  assert.equal(code, 1);
  assert.equal(ctx.out(), "");
  assert.match(ctx.err(), /^hint: shorten --context or --prior-file/m);
});
