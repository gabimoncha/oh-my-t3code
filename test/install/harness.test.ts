import { test } from "bun:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { childEnv, spawnOmt, tempDir, writeFile } from "../helpers.ts";

function codexOnlyMachine() {
  const root = tempDir();
  const project = join(root, "project");
  const bin = join(root, "bin");
  mkdirSync(join(project, ".git"), { recursive: true });
  const codex = join(bin, "codex");
  writeFile(codex, "#!/bin/sh\nexit 0\n");
  chmodSync(codex, 0o755);
  const env: NodeJS.ProcessEnv = { ...childEnv(root), PWD: project, PATH: bin };
  const settings = join(env.T3CODE_HOME as string, "userdata", "settings.json");
  writeFile(settings, JSON.stringify({ providerInstances: { claudeAgent: { driver: "claudeAgent", enabled: false } } }));
  const config = join(project, ".omt", "config.jsonc");
  const cli = (args: string[]) => spawnOmt(args, { root, cwd: project, env });
  return { bin, settings, config, cli };
}

test("e2e U3: Codex-only install", () => {
  const f = codexOnlyMachine();
  const install = f.cli(["install", "--project", "--yes"]);
  assert.equal(install.code, 0, install.stderr);
  assert.equal(install.stderr, "");
  assert.match(readFileSync(f.config, "utf8"), /"harnesses"\s*:\s*\[\s*"codex"\s*\]/);

  const roles = f.cli(["roles"]);
  assert.equal(roles.code, 0, roles.stderr);
  assert.equal(roles.stderr, "");
  assert.match(roles.stdout, /^design\s+unavailable\s+-\s/m);
  assert.match(roles.stdout, /^ui\s+unavailable\s+-\s/m);
  assert.match(roles.stdout, /^writing\s+\S+\s+codex\//m);
});

test("e2e U3: detect and write flow", () => {
  const f = codexOnlyMachine();
  writeFile(f.config, '{\n  "version": 1\n}\n');
  const detect = f.cli(["detect", "--json"]);
  assert.equal(detect.code, 0, detect.stderr);
  assert.equal(detect.stderr, "");
  const report = JSON.parse(detect.stdout) as { harnesses: { driver: string; detected: boolean }[] };
  assert.equal(report.harnesses.find((harness) => harness.driver === "claudeAgent")?.detected, false);

  const codex = f.cli(["detect", "--write", "--project", "--yes"]);
  assert.equal(codex.code, 0, codex.stderr);
  assert.equal(codex.stderr, "");
  assert.deepEqual(JSON.parse(readFileSync(f.config, "utf8")).harnesses, ["codex"]);

  writeFile(f.settings, "{}\n");
  const claude = join(f.bin, "claude");
  writeFile(claude, "#!/bin/sh\nexit 0\n");
  chmodSync(claude, 0o755);
  const both = f.cli(["detect", "--write", "--project", "--yes"]);
  assert.equal(both.code, 0, both.stderr);
  assert.equal(both.stderr, "");
  assert.equal(Object.hasOwn(JSON.parse(readFileSync(f.config, "utf8")), "harnesses"), false);

  const roles = f.cli(["roles"]);
  assert.equal(roles.code, 0, roles.stderr);
  assert.equal(roles.stderr, "");
  assert.match(roles.stdout, /^writing\s+\S+\s+claudeAgent\//m);
});
