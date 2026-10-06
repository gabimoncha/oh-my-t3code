import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { loadConfig } from "../config/load.ts";
import { claudeSettingsPath, manifestPath, skillRoots, t3SettingsPath } from "../paths.ts";
import { resolveAll } from "../routing/resolve.ts";
import type { Capabilities, CliContext } from "../types.ts";
import { pathExists, readFileIfExists } from "../util/fs.ts";
import { findManagedCommands, parseSettings } from "./claudeHook.ts";
import { resolveReal } from "./fsops.ts";
import { classifyLink, planLinks } from "./links.ts";
import { readManifest } from "./manifest.ts";
import { classifySkill, isManagedDir, listBundledSkills } from "./skills.ts";

export type CheckStatus = "PASS" | "WARN" | "FAIL" | "INFO";

export interface DoctorCheck {
  id: string;
  status: CheckStatus;
  message: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

export const MIN_NODE = [22, 18] as const;

function check(id: string, status: CheckStatus, message: string): DoctorCheck {
  return { id, status, message };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function checkNode(version: string): DoctorCheck {
  const [major = 0, minor = 0] = version.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const ok = major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
  return ok
    ? check("node", "PASS", `node ${version}`)
    : check("node", "FAIL", `node ${version} is older than ${MIN_NODE.join(".")}; install Node ${MIN_NODE.join(".")} or later`);
}

async function checkConfig(ctx: CliContext): Promise<DoctorCheck> {
  const { config, issues } = await loadConfig({ cwd: ctx.cwd, env: ctx.env, homedir: ctx.homedir });
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors;
  const roles = plural(Object.keys(config.roles).length, "role");
  if (errors > 0) return check("config", "FAIL", `${plural(errors, "error")}, ${plural(warnings, "warning")}; run omt config validate`);
  if (warnings > 0) return check("config", "WARN", `${roles}, ${plural(warnings, "warning")}; run omt config validate`);
  return check("config", "PASS", roles);
}

async function checkSkills(ctx: CliContext): Promise<DoctorCheck> {
  const root = skillRoots(ctx.env, ctx.homedir).agents;
  const bundled = await listBundledSkills(ctx.packageRoot);
  const groups: Record<string, string[]> = { missing: [], outdated: [], modified: [], unmanaged: [] };
  for (const skill of bundled) {
    const result = await classifySkill(skill.dir, join(root, skill.name));
    if (result.action === "create") groups.missing?.push(skill.name);
    else if (result.action === "update") groups.outdated?.push(skill.name);
    else if (result.action === "conflict") {
      (result.reason === "locally modified" ? groups.modified : groups.unmanaged)?.push(skill.name);
    }
  }
  const problems = Object.entries(groups)
    .filter(([, names]) => names.length > 0)
    .map(([kind, names]) => `${kind}: ${names.join(", ")}`);
  if (problems.length > 0) return check("skills", "WARN", `${problems.join("; ")} in ${root}; run omt install`);
  return check("skills", "PASS", `${plural(bundled.length, "skill")} installed in ${root}`);
}

async function checkLinks(ctx: CliContext): Promise<DoctorCheck> {
  const roots = skillRoots(ctx.env, ctx.homedir);
  const names = (await listBundledSkills(ctx.packageRoot)).map((skill) => skill.name);
  const plan = await planLinks(roots.agents, [{ name: "claude", path: roots.claude }], names);
  if (plan.skipped.length > 0) return check("links", "PASS", `${roots.claude} is the agents skill root`);
  const missing: string[] = [];
  const broken: string[] = [];
  for (const link of plan.links) {
    if (link.action === "create") missing.push(link.name);
    else if (link.action === "conflict") broken.push(`${link.name} (${link.reason ?? "conflict"})`);
    else if (!(await isManagedDir(await resolveReal(link.canonical)))) broken.push(`${link.name} (target is missing)`);
  }
  if (broken.length > 0) return check("links", "FAIL", `broken or conflicting in ${roots.claude}: ${broken.join(", ")}`);
  if (missing.length > 0) return check("links", "WARN", `missing in ${roots.claude}: ${missing.join(", ")}; run omt install`);
  return check("links", "PASS", `${plural(plan.links.length, "link")} in ${roots.claude}`);
}

// The managed command is `"<node>" "<cli>" hook user-prompt-submit # oh-my-t3code`.
function commandPaths(command: string): string[] {
  const match = /^"([^"]*)" "([^"]*)"/.exec(command);
  return match === null ? [] : [match[1] ?? "", match[2] ?? ""];
}

async function checkHooks(ctx: CliContext): Promise<DoctorCheck> {
  let settingsPaths: string[];
  try {
    const manifest = await readManifest(manifestPath(ctx.env, ctx.homedir));
    settingsPaths = (manifest?.hooks ?? []).map((hook) => hook.settingsPath);
  } catch (error) {
    return check("hooks", "WARN", errorMessage(error));
  }
  const fromManifest = settingsPaths.length > 0;
  if (!fromManifest) settingsPaths = [claudeSettingsPath(ctx.env, ctx.homedir)];
  const commands: string[] = [];
  const absent: string[] = [];
  for (const path of settingsPaths) {
    let found: string[];
    try {
      found = findManagedCommands(parseSettings(await readFileIfExists(path), path));
    } catch (error) {
      return check("hooks", "WARN", errorMessage(error));
    }
    if (found.length === 0) absent.push(path);
    commands.push(...found);
  }
  if (commands.length === 0) {
    return fromManifest
      ? check("hooks", "WARN", `the installed hook is missing from ${absent.join(", ")}; run omt install --hooks`)
      : check("hooks", "INFO", "no hook installed; run omt install --hooks to arm ultrawork on the ulw keyword");
  }
  const lost: string[] = [];
  for (const command of commands) {
    const paths = commandPaths(command);
    if (paths.length === 0) lost.push(command);
    for (const path of paths) if (!(await pathExists(path))) lost.push(path);
  }
  if (lost.length > 0) return check("hooks", "FAIL", `the hook command points at a missing path: ${lost.join(", ")}; run omt install --hooks`);
  if (absent.length > 0) return check("hooks", "WARN", `the installed hook is missing from ${absent.join(", ")}; run omt install --hooks`);
  return check("hooks", "PASS", `Claude UserPromptSubmit hook in ${settingsPaths.join(", ")}`);
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false;
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function checkPath(ctx: CliContext): Promise<DoctorCheck> {
  const names = process.platform === "win32" ? ["omt.cmd", "omt.exe", "omt"] : ["omt"];
  for (const dir of (ctx.env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    for (const name of names) {
      const path = join(dir, name);
      if (await isExecutableFile(path)) return check("path", "PASS", `omt is on PATH at ${path}`);
    }
  }
  return check(
    "path",
    "WARN",
    "omt is not on PATH; skills fall back to manual role resolution (run pnpm link --global or npm install -g oh-my-t3code)",
  );
}

async function checkT3(ctx: CliContext): Promise<DoctorCheck> {
  const path = t3SettingsPath(ctx.env, ctx.homedir);
  return (await pathExists(path))
    ? check("t3", "PASS", path)
    : check("t3", "WARN", `${path} does not exist; is T3 Code installed? (set T3CODE_HOME for a custom location)`);
}

function expandHome(path: string, homedir: string): string {
  if (path === "~") return homedir;
  return path.startsWith("~/") ? join(homedir, path.slice(2)) : path;
}

function claudeHomePaths(settings: unknown): { id: string; homePath: string }[] {
  if (settings === null || typeof settings !== "object") return [];
  const instances = (settings as Record<string, unknown>).providerInstances;
  if (instances === null || typeof instances !== "object") return [];
  const found: { id: string; homePath: string }[] = [];
  for (const [id, value] of Object.entries(instances as Record<string, unknown>)) {
    if (value === null || typeof value !== "object") continue;
    const instance = value as Record<string, unknown>;
    const config = instance.config as Record<string, unknown> | null | undefined;
    const homePath = config !== null && typeof config === "object" ? config.homePath : undefined;
    if (instance.driver === "claudeAgent" && typeof homePath === "string" && homePath.trim() !== "") {
      found.push({ id, homePath: homePath.trim() });
    }
  }
  return found;
}

async function linkedInto(skillsDir: string, agentsRoot: string, name: string): Promise<boolean> {
  const path = join(skillsDir, name);
  const canonical = join(agentsRoot, name);
  if ((await classifyLink(path, canonical)).action === "unchanged") return isManagedDir(await resolveReal(canonical));
  try {
    return await isManagedDir(await realpath(path));
  } catch {
    return false;
  }
}

async function checkHomes(ctx: CliContext): Promise<DoctorCheck> {
  const path = t3SettingsPath(ctx.env, ctx.homedir);
  const text = await readFileIfExists(path);
  if (text === undefined) return check("homes", "INFO", "no T3 settings file; no instance sets a homePath");
  let settings: unknown;
  try {
    settings = JSON.parse(text);
  } catch {
    return check("homes", "WARN", `${path} is not valid JSON; cannot read providerInstances`);
  }
  const homes = claudeHomePaths(settings);
  if (homes.length === 0) return check("homes", "INFO", "no claudeAgent instance sets a homePath");
  const agentsRoot = skillRoots(ctx.env, ctx.homedir).agents;
  const names = (await listBundledSkills(ctx.packageRoot)).map((skill) => skill.name);
  const lacking: string[] = [];
  for (const home of homes) {
    const skillsDir = join(expandHome(home.homePath, ctx.homedir), "skills");
    const missing: string[] = [];
    for (const name of names) if (!(await linkedInto(skillsDir, agentsRoot, name))) missing.push(name);
    if (missing.length > 0) lacking.push(`${home.id} (${skillsDir}) lacks ${missing.join(", ")}`);
  }
  if (lacking.length > 0) {
    return check(
      "homes",
      "WARN",
      `${lacking.join("; ")}; run CLAUDE_CONFIG_DIR=<homePath> omt install --targets agents,claude`,
    );
  }
  return check("homes", "PASS", `${plural(homes.length, "claudeAgent instance")} with a homePath have the skills`);
}

function checkRoles(report: ReturnType<typeof resolveAll>): DoctorCheck {
  const resolutions = Object.values(report.roles);
  const unavailable = resolutions.filter((r) => r.status === "unavailable").map((r) => r.role);
  if (unavailable.includes("execute")) {
    return check("roles", "FAIL", `unavailable: ${unavailable.join(", ")}; run omt roles --capabilities <file>`);
  }
  if (unavailable.length > 0) {
    return check("roles", "WARN", `unavailable: ${unavailable.join(", ")}; run omt roles --capabilities <file>`);
  }
  return check("roles", "PASS", `${plural(resolutions.length, "role")} resolve against orchestrator_capabilities`);
}

export async function runDoctor(ctx: CliContext, caps?: Capabilities): Promise<DoctorReport> {
  const checks = [
    checkNode(ctx.nodeVersion),
    await checkConfig(ctx),
    await checkSkills(ctx),
    await checkLinks(ctx),
    await checkHooks(ctx),
    await checkPath(ctx),
    await checkT3(ctx),
    await checkHomes(ctx),
  ];
  if (caps !== undefined) {
    const { config } = await loadConfig({ cwd: ctx.cwd, env: ctx.env, homedir: ctx.homedir });
    checks.push(checkRoles(resolveAll(config, caps)));
  }
  return { ok: !checks.some((c) => c.status === "FAIL"), checks };
}

export function formatDoctor(report: DoctorReport): string {
  const width = Math.max(...report.checks.map((c) => c.id.length));
  return report.checks.map((c) => `${c.status}  ${c.id.padEnd(width)}  ${c.message}\n`).join("");
}
