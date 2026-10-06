import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { main } from "../../src/main.ts";
import { fakeContext, tempDir } from "../helpers.ts";
import type { FakeContext, FakeContextOptions } from "../helpers.ts";

export const STAMP = "20260102030405";

export interface Fixture {
  root: string;
  home: string;
  packageRoot: string;
  agents: string;
  claudeSkills: string;
  gemini: string;
  configDir: string;
  settings: string;
  manifest: string;
  backups: string;
  ctx: (options?: FakeContextOptions) => FakeContext;
  run: (argv: string[], options?: FakeContextOptions) => Promise<{ code: number; ctx: FakeContext }>;
}

export function writeSkill(packageRoot: string, name: string, files: Record<string, string>): void {
  for (const [file, content] of Object.entries(files)) {
    const path = join(packageRoot, "skills", name, file);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }
}

export function makeFixture(t: TestContext): Fixture {
  const root = tempDir(t, "omt-install-");
  const packageRoot = join(root, "package");
  writeSkill(packageRoot, "alpha", { "SKILL.md": "---\nname: alpha\n---\nAlpha.\n" });
  writeSkill(packageRoot, "beta", {
    "SKILL.md": "---\nname: beta\n---\nBeta.\n",
    "references/notes.md": "Beta notes.\n",
  });
  writeSkill(packageRoot, "not-a-skill", { "README.md": "No SKILL.md here.\n" });
  const home = join(root, "home");
  mkdirSync(join(root, "project"), { recursive: true });
  mkdirSync(home, { recursive: true });
  const configDir = join(home, ".config", "oh-my-t3code");
  const ctx = (options: FakeContextOptions = {}) => fakeContext({ root, packageRoot, ...options });
  return {
    root,
    home,
    packageRoot,
    agents: join(home, ".agents", "skills"),
    claudeSkills: join(home, ".claude", "skills"),
    gemini: join(home, ".gemini", "config", "skills"),
    configDir,
    settings: join(home, ".claude", "settings.json"),
    manifest: join(configDir, "install.json"),
    backups: join(configDir, "backups"),
    ctx,
    run: async (argv, options = {}) => {
      const c = ctx(options);
      const code = await main(argv, c);
      return { code, ctx: c };
    },
  };
}

// A map of every path under `dir` to its type and content, used to prove that nothing was written.
export function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (path: string, rel: string) => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      out[rel] = `link:${readlinkSync(path)}`;
    } else if (stat.isDirectory()) {
      out[rel] = "dir";
      for (const name of readdirSync(path)) walk(join(path, name), rel === "" ? name : `${rel}/${name}`);
    } else {
      out[rel] = `file:${createHash("sha256").update(readFileSync(path)).digest("hex")}:${stat.mtimeMs}`;
    }
  };
  walk(dir, "");
  return out;
}

export function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}
