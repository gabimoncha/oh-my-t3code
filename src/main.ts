import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import * as brief from "./commands/brief.ts";
import * as config from "./commands/config.ts";
import * as doctor from "./commands/doctor.ts";
import * as hook from "./commands/hook.ts";
import * as init from "./commands/init.ts";
import * as install from "./commands/install.ts";
import * as ledger from "./commands/ledger.ts";
import * as lock from "./commands/lock.ts";
import * as paths from "./commands/paths.ts";
import * as plan from "./commands/plan.ts";
import * as profile from "./commands/profile.ts";
import * as roles from "./commands/roles.ts";
import * as route from "./commands/route.ts";
import * as uninstall from "./commands/uninstall.ts";
import * as visual from "./commands/visual.ts";
import * as worktree from "./commands/worktree.ts";
import type { CliContext, CommandRun } from "./types.ts";
import { findProjectRoot, hasProjectMarker, omtDir, shadowedWorktreeState } from "./paths.ts";
import { errorMessage, OmtError } from "./util/errors.ts";

export interface CommandModule {
  summary: string;
  usage: string;
  run: CommandRun;
}

export const COMMANDS: Readonly<Record<string, CommandModule>> = {
  install,
  uninstall,
  doctor,
  init,
  config,
  roles,
  route,
  brief,
  plan,
  profile,
  ledger,
  lock,
  visual,
  worktree,
  paths,
  hook,
};

const STATE_COMMANDS = new Set(["plan", "ledger", "brief", "route", "init", "visual"]);
// Run from a folder outside any project, these commands would write plans, ledger entries, or evidence paths there.
const PROJECT_COMMANDS = new Set(["plan", "profile", "ledger", "brief", "visual", "lock"]);

const HERE = fileURLToPath(import.meta.url);

export function readPackageVersion(packageRoot: string): string {
  const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { version?: unknown };
  return typeof pkg.version === "string" ? pkg.version : "0.0.0";
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    let answered = false;
    rl.on("close", () => {
      if (!answered) resolve("");
    });
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(answer);
    });
  });
}

// process.cwd() is always the real path. $PWD keeps the path as the user typed it, such as /var
// instead of /private/var, so printed paths match the paths built from $HOME. findProjectRoot walks
// up by name, so $PWD is kept only when its walk finds the same real root as the physical walk.
export function logicalCwd(env: Record<string, string | undefined>, physical: string): string {
  const pwd = env.PWD;
  if (pwd === undefined || !isAbsolute(pwd)) return physical;
  try {
    if (realpathSync(pwd) !== physical) return physical;
    return realpathSync(findProjectRoot(pwd)) === realpathSync(findProjectRoot(physical)) ? pwd : physical;
  } catch {
    return physical;
  }
}

export function createContext(overrides: Partial<CliContext> = {}): CliContext {
  const packageRoot = overrides.packageRoot ?? dirname(dirname(HERE));
  return {
    argv: [],
    cwd: logicalCwd(process.env, process.cwd()),
    env: process.env,
    homedir: homedir(),
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
    readStdin: readAllStdin,
    isTTY: process.stdin.isTTY === true,
    prompt: promptLine,
    now: () => new Date(),
    packageRoot,
    cliPath: join(dirname(HERE), `cli${extname(HERE)}`),
    nodePath: process.execPath,
    nodeVersion: process.versions.node,
    version: overrides.version ?? readPackageVersion(packageRoot),
    ...overrides,
  };
}

export function mainUsage(): string {
  const names = Object.keys(COMMANDS);
  const width = Math.max(...names.map((name) => name.length));
  const lines = names.map((name) => `  ${name.padEnd(width)}  ${COMMANDS[name]?.summary ?? ""}`);
  return [
    "Usage: omt <command> [options]",
    "",
    "Commands:",
    ...lines,
    "",
    "Options:",
    "  -h, --help     print this help, or a command's help after the command",
    "  -v, --version  print the version",
    "",
  ].join("\n");
}

function wantsHelp(args: string[]): boolean {
  for (const arg of args) {
    if (arg === "--") return false;
    if (arg === "--help" || arg === "-h") return true;
  }
  return false;
}

function reportError(ctx: CliContext, error: unknown): number {
  if (error instanceof OmtError) {
    ctx.stderr(`omt: ${error.message}\n`);
    if (error.hint !== undefined) ctx.stderr(`hint: ${error.hint}\n`);
    return error.exitCode;
  }
  ctx.stderr(`omt: unexpected error: ${errorMessage(error)}\n`);
  return 1;
}

function warnShadowedState(ctx: CliContext): void {
  const shadowed = shadowedWorktreeState(ctx.cwd);
  if (shadowed === undefined) return;
  ctx.stderr(
    `warning: ${omtDir(shadowed.worktree)} holds plans or a ledger that omt no longer reads; move them to ${omtDir(shadowed.main)}\n`,
  );
  ctx.stderr(`hint: if git tracks them, untrack them with "git rm --cached" and commit; .omt/.gitignore keeps plans out of git\n`);
}

export async function main(argv: string[], overrides: Partial<CliContext> = {}): Promise<number> {
  const ctx = createContext(overrides);
  try {
    const [first, ...rest] = argv;
    if (first === undefined || first === "--help" || first === "-h") {
      ctx.stdout(mainUsage());
      return 0;
    }
    if (first === "--version" || first === "-v") {
      ctx.stdout(`${ctx.version}\n`);
      return 0;
    }
    const command = Object.hasOwn(COMMANDS, first) ? COMMANDS[first] : undefined;
    if (command === undefined) {
      const what = first.startsWith("-") ? `unknown option "${first}"` : `unknown command "${first}"`;
      throw new OmtError("usage", what, { exitCode: 2, hint: `run "omt --help" to see the commands` });
    }
    if (wantsHelp(rest)) {
      ctx.stdout(command.usage);
      return 0;
    }
    if (STATE_COMMANDS.has(first)) warnShadowedState(ctx);
    if (PROJECT_COMMANDS.has(first) && !hasProjectMarker(ctx.cwd)) {
      ctx.stderr(`warning: no .omt or .git found above ${ctx.cwd}; omt uses it as the project root. Run omt from the project or worktree folder.\n`);
    }
    return await command.run({ ...ctx, argv: rest });
  } catch (error) {
    return reportError(ctx, error);
  }
}
