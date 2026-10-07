import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { main } from "../../src/main.ts";
import { fakeContext, gitRepo, tempDir } from "../helpers.ts";

// A main checkout with one commit and a linked worktree; `run` calls main() with the cwd in the worktree.
function worktreeProject(t: TestContext) {
  const root = tempDir(t, "omt-wt-");
  const project = join(root, "project");
  const worktree = join(root, "wt");
  gitRepo(root, project)(["worktree", "add", "-q", worktree]);
  const run = async (argv: string[], cwd = worktree) => {
    const ctx = fakeContext({ root, cwd });
    const code = await main(argv, ctx);
    return { code, ctx };
  };
  return { root, project, worktree, run };
}

const WARNING = /^warning: .*[/\\]wt[/\\]\.omt holds plans or a ledger that omt no longer reads; move them to .*[/\\]project[/\\]\.omt$/;

test("init, plan new, and ledger add from a worktree write under the main checkout's .omt", async (t) => {
  const p = worktreeProject(t);
  for (const argv of [["init"], ["plan", "new", "w1"], ["ledger", "add", "--plan", "w1", "--role", "explore", "--status", "completed"]]) {
    const { code, ctx } = await p.run(argv);
    assert.equal(code, 0, ctx.err());
    assert.doesNotMatch(ctx.err(), /warning/, `${argv.join(" ")} prints no warning`);
  }
  assert.ok(existsSync(join(p.project, ".omt", "config.jsonc")));
  assert.ok(existsSync(join(p.project, ".omt", "plans", "w1.md")));
  assert.match(readFileSync(join(p.project, ".omt", "ledger.jsonl"), "utf8"), /"plan":"w1"/);
  assert.ok(!existsSync(join(p.worktree, ".omt")), "the worktree gets no .omt");

  const status = await p.run(["plan", "status", "w1"], p.project);
  assert.equal(status.code, 0, status.ctx.err());
});

test("omt paths prints the main checkout's paths from a worktree", async (t) => {
  const p = worktreeProject(t);
  const evidence = await p.run(["paths", "--evidence"]);
  assert.equal(evidence.code, 0, evidence.ctx.err());
  assert.equal(evidence.ctx.out(), `${join(p.project, ".omt", "evidence")}\n`);

  const root = await p.run(["paths", "--root"]);
  assert.equal(realpathSync(root.ctx.out().trim()), realpathSync(p.project));

  const json = await p.run(["paths", "--json"]);
  assert.equal(json.code, 0, json.ctx.err());
  const omt = join(p.project, ".omt");
  assert.deepEqual(JSON.parse(json.ctx.out()), {
    root: p.project,
    omt,
    plans: join(omt, "plans"),
    ledger: join(omt, "ledger.jsonl"),
    evidence: join(omt, "evidence"),
    config: join(omt, "config.jsonc"),
    shim: join(omt, "bin", "omt"),
  });
});

test("omt paths prints text lines, JSON, or one path per flag", async (t) => {
  const p = worktreeProject(t);
  const omt = join(p.project, ".omt");
  const expected: Record<string, string> = {
    root: p.project,
    omt,
    plans: join(omt, "plans"),
    ledger: join(omt, "ledger.jsonl"),
    evidence: join(omt, "evidence"),
    config: join(omt, "config.jsonc"),
    shim: join(omt, "bin", "omt"),
  };
  const text = await p.run(["paths"], p.project);
  assert.equal(text.code, 0, text.ctx.err());
  assert.equal(text.ctx.out(), Object.entries(expected).map(([name, path]) => `${name}: ${path}\n`).join(""));
  for (const flag of ["root", "plans", "ledger", "evidence", "config", "shim"]) {
    const one = await p.run(["paths", `--${flag}`], p.project);
    assert.equal(one.code, 0, one.ctx.err());
    assert.equal(one.ctx.out(), `${expected[flag]}\n`, flag);
  }
  assert.equal((await p.run(["paths", "--root", "--plans"])).code, 2);
  assert.equal((await p.run(["paths", "--json", "--root"])).code, 2);
  assert.equal((await p.run(["paths", "extra"])).code, 2);
});

test("a worktree .omt with plans gives one shadowed-state warning and a hint; other state gives none", async (t) => {
  const p = worktreeProject(t);
  mkdirSync(join(p.worktree, ".omt", "plans"), { recursive: true });
  writeFileSync(join(p.worktree, ".omt", "config.jsonc"), "{}\n");
  mkdirSync(join(p.worktree, ".omt", "plans", "dir.md"));
  for (const argv of [["plan", "list"], ["ledger", "list"]]) {
    const quiet = await p.run(argv);
    assert.equal(quiet.code, 0, quiet.ctx.err());
    assert.equal(quiet.ctx.err(), "", `${argv.join(" ")}: no plans or ledger in the worktree`);
  }
  writeFileSync(join(p.worktree, ".omt", "plans", "x.md"), "# x\n");
  const warned = await p.run(["plan", "list"]);
  assert.equal(warned.code, 0, warned.ctx.err());
  const lines = warned.ctx.err().trimEnd().split("\n");
  assert.equal(lines.length, 2, warned.ctx.err());
  assert.match(lines[0] ?? "", WARNING);
  assert.equal(
    lines[1],
    'hint: if git tracks them, untrack them with "git rm --cached" and commit; .omt/.gitignore keeps plans out of git',
  );
  assert.equal((await p.run(["paths"])).ctx.err(), "", "paths does not warn");
  assert.equal((await p.run(["plan", "list"], p.project)).ctx.err(), "", "no warning from the main checkout");
});

test("init from a worktree of a bare repository at <repo>/.git writes the worktree's .omt", async (t) => {
  const root = tempDir(t, "omt-wt-");
  const seed = join(root, "seed");
  const git = gitRepo(root, seed);
  const repo = join(root, "repo");
  git(["init", "-q", "--bare", "-b", "main", join(repo, ".git")], root);
  git(["push", "-q", join(repo, ".git"), "main"]);
  const worktree = join(root, "wt");
  git(["worktree", "add", "-q", worktree, "main"], join(repo, ".git"));
  const ctx = fakeContext({ root, cwd: worktree });
  const code = await main(["init"], ctx);
  assert.equal(code, 0, ctx.err());
  assert.ok(existsSync(join(worktree, ".omt", "config.jsonc")));
  assert.ok(!existsSync(join(repo, ".omt")), "the bare repository gets no .omt");
});
