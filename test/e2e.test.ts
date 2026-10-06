import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { BriefJsonOutput, LedgerStats, RouteOutput } from "../src/types.ts";
import { CLI_PATH, childEnv, tempDir } from "./helpers.ts";

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

  // process.execPath, not a `node` shim: a version-manager shim can fail when HOME is a temp dir.
  const omt = (args: string[], input = "") => {
    const result = spawnSync(process.execPath, [CLI_PATH, ...args], { cwd: project, env, encoding: "utf8", input });
    return { code: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  const ok = (args: string[], input = "") => {
    const result = omt(args, input);
    assert.equal(result.code, 0, `omt ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };

  assert.match(ok(["install", "--yes"]), /^Applied \d+ changes\.$/m);
  assert.deepEqual(omtEntries(join(home, ".agents", "skills")).sort(), [
    "omt",
    "omt-loop",
    "omt-plan",
    "omt-research",
    "omt-review",
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
