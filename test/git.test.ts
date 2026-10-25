import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "bun:test";
import { run } from "../src/commands/git.ts";
import { findDefaultBranch } from "../src/git/branch.ts";
import { fakeContext, gitEnv, gitRepo, tempDir, writeFile } from "./helpers.ts";

function project() {
  const root = tempDir("omt-git-");
  const cwd = join(root, "project");
  const git = gitRepo(root, cwd);
  const env = gitEnv(root);
  const config = (value: unknown) => writeFile(join(cwd, ".omt", "config.jsonc"), JSON.stringify(value));
  const check = async (action: string, directory = cwd, ...flags: string[]) => {
    const ctx = fakeContext({ root, cwd: directory, env, argv: ["check", action, ...flags, "--json"] });
    assert.equal(await run(ctx), 0);
    assert.equal(ctx.err(), "");
    return JSON.parse(ctx.out()) as {
      decision: string;
      branch: string | null;
      defaultBranch: string | null;
      value: string | null;
      reason: string;
    };
  };
  return { root, cwd, git, env, config, check };
}

test("git default branch uses origin HEAD, existing init.defaultBranch, main, then master", () => {
  const p = project();
  p.git(["branch", "configured"]);
  p.git(["branch", "master"]);
  p.git(["config", "init.defaultBranch", "configured"]);
  p.git(["update-ref", "refs/remotes/origin/upstream", "HEAD"]);
  p.git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/upstream"]);
  assert.equal(findDefaultBranch(p), "upstream");
  p.git(["symbolic-ref", "--delete", "refs/remotes/origin/HEAD"]);
  assert.equal(findDefaultBranch(p), "configured");
  p.git(["branch", "-D", "configured"]);
  assert.equal(findDefaultBranch(p), "main");
  p.git(["checkout", "-q", "-b", "feat/x"]);
  p.git(["branch", "-D", "main"]);
  assert.equal(findDefaultBranch(p), "master");
});

for (const scenario of ["detached HEAD", "no repo", "no default branch"] as const) {
  test(`git commit asks with ${scenario}`, async () => {
    const p = project();
    let cwd = p.cwd;
    if (scenario === "detached HEAD") p.git(["checkout", "-q", "--detach"]);
    if (scenario === "no repo") cwd = join(p.root, "outside");
    if (scenario === "no default branch") {
      p.git(["branch", "-m", "feat/x"]);
      p.git(["config", "init.defaultBranch", "missing"]);
    }
    const result = await p.check("commit", cwd);
    assert.equal(result.decision, "ask");
    assert.match(result.reason, scenario === "detached HEAD" ? /detached/ : scenario === "no repo" ? /not in a git repository/ : /no default branch/);
  });
}

test("git pr asks on the default branch", async () => {
  const p = project();
  p.git(["remote", "add", "origin", "git@github.com:alice/app.git"]);
  const result = await p.check("pr", p.cwd, "--user", "alice");
  assert.equal(result.decision, "ask");
  assert.equal(result.value, "auto");
  assert.match(result.reason, /default branch/);
});

test("git pullRequests off disables push and pr", async () => {
  const p = project();
  p.git(["checkout", "-q", "-b", "feat/x"]);
  p.git(["remote", "add", "origin", "git@github.com:alice/app.git"]);
  p.config({ profiles: { normal: { workflow: { git: { pullRequests: "off" } } } } });
  for (const action of ["push", "pr"]) {
    const result = await p.check(action, p.cwd, "--user", "alice");
    assert.equal(result.decision, "off", action);
    assert.equal(result.value, "off", action);
  }
});

test("git 2026-10 partial policy allows merge and asks for an unset commit value", async () => {
  const p = project();
  p.git(["checkout", "-q", "-b", "feat/x"]);
  p.config({ defaults: "2026-10", profiles: { normal: { workflow: { git: { merge: "auto" } } } } });
  assert.equal((await p.check("merge")).decision, "auto");
  const result = await p.check("commit");
  assert.equal(result.decision, "ask");
  assert.equal(result.value, null);
  assert.match(result.reason, /2026-10/);
});

test("git merge outside a repo uses the merge value", async () => {
  const p = project();
  const outside = join(p.root, "outside");
  writeFile(join(outside, ".omt", "config.jsonc"), JSON.stringify({
    profiles: { normal: { workflow: { git: { merge: "auto" } } } },
  }));
  const result = await p.check("merge", outside);
  assert.equal(result.decision, "auto");
  assert.equal(result.value, "auto");
  assert.equal(result.branch, null);
  assert.equal(result.defaultBranch, null);
});
