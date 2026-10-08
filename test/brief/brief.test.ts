import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { briefTitle, renderBrief } from "../../src/brief/render.ts";
import type { BriefInput } from "../../src/brief/render.ts";
import { findRoleTemplate, loadResultContract } from "../../src/brief/templates.ts";
import type { TemplateRoots } from "../../src/brief/templates.ts";
import { OmtError } from "../../src/util/errors.ts";
import { tempDir } from "../helpers.ts";

const PERSONA = "# Role: execute (persona)\n\nYou implement one unit.\n";
const CONTRACT = "```text\nSTATUS: DONE | BLOCKED | ESCALATE\n```";

const READ_ONLY = "- Access: read-only. Change no files. Run only commands that leave the repository unchanged.";
const EDIT_SCOPED =
  "- Access: edit. Change only the files in Scope. If the task needs a change outside Scope, stop and report it under OPEN.";
const EDIT_FREE = "- Access: edit. Change only what the task needs.";
const PLAN_MODE =
  "- Mode: you run in plan mode. Stay in it. Do not call ExitPlanMode and do not write a proposed plan. Put the result block in your final assistant message.";

function input(fields: Partial<BriefInput> = {}): BriefInput {
  return {
    role: "execute",
    task: "Add the flag.",
    round: 1,
    depth: 1,
    maxDepth: 2,
    access: "edit",
    interactionMode: "default",
    ...fields,
  };
}

test("renderBrief renders every section in order", () => {
  const text = renderBrief(
    input({
      task: "\nAdd the flag.\n",
      context: "The CLI lives in src/.",
      scope: ["src/cli.ts", "test/"],
      done: ["The flag works", "Tests pass"],
      verify: ["pnpm check"],
      prior: "Round 1: missing test.",
      round: 2,
      depth: 2,
      maxDepth: 2,
      plan: "auth",
      unit: "U3",
    }),
    PERSONA,
    `\n${CONTRACT}\n\n`,
  );
  const expected = `<!-- omt-brief v1 role=execute round=2 depth=2/2 plan=auth unit=U3 -->

# Role: execute

# Role: execute (persona)

You implement one unit.

# Task

Add the flag.

# Context

The CLI lives in src/.

# Scope

- \`src/cli.ts\`
- \`test/\`

# Constraints

${EDIT_SCOPED}
- Delegation: you are at depth 2 of 2. Do all work yourself. Start no subagents and no delegated tasks, except \`test\` tasks for device checks (see Devices).
- You do not see the parent conversation. This brief is your full context. If you need something that is missing, say so in your final message.
- Other agents may edit other files in this repository at the same time. Leave changes outside your scope alone. Do not commit, push, or create branches.
- Processes: do not run \`pkill\`, \`killall\`, or another kill by name, because it can stop your own run. Stop only a process that you started, by its PID. Give each command that can run long a time limit, for example \`timeout 900 <command>\`.
- Shared files: never break and restore files in the shared checkout, for example to prove that a test can fail. The test role makes that proof in a private copy.
- Devices: do not drive a device, Simulator UI, browser, or computer yourself (\`agent-device\`, \`agent-browser\`, computer use, UI flows); only the test role does that, on a cheap model. For each device check, build a brief with \`omt brief test --depth 3 --json\` that gives the steps and the expected result, pass its \`delegateTask\` object to \`delegate_task\` with \`mode: "wait"\` (keep its routed target), and report its result. This delegation is allowed at any depth.

# Done when

- The flag works
- Tests pass

# Verify

- \`pnpm check\`

# Prior rounds

Round 1: missing test.

# Final message

End your work with the block below as your final message. Keep it under 60 lines and put nothing after it.

${CONTRACT}
`;
  assert.equal(text, expected);
});

test("renderBrief leaves out empty optional sections but keeps the required ones", () => {
  const text = renderBrief(input({ context: "  ", scope: [], done: [""], verify: [], prior: "" }), PERSONA, CONTRACT);
  assert.match(text, /^<!-- omt-brief v1 role=execute round=1 depth=1\/2 -->\n/);
  for (const heading of ["Role: execute", "Task", "Constraints", "Final message"]) {
    assert.match(text, new RegExp(`^# ${heading}$`, "m"));
  }
  for (const heading of ["Context", "Scope", "Done when", "Verify", "Prior rounds"]) {
    assert.doesNotMatch(text, new RegExp(`^# ${heading}$`, "m"));
  }
  assert.ok(text.endsWith(`${CONTRACT}\n`));
});

test("renderBrief picks the access line from access and scope", () => {
  const lines = (fields: Partial<BriefInput>) => renderBrief(input(fields), PERSONA, CONTRACT).split("\n");
  assert.ok(lines({ access: "read-only", scope: ["src/"] }).includes(READ_ONLY));
  assert.ok(lines({ access: "edit", scope: ["src/"] }).includes(EDIT_SCOPED));
  const free = lines({ access: "edit" });
  assert.ok(free.includes(EDIT_FREE));
  assert.ok(!free.includes(EDIT_SCOPED));
});

test("renderBrief picks the delegation line from depth and maxDepth", () => {
  const below = renderBrief(input({ depth: 1, maxDepth: 3 }), PERSONA, CONTRACT);
  assert.match(
    below,
    /^- Delegation: you are at depth 1 of 3\. You may delegate with the T3 delegate_task tool\. Give each child depth 2 in its brief\.$/m,
  );
  for (const depth of [3, 4]) {
    const at = renderBrief(input({ depth, maxDepth: 3 }), PERSONA, CONTRACT);
    assert.match(
      at,
      new RegExp(
        `^- Delegation: you are at depth ${depth} of 3\\. Do all work yourself\\. Start no subagents and no delegated tasks, except \`test\` tasks for device checks \\(see Devices\\)\\.$`,
        "m",
      ),
    );
  }
});

test("renderBrief gives every role except test the device line, and allows test children at max depth", () => {
  const deep = renderBrief(input({ role: "deep", depth: 1, maxDepth: 1 }), PERSONA, CONTRACT);
  assert.match(deep, /^- Devices: do not drive a device, Simulator UI, browser, or computer yourself .* This delegation is allowed at any depth\.$/m);
  assert.match(deep, /^- Delegation: you are at depth 1 of 1\. .*except `test` tasks for device checks \(see Devices\)\.$/m);
  const reviewer = renderBrief(input({ role: "review", interactionMode: "plan", access: "read-only", depth: 1, maxDepth: 2 }), PERSONA, CONTRACT);
  assert.match(reviewer, /^- Devices: .* You run in plan mode and cannot start a `test` task, so list each device check /m);
  const reviewerAtMax = renderBrief(input({ role: "review", interactionMode: "plan", access: "read-only", depth: 1, maxDepth: 1 }), PERSONA, CONTRACT);
  assert.match(reviewerAtMax, /^- Delegation: you are at depth 1 of 1\. Do all work yourself\. Start no subagents and no delegated tasks\.$/m);
  const raised = renderBrief(input({ role: "deep", depth: 2, maxDepth: 2, configuredMaxDepth: 1 }), PERSONA, CONTRACT);
  assert.match(raised, /build a brief with `omt brief test --depth 3 --max-depth 2 --json` that/);
  const tester = renderBrief(input({ role: "test", depth: 2, maxDepth: 2 }), PERSONA, CONTRACT);
  assert.doesNotMatch(tester, /- Devices:/);
  assert.match(tester, /^- Delegation: you are at depth 2 of 2\. Do all work yourself\. Start no subagents and no delegated tasks\.$/m);
});

test("renderBrief names --max-depth when it differs from the configured max depth", () => {
  const raised = renderBrief(input({ depth: 1, maxDepth: 3, configuredMaxDepth: 1 }), PERSONA, CONTRACT);
  assert.match(
    raised,
    /^- Delegation: you are at depth 1 of 3\. You may delegate with the T3 delegate_task tool\. Give each child depth 2, and pass --max-depth 3 to omt brief\.$/m,
  );
  const same = renderBrief(input({ depth: 1, maxDepth: 3, configuredMaxDepth: 3 }), PERSONA, CONTRACT);
  assert.match(same, /Give each child depth 2 in its brief\.$/m);
});

test("renderBrief adds the plan-mode line after the delegation line only in plan mode", () => {
  const plan = renderBrief(input({ interactionMode: "plan", access: "read-only" }), PERSONA, CONTRACT).split("\n");
  const index = plan.indexOf(PLAN_MODE);
  assert.ok(index > 0);
  assert.match(plan[index - 1] ?? "", /^- Delegation: /);
  for (const mode of ["default", "inherit"] as const) {
    assert.ok(!renderBrief(input({ interactionMode: mode }), PERSONA, CONTRACT).includes("Mode: you run in plan mode"));
  }
});

test("briefTitle follows the title rule", () => {
  assert.equal(briefTitle("review", "\n  \n  token refresh  \nmore"), "review: token refresh");
  assert.equal(briefTitle("review", "token refresh", "U3"), "review U3: token refresh");
  assert.equal(briefTitle("review", "token refresh", "U3", 1), "review U3: token refresh");
  assert.equal(briefTitle("review", "token refresh", "U3", 2), "review U3 r2: token refresh");
  assert.equal(briefTitle("review", "token refresh", undefined, 3), "review r3: token refresh");
  const long = briefTitle("execute", "x".repeat(200), "U1");
  assert.equal(long.length, 72);
  assert.ok(long.startsWith("execute U1: xxx"));
});

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function fixture(t: TestContext): TemplateRoots & { configDir: string } {
  const root = tempDir(t);
  const homedir = join(root, "home");
  const configDir = join(root, "config");
  mkdirSync(homedir, { recursive: true });
  return {
    packageRoot: join(root, "pkg"),
    projectRoot: join(root, "project"),
    env: { OMT_CONFIG_DIR: configDir },
    homedir,
    configDir,
  };
}

test("findRoleTemplate uses project, user, package, then the generic template", async (t) => {
  const roots = fixture(t);
  const generic = join(roots.packageRoot, "skills", "omt", "references", "roles", "_generic.md");
  const bundled = join(roots.packageRoot, "skills", "omt", "references", "roles", "review.md");
  const user = join(roots.configDir, "roles", "review.md");
  const project = join(roots.projectRoot, ".omt", "roles", "review.md");
  writeFile(generic, "generic");

  assert.deepEqual(await findRoleTemplate(roots, "review"), { path: generic, content: "generic" });
  writeFile(bundled, "bundled");
  assert.deepEqual(await findRoleTemplate(roots, "review"), { path: bundled, content: "bundled" });
  writeFile(user, "user");
  assert.deepEqual(await findRoleTemplate(roots, "review"), { path: user, content: "user" });
  writeFile(project, "project");
  assert.deepEqual(await findRoleTemplate(roots, "review"), { path: project, content: "project" });
  assert.deepEqual(await findRoleTemplate(roots, "custom"), { path: generic, content: "generic" });
});

test("findRoleTemplate fails when no template exists", async (t) => {
  const roots = fixture(t);
  await assert.rejects(findRoleTemplate(roots, "review"), (error: unknown) => error instanceof OmtError);
});

test("findRoleTemplate never reads outside the roles directories for a path-like role", async (t) => {
  const roots = fixture(t);
  writeFile(join(roots.packageRoot, "skills", "omt", "references", "roles", "_generic.md"), "generic");
  writeFile(join(roots.packageRoot, "secret.md"), "secret");
  const found = await findRoleTemplate(roots, "../../../secret");
  assert.equal(found.content, "generic");
});

test("loadResultContract reads and trims the contract for a result kind", async (t) => {
  const roots = fixture(t);
  writeFile(join(roots.packageRoot, "skills", "omt", "references", "results", "review.md"), `\n${CONTRACT}\n\n`);
  assert.equal(await loadResultContract(roots.packageRoot, "review"), CONTRACT);
  await assert.rejects(loadResultContract(roots.packageRoot, "work"), (error: unknown) => error instanceof OmtError);
});
