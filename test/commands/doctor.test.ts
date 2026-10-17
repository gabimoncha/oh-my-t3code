import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { CLI_PATH } from "../helpers.ts";
import { doctor } from "../run.ts";
import { CAPS_FILE, makeProject } from "./shared.ts";
import type { Project } from "./shared.ts";

async function installed(t: TestContext, args: string[] = []): Promise<Project> {
  const project = makeProject(t);
  await project.runOk(["install", "--yes", ...args]);
  return project;
}

function t3Settings(project: Project, value: unknown): void {
  mkdirSync(join(project.home, ".t3", "userdata"), { recursive: true });
  writeFileSync(join(project.home, ".t3", "userdata", "settings.json"), JSON.stringify(value));
}

test("doctor prints one line per check and exits 0 without failures", async (t) => {
  const project = makeProject(t);
  const { ctx } = await project.runOk(["doctor"]);
  const ids = ctx.out().trimEnd().split("\n").map((line) => line.split(/\s+/)[1]);
  assert.deepEqual(ids, ["node", "config", "skills", "links", "hooks", "path", "t3", "homes"]);
  assert.match(ctx.out(), /^PASS  config  15 roles$/m);
});

test("doctor node check passes on 22.18 and fails on an older version", async (t) => {
  const project = makeProject(t);
  assert.equal((await doctor(project, [], { nodeVersion: "22.18.0" })).get("node").status, "PASS");
  assert.equal((await doctor(project, [], { nodeVersion: "24.0.0" })).get("node").status, "PASS");
  const old = await doctor(project, [], { nodeVersion: "22.17.1" });
  assert.equal(old.get("node").status, "FAIL");
  assert.equal(old.report.ok, false);
  assert.equal(old.code, 1);
});

test("doctor config check: PASS, WARN for warnings, FAIL for errors", async (t) => {
  const project = makeProject(t);
  assert.equal((await doctor(project)).get("config").status, "PASS");
  project.projectConfig('{ "version": 1, "roles": { "ghost": null } }\n');
  assert.equal((await doctor(project)).get("config").status, "WARN");
  project.projectConfig("{ not json\n");
  const failed = await doctor(project);
  assert.equal(failed.get("config").status, "FAIL");
  assert.equal(failed.code, 1);
});

test("doctor skills check: PASS when current, WARN when missing or modified", async (t) => {
  const missing = makeProject(t);
  assert.equal((await doctor(missing)).get("skills").status, "WARN");
  assert.match((await doctor(missing)).get("skills").message, /^missing: omt, /);

  const project = await installed(t);
  assert.equal((await doctor(project)).get("skills").status, "PASS");
  writeFileSync(join(project.home, ".agents", "skills", "omt", "SKILL.md"), "edited\n");
  const modified = await doctor(project);
  assert.equal(modified.get("skills").status, "WARN");
  assert.match(modified.get("skills").message, /modified: omt/);
});

test("doctor links check: PASS, WARN for a missing link, FAIL for a conflicting or broken link", async (t) => {
  const project = await installed(t);
  const claudeSkills = join(project.home, ".claude", "skills");
  assert.equal((await doctor(project)).get("links").status, "PASS");

  rmSync(join(claudeSkills, "omt-plan"));
  assert.equal((await doctor(project)).get("links").status, "WARN");

  symlinkSync(join(project.root, "elsewhere"), join(claudeSkills, "omt-plan"));
  assert.equal((await doctor(project)).get("links").status, "FAIL");

  rmSync(join(claudeSkills, "omt-plan"));
  symlinkSync("../../.agents/skills/omt-plan", join(claudeSkills, "omt-plan"));
  rmSync(join(project.home, ".agents", "skills", "omt-plan"), { recursive: true });
  const broken = await doctor(project);
  assert.equal(broken.get("links").status, "FAIL");
  assert.match(broken.get("links").message, /omt-plan \(target is missing\)/);
});

test("doctor hooks check: INFO, PASS, WARN when removed, FAIL for a missing path", async (t) => {
  const plain = await installed(t);
  const info = (await doctor(plain)).get("hooks");
  assert.equal(info.status, "INFO");
  assert.match(info.message, /omt install --hooks/);

  const project = await installed(t, ["--hooks"]);
  assert.equal((await doctor(project)).get("hooks").status, "PASS");

  const settings = join(project.home, ".claude", "settings.json");
  const original = readFileSync(settings, "utf8");
  writeFileSync(settings, original.replace(CLI_PATH, join(project.root, "gone", "cli.ts")));
  const lost = await doctor(project);
  assert.equal(lost.get("hooks").status, "FAIL");
  assert.equal(lost.code, 1);

  writeFileSync(settings, "{}\n");
  assert.equal((await doctor(project)).get("hooks").status, "WARN");
});

test("doctor path check: PASS with an executable omt on PATH, WARN without", async (t) => {
  const project = makeProject(t);
  const bin = join(project.root, "bin");
  mkdirSync(bin);
  const env = { HOME: project.home, PATH: bin };
  assert.equal((await doctor(project, [], { env })).get("path").status, "WARN");
  writeFileSync(join(bin, "omt"), "#!/bin/sh\n");
  assert.equal((await doctor(project, [], { env })).get("path").status, "WARN");
  chmodSync(join(bin, "omt"), 0o755);
  const found = (await doctor(project, [], { env })).get("path");
  assert.equal(found.status, "PASS");
  assert.match(found.message, /bin\/omt$/);
});

test("doctor t3 check: PASS when the T3 settings file exists, WARN otherwise", async (t) => {
  const project = makeProject(t);
  assert.equal((await doctor(project)).get("t3").status, "WARN");
  t3Settings(project, {});
  assert.equal((await doctor(project)).get("t3").status, "PASS");
});

test("doctor homes check: INFO, PASS, and WARN, and it never writes the T3 settings", async (t) => {
  const project = await installed(t);
  assert.equal((await doctor(project)).get("homes").status, "INFO");
  t3Settings(project, { providerInstances: { cursor: { driver: "cursor", config: {} } } });
  assert.equal((await doctor(project)).get("homes").status, "INFO");

  const work = join(project.root, "claude-work");
  t3Settings(project, {
    providerInstances: {
      claudeWork: { driver: "claudeAgent", config: { homePath: work } },
      claudeAgent: { driver: "claudeAgent", config: {} },
    },
  });
  const settingsPath = join(project.home, ".t3", "userdata", "settings.json");
  const before = readFileSync(settingsPath, "utf8");
  const lacking = (await doctor(project)).get("homes");
  assert.equal(lacking.status, "WARN");
  assert.match(lacking.message, /claudeWork .* lacks omt, /);

  await project.runOk(["install", "--yes"], { env: { HOME: project.home, CLAUDE_CONFIG_DIR: work } });
  assert.equal((await doctor(project)).get("homes").status, "PASS");
  assert.equal(readFileSync(settingsPath, "utf8"), before);
});

test("doctor roles check runs only with --capabilities: PASS, WARN, FAIL", async (t) => {
  const project = makeProject(t);
  assert.equal((await doctor(project)).report.checks.some((c) => c.id === "roles"), false);
  assert.equal((await doctor(project, ["--capabilities", CAPS_FILE])).get("roles").status, "PASS");

  const grok = '[{ "driver": "grok", "model": "grok-build" }]';
  project.projectConfig(`{ "version": 1, "roles": { "oracle": { "chain": ${grok} } } }\n`);
  const warned = (await doctor(project, ["--capabilities", CAPS_FILE])).get("roles");
  assert.equal(warned.status, "WARN");
  assert.match(warned.message, /unavailable: oracle/);

  project.projectConfig(`{ "version": 1, "roles": { "execute": { "chain": ${grok} } } }\n`);
  const failed = await doctor(project, ["--capabilities", CAPS_FILE]);
  assert.equal(failed.get("roles").status, "FAIL");
  assert.equal(failed.code, 1);
});
