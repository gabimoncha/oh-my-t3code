import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { WorktreeReport } from "../types.ts";
import { OmtError } from "../util/errors.ts";
import { lstatIfExists, writeFileAtomic } from "../util/fs.ts";
import { GENERATED_T3_JSON, MANAGED_SCRIPT_SNIPPET } from "./check.ts";

export type SetupAction = "create" | "unchanged" | "keep";

export interface SetupStep {
  path: string;
  action: SetupAction;
  content?: string; // set for "create"
  reason?: string;
}

export interface SetupPlan {
  root: string;
  steps: SetupStep[];
  incomplete?: string; // a manual change that the setup still needs after the plan
}

// Each folder between the checkout root and a new file must be a real folder or absent. A symlink,
// also a dangling one or one that stays inside the checkout, is refused: the write could follow it,
// and Node would run a linked runner from another folder.
async function assertPlainParents(root: string, path: string): Promise<void> {
  const rel = relative(root, dirname(path));
  if (rel.startsWith("..") || isAbsolute(rel)) throw refuse(`${path} is outside the checkout ${root}`);
  let dir = root;
  for (const part of rel === "" ? [] : rel.split(sep)) {
    dir = join(dir, part);
    const stat = await lstatIfExists(dir);
    if (stat === undefined) return;
    if (stat.isSymbolicLink()) {
      throw refuse(`${dir} is a symlink; omt writes no setup file through a symlinked folder`, "replace the symlink with a real folder, or write the setup files by hand");
    }
    if (!stat.isDirectory()) throw refuse(`${dir} exists and is not a folder`, "move it away, or write the setup files by hand");
  }
}

function refuse(message: string, hint?: string): OmtError {
  return new OmtError("worktree_setup", message, hint === undefined ? undefined : { hint });
}

// Decides what `omt worktree setup` writes. It never rewrites an existing file.
export async function planSetup(report: WorktreeReport, runnerText: string, workspaceText: string): Promise<SetupPlan> {
  const { setup, store } = report;
  if (!report.checkout) throw refuse(`no .git found at or above ${report.root}; worktree setup needs a git checkout`);
  if (report.blockers.some((b) => b.startsWith("the checkout is the home directory"))) {
    throw new OmtError("usage", `${report.root} is the home directory; run omt worktree setup in a project checkout`, { exitCode: 2 });
  }
  if (setup.status === "invalid") throw refuse(`${setup.message}: ${(setup.issues ?? []).join("; ")}`, `fix ${report.t3File}; omt never rewrites it`);
  if (setup.status === "no-setup") {
    throw refuse(setup.message, `add this script to "scripts" in ${report.t3File}, then run omt worktree setup again: ${MANAGED_SCRIPT_SNIPPET}`);
  }
  if (setup.status === "custom") {
    return { root: report.root, steps: [{ path: report.t3File, action: "keep", reason: `custom setup script "${setup.command ?? ""}"` }] };
  }
  if (setup.runner === "linked") {
    throw refuse(
      `${report.runnerFile} or its folder is a symlink; Node would run the runner from the link target and install in another folder`,
      "replace the symlinked .t3 folder or runner with a real folder, then run omt worktree setup again",
    );
  }
  if (setup.runner === "occupied") {
    throw refuse(`${dirname(report.runnerFile)} exists and is not a folder; omt cannot write ${report.runnerFile}`, "move it away, then run omt worktree setup again, or write the setup files by hand");
  }
  if (setup.runner === "different") {
    throw refuse(
      `${report.runnerFile} exists and differs from the bundled runner (outdated or edited)`,
      `compare it with the bundled runner and update it by hand, or delete it and run omt worktree setup again`,
    );
  }
  const steps: SetupStep[] = [];
  if (setup.status === "managed") steps.push({ path: report.t3File, action: "keep", reason: "it already runs the omt setup runner" });
  else steps.push({ path: report.t3File, action: "create", content: GENERATED_T3_JSON });
  steps.push(
    setup.runner === "current"
      ? { path: report.runnerFile, action: "unchanged" }
      : { path: report.runnerFile, action: "create", content: runnerText },
  );
  let incomplete: string | undefined;
  if (store !== undefined) {
    if (store.status === "no-file") {
      steps.push({ path: report.workspaceFile, action: "create", content: workspaceText, reason: "keeps the global virtual store after pnpm run and pnpm exec" });
    } else if (store.status === "set") {
      steps.push({ path: report.workspaceFile, action: "unchanged" });
    } else {
      steps.push({ path: report.workspaceFile, action: "keep", reason: "omt never changes an existing file" });
      incomplete = `${store.message}; ${store.action ?? ""}`;
    }
  }
  if (steps.some((step) => step.action === "create") && !report.canGenerate) {
    throw refuse(`cannot generate the worktree setup: ${report.blockers.join("; ")}`, "fix the problem, or write the setup files by hand");
  }
  await preflight(report.root, steps);
  return { root: report.root, steps, ...(incomplete === undefined ? {} : { incomplete }) };
}

// Checks every new file's path before any write, so a refusal leaves all files unchanged.
async function preflight(root: string, steps: SetupStep[]): Promise<void> {
  for (const step of steps) {
    if (step.action !== "create") continue;
    await assertPlainParents(root, step.path);
    if ((await lstatIfExists(step.path)) !== undefined) throw refuse(`${step.path} appeared during the setup; nothing was written`);
  }
}

export function renderSetupPlan(plan: SetupPlan): string {
  let text = `Worktree setup (${plan.root}):\n`;
  for (const step of plan.steps) {
    text += `  ${step.action.padEnd(10)}${step.path}${step.reason === undefined ? "" : `  (${step.reason})`}\n`;
  }
  return text;
}

export function setupHasChanges(plan: SetupPlan): boolean {
  return plan.steps.some((step) => step.action === "create");
}

// Checks all paths again, because a folder can become a symlink after the plan, then writes each new file.
export async function applySetup(plan: SetupPlan): Promise<string[]> {
  await preflight(plan.root, plan.steps);
  const created: string[] = [];
  for (const step of plan.steps) {
    if (step.action !== "create" || step.content === undefined) continue;
    await assertPlainParents(plan.root, step.path);
    if ((await lstatIfExists(step.path)) !== undefined) throw refuse(`${step.path} appeared during the setup; nothing more was written`);
    await writeFileAtomic(step.path, step.content);
    created.push(step.path);
  }
  return created;
}
