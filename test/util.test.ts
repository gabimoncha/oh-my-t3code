import { chmodSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/util/args.ts";
import { OmtError } from "../src/util/errors.ts";
import {
  copyDir,
  ensureDir,
  hashDir,
  isSymlink,
  MANAGED_MARKER,
  pathExists,
  readFileIfExists,
  writeFileAtomic,
} from "../src/util/fs.ts";
import { formatJson, renderTable } from "../src/util/output.ts";
import { tempDir } from "./helpers.ts";

test("OmtError defaults to exit code 1 and keeps code, hint, and cause", () => {
  const cause = new Error("inner");
  const error = new OmtError("bad", "it failed", { hint: "try again", cause });
  assert.equal(error.code, "bad");
  assert.equal(error.message, "it failed");
  assert.equal(error.hint, "try again");
  assert.equal(error.exitCode, 1);
  assert.equal(error.cause, cause);
  assert.ok(error instanceof Error);
  assert.equal(new OmtError("usage", "x", { exitCode: 2 }).exitCode, 2);
  assert.equal(new OmtError("x", "y").hint, undefined);
});

test("writeFileAtomic creates parent directories and leaves no temp file", async (t) => {
  const root = tempDir(t);
  const target = join(root, "a", "b", "file.txt");
  await writeFileAtomic(target, "one");
  assert.equal(readFileSync(target, "utf8"), "one");
  await writeFileAtomic(target, "two");
  assert.equal(readFileSync(target, "utf8"), "two");
  assert.deepEqual(readdirSync(join(root, "a", "b")), ["file.txt"]);
});

test("readFileIfExists, pathExists, and isSymlink handle missing paths", async (t) => {
  const root = tempDir(t);
  const file = join(root, "f.txt");
  assert.equal(await readFileIfExists(file), undefined);
  assert.equal(await pathExists(file), false);
  assert.equal(await isSymlink(file), false);
  writeFileSync(file, "hi");
  assert.equal(await readFileIfExists(file), "hi");
  assert.equal(await pathExists(file), true);
  assert.equal(await isSymlink(file), false);
  const link = join(root, "link");
  symlinkSync("missing-target", link);
  assert.equal(await pathExists(link), true);
  assert.equal(await isSymlink(link), true);
});

test("parseArgs returns values and positionals", () => {
  const parsed = parseArgs(["show", "--json", "--role", "a", "--role", "b"], {
    json: { type: "boolean" },
    role: { type: "string", multiple: true },
  });
  assert.deepEqual(parsed.positionals, ["show"]);
  assert.equal(parsed.values.json, true);
  assert.deepEqual(parsed.values.role, ["a", "b"]);
});

test("parseArgs turns a parse error into an OmtError with exit code 2", () => {
  assert.throws(
    () => parseArgs(["--nope"], { json: { type: "boolean" } }),
    (error: unknown) => error instanceof OmtError && error.exitCode === 2 && error.code === "usage",
  );
  assert.throws(
    () => parseArgs(["--role"], { role: { type: "string" } }),
    (error: unknown) => error instanceof OmtError && error.exitCode === 2,
  );
});

test("copyDir copies a tree and hashDir ignores the marker file and .DS_Store", async (t) => {
  const root = tempDir(t);
  const source = join(root, "skill");
  mkdirSync(join(source, "references"), { recursive: true });
  writeFileSync(join(source, "SKILL.md"), "# skill\n");
  writeFileSync(join(source, "references", "a.md"), "a\n");
  const before = await hashDir(source);
  assert.match(before, /^[0-9a-f]{64}$/);

  const copy = join(root, "out", "skill");
  await copyDir(source, copy);
  assert.equal(readFileSync(join(copy, "references", "a.md"), "utf8"), "a\n");
  assert.equal(await hashDir(copy), before);

  writeFileSync(join(copy, MANAGED_MARKER), "{}\n");
  assert.equal(await hashDir(copy), before);

  writeFileSync(join(copy, ".DS_Store"), "finder\n");
  writeFileSync(join(copy, "references", ".DS_Store"), "finder\n");
  assert.equal(await hashDir(copy), before);

  writeFileSync(join(copy, "references", "a.md"), "changed\n");
  assert.notEqual(await hashDir(copy), before);
});

test("hashDir changes when a file is renamed or added", async (t) => {
  const root = tempDir(t);
  const dir = join(root, "d");
  await ensureDir(dir);
  writeFileSync(join(dir, "x.md"), "same");
  const first = await hashDir(dir);
  const renamed = join(root, "e");
  await ensureDir(renamed);
  writeFileSync(join(renamed, "y.md"), "same");
  assert.notEqual(await hashDir(renamed), first);
  writeFileSync(join(dir, "z.md"), "");
  assert.notEqual(await hashDir(dir), first);
});

test("formatJson uses 2-space indent and a final newline", () => {
  assert.equal(formatJson({ a: [1] }), '{\n  "a": [\n    1\n  ]\n}\n');
});

test("renderTable pads columns and trims trailing space", () => {
  const table = renderTable(["ROLE", "STATUS", "MODE"], [
    ["execute", "resolved", "default"],
    ["qa", "", "plan"],
  ]);
  assert.equal(table, "ROLE     STATUS    MODE\nexecute  resolved  default\nqa                 plan\n");
});

test("writeFileAtomic keeps the mode of the file it replaces and applies a mode to a new file", async (t) => {
  const dir = tempDir(t);
  const path = join(dir, "secret.json");
  writeFileSync(path, "old");
  chmodSync(path, 0o600);
  await writeFileAtomic(path, "new");
  assert.equal(readFileSync(path, "utf8"), "new");
  assert.equal(statSync(path).mode & 0o777, 0o600);
  chmodSync(path, 0o640);
  await writeFileAtomic(path, "newer", { mode: 0o600 });
  assert.equal(statSync(path).mode & 0o777, 0o640);
  const fresh = join(dir, "fresh.json");
  await writeFileAtomic(fresh, "x", { mode: 0o600 });
  assert.equal(statSync(fresh).mode & 0o777, 0o600);
});
