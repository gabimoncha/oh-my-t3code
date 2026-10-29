import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import { writeFile } from "../helpers.ts";
import { doctor } from "../run.ts";
import { makeFixture, readJson, snapshot } from "./fixture.ts";

function retireBeta(packageRoot: string): void {
  rmSync(join(packageRoot, "skills", "beta"), { recursive: true });
}

test("install removes a managed skill that the bundle no longer ships, with its links and record", async () => {
  const f = makeFixture();
  await f.runOk(["install", "--yes"]);
  retireBeta(f.packageRoot);

  const before = snapshot(f.home);
  const dry = await f.runOk(["install", "--dry-run"]);
  assert.match(dry.ctx.out(), /^ {2}remove {3}beta {2}\(no longer shipped\)$/m);
  assert.match(dry.ctx.out(), new RegExp(`^ {2}remove {3}${join(f.claudeSkills, "beta")} -> \\S+ {2}\\(no longer shipped\\)$`, "m"));
  assert.match(dry.ctx.out(), /Dry run: nothing was written\./);
  assert.deepEqual(snapshot(f.home), before);

  await f.runOk(["install", "--yes"]);
  assert.ok(!existsSync(join(f.agents, "beta")));
  assert.throws(() => lstatSync(join(f.claudeSkills, "beta")));
  assert.ok(existsSync(join(f.agents, "alpha", "SKILL.md")));
  const manifest = readJson(f.manifest);
  assert.deepEqual(manifest.skills, ["alpha"]);
  assert.deepEqual((manifest.links as { path: string }[]).map((link) => link.path), [join(f.claudeSkills, "alpha")]);

  const again = await f.runOk(["install", "--yes"]);
  assert.match(again.ctx.out(), /Everything is up to date\./);
});

test("install keeps a folder that omt's record does not list, or that has no omt marker", async () => {
  const f = makeFixture();
  await f.runOk(["install", "--yes"]);
  // An unrecorded folder with a copied marker stays.
  writeFile(join(f.agents, "gamma", "SKILL.md"), "Gamma.\n");
  writeFileSync(join(f.agents, "gamma", ".omt-managed.json"), readFileSync(join(f.agents, "alpha", ".omt-managed.json")));
  // A recorded name whose folder the user replaced with their own stays, and the record forgets it.
  rmSync(join(f.agents, "beta"), { recursive: true });
  writeFile(join(f.agents, "beta", "SKILL.md"), "Owner beta.\n");
  retireBeta(f.packageRoot);

  const { ctx } = await f.runOk(["install", "--yes"]);
  assert.doesNotMatch(ctx.out(), /remove/);
  assert.equal(readFileSync(join(f.agents, "beta", "SKILL.md"), "utf8"), "Owner beta.\n");
  assert.ok(existsSync(join(f.agents, "gamma", "SKILL.md")));
  assert.deepEqual(readJson(f.manifest).skills, ["alpha"]);
});

test("install treats an edited retired skill as a conflict, and --force backs it up and removes it", async () => {
  const f = makeFixture();
  await f.runOk(["install", "--yes"]);
  writeFile(join(f.agents, "beta", "SKILL.md"), "Edited beta.\n");
  retireBeta(f.packageRoot);

  const refused = await f.run(["install", "--yes"]);
  assert.equal(refused.code, 1);
  assert.match(refused.ctx.out(), /^ {2}conflict beta {2}\(locally modified\)$/m);
  assert.equal(readFileSync(join(f.agents, "beta", "SKILL.md"), "utf8"), "Edited beta.\n");
  assert.ok(lstatSync(join(f.claudeSkills, "beta")).isSymbolicLink());

  const { ctx } = await f.runOk(["install", "--yes", "--force"]);
  assert.match(ctx.out(), /^ {2}replace {2}beta/m);
  assert.ok(!existsSync(join(f.agents, "beta")));
  assert.throws(() => lstatSync(join(f.claudeSkills, "beta")));
  const backup = (readJson(f.manifest).backups as string[]).find((path) => path.endsWith("/agents/beta"));
  assert.ok(backup !== undefined);
  assert.equal(readFileSync(join(backup, "SKILL.md"), "utf8"), "Edited beta.\n");
  assert.deepEqual(readJson(f.manifest).skills, ["alpha"]);
});

test("doctor warns about a leftover managed skill until install removes it", async () => {
  const f = makeFixture();
  await f.runOk(["install", "--yes"]);
  assert.equal((await doctor(f)).get("skills").status, "PASS");
  retireBeta(f.packageRoot);

  const warned = (await doctor(f)).get("skills");
  assert.equal(warned.status, "WARN");
  assert.match(warned.message, /^no longer shipped: beta in .*; run omt install$/);

  await f.runOk(["install", "--yes"]);
  assert.equal((await doctor(f)).get("skills").status, "PASS");
});
