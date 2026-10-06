import { readdir, readlink, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { claudeSettingsPath, configDir, manifestPath, skillRoots, userConfigPath } from "../paths.ts";
import type { CliContext } from "../types.ts";
import { usageError } from "../util/errors.ts";
import { hashDir, isSymlink, pathExists } from "../util/fs.ts";
import { assertStableCliPath, hookCommand, planHookInstall, planHookRemoval } from "./claudeHook.ts";
import type { HookChange } from "./claudeHook.ts";
import { planLinks } from "./links.ts";
import type { LinkRoot, LinkRootName, SkippedRoot } from "./links.ts";
import { readManifest } from "./manifest.ts";
import type { Manifest } from "./manifest.ts";
import { classifySkill, isManagedDir, listBundledSkills, readMarker } from "./skills.ts";

export type TargetName = "agents" | LinkRootName;
export const TARGET_NAMES: readonly TargetName[] = ["agents", "claude", "gemini"];

export type PlanAction = "create" | "update" | "unchanged" | "conflict" | "replace" | "remove" | "keep";

export interface SkillStep {
  name: string;
  source: string;
  path: string;
  sourceHash: string;
  action: PlanAction;
  reason?: string;
  backup?: boolean; // uninstall --force: move a locally modified skill to the backups before removal
}

export interface LinkStep {
  root: LinkRootName;
  name: string;
  path: string;
  target: string;
  action: PlanAction;
  reason?: string;
}

export interface ConfigStep {
  path: string;
  action: PlanAction;
}

export interface HookStep extends Omit<HookChange, "action"> {
  action: PlanAction;
}

export interface InstallPlan {
  version: string;
  targets: TargetName[];
  agentsRoot: string;
  configDir: string;
  manifestPath: string;
  skills: SkillStep[];
  links: LinkStep[];
  skippedRoots: SkippedRoot[];
  config: ConfigStep;
  hook?: HookStep;
  previous?: Manifest;
}

export interface UninstallPlan {
  configDir: string;
  links: LinkStep[];
  skills: SkillStep[];
  hooks: HookStep[];
  config: ConfigStep;
  manifest: { path: string; action: PlanAction };
  purge: boolean;
}

export async function parseTargets(value: string | undefined, homedir: string): Promise<TargetName[]> {
  const selected = new Set<TargetName>(["agents"]);
  if (value === undefined) {
    selected.add("claude");
    if (await pathExists(join(homedir, ".gemini"))) selected.add("gemini");
  } else {
    for (const raw of value.split(",")) {
      const name = raw.trim();
      if (name === "") continue;
      if (!(TARGET_NAMES as readonly string[]).includes(name)) {
        throw usageError(`unknown target "${name}"`, "use a comma-separated subset of agents, claude, gemini");
      }
      selected.add(name as TargetName);
    }
  }
  return TARGET_NAMES.filter((name) => selected.has(name));
}

export interface InstallOptions {
  targets: TargetName[];
  hooks: boolean;
  force: boolean;
}

export async function buildInstallPlan(ctx: CliContext, options: InstallOptions): Promise<InstallPlan> {
  const roots = skillRoots(ctx.env, ctx.homedir);
  let command: string | undefined;
  if (options.hooks) {
    assertStableCliPath(ctx.cliPath);
    command = hookCommand(ctx.nodePath, ctx.cliPath);
  }
  const bundled = await listBundledSkills(ctx.packageRoot);
  const skills: SkillStep[] = [];
  for (const skill of bundled) {
    const path = join(roots.agents, skill.name);
    const result = await classifySkill(skill.dir, path);
    skills.push({ name: skill.name, source: skill.dir, path, ...result });
  }
  const linkRoots: LinkRoot[] = options.targets
    .filter((name): name is LinkRootName => name !== "agents")
    .map((name) => ({ name, path: roots[name] }));
  const linkPlan = await planLinks(
    roots.agents,
    linkRoots,
    bundled.map((skill) => skill.name),
  );
  const links: LinkStep[] = linkPlan.links.map(({ canonical: _canonical, ...link }) => link);
  const configPath = userConfigPath(ctx.env, ctx.homedir);
  const plan: InstallPlan = {
    version: ctx.version,
    targets: options.targets,
    agentsRoot: roots.agents,
    configDir: configDir(ctx.env, ctx.homedir),
    manifestPath: manifestPath(ctx.env, ctx.homedir),
    skills,
    links,
    skippedRoots: linkPlan.skipped,
    config: { path: configPath, action: (await pathExists(configPath)) ? "unchanged" : "create" },
  };
  const previous = await readManifest(plan.manifestPath);
  if (previous !== undefined) plan.previous = previous;
  if (command !== undefined) plan.hook = await planHookInstall(claudeSettingsPath(ctx.env, ctx.homedir), command);
  if (options.force) {
    for (const step of [...plan.skills, ...plan.links]) {
      if (step.action === "conflict") step.action = "replace";
    }
  }
  return plan;
}

export function installConflicts(plan: InstallPlan): number {
  return [...plan.skills, ...plan.links].filter((step) => step.action === "conflict").length;
}

export function installHasChanges(plan: InstallPlan): boolean {
  const steps: { action: PlanAction }[] = [...plan.skills, ...plan.links, plan.config];
  if (plan.hook !== undefined) steps.push(plan.hook);
  return steps.some((step) => step.action !== "unchanged");
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw error;
  }
}

// Returns the real path of a symlink that resolves to a managed skill directory.
async function managedLinkTarget(path: string): Promise<string | undefined> {
  if (!(await isSymlink(path))) return undefined;
  try {
    const target = await realpath(path);
    return (await isManagedDir(target)) ? target : undefined;
  } catch {
    return undefined;
  }
}

async function isLocallyModified(dir: string): Promise<boolean> {
  const marker = await readMarker(dir);
  return marker == null || (await hashDir(dir)) !== marker.hash;
}

async function realOrSelf(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

export async function buildUninstallPlan(
  ctx: CliContext,
  options: { purge: boolean; force?: boolean },
): Promise<UninstallPlan> {
  const roots = skillRoots(ctx.env, ctx.homedir);
  const manifestFile = manifestPath(ctx.env, ctx.homedir);
  const manifest = await readManifest(manifestFile);

  const skillDirs = new Set<string>([roots.agents]);
  if (manifest !== undefined && manifest.skillsRoot !== "") skillDirs.add(resolve(manifest.skillsRoot));
  const skills: SkillStep[] = [];
  const kept = new Set<string>();
  for (const dir of skillDirs) {
    for (const name of await listDir(dir)) {
      const path = join(dir, name);
      if (!(await isManagedDir(path))) continue;
      const step: SkillStep = { name, source: "", path, sourceHash: "", action: "remove" };
      if (await isLocallyModified(path)) {
        if (options.force === true) {
          step.backup = true;
          step.reason = "locally modified; backed up";
        } else {
          step.action = "keep";
          step.reason = "locally modified";
          kept.add(await realOrSelf(path));
        }
      }
      skills.push(step);
    }
  }

  const linkCandidates = new Map<string, { root: LinkRootName; name: string }>();
  for (const root of ["claude", "gemini"] as const) {
    for (const name of await listDir(roots[root])) linkCandidates.set(join(roots[root], name), { root, name });
  }
  for (const link of manifest?.links ?? []) {
    if (!linkCandidates.has(link.path)) {
      const root: LinkRootName = link.path.startsWith(`${roots.gemini}/`) ? "gemini" : "claude";
      linkCandidates.set(link.path, { root, name: basename(link.path) });
    }
  }
  const links: LinkStep[] = [];
  for (const [path, { root, name }] of linkCandidates) {
    const target = await managedLinkTarget(path);
    if (target === undefined) continue;
    const keep = kept.has(target);
    links.push({
      root,
      name,
      path,
      target: await readlink(path),
      action: keep ? "keep" : "remove",
      ...(keep ? { reason: "points at a kept skill" } : {}),
    });
  }

  const settingsPaths = new Set<string>([claudeSettingsPath(ctx.env, ctx.homedir)]);
  for (const hook of manifest?.hooks ?? []) settingsPaths.add(hook.settingsPath);
  const hooks: HookStep[] = [];
  for (const settingsPath of settingsPaths) {
    const change = await planHookRemoval(settingsPath);
    if (change !== undefined) hooks.push(change);
  }

  const configPath = userConfigPath(ctx.env, ctx.homedir);
  const configExists = await pathExists(configPath);
  return {
    configDir: configDir(ctx.env, ctx.homedir),
    links,
    skills,
    hooks,
    config: { path: configPath, action: configExists ? (options.purge ? "remove" : "keep") : "unchanged" },
    manifest: { path: manifestFile, action: manifest !== undefined || (await pathExists(manifestFile)) ? "remove" : "unchanged" },
    purge: options.purge,
  };
}

export function uninstallHasChanges(plan: UninstallPlan): boolean {
  return (
    plan.links.some((link) => link.action === "remove") ||
    plan.skills.some((skill) => skill.action === "remove") ||
    plan.hooks.length > 0 ||
    plan.config.action === "remove" ||
    plan.manifest.action === "remove"
  );
}

function line(action: PlanAction, subject: string, reason?: string): string {
  return `  ${action.padEnd(8)} ${subject}${reason === undefined ? "" : `  (${reason})`}\n`;
}

export function renderInstallPlan(plan: InstallPlan): string {
  let text = `Skills (${plan.agentsRoot}):\n`;
  if (plan.skills.length === 0) text += "  none found in the package\n";
  for (const step of plan.skills) text += line(step.action, step.name, step.reason);
  const roots = new Map<string, LinkStep[]>();
  for (const link of plan.links) roots.set(dirname(link.path), [...(roots.get(dirname(link.path)) ?? []), link]);
  text += "Links:\n";
  if (roots.size === 0 && plan.skippedRoots.length === 0) text += "  none selected\n";
  for (const [root, links] of roots) {
    for (const link of links) text += line(link.action, `${join(root, link.name)} -> ${link.target}`, link.reason);
  }
  for (const skipped of plan.skippedRoots) text += `  skip     ${skipped.path}  (${skipped.reason})\n`;
  text += "Config:\n";
  text += line(plan.config.action, plan.config.path);
  text += "Hooks:\n";
  text +=
    plan.hook === undefined
      ? "  none     (add --hooks to install the Claude Code ultrawork hook)\n"
      : line(plan.hook.action, `Claude UserPromptSubmit in ${plan.hook.settingsPath}`);
  return text;
}

export function renderUninstallPlan(plan: UninstallPlan): string {
  let text = "Links:\n";
  if (plan.links.length === 0) text += "  none\n";
  for (const link of plan.links) text += line(link.action, link.path, link.reason);
  text += "Skills:\n";
  if (plan.skills.length === 0) text += "  none\n";
  for (const skill of plan.skills) text += line(skill.action, skill.path, skill.reason);
  text += "Hooks:\n";
  if (plan.hooks.length === 0) text += "  none\n";
  for (const hook of plan.hooks) text += line(hook.action, `Claude UserPromptSubmit in ${hook.settingsPath}`);
  text += "Config:\n";
  // "unchanged" here means the file does not exist.
  if (plan.config.action === "unchanged" && plan.manifest.action === "unchanged") text += "  none\n";
  if (plan.config.action !== "unchanged") {
    text += line(plan.config.action, plan.config.path, plan.config.action === "keep" ? "add --purge to remove it" : undefined);
  }
  if (plan.manifest.action !== "unchanged") text += line(plan.manifest.action, plan.manifest.path);
  const kept = plan.skills.filter((skill) => skill.action === "keep").length;
  if (kept > 0) text += `${kept} locally modified skill${kept === 1 ? "" : "s"} kept; add --force to back up and remove them\n`;
  return text;
}
