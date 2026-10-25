import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import { run as install } from "../../src/commands/install.ts";
import { run as uninstall } from "../../src/commands/uninstall.ts";
import { addProject } from "../../src/install/projects.ts";
import { projectsPath } from "../../src/paths.ts";
import { fakeContext, tempDir } from "../helpers.ts";
import { makeFixture, readJson } from "./fixture.ts";

function projectFixture() {
  const f = makeFixture();
  mkdirSync(join(f.root, "project", ".git"));
  const context = (argv: string[]) => fakeContext({
    root: f.root,
    packageRoot: f.packageRoot,
    cliPath: "/opt/omt/dist/cli.js",
    argv,
  });
  const ctx = context([]);
  return { context, root: ctx.cwd, path: projectsPath(ctx.env, ctx.homedir), now: ctx.now() };
}

test("install --project --yes records the project root", async () => {
  const f = projectFixture();
  const ctx = f.context(["--project", "--yes"]);

  assert.equal(await install(ctx), 0, ctx.err());
  assert.deepEqual(readJson(f.path), {
    version: 1,
    projects: [{ root: f.root, addedAt: f.now.toISOString() }],
  });
});

test("install --project --yes records the root when everything is up to date", async () => {
  const f = projectFixture();
  const first = f.context(["--project", "--yes"]);
  assert.equal(await install(first), 0, first.err());
  rmSync(f.path);
  const again = f.context(["--project", "--yes"]);

  assert.equal(await install(again), 0, again.err());
  assert.match(again.out(), /Everything is up to date\./);
  assert.deepEqual(readJson(f.path), {
    version: 1,
    projects: [{ root: f.root, addedAt: f.now.toISOString() }],
  });
});

test("install --project --dry-run does not record the root or change the project list", async () => {
  const f = projectFixture();
  const dryRun = f.context(["--project", "--yes", "--dry-run"]);

  assert.equal(await install(dryRun), 0, dryRun.err());
  assert.equal(existsSync(f.path), false);

  const other = tempDir();
  await addProject(f.path, other, f.now);
  const before = readFileSync(f.path, "utf8");
  const again = f.context(["--project", "--yes", "--dry-run"]);
  assert.equal(await install(again), 0, again.err());
  assert.equal(readFileSync(f.path, "utf8"), before);
});

test("uninstall --project --yes removes the root and keeps other projects", async () => {
  const f = projectFixture();
  const installed = f.context(["--project", "--yes"]);
  assert.equal(await install(installed), 0, installed.err());
  const other = tempDir();
  await addProject(f.path, other, f.now);
  const ctx = f.context(["--project", "--yes"]);

  assert.equal(await uninstall(ctx), 0, ctx.err());
  assert.deepEqual(readJson(f.path), {
    version: 1,
    projects: [{ root: other, addedAt: f.now.toISOString() }],
  });
});

test("addProject dedupes a root and its symlink spelling", async () => {
  const ctx = fakeContext({ root: tempDir() });
  const path = projectsPath(ctx.env, ctx.homedir);
  const alias = join(ctx.homedir, "project-link");
  symlinkSync(ctx.cwd, alias, "dir");

  await addProject(path, ctx.cwd, ctx.now());
  await addProject(path, alias, new Date("2026-02-03T04:05:06.000Z"));
  await addProject(path, ctx.cwd, ctx.now());

  assert.deepEqual(readJson(path), {
    version: 1,
    projects: [{ root: ctx.cwd, addedAt: ctx.now().toISOString() }],
  });
});
