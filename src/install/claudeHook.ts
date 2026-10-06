import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { OmtError } from "../util/errors.ts";
import { readFileIfExists, writeFileAtomic } from "../util/fs.ts";
import { writeTargetFor } from "./fsops.ts";

export const HOOK_SIGNATURE = "# oh-my-t3code";
export const HOOK_EVENT = "UserPromptSubmit";
export const HOOK_TIMEOUT_SECONDS = 10;

export type HookAction = "create" | "update" | "unchanged" | "remove";

type Json = Record<string, unknown>;

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function realOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function isPackageRunnerCache(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return normalized.includes("/_npx/") || /\/pnpm\/(?:[^/]+\/)*dlx\//i.test(normalized);
}

// Refuses a CLI path that can disappear: a temp directory, an npx cache, or a pnpm dlx cache.
export function assertStableCliPath(cliPath: string, tempRoot: string = tmpdir()): void {
  const temps = [tempRoot, realOrSelf(tempRoot)];
  const paths = [cliPath, realOrSelf(cliPath)];
  const transient =
    paths.some(isPackageRunnerCache) ||
    paths.some((path) => temps.some((temp) => isInside(path, temp)));
  if (transient) {
    throw new OmtError("hook_cli_path", `refusing --hooks: the omt CLI runs from a temporary path (${cliPath})`, {
      hint: "install the package globally (npm install -g oh-my-t3code), then run omt install --hooks again",
    });
  }
}

export function hookCommand(nodePath: string, cliPath: string): string {
  for (const path of [nodePath, cliPath]) {
    if (/["$`\\\n]/.test(path)) {
      throw new OmtError("hook_cli_path", `refusing --hooks: the path cannot be quoted safely for a shell: ${path}`);
    }
  }
  return `"${nodePath}" "${cliPath}" hook user-prompt-submit ${HOOK_SIGNATURE}`;
}

export function isManagedCommand(command: unknown): boolean {
  return typeof command === "string" && command.trimEnd().endsWith(HOOK_SIGNATURE);
}

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseSettings(text: string | undefined, path: string): Json {
  if (text === undefined || text.trim() === "") return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new OmtError("claude_settings", `${path} is not valid JSON; nothing was changed`, {
      hint: "fix the file, then run the command again",
      cause: error,
    });
  }
  if (!isObject(value)) throw new OmtError("claude_settings", `${path} does not hold a JSON object; nothing was changed`);
  if (value.hooks !== undefined && !isObject(value.hooks)) {
    throw new OmtError("claude_settings", `"hooks" in ${path} is not an object; nothing was changed`);
  }
  const event = (value.hooks as Json | undefined)?.[HOOK_EVENT];
  if (event !== undefined && !Array.isArray(event)) {
    throw new OmtError("claude_settings", `"hooks.${HOOK_EVENT}" in ${path} is not an array; nothing was changed`);
  }
  return value;
}

export function serializeSettings(settings: Json): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

function managedHandlers(settings: Json): Json[] {
  const groups = (settings.hooks as Json | undefined)?.[HOOK_EVENT];
  if (!Array.isArray(groups)) return [];
  const found: Json[] = [];
  for (const group of groups) {
    if (!isObject(group) || !Array.isArray(group.hooks)) continue;
    for (const handler of group.hooks) {
      if (isObject(handler) && isManagedCommand(handler.command)) found.push(handler);
    }
  }
  return found;
}

export function findManagedCommands(settings: Json): string[] {
  return managedHandlers(settings).map((handler) => handler.command as string);
}

// Returns a copy of the settings with the managed entry added or its command replaced.
export function withHook(settings: Json, command: string): Json {
  const next = structuredClone(settings);
  const existing = managedHandlers(next);
  if (existing.length > 0) {
    for (const handler of existing) handler.command = command;
    return next;
  }
  const hooks = isObject(next.hooks) ? next.hooks : {};
  const groups = Array.isArray(hooks[HOOK_EVENT]) ? (hooks[HOOK_EVENT] as unknown[]) : [];
  groups.push({ hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_SECONDS }] });
  hooks[HOOK_EVENT] = groups;
  next.hooks = hooks;
  return next;
}

// Returns a copy of the settings without managed entries. Groups, the event key, and `hooks`
// are dropped only when removing the managed entry left them empty.
export function withoutHook(settings: Json): Json {
  const next = structuredClone(settings);
  const hooks = next.hooks;
  if (!isObject(hooks) || !Array.isArray(hooks[HOOK_EVENT])) return next;
  const groups: unknown[] = [];
  let changed = false;
  for (const group of hooks[HOOK_EVENT] as unknown[]) {
    if (!isObject(group) || !Array.isArray(group.hooks)) {
      groups.push(group);
      continue;
    }
    const kept = group.hooks.filter((handler) => !(isObject(handler) && isManagedCommand(handler.command)));
    if (kept.length === group.hooks.length) {
      groups.push(group);
      continue;
    }
    changed = true;
    if (kept.length > 0) groups.push({ ...group, hooks: kept });
  }
  if (!changed) return next;
  if (groups.length > 0) {
    hooks[HOOK_EVENT] = groups;
  } else {
    delete hooks[HOOK_EVENT];
    if (Object.keys(hooks).length === 0) delete next.hooks;
  }
  return next;
}

export interface HookChange {
  settingsPath: string;
  command: string; // the managed command after the change; the removed one for "remove"
  action: HookAction;
  before: string | undefined; // file content now, undefined when the file is missing
  after: string; // content to write; equals before when unchanged
}

export async function planHookInstall(settingsPath: string, command: string): Promise<HookChange> {
  const before = await readFileIfExists(settingsPath);
  const settings = parseSettings(before, settingsPath);
  const current = findManagedCommands(settings);
  if (current.length > 0 && current.every((existing) => existing === command)) {
    return { settingsPath, command, action: "unchanged", before, after: before ?? "" };
  }
  const after = serializeSettings(withHook(settings, command));
  if (after === before) return { settingsPath, command, action: "unchanged", before, after };
  return { settingsPath, command, action: current.length > 0 ? "update" : "create", before, after };
}

export async function planHookRemoval(settingsPath: string): Promise<HookChange | undefined> {
  const before = await readFileIfExists(settingsPath);
  if (before === undefined) return undefined;
  const settings = parseSettings(before, settingsPath);
  const current = findManagedCommands(settings);
  if (current.length === 0) return undefined;
  return {
    settingsPath,
    command: current[0] ?? "",
    action: "remove",
    before,
    after: serializeSettings(withoutHook(settings)),
  };
}

// Backs up the old file into `backupDir`, then writes onto the real path so a symlink stays a symlink.
// Returns the backup path, if one was written.
export async function writeHookChange(change: HookChange, backupDir: string): Promise<string | undefined> {
  if (change.action === "unchanged") return undefined;
  const current = await readFileIfExists(change.settingsPath);
  if (current !== change.before) {
    throw new OmtError("claude_settings", `${change.settingsPath} changed after the plan was made; nothing was written`, {
      hint: "run the command again",
    });
  }
  let backup: string | undefined;
  if (change.before !== undefined) {
    backup = join(backupDir, "claude-settings.json");
    for (let n = 1; (await readFileIfExists(backup)) !== undefined; n += 1) {
      backup = join(backupDir, `claude-settings-${n}.json`);
    }
    await writeFileAtomic(backup, change.before, { mode: 0o600 });
  }
  await writeFileAtomic(await writeTargetFor(change.settingsPath), change.after);
  return backup;
}
