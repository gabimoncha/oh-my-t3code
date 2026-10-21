import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnOmt, tempDir, writeFile } from "../helpers.ts";

test("e2e U2: defaults pins latest and repairs an unknown pin without changing other text", () => {
  const root = tempDir();
  const project = join(root, "project");
  mkdirSync(join(project, ".git"), { recursive: true });
  const projectPath = join(project, ".omt", "config.jsonc");
  const cli = (args: string[]) => spawnOmt(args, { root, cwd: project, env: { PWD: project } });
  const original = '{\n  // Keep my role override.\n  "version": 1,\n  "roles": { "execute": { "fast": true } },\n}\n';
  writeFile(projectPath, original);

  const unpinned = cli(["defaults", "list"]);
  assert.equal(unpinned.code, 0, unpinned.stderr);
  assert.equal(unpinned.stderr, "");
  assert.equal(unpinned.stdout, "2026-10  latest, selected (latest)\n");

  const pin = cli(["defaults", "use", "latest", "--project", "--yes"]);
  assert.equal(pin.code, 0, pin.stderr);
  assert.equal(pin.stderr, "");
  const pinned = original.replace('  "version": 1,\n', '  "version": 1,\n  "defaults": "2026-10",\n');
  assert.equal(readFileSync(projectPath, "utf8"), pinned, "pin adds only the defaults property");

  const selected = cli(["defaults", "list"]);
  assert.equal(selected.code, 0, selected.stderr);
  assert.equal(selected.stderr, "");
  assert.equal(selected.stdout, `2026-10  latest, selected (${projectPath})\n`);

  const unknown = pinned.replace('"defaults": "2026-10"', '"defaults": "1999-01"');
  writeFile(projectPath, unknown);
  const invalid = cli(["config", "validate"]);
  assert.equal(invalid.code, 1, invalid.stderr);
  assert.equal(invalid.stderr, "");
  assert.equal(invalid.stdout, `error ${projectPath} defaults: unknown default set "1999-01"; known sets: 2026-10\n`);

  const repair = cli(["defaults", "use", "latest", "--project", "--yes"]);
  assert.equal(repair.code, 0, repair.stderr);
  assert.equal(repair.stderr, "");
  assert.equal(
    readFileSync(projectPath, "utf8"),
    unknown.replace('"defaults": "1999-01"', '"defaults": "2026-10"'),
    "repair replaces only the defaults value",
  );

  const valid = cli(["config", "validate"]);
  assert.equal(valid.code, 0, valid.stderr);
  assert.equal(valid.stderr, "");
  assert.equal(valid.stdout, "config ok\n");
});
