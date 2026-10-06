import { randomBytes } from "node:crypto";
import { rename, rm, rmdir, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { USER_STARTER_CONFIG } from "../config/starter.ts";
import { OmtError } from "../util/errors.ts";
import { copyDir, ensureDir, hashDir, pathExists, writeFileAtomic } from "../util/fs.ts";
import { writeHookChange } from "./claudeHook.ts";
import type { HookChange } from "./claudeHook.ts";
import { movePath, newBackupDir } from "./fsops.ts";
import { mergeManifest, writeManifest } from "./manifest.ts";
import type { Manifest } from "./manifest.ts";
import type { HookStep, InstallPlan, SkillStep, UninstallPlan } from "./plan.ts";
import { PACKAGE_NAME, writeMarker } from "./skills.ts";

export interface ApplyResult {
  changed: string[]; // paths written, created, or removed
  backups: string[];
}

function scratchPath(agentsRoot: string, kind: "tmp" | "old"): string {
  return join(dirname(agentsRoot), `.omt-${kind}-${randomBytes(6).toString("hex")}`);
}

// Lazily creates one backup directory per run, so a run without backups leaves no empty directory.
function backupDirFor(configDir: string, now: Date): () => Promise<string> {
  let dir: string | undefined;
  return async () => {
    dir ??= await newBackupDir(configDir, now);
    return dir;
  };
}

// Builds the new skill directory next to the agents root, then swaps it into place.
async function installSkill(step: SkillStep, plan: InstallPlan): Promise<void> {
  const temp = scratchPath(plan.agentsRoot, "tmp");
  let old: string | undefined;
  try {
    await copyDir(step.source, temp);
    const hash = await hashDir(temp);
    if (hash !== step.sourceHash) {
      throw new OmtError("skill_changed", `the bundled skill ${step.name} changed while installing`, {
        hint: "run the command again",
      });
    }
    await writeMarker(temp, { package: PACKAGE_NAME, version: plan.version, skill: step.name, hash });
    await ensureDir(plan.agentsRoot);
    if (await pathExists(step.path)) {
      old = scratchPath(plan.agentsRoot, "old");
      await rename(step.path, old);
    }
    await rename(temp, step.path);
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    if (old !== undefined && !(await pathExists(step.path))) await rename(old, step.path);
    throw error;
  }
  if (old !== undefined) await rm(old, { recursive: true, force: true });
}

async function writeHook(step: HookStep, backupDir: () => Promise<string>, result: ApplyResult): Promise<void> {
  const backup = await writeHookChange(step as HookChange, await backupDir());
  if (backup !== undefined) result.backups.push(backup);
  result.changed.push(step.settingsPath);
}

export async function applyInstall(plan: InstallPlan, now: Date): Promise<ApplyResult> {
  const result: ApplyResult = { changed: [], backups: [] };
  const backupDir = backupDirFor(plan.configDir, now);

  for (const step of [...plan.skills, ...plan.links]) {
    if (step.action === "conflict") {
      throw new OmtError("conflict", `cannot apply a plan with conflicts (${step.path})`, { hint: "use --force" });
    }
  }

  for (const step of plan.skills) {
    if (step.action === "replace") {
      const backup = join(await backupDir(), "agents", step.name);
      await movePath(step.path, backup);
      result.backups.push(backup);
    }
    if (step.action === "create" || step.action === "update" || step.action === "replace") {
      await installSkill(step, plan);
      result.changed.push(step.path);
    }
  }

  for (const link of plan.links) {
    if (link.action === "replace") {
      const backup = join(await backupDir(), link.root, link.name);
      await movePath(link.path, backup);
      result.backups.push(backup);
    }
    if (link.action === "create" || link.action === "replace") {
      await ensureDir(dirname(link.path));
      await symlink(link.target, link.path, "dir");
      result.changed.push(link.path);
    }
  }

  let configCreated = false;
  if (plan.config.action === "create" && !(await pathExists(plan.config.path))) {
    await writeFileAtomic(plan.config.path, USER_STARTER_CONFIG);
    configCreated = true;
    result.changed.push(plan.config.path);
  }

  if (plan.hook !== undefined && plan.hook.action !== "unchanged") await writeHook(plan.hook, backupDir, result);

  const manifest: Manifest = {
    package: PACKAGE_NAME,
    version: plan.version,
    installedAt: now.toISOString(),
    skillsRoot: plan.agentsRoot,
    skills: plan.skills.map((step) => step.name),
    links: plan.links.map((link) => ({ path: link.path, target: link.target })),
    config: { path: plan.config.path, created: configCreated },
    hooks:
      plan.hook === undefined
        ? []
        : [{ kind: "claude-user-prompt-submit", settingsPath: plan.hook.settingsPath, command: plan.hook.command }],
    backups: result.backups,
  };
  await writeManifest(plan.manifestPath, mergeManifest(plan.previous, manifest));
  return result;
}

export async function applyUninstall(plan: UninstallPlan, now: Date): Promise<ApplyResult> {
  const result: ApplyResult = { changed: [], backups: [] };
  const backupDir = backupDirFor(plan.configDir, now);

  for (const link of plan.links) {
    if (link.action !== "remove") continue;
    await rm(link.path, { force: true });
    result.changed.push(link.path);
  }
  for (const skill of plan.skills) {
    if (skill.action !== "remove") continue;
    if (skill.backup === true) {
      const backup = join(await backupDir(), "agents", skill.name);
      await movePath(skill.path, backup);
      result.backups.push(backup);
      result.changed.push(skill.path);
      continue;
    }
    // Move out first so a partial delete never leaves a half-removed skill that agents would load.
    const old = scratchPath(dirname(skill.path), "old");
    await rename(skill.path, old);
    await rm(old, { recursive: true, force: true });
    result.changed.push(skill.path);
  }
  for (const hook of plan.hooks) await writeHook(hook, backupDir, result);
  if (plan.config.action === "remove") {
    await rm(plan.config.path, { force: true });
    result.changed.push(plan.config.path);
  }
  if (plan.manifest.action === "remove") {
    await rm(plan.manifest.path, { force: true });
    result.changed.push(plan.manifest.path);
  }
  if (plan.purge) {
    try {
      await rmdir(plan.configDir);
      result.changed.push(plan.configDir);
    } catch {
      // The directory is missing or still holds user files, such as backups or roles.
    }
  }
  return result;
}
