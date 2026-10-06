import { stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { OmtError } from "../util/errors.ts";
import { readFileIfExists } from "../util/fs.ts";

export const SHIM_SIGNATURE = "# oh-my-t3code project shim";
export const OMT_GITIGNORE_LINES: readonly string[] = ["ledger.jsonl", "evidence/", "bin/", "install.json", "backups/"];
export const BACKUPS_GITIGNORE = "*\n";

// The markers carry the project root, because worktrees of one repository share one exclude file.
export function excludeBegin(root: string): string {
  return `# >>> oh-my-t3code project install: ${root} >>>`;
}

export function excludeEnd(root: string): string {
  return `# <<< oh-my-t3code project install: ${root} <<<`;
}

function assertShellSafe(path: string): void {
  if (/["$`\\\n]/.test(path)) {
    throw new OmtError("shim_cli_path", `refusing --project: the path cannot be quoted safely for a shell: ${path}`);
  }
}

// Tries the recorded node first and falls back to `node` on PATH, so a Node upgrade does not break the shim.
export function shimContent(nodePath: string, cliPath: string): string {
  for (const path of [nodePath, cliPath]) assertShellSafe(path);
  return `#!/bin/sh\n${SHIM_SIGNATURE}\nnode="${nodePath}"\n[ -x "$node" ] || node=node\nexec "$node" "${cliPath}" "$@"\n`;
}

export function isManagedShim(text: string | undefined): boolean {
  return text !== undefined && text.split("\n")[1] === SHIM_SIGNATURE;
}

// The recorded node and CLI paths of a managed shim.
export function shimPaths(text: string): { node?: string; cli?: string } {
  const node = /^node="([^"]*)"$/m.exec(text)?.[1];
  const cli = /^exec "\$node" "([^"]*)"/m.exec(text)?.[1];
  return { ...(node === undefined ? {} : { node }), ...(cli === undefined ? {} : { cli }) };
}

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

// Appends the missing lines and never removes one.
export function withGitignoreLines(text: string | undefined): string {
  const current = text ?? "";
  const present = new Set(splitLines(current).map((line) => line.trim()));
  const missing = OMT_GITIGNORE_LINES.filter((line) => !present.has(line));
  if (missing.length === 0) return current;
  const prefix = current === "" || current.endsWith("\n") ? current : `${current}\n`;
  return `${prefix}${missing.join("\n")}\n`;
}

export interface GitExclude {
  path?: string; // the exclude file, when the root is inside a repository
  top?: string; // the repository top level: the directory that holds `.git`
  note?: string; // why there is no path
}

async function dotGitKind(path: string): Promise<"dir" | "file" | undefined> {
  try {
    return (await stat(path)).isDirectory() ? "dir" : "file";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
}

// Finds `info/exclude` without running git. Walks up from the root to the nearest `.git`, which is a
// directory or a file with `gitdir: <path>` (a worktree or a submodule).
export async function findGitExclude(root: string): Promise<GitExclude> {
  let top = resolve(root);
  let kind = await dotGitKind(join(top, ".git"));
  while (kind === undefined) {
    const parent = dirname(top);
    if (parent === top) return { note: `${root} has no .git, and no parent directory has one; git exclude skipped` };
    top = parent;
    kind = await dotGitKind(join(top, ".git"));
  }
  const dotGit = join(top, ".git");
  if (kind === "dir") return { path: join(dotGit, "info", "exclude"), top };
  const text = (await readFileIfExists(dotGit)) ?? "";
  const match = /^gitdir:\s*(.+?)\s*$/m.exec(text);
  if (match === null || match[1] === undefined) return { note: `${dotGit} has no gitdir line; git exclude skipped` };
  const gitDir = resolve(top, match[1]);
  const commonDir = (await readFileIfExists(join(gitDir, "commondir")))?.trim();
  const common = commonDir === undefined || commonDir === "" ? gitDir : resolve(gitDir, commonDir);
  return { path: join(common, "info", "exclude"), top };
}

// Puts a backslash before each character that git reads as a glob, and before trailing spaces.
// A pattern always starts with "/", so a leading "!" or "#" cannot occur.
function escapeGlob(text: string): string {
  const escaped = text.replace(/[\\[\]*?]/g, (char) => `\\${char}`);
  return escaped.replace(/ +$/, (spaces) => "\\ ".repeat(spaces.length));
}

// The pattern for `path`, anchored at the repository top level, with glob characters escaped.
export function excludePattern(top: string, path: string, dir = false): string {
  const rel = relative(top, path).split(sep).join("/");
  return `/${escapeGlob(rel)}${dir ? "/" : ""}`;
}

// Matches the scratch directories of an install or uninstall run next to the agents root.
export function scratchPattern(top: string, agentsRoot: string): string {
  return `${excludePattern(top, dirname(agentsRoot), true)}.omt-*/`;
}

export const SCRATCH_NAME = /^\.omt-(?:tmp|old)-[0-9a-f]+$/;

// The block of one root runs from its BEGIN marker to the next END marker of the same root. A BEGIN
// marker without an END marker is no block, so no edit ever runs to the end of the file.
function blockRange(lines: string[], root: string): [number, number] | undefined {
  const begin = excludeBegin(root);
  const end = excludeEnd(root);
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] !== end) continue;
    const start = lines.lastIndexOf(begin, index - 1);
    if (start !== -1) return [start, index];
  }
  return undefined;
}

export function excludeBlockLines(text: string | undefined, root: string): string[] | undefined {
  const lines = splitLines(text ?? "");
  const range = blockRange(lines, root);
  return range === undefined ? undefined : lines.slice(range[0] + 1, range[1]);
}

// The roots of every complete block in the file.
export function excludeBlockRoots(text: string | undefined): string[] {
  const prefix = "# >>> oh-my-t3code project install: ";
  const roots = new Set<string>();
  for (const line of splitLines(text ?? "")) {
    if (!line.startsWith(prefix) || !line.endsWith(" >>>")) continue;
    const root = line.slice(prefix.length, -" >>>".length);
    if (excludeBlockLines(text, root) !== undefined) roots.add(root);
  }
  return [...roots];
}

function removeBlocks(lines: string[], roots: string[]): { removed: boolean; removedLast: boolean } {
  let removed = false;
  let removedLast = false;
  for (const root of roots) {
    for (let range = blockRange(lines, root); range !== undefined; range = blockRange(lines, root)) {
      if (range[1] === lines.length - 1) removedLast = true;
      lines.splice(range[0], range[1] - range[0] + 1);
      removed = true;
    }
  }
  return { removed, removedLast };
}

// Replaces the root's block in place, or the block of a stale root (an old path of the same
// project), or appends a new block. Other blocks of the stale roots go. Every other line stays.
export function withExcludeBlock(text: string | undefined, root: string, entries: string[], stale: string[] = []): string {
  const current = text ?? "";
  const block = [excludeBegin(root), ...entries, excludeEnd(root)];
  const lines = splitLines(current);
  let range = blockRange(lines, root);
  for (const other of stale) range ??= blockRange(lines, other);
  if (range === undefined) {
    const prefix = current === "" || current.endsWith("\n") ? current : `${current}\n`;
    return `${prefix}${block.join("\n")}\n`;
  }
  lines.splice(range[0], range[1] - range[0] + 1, ...block);
  removeBlocks(lines, stale.filter((other) => other !== root));
  return `${lines.join("\n")}${current.endsWith("\n") ? "\n" : ""}`;
}

// Removes the blocks of the given roots. When the last block of the file goes and the install added
// the newline before it (`addedNewline`), that newline goes too, so the file gets its old bytes back.
export function withoutExcludeBlocks(text: string, roots: string[], addedNewline = false): string {
  const lines = splitLines(text);
  const { removed, removedLast } = removeBlocks(lines, roots);
  if (!removed) return text;
  if (lines.length === 0) return "";
  const finalNewline = removedLast ? !addedNewline : text.endsWith("\n");
  return `${lines.join("\n")}${finalNewline ? "\n" : ""}`;
}

export function withoutExcludeBlock(text: string, root: string, addedNewline = false): string {
  return withoutExcludeBlocks(text, [root], addedNewline);
}
