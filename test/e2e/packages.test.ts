import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import { gitRepo } from "../helpers.ts";
import { releaseRegistry, run, tools } from "./registry.ts";

test("npm, pnpm, and bun install the release as a dev dependency and run install and doctor", async () => {
  const tool = tools();
  const registry = await releaseRegistry("packages-", tool);
  for (const manager of ["npm", "pnpm", "bun"] as const) {
    const env = registry.env(manager, manager === "bun" ? tool.bunPath : tool.nodePath);
    const project = join(registry.root, manager);
    gitRepo(env.HOME!, project, { "package.json": JSON.stringify({ name: `test-${manager}`, private: true }) });
    const pkg = `oh-my-t3code@${registry.version}`;
    const args = manager === "npm"
      ? ["install", "--save-dev", "--no-audit", "--no-fund", "--prefer-offline", pkg]
      : manager === "pnpm"
        ? ["add", "--save-dev", "--config.minimum-release-age=0", "--registry", registry.registry, pkg]
        : ["add", "--dev", "--registry", registry.registry, pkg];
    await run(tool[manager], args, project, env);
    const manifest = JSON.parse(readFileSync(join(project, "package.json"), "utf8")) as { devDependencies?: Record<string, string> };
    assert.ok(manifest.devDependencies?.["oh-my-t3code"], `${manager} must save a dev dependency`);
    const runner = manager === "npm" ? tool.npx : tool[manager];
    const runnerArgs = manager === "npm"
      ? ["--no-install", "omt"]
      : manager === "pnpm"
        ? ["--registry", registry.registry, "--config.minimum-release-age=0", "exec", "omt"]
        : ["x", "--no-install", "omt"];
    const version = await run(runner, [...runnerArgs, "--version"], project, env);
    assert.equal(version.trim(), registry.version, `${manager} must run the package version`);
    const install = await run(runner, [...runnerArgs, "install", "--project", "--yes"], project, env);
    assert.doesNotMatch(install, /^FAIL\b/m);
    const doctor = await run(join(project, ".omt", "bin", "omt"), ["doctor", "--project"], project, env);
    assert.doesNotMatch(doctor, /^FAIL\b/m);
  }
}, 240_000);
