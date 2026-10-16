import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import type { BriefJsonOutput, LedgerStats, RouteOutput } from "../src/types.ts";
import { childEnv, CLI_PATH, gitEnv, gitRepo, spawnOmt, tempDir } from "./helpers.ts";
import { contentTree } from "./install/fixture.ts";

function omtEntries(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.startsWith("omt")) : [];
}

test("end to end: install, use every command in a project, then uninstall", (t) => {
  const root = tempDir(t, "omt-e2e-");
  const env = childEnv(root);
  const home = env.HOME as string;
  const project = join(root, "project");
  mkdirSync(home, { recursive: true });
  mkdirSync(join(project, ".git"), { recursive: true });

  const omt = (args: string[], input = "") => spawnOmt(args, { root, cwd: project, env, input });
  const ok = (args: string[], input = "") => {
    const result = omt(args, input);
    assert.equal(result.code, 0, `omt ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };

  assert.match(ok(["install", "--yes"]), /^Applied \d+ changes\.$/m);
  assert.deepEqual(omtEntries(join(home, ".agents", "skills")).sort(), [
    "omt",
    "omt-design",
    "omt-loop",
    "omt-plan",
    "omt-research",
    "omt-review",
    "omt-show",
    "omt-swarm",
    "omt-ulw",
  ]);

  const doctor = ok(["doctor"]);
  assert.match(doctor, /^PASS  skills  /m);
  assert.match(doctor, /^PASS  links   /m);

  assert.match(ok(["roles"]), /^execute\s+unverified\s+/m);

  const route = JSON.parse(ok(["route", "execute"])) as RouteOutput;
  assert.equal(route.status, "unverified");
  assert.equal(route.delegateTask?.role, "implementation");

  assert.match(ok(["init"]), /^create .*\.omt[/\\]config\.jsonc$/m);
  assert.match(ok(["plan", "new", "demo"]), /demo\.md$/m);
  assert.match(ok(["plan", "status", "demo"]), /^next: U1 /m);

  const brief = JSON.parse(ok(["brief", "execute", "--task", "x", "--plan", "demo", "--unit", "U1", "--json"])) as BriefJsonOutput;
  assert.equal(brief.delegateTask.clientRequestId, "omt:demo:U1:execute:r1:a1");
  assert.equal(brief.delegateTask.title, "execute U1: x");
  assert.equal(brief.delegateTask.mode, "async");

  const added = JSON.parse(
    ok(["ledger", "add", "--plan", "demo", "--unit", "U1", "--role", "execute", "--status", "dispatched", "--task-id", "task-1"]),
  );
  assert.equal(added.taskId, "task-1");
  const stats = JSON.parse(ok(["ledger", "stats", "--plan", "demo", "--json"])) as LedgerStats;
  assert.equal(stats.active, 1);
  assert.equal(stats.canDispatch, true);
  assert.match(ok(["ledger", "stats", "--plan", "demo"]), /^can dispatch: yes$/m);

  const hook = JSON.parse(ok(["hook", "user-prompt-submit"], JSON.stringify({ prompt: "ulw add a demo endpoint" })));
  assert.equal(hook.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(hook.hookSpecificOutput.additionalContext, /omt-ulw/);
  assert.equal(ok(["hook", "user-prompt-submit"], JSON.stringify({ prompt: "add a demo endpoint" })), "");

  assert.match(ok(["uninstall", "--yes"]), /^Removed \d+ paths\.$/m);
  assert.deepEqual(omtEntries(join(home, ".agents", "skills")), []);
  assert.deepEqual(omtEntries(join(home, ".claude", "skills")), []);
});

// A committed git repository in a temp root, with an omt runner whose HOME and git config point into the root.
function gitProject(t: TestContext, files: Record<string, string>) {
  const root = tempDir(t, "omt-e2e-project-");
  const env = gitEnv(root);
  const project = join(root, "project");
  mkdirSync(env.HOME as string, { recursive: true });
  const git = gitRepo(root, project, files);
  const run = (command: string, args: string[]) => {
    const result = spawnSync(command, args, { cwd: project, env, encoding: "utf8" });
    assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };
  const omt = (...args: string[]) => {
    const result = spawnOmt(args, { root, cwd: project, env });
    assert.equal(result.code, 0, `${process.execPath} ${[CLI_PATH, ...args].join(" ")}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };
  const status = () => git(["status", "--porcelain", "--untracked-files=all", "--ignored"]);
  return { env, project, run, git, omt, status };
}

for (const [label, files] of [
  ["a tracked .omt/plans/x.md", { "README.md": "demo\n", ".omt/plans/x.md": "# x\n" }],
  ["no .omt and no .claude", { "README.md": "demo\n" }],
] as const) {
  test(`end to end: install --project with ${label} leaves no trace in git, and uninstall restores the tree`, (t) => {
    const p = gitProject(t, files);
    const excludeBefore = readFileSync(join(p.project, ".git", "info", "exclude"), "utf8");
    const treeBefore = Object.keys(contentTree(p.project));

    assert.match(p.omt("install", "--project", "--hooks", "--yes"), /^Applied \d+ changes\.$/m);
    const written = [".agents/skills/omt-ulw", ".claude/skills/omt-ulw", ".claude/settings.local.json", ".omt/bin/omt", ".omt/config.jsonc"];
    for (const path of written) {
      assert.ok(existsSync(join(p.project, path)), path);
    }
    assert.equal(p.git(["status", "--porcelain", "--untracked-files=all"]), "");
    assert.equal(p.run(join(p.project, ".omt", "bin", "omt"), ["--version"]).trim(), "0.1.0");
    assert.match(p.run(join(p.project, ".omt", "bin", "omt"), ["roles"]), /^execute\s+unverified\s+/m);
    assert.deepEqual(omtEntries(join(p.env.HOME as string, ".agents", "skills")), []);

    assert.match(p.omt("uninstall", "--project", "--yes"), /^Removed \d+ paths\.$/m);
    assert.equal(p.status(), "");
    assert.equal(readFileSync(join(p.project, ".git", "info", "exclude"), "utf8"), excludeBefore);
    assert.deepEqual(Object.keys(contentTree(p.project)), treeBefore);
  });
}

test("end to end: --project keeps the user's own settings.local.json keys and its mode", (t) => {
  const p = gitProject(t, { "README.md": "demo\n" });
  const local = join(p.project, ".claude", "settings.local.json");
  mkdirSync(dirname(local));
  const mine = `${JSON.stringify({ theme: "dark", permissions: { allow: ["Bash(ls)"] } }, null, 2)}\n`;
  writeFileSync(local, mine, { mode: 0o600 });
  chmodSync(local, 0o600);
  const statusBefore = p.git(["status", "--porcelain", "--untracked-files=all"]);

  p.omt("install", "--project", "--hooks", "--yes");
  const settings = JSON.parse(readFileSync(local, "utf8")) as Record<string, unknown>;
  assert.equal(settings.theme, "dark");
  assert.deepEqual(settings.permissions, { allow: ["Bash(ls)"] });
  assert.match(JSON.stringify(settings.hooks), /# oh-my-t3code/);
  assert.equal(statSync(local).mode & 0o777, 0o600);
  assert.equal(p.git(["status", "--porcelain", "--untracked-files=all"]), statusBefore);

  p.omt("uninstall", "--project", "--yes");
  assert.equal(readFileSync(local, "utf8"), mine);
  assert.equal(statSync(local).mode & 0o777, 0o600);
});
