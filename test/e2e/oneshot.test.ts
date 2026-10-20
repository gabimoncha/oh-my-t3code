import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import { gitRepo } from "../helpers.ts";
import { releaseRegistry, run, tools } from "./registry.ts";

test("npx omt3 installs a pinned runner shim that runs roles", async () => {
  const tool = tools();
  const registry = await releaseRegistry("oneshot-", tool);
  const env = registry.env("npx", tool.nodePath);
  const project = join(registry.root, "project");
  gitRepo(env.HOME!, project);
  await run(tool.npx, ["--yes", `omt3@${registry.version}`, "install", "--project", "--yes"], project, env);
  const shim = join(project, ".omt", "bin", "omt");
  assert.ok(readFileSync(shim, "utf8").split("\n").includes(`exec npx --yes omt3@${registry.version} "$@"`), "the shim must call npx with the release version");
  const roles = await run(shim, ["roles"], project, env);
  assert.match(roles, /^ROLE\s+STATUS\s+TARGET\s+ACCESS\s+MODE\s+CROSS$/m);
}, 240_000);
