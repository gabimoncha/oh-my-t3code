import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { main } from "../src/main.ts";
import { PACKAGE_ROOT, fakeContext, spawnOmt, tempDir } from "./helpers.ts";

const COMMAND_NAMES = [
  "install",
  "uninstall",
  "doctor",
  "init",
  "config",
  "roles",
  "route",
  "brief",
  "plan",
  "profile",
  "ledger",
  "visual",
  "hook",
];

function runCli(t: TestContext, args: string[]) {
  const root = tempDir(t);
  return spawnOmt(args, { root });
}

test("--help lists every command and exits 0", (t) => {
  const result = runCli(t, ["--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^Usage: omt <command>/);
  for (const name of COMMAND_NAMES) {
    assert.match(result.stdout, new RegExp(`^  ${name} `, "m"));
  }
});

test("no command prints the command list", (t) => {
  const result = runCli(t, []);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Commands:/);
});

test("--version prints the package.json version", (t) => {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string };
  const result = runCli(t, ["--version"]);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, `${pkg.version}\n`);
});

test("an unknown command is a usage error with exit 2", (t) => {
  const result = runCli(t, ["nope"]);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^omt: unknown command "nope"\nhint: /);
});

test("an unknown global option is a usage error with exit 2", (t) => {
  const result = runCli(t, ["--nope"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /^omt: unknown option "--nope"/);
});

test("install --help prints the install usage and exits 0", (t) => {
  const result = runCli(t, ["install", "--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^Usage: omt install /);
  assert.match(result.stdout, /--dry-run/);
});

test("every command accepts -h", async (t) => {
  for (const name of COMMAND_NAMES) {
    const ctx = fakeContext({ root: tempDir(t) });
    assert.equal(await main([name, "-h"], ctx), 0, name);
    assert.match(ctx.out(), new RegExp(`^Usage: omt ${name}`), name);
  }
});

test("an OmtError prints omt: <message> and returns its exit code", async (t) => {
  const ctx = fakeContext({ root: tempDir(t) });
  const code = await main(["nope"], ctx);
  assert.equal(code, 2);
  assert.equal(ctx.err(), `omt: unknown command "nope"\nhint: run "omt --help" to see the commands\n`);
});

test("an unexpected error prints omt: unexpected error and returns 1", async (t) => {
  const ctx = fakeContext({
    root: tempDir(t),
    stdout: () => {
      throw new Error("boom");
    },
  });
  assert.equal(await main(["--version"], ctx), 1);
  assert.equal(ctx.err(), "omt: unexpected error: boom\n");
});
