import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { main } from "../../src/main.ts";
import { PACKAGE_ROOT, fakeContext, tempDir } from "../helpers.ts";
import type { FakeContext, FakeContextOptions } from "../helpers.ts";

export const CAPS_FILE = join(PACKAGE_ROOT, "test", "fixtures", "capabilities.json");

export interface Project {
  root: string;
  home: string;
  cwd: string;
  run: (argv: string[], options?: FakeContextOptions) => Promise<{ code: number; ctx: FakeContext }>;
  projectConfig: (text: string) => void;
}

// A temp home and a temp git project; `run` calls main() with a fake context rooted there.
export function makeProject(t: TestContext): Project {
  const root = tempDir(t, "omt-cmd-");
  const home = join(root, "home");
  const cwd = join(root, "project");
  mkdirSync(join(cwd, ".git"), { recursive: true });
  mkdirSync(home, { recursive: true });
  return {
    root,
    home,
    cwd,
    run: async (argv, options = {}) => {
      const ctx = fakeContext({ root, ...options });
      const code = await main(argv, ctx);
      return { code, ctx };
    },
    projectConfig: (text) => {
      mkdirSync(join(cwd, ".omt"), { recursive: true });
      writeFileSync(join(cwd, ".omt", "config.jsonc"), text);
    },
  };
}
