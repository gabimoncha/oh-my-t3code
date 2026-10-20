import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { OmtError } from "../util/errors.ts";
import { readFileIfExists, writeFileAtomic } from "../util/fs.ts";
import { isRecord } from "../util/json.ts";
import { writeTargetFor } from "./fsops.ts";

export const HOOK_SIGNATURE = "# oh-my-t3code";
export const HOOK_EVENT = "UserPromptSubmit";
export const HOOK_TIMEOUT_SECONDS = 10;

export type HookAction = "create" | "update" | "unchanged" | "remove";

type Json = Record<string, unknown>;

function assertQuotable(path: string): void {
  if (/["$`\\\n]/.test(path)) {
    throw new OmtError("hook_cli_path", `refusing --hooks: the path cannot be quoted safely for a shell: ${path}`);
  }
}

// A binary runs by itself, so its command names no runtime. Source and bundle mode name the runtime.
export function hookCommand(runtimePath: string | undefined, cliPath: string): string {
  const paths = runtimePath === undefined ? [cliPath] : [runtimePath, cliPath];
  for (const path of paths) assertQuotable(path);
  return `${paths.map((path) => `"${path}"`).join(" ")} hook user-prompt-submit ${HOOK_SIGNATURE}`;
}

// Project scope calls the shim, so the runtime and CLI paths live in one file.
export function shimHookCommand(shimPath: string): string {
  assertQuotable(shimPath);
  return `"${shimPath}" hook user-prompt-submit ${HOOK_SIGNATURE}`;
}

export function isManagedCommand(command: unknown): boolean {
  return typeof command === "string" && command.trimEnd().endsWith(HOOK_SIGNATURE);
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
  if (!isRecord(value)) throw new OmtError("claude_settings", `${path} does not hold a JSON object; nothing was changed`);
  if (value.hooks !== undefined && !isRecord(value.hooks)) {
    throw new OmtError("claude_settings", `"hooks" in ${path} is not an object; nothing was changed`);
  }
  const event = (value.hooks as Json | undefined)?.[HOOK_EVENT];
  if (event !== undefined && !Array.isArray(event)) {
    throw new OmtError("claude_settings", `"hooks.${HOOK_EVENT}" in ${path} is not an array; nothing was changed`);
  }
  return value;
}

// How a settings file is formatted, so that an edit keeps the owner's style.
export interface JsonStyle {
  indent: string; // "" is compact
  finalNewline: boolean;
  crlf: boolean;
}

export const DEFAULT_JSON_STYLE: JsonStyle = { indent: "  ", finalNewline: true, crlf: false };

export function detectJsonStyle(text: string | undefined): JsonStyle {
  if (text === undefined || text.trim() === "") return DEFAULT_JSON_STYLE;
  // An empty object such as "{}" shows no style, so it gets the default indentation.
  const empty = /^\s*\{\s*\}\s*$/.test(text);
  const indent = empty ? DEFAULT_JSON_STYLE.indent : (/\n([ \t]+)\S/.exec(text)?.[1] ?? "");
  return {
    indent: indent.startsWith("\t") ? "\t" : indent,
    finalNewline: text.endsWith("\n"),
    crlf: text.includes("\r\n"),
  };
}

export function serializeSettings(settings: Json, style: JsonStyle = DEFAULT_JSON_STYLE): string {
  const text = `${JSON.stringify(settings, null, style.indent)}${style.finalNewline ? "\n" : ""}`;
  return style.crlf ? text.replaceAll("\n", "\r\n") : text;
}

// True when serializing the parsed file in its detected style gives its exact bytes back.
export function isOmtLayout(text: string, path: string): boolean {
  return serializeSettings(parseSettings(text, path), detectJsonStyle(text)) === text;
}

function managedHandlers(settings: Json): Json[] {
  const groups = (settings.hooks as Json | undefined)?.[HOOK_EVENT];
  if (!Array.isArray(groups)) return [];
  const found: Json[] = [];
  for (const group of groups) {
    if (!isRecord(group) || !Array.isArray(group.hooks)) continue;
    for (const handler of group.hooks) {
      if (isRecord(handler) && isManagedCommand(handler.command)) found.push(handler);
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
  const hooks = isRecord(next.hooks) ? next.hooks : {};
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
  if (!isRecord(hooks) || !Array.isArray(hooks[HOOK_EVENT])) return next;
  const groups: unknown[] = [];
  let changed = false;
  for (const group of hooks[HOOK_EVENT] as unknown[]) {
    if (!isRecord(group) || !Array.isArray(group.hooks)) {
      groups.push(group);
      continue;
    }
    const kept = group.hooks.filter((handler) => !(isRecord(handler) && isManagedCommand(handler.command)));
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
  empty?: boolean; // "remove": only {} is left
  restoreBackup?: string; // "remove": `after` holds the bytes of this install-time backup, which is then deleted
}

export async function planHookInstall(settingsPath: string, command: string): Promise<HookChange> {
  const before = await readFileIfExists(settingsPath);
  const settings = parseSettings(before, settingsPath);
  const current = findManagedCommands(settings);
  if (current.length > 0 && current.every((existing) => existing === command)) {
    return { settingsPath, command, action: "unchanged", before, after: before ?? "" };
  }
  const after = serializeSettings(withHook(settings, command), detectJsonStyle(before));
  if (after === before) return { settingsPath, command, action: "unchanged", before, after };
  return { settingsPath, command, action: current.length > 0 ? "update" : "create", before, after };
}

function parsesTo(text: string, value: Json): boolean {
  try {
    return isDeepStrictEqual(text.trim() === "" ? {} : JSON.parse(text), value);
  } catch {
    return false;
  }
}

// When the settings left after the removal equal the install-time backup, the change writes the
// backup's bytes back, so the file is exactly what it was before the install.
export async function planHookRemoval(settingsPath: string, installBackup?: string): Promise<HookChange | undefined> {
  const before = await readFileIfExists(settingsPath);
  if (before === undefined) return undefined;
  const settings = parseSettings(before, settingsPath);
  const current = findManagedCommands(settings);
  if (current.length === 0) return undefined;
  const remaining = withoutHook(settings);
  const change: HookChange = {
    settingsPath,
    command: current[0] ?? "",
    action: "remove",
    before,
    after: serializeSettings(remaining, detectJsonStyle(before)),
    empty: isDeepStrictEqual(remaining, {}),
  };
  const backup = installBackup === undefined ? undefined : await readFileIfExists(installBackup);
  if (installBackup !== undefined && backup !== undefined && parsesTo(backup, remaining)) {
    change.after = backup;
    change.restoreBackup = installBackup;
  }
  return change;
}

// Backs up the old file into `backupDir` (no backup when it is undefined), then writes onto the real
// path so a symlink stays a symlink. Returns the backup path, if one was written.
export async function writeHookChange(change: HookChange, backupDir: string | undefined): Promise<string | undefined> {
  if (change.action === "unchanged") return undefined;
  const current = await readFileIfExists(change.settingsPath);
  if (current !== change.before) {
    throw new OmtError("claude_settings", `${change.settingsPath} changed after the plan was made; nothing was written`, {
      hint: "run the command again",
    });
  }
  let backup: string | undefined;
  if (backupDir !== undefined && change.before !== undefined && change.restoreBackup === undefined) {
    backup = join(backupDir, "claude-settings.json");
    for (let n = 1; (await readFileIfExists(backup)) !== undefined; n += 1) {
      backup = join(backupDir, `claude-settings-${n}.json`);
    }
    await writeFileAtomic(backup, change.before, { mode: 0o600 });
  }
  await writeFileAtomic(await writeTargetFor(change.settingsPath), change.after);
  return backup;
}
