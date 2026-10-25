import { randomBytes } from "node:crypto";
import { lstat, mkdir, readdir, rename, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { OmtError } from "../util/errors.ts";
import { ensureDir, errorCode, readFileIfExists, realOrSelf, tempPathFor, writeFileAtomic } from "../util/fs.ts";
import { isRecord } from "../util/json.ts";

export interface ProjectEntry {
  root: string;
  addedAt: string;
}

function invalid(path: string, reason: string): OmtError {
  return new OmtError("projects_invalid", `${path} is not a valid project list: ${reason}`, {
    hint: `delete ${path}; omt install --project adds each project again`,
  });
}

export async function readProjects(path: string): Promise<ProjectEntry[]> {
  const text = await readFileIfExists(path);
  if (text === undefined) return [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw invalid(path, "the file is not valid JSON");
  }
  if (!isRecord(data) || data.version !== 1 || !Array.isArray(data.projects)) {
    throw invalid(path, 'expected { "version": 1, "projects": [...] }');
  }
  return data.projects.map((entry) => {
    if (!isRecord(entry) || typeof entry.root !== "string" || typeof entry.addedAt !== "string") {
      throw invalid(path, "each project needs a root and an addedAt string");
    }
    return { root: entry.root, addedAt: entry.addedAt };
  });
}

async function writeProjects(path: string, projects: ProjectEntry[]): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify({ version: 1, projects }, null, 2)}\n`);
}

function sameRoot(a: string, b: string): boolean {
  return a === b || realOrSelf(a) === realOrSelf(b);
}

const LOCK_TIMEOUT_MS = 5_000;
const LOCK_STALE_MS = 30_000;
// Rename errors that mean the lock path is taken. Windows gives EPERM when the rename would replace a directory.
const LOCK_HELD = new Set(["ENOTEMPTY", "EEXIST", "ENOTDIR", "EPERM"]);

function isStale(mtimeMs: number): boolean {
  return Date.now() - mtimeMs > LOCK_STALE_MS;
}

// The lock is a directory with one file named after the owner's random token, and a rename publishes both at once.
// Only an unlink of a token file by name and an rmdir of an empty directory remove a lock, so no caller can remove
// a lock that another caller took after its check. An empty lock directory is free.
async function withProjectsLock<T>(path: string, action: () => Promise<T>): Promise<T> {
  const lock = `${path}.lock`;
  const token = randomBytes(16).toString("hex");
  const staged = tempPathFor(lock);
  await ensureDir(dirname(path));
  await mkdir(staged);
  try {
    await writeFile(join(staged, token), "");
    await acquireLock(lock, staged, path);
  } catch (error) {
    await rm(staged, { recursive: true, force: true });
    throw error;
  }
  try {
    return await action();
  } finally {
    await releaseLock(lock, token);
  }
}

async function acquireLock(lock: string, staged: string, path: string): Promise<void> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (let delay = 10; ; delay = Math.min(delay * 2, 200)) {
    try {
      await rename(staged, lock);
      return;
    } catch (error) {
      if (!LOCK_HELD.has(errorCode(error) ?? "")) throw error;
    }
    await breakStaleLock(lock);
    if (Date.now() >= deadline) {
      throw new OmtError("projects_locked", `${lock} is held by another process`, {
        hint: `another omt command is updating ${path}; run the command again`,
      });
    }
    await sleep(delay);
  }
}

async function breakStaleLock(lock: string): Promise<void> {
  const info = await lstat(lock).catch(() => undefined);
  if (info === undefined) return;
  if (!info.isDirectory()) {
    // omt never makes the lock a file or a link, and unlink cannot remove a lock directory that replaced this one.
    if (isStale(info.mtimeMs)) await unlink(lock).catch(() => undefined);
    return;
  }
  for (const name of await readdir(lock).catch(() => [])) {
    const file = join(lock, name);
    const entry = await lstat(file).catch(() => undefined);
    if (entry !== undefined && isStale(entry.mtimeMs)) await unlink(file).catch(() => undefined);
  }
  await rmdir(lock).catch(() => undefined);
}

async function releaseLock(lock: string, token: string): Promise<void> {
  try {
    await unlink(join(lock, token));
  } catch (error) {
    // The lock went stale and another caller broke it, so the lock at this path is not ours.
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return;
    throw error;
  }
  // A failure leaves an empty directory, which is free, or the lock of a caller that renamed onto it.
  await rmdir(lock).catch(() => undefined);
}

export async function addProject(path: string, root: string, now: Date): Promise<void> {
  await withProjectsLock(path, async () => {
    const projects = await readProjects(path);
    if (projects.some((entry) => sameRoot(entry.root, root))) return;
    await writeProjects(path, [...projects, { root, addedAt: now.toISOString() }]);
  });
}

export async function removeProjects(path: string, roots: string[]): Promise<void> {
  await withProjectsLock(path, async () => {
    const projects = await readProjects(path);
    const kept = projects.filter((entry) => !roots.some((root) => sameRoot(entry.root, root)));
    if (kept.length !== projects.length) await writeProjects(path, kept);
  });
}

// Install and uninstall already changed the project files, so a project list error must not change their result.
export function projectsWarning(error: unknown): string {
  if (error instanceof OmtError && (error.code === "projects_invalid" || error.code === "projects_locked")) {
    return `warning: ${error.message}\n${error.hint === undefined ? "" : `hint: ${error.hint}\n`}`;
  }
  throw error;
}
