import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, statSync, symlinkSync, lstatSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run as config } from "../../src/commands/config.ts";
import { run as init } from "../../src/commands/init.ts";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import { parseJsonc } from "../../src/config/jsonc.ts";
import { PROJECT_STARTER_CONFIG, USER_STARTER_CONFIG } from "../../src/config/starter.ts";
import { validateLayer } from "../../src/config/validate.ts";
import { OmtError } from "../../src/util/errors.ts";
import { logicalCwd } from "../../src/main.ts";
import { findProjectRoot } from "../../src/paths.ts";
import { CLI_PATH, childEnv, fakeContext, tempDir } from "../helpers.ts";

function setup(t: TestContext) {
  const root = tempDir(t);
  const project = join(root, "project");
  mkdirSync(join(project, ".git"), { recursive: true });
  const configDir = join(root, "cfg");
  const userPath = join(configDir, "config.jsonc");
  const projectPath = join(project, ".omt", "config.jsonc");
  const ctx = (argv: string[]) => {
    const base = fakeContext({ root });
    return fakeContext({ root, argv, env: { ...base.env, OMT_CONFIG_DIR: configDir } });
  };
  const write = (path: string, text: string) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  };
  return { root, project, configDir, userPath, projectPath, ctx, write };
}

async function rejectsUsage(promise: Promise<number>): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof OmtError && error.exitCode === 2);
}

test("config show --defaults prints the 13 default roles as JSON", async (t) => {
  const { ctx } = setup(t);
  const c = ctx(["show", "--defaults"]);
  assert.equal(await config(c), 0);
  const printed = JSON.parse(c.out());
  assert.deepEqual(printed, DEFAULT_CONFIG);
  assert.equal(Object.keys(printed.roles).length, 13);
  assert.deepEqual(printed.visuals, { plan: true });
});

test("a layer with visuals.plan false turns the plan page off, and a bad value is an error", async (t) => {
  const { ctx, write, userPath, projectPath } = setup(t);
  write(userPath, '{ "visuals": { "plan": false } }');
  let c = ctx([]);
  assert.equal(await config(c), 0);
  assert.deepEqual(JSON.parse(c.out()).visuals, { plan: false });
  assert.equal(c.err(), "");

  write(projectPath, '{ "visuals": { "plan": "yes", "page": true } }');
  c = ctx([]);
  assert.equal(await config(c), 0);
  assert.deepEqual(JSON.parse(c.out()).visuals, { plan: false });
  assert.equal(
    c.err(),
    `error ${projectPath} visuals.plan: must be a boolean, got "yes"\n` +
      `error ${projectPath} visuals.page: unknown visuals key "page"; allowed keys: plan\n`,
  );
});

test("config with no subcommand shows the effective config and prints issues to stderr", async (t) => {
  const { ctx, write, userPath } = setup(t);
  write(userPath, '{ "limits": { "maxParallel": 7, "maxDepth": 99 } }');
  const c = ctx([]);
  assert.equal(await config(c), 0);
  assert.equal(JSON.parse(c.out()).limits.maxParallel, 7);
  assert.equal(c.err(), `error ${userPath} limits.maxDepth: must be an integer from 0 to 3, got 99\n`);
});

test("config path prints both paths with absent and present", async (t) => {
  const { ctx, write, userPath, projectPath } = setup(t);
  let c = ctx(["path"]);
  assert.equal(await config(c), 0);
  assert.equal(c.out(), `user: ${userPath} (absent)\nproject: ${projectPath} (absent)\n`);
  write(userPath, "{}");
  write(projectPath, "{}");
  c = ctx(["path"]);
  await config(c);
  assert.equal(c.out(), `user: ${userPath} (present)\nproject: ${projectPath} (present)\n`);
});

test("config validate prints config ok when there is no issue", async (t) => {
  const { ctx } = setup(t);
  const c = ctx(["validate"]);
  assert.equal(await config(c), 0);
  assert.equal(c.out(), "config ok\n");
});

test("config validate prints each issue and exits 1 on an error", async (t) => {
  const { ctx, write, userPath, projectPath } = setup(t);
  write(userPath, '{ "bogus": 1 }');
  write(projectPath, "{ oops }");
  const c = ctx(["validate"]);
  assert.equal(await config(c), 1);
  const lines = c.out().trimEnd().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0] ?? "", new RegExp(`^error ${userPath} bogus: unknown key "bogus"`));
  assert.ok(lines[1]?.startsWith(`error ${projectPath}: 1:3: `), lines[1]);
  assert.equal(lines[1]?.split(projectPath).length, 2, "prints the path once");
});

test("config validate exits 0 when every issue is a warning", async (t) => {
  const { ctx, write, userPath } = setup(t);
  write(userPath, '{ "roles": { "nope": null } }');
  const c = ctx(["validate"]);
  assert.equal(await config(c), 0);
  assert.match(c.out(), /^warning .* roles\.nope: /);
});

test("config validate --json prints ok and the issues", async (t) => {
  const { ctx, write, userPath } = setup(t);
  let c = ctx(["validate", "--json"]);
  assert.equal(await config(c), 0);
  assert.deepEqual(JSON.parse(c.out()), { ok: true, issues: [] });
  write(userPath, '{ "version": 3 }');
  c = ctx(["validate", "--json"]);
  assert.equal(await config(c), 1);
  const printed = JSON.parse(c.out());
  assert.equal(printed.ok, false);
  assert.deepEqual(printed.issues, [
    { source: userPath, path: "version", message: "must be 1, got 3", severity: "error" },
  ]);
});

test("config init writes the user starter, which loads with no issues", async (t) => {
  const { ctx, userPath } = setup(t);
  const c = ctx(["init"]);
  assert.equal(await config(c), 0);
  assert.equal(c.out(), `create ${userPath}\n`);
  assert.equal(readFileSync(userPath, "utf8"), USER_STARTER_CONFIG);
  const v = ctx(["validate"]);
  assert.equal(await config(v), 0);
  assert.equal(v.out(), "config ok\n");
});

test("config init refuses to overwrite without --force", async (t) => {
  const { ctx, write, userPath } = setup(t);
  write(userPath, "{ }");
  await assert.rejects(config(ctx(["init"])), (error: unknown) => {
    assert.ok(error instanceof OmtError);
    assert.equal(error.exitCode, 1);
    assert.match(error.message, /already exists/);
    return true;
  });
  assert.equal(readFileSync(userPath, "utf8"), "{ }");
  const c = ctx(["init", "--force"]);
  assert.equal(await config(c), 0);
  assert.equal(c.out(), `overwrite ${userPath}\n`);
  assert.equal(readFileSync(userPath, "utf8"), USER_STARTER_CONFIG);
});

test("config init --force keeps a symlinked config a symlink", async (t) => {
  const { root, ctx, configDir, userPath } = setup(t);
  const real = join(root, "dotfiles", "omt.jsonc");
  mkdirSync(join(root, "dotfiles"), { recursive: true });
  mkdirSync(configDir, { recursive: true });
  writeFileSync(real, "{}");
  symlinkSync(real, userPath);
  assert.equal(await config(ctx(["init", "--force"])), 0);
  assert.ok(lstatSync(userPath).isSymbolicLink());
  assert.equal(readFileSync(real, "utf8"), USER_STARTER_CONFIG);
});

test("config rejects an unknown subcommand, an extra argument, and an unknown flag", async (t) => {
  const { ctx } = setup(t);
  await rejectsUsage(config(ctx(["edit"])));
  await rejectsUsage(config(ctx(["show", "extra"])));
  await rejectsUsage(config(ctx(["show", "--yaml"])));
});

test("the starter configs are valid layers", () => {
  for (const text of [USER_STARTER_CONFIG, PROJECT_STARTER_CONFIG]) {
    assert.deepEqual(validateLayer(parseJsonc(text, "starter"), "starter").issues, []);
  }
});

test("init creates the config, plans dir, and .gitignore in the project root", async (t) => {
  const { project, ctx } = setup(t);
  const nested = join(project, "a", "b");
  mkdirSync(nested, { recursive: true });
  const c = { ...ctx([]), cwd: nested };
  let out = "";
  c.stdout = (text) => {
    out += text;
  };
  assert.equal(await init(c), 0);
  const omt = join(project, ".omt");
  assert.equal(
    out,
    `create ${join(omt, "config.jsonc")}\ncreate ${join(omt, "plans")}\ncreate ${join(omt, ".gitignore")}\n`,
  );
  assert.equal(readFileSync(join(omt, "config.jsonc"), "utf8"), PROJECT_STARTER_CONFIG);
  assert.ok(statSync(join(omt, "plans")).isDirectory());
  assert.equal(readFileSync(join(omt, ".gitignore"), "utf8"), "ledger.jsonl\nevidence/\nbin/\ninstall.json\nbackups/\nplans/\n");
});

test("init creates only what is missing and never overwrites the config", async (t) => {
  const { project, ctx, write, projectPath } = setup(t);
  write(projectPath, "{ /* mine */ }");
  const omt = join(project, ".omt");
  const c = ctx([]);
  assert.equal(await init(c), 0);
  assert.equal(
    c.out(),
    `exists ${projectPath}\ncreate ${join(omt, "plans")}\ncreate ${join(omt, ".gitignore")}\n`,
  );
  assert.equal(readFileSync(projectPath, "utf8"), "{ /* mine */ }");
  const again = ctx([]);
  assert.equal(await init(again), 0);
  assert.equal(
    again.out(),
    `exists ${projectPath}\nexists ${join(omt, "plans")}\nexists ${join(omt, ".gitignore")}\n`,
  );
});

test("init adds the missing lines to an existing .gitignore and keeps the user's lines", async (t) => {
  const { project, ctx, write, projectPath } = setup(t);
  const ignore = join(project, ".omt", ".gitignore");
  write(ignore, "ledger.jsonl\nevidence/\nbin/\ninstall.json\nbackups/\n# mine\nscratch/");
  const c = ctx([]);
  assert.equal(await init(c), 0);
  assert.equal(
    c.out(),
    `create ${projectPath}\ncreate ${join(project, ".omt", "plans")}\nupdate ${ignore}\n`,
  );
  assert.equal(
    readFileSync(ignore, "utf8"),
    "ledger.jsonl\nevidence/\nbin/\ninstall.json\nbackups/\n# mine\nscratch/\nplans/\n",
  );
  const again = ctx([]);
  assert.equal(await init(again), 0);
  assert.match(again.out(), new RegExp(`^exists ${ignore.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
});

test("init updates a symlinked .gitignore through its target and leaves a dangling one alone", async (t) => {
  const { root, project, ctx, write } = setup(t);
  const ignore = join(project, ".omt", ".gitignore");
  const target = join(root, "dotfiles", "omt-gitignore");
  write(target, "ledger.jsonl\n");
  mkdirSync(join(project, ".omt"), { recursive: true });
  symlinkSync(target, ignore);
  assert.equal(await init(ctx([])), 0);
  assert.ok(lstatSync(ignore).isSymbolicLink());
  assert.equal(readFileSync(target, "utf8"), "ledger.jsonl\nevidence/\nbin/\ninstall.json\nbackups/\nplans/\n");

  const other = setup(t);
  const dangling = join(other.project, ".omt", ".gitignore");
  mkdirSync(join(other.project, ".omt"), { recursive: true });
  symlinkSync(join(other.root, "missing"), dangling);
  const c = other.ctx([]);
  assert.equal(await init(c), 0);
  assert.match(c.out(), /^exists .*\.gitignore$/m);
  assert.ok(lstatSync(dangling).isSymbolicLink());
});

test("init rejects arguments", async (t) => {
  const { ctx } = setup(t);
  await rejectsUsage(init(ctx(["now"])));
  await rejectsUsage(init(ctx(["--force"])));
});

test("config init --force writes through a dangling symlink to its target", async (t) => {
  const { root, ctx, configDir, userPath } = setup(t);
  const real = join(root, "dotfiles", "omt.jsonc");
  mkdirSync(configDir, { recursive: true });
  symlinkSync(real, userPath);
  assert.equal(await config(ctx(["init", "--force"])), 0);
  assert.ok(lstatSync(userPath).isSymbolicLink());
  assert.equal(readFileSync(real, "utf8"), USER_STARTER_CONFIG);
});

test("logicalCwd keeps $PWD when it names the same directory as the real cwd", (t) => {
  const root = tempDir(t);
  const real = join(root, "real");
  const link = join(root, "link");
  mkdirSync(real);
  symlinkSync(real, link);
  const physical = realpathSync(real);
  assert.equal(logicalCwd({ PWD: link }, physical), link);
  assert.equal(logicalCwd({ PWD: root }, physical), physical);
  assert.equal(logicalCwd({ PWD: "relative" }, physical), physical);
  assert.equal(logicalCwd({}, physical), physical);
});

test("logicalCwd drops $PWD when a symlink into a subdirectory hides the project root", (t) => {
  const root = tempDir(t);
  const repo = join(root, "real", "repo");
  const pkg = join(repo, "pkg");
  const link = join(root, "pkglink");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(join(repo, ".omt"));
  mkdirSync(pkg);
  symlinkSync(pkg, link);
  const physical = realpathSync(pkg);
  assert.equal(logicalCwd({ PWD: link }, physical), physical);
  assert.equal(findProjectRoot(logicalCwd({ PWD: link }, physical)), realpathSync(repo));

  const repoLink = join(root, "repolink");
  symlinkSync(repo, repoLink);
  assert.equal(logicalCwd({ PWD: join(repoLink, "pkg") }, physical), join(repoLink, "pkg"));
});

test("config path prints the user and project paths unresolved", (t) => {
  const root = tempDir(t);
  const real = join(root, "real");
  const link = join(root, "link");
  mkdirSync(join(real, ".git"), { recursive: true });
  symlinkSync(real, link);
  const env = { ...childEnv(root), PWD: link, OMT_CONFIG_DIR: join(link, "cfg") };
  const result = spawnSync(process.execPath, [CLI_PATH, "config", "path"], { cwd: link, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    `user: ${join(link, "cfg", "config.jsonc")} (absent)\nproject: ${join(link, ".omt", "config.jsonc")} (absent)\n`,
  );
});

test("with $PWD on a symlink into a subdirectory, the CLI uses the real project root", (t) => {
  const root = tempDir(t);
  const repo = join(root, "real", "repo");
  const link = join(root, "pkglink");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(join(repo, ".omt"));
  writeFileSync(join(repo, ".omt", "config.jsonc"), '{ "version": 1 }\n');
  mkdirSync(join(repo, "pkg"));
  symlinkSync(join(repo, "pkg"), link);
  const env = { ...childEnv(root), PWD: link };
  const cli = (args: string[]) => spawnSync(process.execPath, [CLI_PATH, ...args], { cwd: link, env, encoding: "utf8" });

  const path = cli(["config", "path"]);
  assert.equal(path.status, 0, path.stderr);
  assert.match(path.stdout, new RegExp(`^project: ${realpathSync(repo)}/\\.omt/config\\.jsonc \\(present\\)$`, "m"));

  const add = cli(["ledger", "add", "--role", "execute", "--status", "dispatched", "--task-id", "t1"]);
  assert.equal(add.status, 0, add.stderr);
  assert.ok(readFileSync(join(repo, ".omt", "ledger.jsonl"), "utf8").includes('"taskId":"t1"'));
  assert.throws(() => statSync(join(repo, "pkg", ".omt")));
});
