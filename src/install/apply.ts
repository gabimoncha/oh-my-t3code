import { randomBytes } from "node:crypto";
import { chmod, readdir, rename, rm, rmdir, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { starterConfig } from "../config/starter.ts";
import { errorMessage, OmtError } from "../util/errors.ts";
import { copyDir, ensureDir, hashDir, pathExists, readFileIfExists, writeFileAtomic } from "../util/fs.ts";
import { isOmtLayout, writeHookChange } from "./claudeHook.ts";
import type { HookChange } from "./claudeHook.ts";
import { movePath, newBackupDir, writeTargetFor } from "./fsops.ts";
import { mergeManifest, writeManifest } from "./manifest.ts";
import type { Manifest, ManifestFile, ManifestHook } from "./manifest.ts";
import { replaceableSteps, sha256 } from "./plan.ts";
import type { FileStep, HookStep, InstallPlan, SkillStep, UninstallPlan } from "./plan.ts";
import { BACKUPS_GITIGNORE } from "./project.ts";
import { PACKAGE_NAME, writeMarker } from "./skills.ts";

export interface ApplyResult {
  changed: string[]; // paths written, created, or removed
  backups: string[];
}

function scratchPath(agentsRoot: string, kind: "tmp" | "old"): string {
  return join(dirname(agentsRoot), `.omt-${kind}-${randomBytes(6).toString("hex")}`);
}

// Lazily creates one backup directory per run, so a run without backups leaves no empty directory.
// In project scope, `backups/.gitignore` holds `*`, so git never shows a backup; `onIgnore` gets it when this run wrote it.
function backupDirFor(stateDir: string, now: Date, project: boolean, onIgnore?: (file: ManifestFile) => void): () => Promise<string> {
  let dir: string | undefined;
  return async () => {
    if (dir !== undefined) return dir;
    dir = await newBackupDir(stateDir, now);
    const ignore = join(stateDir, "backups", ".gitignore");
    if (project && !(await pathExists(ignore))) {
      await writeFileAtomic(ignore, BACKUPS_GITIGNORE);
      onIgnore?.({ path: ignore, sha256: sha256(BACKUPS_GITIGNORE) });
    }
    return dir;
  };
}

async function removeEmptyDir(dir: string): Promise<boolean> {
  try {
    await rmdir(dir);
    return true;
  } catch {
    // The directory is missing or holds other files.
    return false;
  }
}

// Deletes a scratch directory. A failure names the path; the next run removes it.
async function removeScratch(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (error) {
    throw new OmtError("scratch", `cannot delete the scratch directory ${dir}: ${errorMessage(error)}`, {
      hint: "fix the permissions, then run the command again; the next run removes the directory",
      cause: error,
    });
  }
}

async function removeScratchDirs(dirs: string[], result: ApplyResult): Promise<void> {
  for (const dir of dirs) {
    await removeScratch(dir);
    result.changed.push(dir);
  }
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
  if (old !== undefined) await removeScratch(old);
}

// A settings file that the install created and that holds only the omt entry is deleted without a
// backup. For a symlink, the install created its target, so the target goes and the link stays.
// An exact restore writes the install-time backup's bytes back, then deletes that backup.
// Returns the backup that this write made, if any.
async function writeHook(step: HookStep, backupDir: () => Promise<string>, result: ApplyResult, skipBackup = false): Promise<string | undefined> {
  let backup: string | undefined;
  if (step.removeFile === true) {
    if ((await readFileIfExists(step.settingsPath)) !== step.before) {
      throw new OmtError("claude_settings", `${step.settingsPath} changed after the plan was made; nothing was written`, {
        hint: "run the command again",
      });
    }
    await rm(await writeTargetFor(step.settingsPath), { force: true });
  } else if (step.restoreBackup !== undefined) {
    await writeHookChange(step as HookChange, undefined);
    await rm(step.restoreBackup, { force: true });
    const stampDir = dirname(step.restoreBackup);
    if (await removeEmptyDir(stampDir)) await removeEmptyDir(dirname(stampDir));
  } else {
    const needsBackup = step.action !== "unchanged" && step.before !== undefined && !skipBackup;
    backup = await writeHookChange(step as HookChange, needsBackup ? await backupDir() : undefined);
    if (backup !== undefined) result.backups.push(backup);
  }
  result.changed.push(step.settingsPath);
  return backup;
}

// Writes `after` only when the file still holds what the plan read. A `deleteFile` step deletes the
// file instead, and then its `removeDir` when that is empty. A symlink at the path stays a symlink:
// the write goes to its real path, and a delete empties the target and keeps the link.
async function writeFileStep(step: FileStep, mode?: number): Promise<void> {
  if ((await readFileIfExists(step.path)) !== step.before) {
    throw new OmtError("file_changed", `${step.path} changed after the plan was made; nothing more was written`, {
      hint: "run the command again",
    });
  }
  const target = await writeTargetFor(step.path);
  if (step.deleteFile === true && target === step.path) {
    await removePath(step.path);
    if (step.removeDir !== undefined) await removeEmptyDir(step.removeDir);
    return;
  }
  await writeFileAtomic(target, step.after, mode === undefined ? {} : { mode });
}

// Deletes a path. A failure names the path; running the command again finishes the work.
async function removePath(path: string, options: { recursive?: boolean } = {}): Promise<void> {
  try {
    await rm(path, { force: true, ...options });
  } catch (error) {
    throw new OmtError("remove", `cannot delete ${path}: ${errorMessage(error)}`, {
      hint: "fix the permissions, then run the command again",
      cause: error,
    });
  }
}

// Returns the created files that this run wrote, with the hash of what it wrote.
async function applyProjectInstall(
  plan: InstallPlan,
  backupDir: () => Promise<string>,
  result: ApplyResult,
): Promise<ManifestFile[]> {
  const project = plan.project;
  if (project === undefined) return [];
  const files: ManifestFile[] = [];
  if (project.plans.action === "create") {
    await ensureDir(project.plans.path);
    result.changed.push(project.plans.path);
  }
  if (project.gitignore.action === "create" || project.gitignore.action === "update") {
    await writeFileStep(project.gitignore);
    result.changed.push(project.gitignore.path);
    if (project.gitignoreCreated) files.push({ path: project.gitignore.path, sha256: sha256(project.gitignore.after) });
  }
  const shim = project.shim;
  if (shim.action === "replace") {
    const backup = join(await backupDir(), "bin", "omt");
    await movePath(shim.path, backup);
    result.backups.push(backup);
    shim.before = undefined;
  }
  if (shim.action === "create" || shim.action === "update" || shim.action === "replace") {
    await writeFileStep(shim, 0o755);
    await chmod(shim.path, 0o755);
    result.changed.push(shim.path);
  }
  return files;
}

async function existing(paths: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const path of paths) if (await pathExists(path)) found.push(path);
  return found;
}

function projectRecord(plan: InstallPlan, files: ManifestFile[], dirs: string[]): Manifest["project"] {
  const project = plan.project;
  if (project === undefined) return undefined;
  const exclude = project.exclude !== undefined && project.exclude.action !== "remove" ? project.exclude : undefined;
  return {
    omtDirCreated: project.omtDirCreated,
    settingsCreated: project.settingsCreated,
    shim: project.shim.path,
    ...(exclude === undefined ? {} : { gitExclude: exclude.path }),
    ...(exclude === undefined || project.excludeFile === undefined ? {} : { excludeFile: project.excludeFile }),
    ...(project.excludeNote === "--no-git-exclude" ? { gitExcludeOff: true } : {}),
    ...(project.gitignoreRestore === undefined ? {} : { gitignoreRestore: project.gitignoreRestore }),
    ...(project.existing.skills.length + project.existing.links.length === 0 ? {} : { existing: project.existing }),
    files,
    dirs,
  };
}

// The backups .gitignore that this run will write, so the provisional manifest can record it.
async function plannedBackupsIgnore(plan: InstallPlan, skipHookBackup: boolean): Promise<ManifestFile | undefined> {
  if (plan.project === undefined) return undefined;
  const path = join(plan.stateDir, "backups", ".gitignore");
  if (await pathExists(path)) return undefined;
  const replaces = replaceableSteps(plan).some((step) => step.action === "replace");
  const hook = plan.hook;
  const hookBackup = hook !== undefined && hook.action !== "unchanged" && hook.before !== undefined && !skipHookBackup;
  return replaces || hookBackup ? { path, sha256: sha256(BACKUPS_GITIGNORE) } : undefined;
}

// A project hook update needs no backup when the file is in the layout that omt writes, because then
// the rewrite changes only the command of the omt entry (the shim path moves with the project). A file
// in any other layout, such as one with inline arrays, gets a backup, which is not the hook `backup`.
function skipsHookBackup(plan: InstallPlan): boolean {
  const hook = plan.hook;
  return plan.project !== undefined && hook?.action === "update" && hook.before !== undefined && isOmtLayout(hook.before, hook.settingsPath);
}

function installManifest(plan: InstallPlan, now: Date, fields: Pick<Manifest, "config" | "hooks" | "backups" | "project">): Manifest {
  return {
    ...(plan.project === undefined ? {} : { scope: "project" as const, root: plan.project.root }),
    package: PACKAGE_NAME,
    version: plan.version,
    installedAt: now.toISOString(),
    skillsRoot: plan.agentsRoot,
    // A project manifest lists only what an install owns; `project.existing` lists the rest.
    skills: plan.skills.filter((step) => plan.project?.existing.skills.includes(step.name) !== true).map((step) => step.name),
    links: plan.links
      .filter((link) => plan.project?.existing.links.includes(link.path) !== true)
      .map((link) => ({ path: link.path, target: link.target })),
    ...fields,
  };
}

function hookRecords(plan: InstallPlan, created: boolean, backup?: string): ManifestHook[] {
  if (plan.hook === undefined) return [];
  return [
    {
      kind: "claude-user-prompt-submit",
      settingsPath: plan.hook.settingsPath,
      command: plan.hook.command,
      ...(created ? { created: true } : {}),
      ...(backup === undefined ? {} : { backup }),
    },
  ];
}

// In project scope, the exclude block and a provisional manifest go first, so a failure later in
// the run leaves no file that git shows or that the next run takes for the user's.
async function beginProjectInstall(
  plan: InstallPlan,
  now: Date,
  hookCreated: boolean,
  starter: string,
  backupsIgnore: ManifestFile | undefined,
): Promise<void> {
  const project = plan.project;
  if (project === undefined) return;
  const exclude = project.exclude;
  if (exclude !== undefined && exclude.action !== "unchanged") {
    try {
      await writeFileStep(exclude);
    } catch (error) {
      if (error instanceof OmtError) throw error;
      throw new OmtError("git_exclude", `cannot write the git exclude block to ${exclude.path}: ${errorMessage(error)}; nothing was changed`, {
        hint: "fix the file's permissions, or run the install again with --no-git-exclude",
        cause: error,
      });
    }
  }
  const files: ManifestFile[] = [];
  if (project.gitignoreCreated && (project.gitignore.action === "create" || project.gitignore.action === "update")) {
    files.push({ path: project.gitignore.path, sha256: sha256(project.gitignore.after) });
  }
  if (plan.config.action === "create") files.push({ path: plan.config.path, sha256: sha256(starter) });
  if (backupsIgnore !== undefined) files.push(backupsIgnore);
  const provisional = installManifest(plan, now, {
    config: { path: plan.config.path, created: plan.config.action === "create" },
    hooks: hookRecords(plan, hookCreated),
    backups: [],
    project: projectRecord(plan, files, project.missingDirs),
  });
  await writeManifest(plan.manifestPath, mergeManifest(plan.previous, provisional));
}

export async function applyInstall(plan: InstallPlan, now: Date): Promise<ApplyResult> {
  const result: ApplyResult = { changed: [], backups: [] };
  const createdIgnores: ManifestFile[] = [];
  const backupDir = backupDirFor(plan.stateDir, now, plan.project !== undefined, (file) => createdIgnores.push(file));

  for (const step of replaceableSteps(plan)) {
    if (step.action === "conflict") {
      throw new OmtError("conflict", `cannot apply a plan with conflicts (${step.path})`, { hint: "use --force" });
    }
  }
  const starter = starterConfig(plan.scope, plan.config.harnesses);
  const hookCreated =
    plan.hook !== undefined &&
    (plan.hook.before === undefined ||
      plan.previous?.hooks.some((hook) => hook.settingsPath === plan.hook?.settingsPath && hook.created === true) === true);
  const skipHookBackup = skipsHookBackup(plan);
  await beginProjectInstall(plan, now, hookCreated, starter, await plannedBackupsIgnore(plan, skipHookBackup));
  await removeScratchDirs(plan.scratch, result);

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
    await writeFileAtomic(plan.config.path, starter);
    configCreated = true;
    result.changed.push(plan.config.path);
  }

  const createdFiles = await applyProjectInstall(plan, backupDir, result);
  if (configCreated && plan.project !== undefined) createdFiles.push({ path: plan.config.path, sha256: sha256(starter) });
  let hookBackup: string | undefined;
  if (plan.hook !== undefined && plan.hook.action !== "unchanged") {
    const backup = await writeHook(plan.hook, backupDir, result, skipHookBackup);
    // Only the backup taken before the entry was first added can restore the file exactly.
    if (plan.hook.action === "create") hookBackup = backup;
  }
  if (plan.project?.exclude !== undefined && plan.project.exclude.action !== "unchanged") result.changed.push(plan.project.exclude.path);

  const manifest = installManifest(plan, now, {
    config: { path: plan.config.path, created: configCreated },
    hooks: hookRecords(plan, hookCreated, hookBackup),
    backups: result.backups,
    project: plan.project === undefined ? undefined : projectRecord(plan, [...createdFiles, ...createdIgnores], await existing(plan.project.missingDirs)),
  });
  await writeManifest(plan.manifestPath, mergeManifest(plan.previous, manifest));
  return result;
}

// The mirror of the install order: the exclude block changes last, so a run that fails midway leaves
// every remaining path hidden from git, and the next run finishes the work.
export async function applyUninstall(plan: UninstallPlan, now: Date): Promise<ApplyResult> {
  const result: ApplyResult = { changed: [], backups: [] };
  const backupDir = backupDirFor(plan.stateDir, now, plan.project !== undefined);
  await removeScratchDirs(plan.scratch, result);

  for (const link of plan.links) {
    if (link.action !== "remove") continue;
    await removePath(link.path);
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
    try {
      await rename(skill.path, old);
    } catch (error) {
      throw new OmtError("remove", `cannot move ${skill.path} out of the skills directory: ${errorMessage(error)}`, {
        hint: "fix the permissions, then run the command again",
        cause: error,
      });
    }
    await removeScratch(old);
    result.changed.push(skill.path);
  }
  for (const hook of plan.hooks) await writeHook(hook, backupDir, result);
  if (plan.project?.shim !== undefined) {
    await removePath(plan.project.shim.path);
    result.changed.push(plan.project.shim.path);
  }
  if (plan.project?.gitignore !== undefined) {
    await writeFileStep(plan.project.gitignore);
    result.changed.push(plan.project.gitignore.path);
  }
  for (const file of plan.project?.files ?? []) {
    if (file.action !== "remove") continue;
    const text = await readFileIfExists(file.path);
    if (text === undefined || sha256(text) !== file.sha256) continue;
    await removePath(file.path);
    result.changed.push(file.path);
  }
  if (plan.config.action === "remove") {
    await removePath(plan.config.path);
    result.changed.push(plan.config.path);
  }
  if (plan.manifest.action === "remove") {
    await removePath(plan.manifest.path);
    result.changed.push(plan.manifest.path);
  } else if (plan.manifest.rewrite !== undefined) {
    await writeManifest(plan.manifest.path, plan.manifest.rewrite);
    result.changed.push(plan.manifest.path);
  }
  const ignore = plan.project?.backupsIgnore;
  if (ignore !== undefined) {
    const entries = await readdir(dirname(ignore.path)).catch(() => []);
    const text = await readFileIfExists(ignore.path);
    if (entries.length === 1 && entries[0] === ".gitignore" && text !== undefined && sha256(text) === ignore.sha256) {
      await removePath(ignore.path);
    }
  }
  for (const dir of plan.project?.emptyDirs ?? []) await removeEmptyDir(dir);
  if (plan.project?.exclude !== undefined) {
    await writeFileStep(plan.project.exclude);
    result.changed.push(plan.project.exclude.path);
  }
  if (plan.purge && plan.scope === "user") {
    try {
      await rmdir(plan.stateDir);
      result.changed.push(plan.stateDir);
    } catch {
      // The directory is missing or still holds user files, such as backups or roles.
    }
  }
  return result;
}
