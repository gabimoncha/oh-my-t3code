import { accessSync, constants, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestContext } from "node:test";
import type { CliContext } from "../src/types.ts";

export const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const CLI_PATH = join(PACKAGE_ROOT, "src", "cli.ts");

// The absolute path of a tool on the real PATH, skipping version-manager shims, which can loop
// when HOME is a temp directory. Tests that set a temp HOME call tools by this path.
export function findTool(name: string, fallback: string): string {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir === "" || /[/\\]shims$/.test(dir)) continue;
    const path = join(dir, name);
    try {
      if (!statSync(path).isFile()) continue;
      accessSync(path, constants.X_OK);
      return path;
    } catch {
      // Not in this directory.
    }
  }
  return fallback;
}

export const GIT = findTool("git", "/usr/bin/git");

export function makeTempDir(prefix = "omt-test-"): { path: string; remove: () => void } {
  const path = mkdtempSync(join(tmpdir(), prefix));
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}

// Creates a temp directory that the test runner removes after the test, even when it fails.
export function tempDir(t: TestContext, prefix?: string): string {
  const dir = makeTempDir(prefix);
  t.after(dir.remove);
  return dir.path;
}

// A child-process environment where every variable that affects omt paths points into `root`.
export function childEnv(root: string): NodeJS.ProcessEnv {
  const home = join(root, "home");
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    OMT_CONFIG_DIR: join(home, ".config", "oh-my-t3code"),
    XDG_CONFIG_HOME: join(home, ".config"),
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    T3CODE_HOME: join(home, ".t3"),
  };
}

export interface FakeContext extends CliContext {
  out: () => string;
  err: () => string;
  prompts: string[];
}

export interface FakeContextOptions extends Partial<CliContext> {
  root?: string; // temp directory to hold home/ and project/; required unless homedir and cwd are given
  answer?: string; // what prompt() returns
  stdin?: string; // what readStdin() returns
}

export function fakeContext(overrides: FakeContextOptions = {}): FakeContext {
  const { root, answer = "", stdin = "", ...rest } = overrides;
  if (root === undefined && (rest.homedir === undefined || rest.cwd === undefined)) {
    throw new Error("fakeContext needs root, or both homedir and cwd, so that it never uses the real home directory");
  }
  const home = rest.homedir ?? join(root as string, "home");
  const cwd = rest.cwd ?? join(root as string, "project");
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  let stdout = "";
  let stderr = "";
  const prompts: string[] = [];
  const ctx: CliContext = {
    argv: [],
    cwd,
    env: { HOME: home },
    homedir: home,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    readStdin: async () => stdin,
    isTTY: false,
    prompt: async (question) => {
      prompts.push(question);
      return answer;
    },
    now: () => new Date("2026-01-02T03:04:05.000Z"),
    packageRoot: PACKAGE_ROOT,
    cliPath: CLI_PATH,
    nodePath: process.execPath,
    nodeVersion: process.versions.node,
    version: "0.1.0",
    ...rest,
  };
  return { ...ctx, out: () => stdout, err: () => stderr, prompts };
}
