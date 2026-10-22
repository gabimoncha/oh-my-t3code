import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "bun:test";
import { childEnv, PACKAGE_ROOT, tempDir, writeFile } from "./helpers.ts";

const PACKAGES = ["darwin-arm64", "linux-arm64-gnu", "linux-arm64-musl", "linux-x64-gnu", "linux-x64-musl"];

function fakeTool(path: string, name: string): void {
  writeFile(path, `#!/bin/sh\necho "${name} $*"\n`);
  chmodSync(path, 0o755);
}

function fakeRoot(withNative: boolean): string {
  const root = tempDir();
  mkdirSync(join(root, "scripts"));
  copyFileSync(join(PACKAGE_ROOT, "scripts", "tsrs.sh"), join(root, "scripts", "tsrs.sh"));
  fakeTool(join(root, "node_modules", ".bin", "tsrs"), "launcher");
  if (withNative) {
    for (const name of PACKAGES) fakeTool(join(root, "node_modules", "@tsrs", name, "tsrs"), `native ${name}`);
  }
  return root;
}

function runScript(root: string, env: NodeJS.ProcessEnv = {}) {
  const { TSRS_BINARY: _, ...base } = childEnv(root);
  return spawnSync("sh", [join(root, "scripts", "tsrs.sh"), "-p", "tsconfig.json"], {
    cwd: root,
    env: { ...base, ...env },
    encoding: "utf8",
  });
}

test("tsrs.sh runs the native binary for this machine and passes the arguments", () => {
  const result = runScript(fakeRoot(true));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^native (darwin-arm64|linux-(arm64|x64)-(gnu|musl)) -p tsconfig\.json\n$/);
});

test("tsrs.sh falls back to the npm launcher when no native binary is installed", () => {
  const result = runScript(fakeRoot(false));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "launcher -p tsconfig.json\n");
});

test("tsrs.sh runs TSRS_BINARY when it is set", () => {
  const root = fakeRoot(true);
  const override = join(root, "custom", "tsrs");
  fakeTool(override, "override");
  const result = runScript(root, { TSRS_BINARY: override });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "override -p tsconfig.json\n");
});

test("tsrs.sh runs the installed tsrs", () => {
  const { TSRS_BINARY: _, ...env } = childEnv(tempDir());
  const result = spawnSync("sh", [join(PACKAGE_ROOT, "scripts", "tsrs.sh"), "--version"], { env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\(tsrs \d/);
});
