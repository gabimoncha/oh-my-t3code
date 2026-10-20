import { dirname } from "node:path";
import { parseJsonc } from "../config/jsonc.ts";
import { findCheckoutRoot, findProjectRoot, mainCheckoutOf, pnpmWorkspacePath, t3ProjectFilePath, worktreeRunnerPath } from "../paths.ts";
import type { CliContext, WorktreeCheck, WorktreeLinker, WorktreeManager, WorktreeReport, WorktreeSetup, WorktreeStore } from "../types.ts";
import { errorMessage } from "../util/errors.ts";
import { lstatIfExists, readFileIfExists, realOrSelf } from "../util/fs.ts";
import { isRecord } from "../util/json.ts";
import { loadRunnerTemplate } from "./runner.ts";
import type { RunnerTemplate } from "./runner.ts";

export const MANAGED_COMMAND = "node .t3/omt-worktree-setup.mjs";
export const T3_SCHEMA_URL = "https://t3.codes/schema/t3.json";

export const GENERATED_T3_JSON = `${JSON.stringify(
  {
    $schema: T3_SCHEMA_URL,
    scripts: [{ name: "Setup", command: MANAGED_COMMAND, icon: "configure", runOnWorktreeCreate: true, async: false }],
  },
  null,
  2,
)}\n`;

export const MANAGED_SCRIPT_SNIPPET = JSON.stringify({
  name: "Setup",
  command: MANAGED_COMMAND,
  icon: "configure",
  runOnWorktreeCreate: true,
  async: false,
});

export const ACTIVATION_NOTE =
  "T3 runs a setup script only from the project's saved scripts. t3.json is not read at worktree creation. " +
  "Commit t3.json and .t3/ (and pnpm-workspace.yaml for pnpm) on the branch that new worktrees start from, then import Setup in T3 Project Settings. " +
  "omt does not read or change T3 settings, so activation is unverified here.";

// The t3.json schema of T3 Code (packages/contracts/src/t3ProjectFile.ts).
const ICONS = ["play", "test", "lint", "configure", "build", "debug"];
const MAX_SCRIPTS = 50;
const MAX_ICON_PATH = 512;

function nonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

export function validateT3File(value: unknown): string[] {
  if (!isRecord(value)) return ["the file is not a JSON object"];
  const issues: string[] = [];
  if (value.$schema !== undefined && typeof value.$schema !== "string") issues.push("$schema must be a string");
  if (value.iconPath !== undefined && (!nonEmpty(value.iconPath) || (value.iconPath as string).length > MAX_ICON_PATH)) {
    issues.push(`iconPath must be a non-empty string of at most ${MAX_ICON_PATH} characters`);
  }
  if (value.defaultThreadEnvMode !== undefined && !["local", "worktree"].includes(value.defaultThreadEnvMode as string)) {
    issues.push('defaultThreadEnvMode must be "local" or "worktree"');
  }
  if (value.worktreeSubmodules !== undefined && !["recursive", "top-level", "none"].includes(value.worktreeSubmodules as string)) {
    issues.push('worktreeSubmodules must be "recursive", "top-level", or "none"');
  }
  if (value.scripts === undefined) return issues;
  if (!Array.isArray(value.scripts)) return [...issues, "scripts must be an array"];
  if (value.scripts.length > MAX_SCRIPTS) issues.push(`scripts has ${value.scripts.length} entries; the limit is ${MAX_SCRIPTS}`);
  value.scripts.forEach((script: unknown, index: number) => {
    const at = `scripts[${index}]`;
    if (!isRecord(script)) {
      issues.push(`${at} must be an object`);
      return;
    }
    for (const key of ["name", "command"]) if (!nonEmpty(script[key])) issues.push(`${at}.${key} must be a non-empty string`);
    if (script.icon !== undefined && !ICONS.includes(script.icon as string)) issues.push(`${at}.icon must be one of ${ICONS.join(", ")}`);
    for (const key of ["runOnWorktreeCreate", "runOnSettle", "async", "autoOpenPreview"]) {
      if (script[key] !== undefined && typeof script[key] !== "boolean") issues.push(`${at}.${key} must be true or false`);
    }
    if (script.previewUrl !== undefined && !nonEmpty(script.previewUrl)) issues.push(`${at}.previewUrl must be a non-empty string`);
  });
  return issues;
}

// Node resolves symlinks in a script path, so a linked .t3 folder or runner would make the runner
// work on another folder. Such a runner is "linked", never "current". The parent is inspected first,
// because a .t3 that is a file makes the runner's lstat fail with ENOTDIR.
async function runnerState(path: string, template: string): Promise<NonNullable<WorktreeSetup["runner"]>> {
  const parent = await lstatIfExists(dirname(path));
  if (parent?.isSymbolicLink() === true) return "linked";
  if (parent !== undefined && !parent.isDirectory()) return "occupied";
  const stat = await lstatIfExists(path);
  if (stat === undefined) return "missing";
  if (stat.isSymbolicLink()) return "linked";
  let text: string | undefined;
  try {
    text = await readFileIfExists(path);
  } catch {
    return "different";
  }
  return text === template ? "current" : "different";
}

async function inspectSetup(t3File: string, runnerFile: string, template: string, needed: boolean): Promise<WorktreeSetup> {
  const exists = (await lstatIfExists(t3File)) !== undefined;
  let text: string | undefined;
  try {
    text = await readFileIfExists(t3File);
  } catch (error) {
    return { status: "invalid", message: `cannot read ${t3File}`, issues: [errorMessage(error)] };
  }
  if (text === undefined) {
    if (exists) return { status: "invalid", message: `${t3File} is a link to a missing file`, issues: ["dangling symlink"] };
    const runner = await runnerState(runnerFile, template);
    return needed
      ? {
        status: "missing",
        message: `${t3File} does not exist, so the repository has no worktree setup script; a saved or inherited T3 setup can still exist, and activation is unverified`,
        runner,
      }
      : { status: "not-needed", message: "no package manager in the checkout; no worktree setup is needed", runner };
  }
  let parsed: unknown;
  try {
    parsed = parseJsonc(text, t3File);
  } catch (error) {
    return { status: "invalid", message: `${t3File} is not valid JSONC`, issues: [errorMessage(error)] };
  }
  const issues = validateT3File(parsed);
  if (issues.length > 0) return { status: "invalid", message: `${t3File} does not match the T3 project file schema`, issues };
  const scripts = isRecord(parsed) && Array.isArray(parsed.scripts) ? (parsed.scripts as Record<string, unknown>[]) : [];
  const setup = scripts.find((script) => script.runOnWorktreeCreate === true);
  if (setup === undefined) {
    return { status: "no-setup", message: `${t3File} has no script with "runOnWorktreeCreate": true` };
  }
  const command = (setup.command as string).trim();
  const async = typeof setup.async === "boolean" ? setup.async : undefined;
  const wait = async === false ? "T3 waits for it before the agent starts" : 'T3 starts the agent while it runs; set "async": false to wait for it';
  if (command === MANAGED_COMMAND) {
    const runner = await runnerState(runnerFile, template);
    return { status: "managed", message: `the setup script "${setup.name as string}" runs ${MANAGED_COMMAND}; ${wait}`, command, async, runner };
  }
  return {
    status: "custom",
    message: `the setup script "${setup.name as string}" runs "${command}"; ${wait}. omt keeps it and cannot verify that it installs dependencies or uses a global store`,
    command,
    async,
  };
}

function managerCheck(manager: WorktreeManager): WorktreeCheck {
  if (manager.status === "none") return { id: "manager", status: "INFO", message: manager.message ?? "no package manager" };
  if (manager.status === "blocked") {
    return { id: "manager", status: "WARN", message: `${manager.message ?? "unsupported"}${manager.action === undefined ? "" : `; ${manager.action}`}` };
  }
  const pinned = manager.version === undefined ? "no pinned version" : `${manager.declaredBy ?? "package.json"} pins ${manager.version}`;
  return { id: "manager", status: "PASS", message: `${manager.manager ?? ""} with ${manager.lockfile ?? ""} (${pinned})` };
}

function linkerCheck(linker: WorktreeLinker): WorktreeCheck {
  if (linker.status === "incompatible" || linker.status === "unverified") {
    return { id: "linker", status: "WARN", message: `${linker.message}${linker.action === undefined ? "" : `; ${linker.action}`}` };
  }
  return { id: "linker", status: "PASS", message: linker.message };
}

function storeCheck(store: WorktreeStore, setup: WorktreeSetup): WorktreeCheck {
  if (store.status === "set") return { id: "store", status: "PASS", message: store.message };
  const message = `${store.message}${store.action === undefined ? "" : `; ${store.action}`}`;
  // omt does not judge a custom setup's store; the line is only information.
  return { id: "store", status: setup.status === "custom" ? "INFO" : "WARN", message };
}

const LINKED_RUNNER = "replace the symlinked .t3 folder or runner with a real folder, then run omt worktree setup";

function occupiedRunner(runnerFile: string): string {
  return `move ${dirname(runnerFile)} away (omt needs a folder there), then run omt worktree setup`;
}

function occupiedMessage(runnerFile: string): string {
  return `${dirname(runnerFile)} exists and is not a folder, so ${runnerFile} cannot be written`;
}

function setupCheck(setup: WorktreeSetup, report: { manager: WorktreeManager; runnerFile: string }): WorktreeCheck {
  const id = "setup";
  switch (setup.status) {
    case "not-needed":
      return { id, status: "INFO", message: setup.message };
    case "missing":
      if (setup.runner === "occupied") return { id, status: "WARN", message: `${setup.message}; ${occupiedMessage(report.runnerFile)}` };
      return { id, status: "WARN", message: setup.message };
    case "no-setup":
      return { id, status: "WARN", message: setup.message };
    case "invalid":
      return { id, status: "WARN", message: `${setup.message}: ${(setup.issues ?? []).join("; ")}` };
    case "custom":
      return { id, status: setup.async === false ? "INFO" : "WARN", message: setup.message };
    case "managed": {
      if (setup.runner === "missing") return { id, status: "WARN", message: `${setup.message}, but ${report.runnerFile} is missing` };
      if (setup.runner === "occupied") return { id, status: "WARN", message: `${setup.message}, but ${occupiedMessage(report.runnerFile)}` };
      if (setup.runner === "linked") {
        return { id, status: "WARN", message: `${setup.message}, but ${report.runnerFile} or its folder is a symlink, so the runner would work on another folder` };
      }
      if (setup.runner === "different") {
        return { id, status: "WARN", message: `${setup.message}, but ${report.runnerFile} differs from the bundled runner (outdated or edited); omt keeps it` };
      }
      if (report.manager.status === "blocked") return { id, status: "WARN", message: `${setup.message}, but the runner will stop: ${report.manager.message ?? ""}` };
      return { id, status: setup.async === false ? "PASS" : "WARN", message: setup.message };
    }
  }
}

// The manual step for a pnpm store setting that omt worktree setup cannot write.
function storeAction(report: Omit<WorktreeReport, "next" | "checks" | "summary">): string | undefined {
  const store = report.store;
  if (store === undefined || store.status === "set" || store.status === "no-file") return undefined;
  return store.action;
}

function nextAction(report: Omit<WorktreeReport, "next" | "checks" | "summary">): string | undefined {
  const { setup } = report;
  const manual = storeAction(report);
  switch (setup.status) {
    case "not-needed":
      return undefined;
    case "missing":
      if (!report.canGenerate) return report.blockers.join("; ");
      if (setup.runner === "linked") return LINKED_RUNNER;
      if (setup.runner === "occupied") return occupiedRunner(report.runnerFile);
      return `run omt worktree setup --dry-run, then omt worktree setup${manual === undefined ? "" : `; also ${manual}`}`;
    case "invalid":
      return `fix ${report.t3File}; omt never rewrites it`;
    case "no-setup":
      return `add this script to "scripts" in ${report.t3File}, then run omt worktree setup to write the runner: ${MANAGED_SCRIPT_SNIPPET}`;
    case "custom":
      return setup.async === false
        ? "check that the custom setup installs the dependencies, and that a second worktree reuses the store"
        : `set "async": false on the setup script in ${report.t3File}`;
    case "managed":
      if (setup.runner === "linked") return LINKED_RUNNER;
      if (setup.runner === "occupied") return occupiedRunner(report.runnerFile);
      if (setup.runner === "missing") {
        if (!report.canGenerate) return report.blockers.join("; ");
        return `run omt worktree setup to write the runner${manual === undefined ? "" : `; also ${manual}`}`;
      }
      if (setup.runner === "different") return `compare ${report.runnerFile} with the bundled runner and update it by hand, or delete it and run omt worktree setup`;
      if (report.blockers.length > 0) return report.blockers.join("; ");
      if (report.store?.status === "no-file") return "run omt worktree setup to create pnpm-workspace.yaml";
      if (manual !== undefined) return manual;
      if (setup.async !== false) return `set "async": false on the setup script in ${report.t3File}`;
      return `commit t3.json, .t3/${report.store === undefined ? "" : ", and pnpm-workspace.yaml"} on the base branch of new worktrees, then import Setup in T3 Project Settings`;
  }
}

function worst(checks: WorktreeCheck[]): WorktreeCheck["status"] {
  for (const status of ["FAIL", "WARN", "PASS"] as const) if (checks.some((c) => c.status === status)) return status;
  return "INFO";
}

// Reads the checkout of ctx.cwd: package manager, lockfile, linker settings, t3.json, and the runner.
// It starts no process and writes nothing.
export async function inspectWorktree(ctx: CliContext, template?: RunnerTemplate): Promise<WorktreeReport> {
  const runner = template ?? (await loadRunnerTemplate(ctx.packageRoot));
  const checkoutRoot = findCheckoutRoot(ctx.cwd);
  const root = checkoutRoot ?? findProjectRoot(ctx.cwd);
  const main = checkoutRoot === undefined ? undefined : mainCheckoutOf(checkoutRoot);
  const t3File = t3ProjectFilePath(root);
  const runnerFile = worktreeRunnerPath(root);
  const manager = runner.module.detectManager(root);
  const linker = manager.status === "ok" && manager.manager !== undefined
    ? runner.module.checkLinker(root, manager.manager, { env: ctx.env, home: ctx.homedir })
    : undefined;
  const setup = await inspectSetup(t3File, runnerFile, runner.text, manager.status !== "none");
  const store = manager.status === "ok" && manager.manager === "pnpm" ? runner.module.persistentGlobalStore(root, manager.version) : undefined;

  const blockers: string[] = [];
  if (checkoutRoot === undefined) blockers.push("no .git found; worktree setup needs a git checkout");
  // Real paths, so a symlinked alias of the home directory is still the home directory.
  if (realOrSelf(root) === realOrSelf(ctx.homedir)) blockers.push("the checkout is the home directory");
  if (manager.status !== "ok") blockers.push(`${manager.message ?? "no package manager"}${manager.action === undefined ? "" : `; ${manager.action}`}`);
  if (linker !== undefined && (linker.status === "incompatible" || linker.status === "unverified")) {
    blockers.push(`${linker.message}${linker.action === undefined ? "" : `; ${linker.action}`}`);
  }
  const base = {
    root,
    checkout: checkoutRoot !== undefined,
    ...(main === undefined ? {} : { mainCheckout: main }),
    t3File,
    runnerFile,
    manager,
    ...(linker === undefined ? {} : { linker }),
    workspaceFile: pnpmWorkspacePath(root),
    ...(store === undefined ? {} : { store }),
    setup,
    complete: setup.status === "managed" && setup.runner === "current" && (store === undefined || store.status === "set"),
    canGenerate: blockers.length === 0,
    blockers,
    activation: ACTIVATION_NOTE,
  };
  const next = nextAction(base);
  const checks: WorktreeCheck[] = [
    {
      id: "checkout",
      status: checkoutRoot === undefined ? "INFO" : "PASS",
      message:
        checkoutRoot === undefined
          ? `${root} (no .git; setup files need a git checkout)`
          : main === undefined
            ? `${root} (main checkout)`
            : `${root} (linked worktree of ${main}; setup files stay in this checkout)`,
    },
    managerCheck(manager),
    ...(linker === undefined ? [] : [linkerCheck(linker)]),
    ...(store === undefined ? [] : [storeCheck(store, setup)]),
    setupCheck(setup, { manager, runnerFile }),
    { id: "activation", status: "INFO", message: ACTIVATION_NOTE },
  ];
  const relevant = setup.status === "not-needed" ? [] : checks.filter((c) => c.id !== "activation" && c.id !== "checkout");
  const status = setup.status === "not-needed" ? "INFO" : setup.status === "custom" && worst(relevant) === "PASS" ? "INFO" : worst(relevant);
  const setupLine = checks.find((c) => c.id === "setup")?.message ?? setup.message;
  // The store problem goes into the summary line, so a good setup line cannot hide it.
  const storeLine = store !== undefined && store.status !== "set" && setup.status !== "custom" && setup.status !== "not-needed" ? `; ${store.message}` : "";
  const summary: WorktreeCheck = {
    id: "worktree",
    status,
    message: `${root}: ${setupLine}${storeLine}${status === "PASS" ? `; ${manager.manager ?? ""} global virtual store; activation in T3 is unverified` : ""}${next === undefined || status === "PASS" ? "" : `; next: ${next}`}`,
  };
  return { ...base, ...(next === undefined ? {} : { next }), checks, summary };
}

// The summary line for init, install --project, and doctor --project. A read error becomes a WARN.
export async function worktreeSummary(ctx: CliContext): Promise<WorktreeCheck> {
  try {
    return (await inspectWorktree(ctx)).summary;
  } catch (error) {
    return { id: "worktree", status: "WARN", message: `cannot check the worktree setup: ${errorMessage(error)}` };
  }
}
