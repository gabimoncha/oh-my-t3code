import { cp, lstat, readlink, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { ensureDir, pathExists } from "../util/fs.ts";

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

// Resolves the nearest existing ancestor with realpath and appends the rest, so a missing
// path under a symlinked directory still compares equal to its real location.
export async function resolveReal(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch (error) {
    const code = errorCode(error);
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
  }
  try {
    if ((await lstat(absolute)).isSymbolicLink()) {
      return resolveReal(resolve(dirname(absolute), await readlink(absolute)));
    }
  } catch (error) {
    const code = errorCode(error);
    if (code !== "ENOENT" && code !== "ENOTDIR" && code !== "ELOOP") throw error;
  }
  const parent = dirname(absolute);
  if (parent === absolute) return absolute;
  return join(await resolveReal(parent), basename(absolute));
}

// The real path that a write to `path` lands on. A dangling symlink resolves to its target.
export async function writeTargetFor(path: string): Promise<string> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      try {
        return await realpath(path);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
        return resolveReal(resolve(dirname(path), await readlink(path)));
      }
    }
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  return path;
}

export async function movePath(source: string, target: string): Promise<void> {
  await ensureDir(dirname(target));
  try {
    await rename(source, target);
  } catch (error) {
    if (errorCode(error) !== "EXDEV") throw error;
    await cp(source, target, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
    await rm(source, { recursive: true, force: true });
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function backupStamp(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

// Picks `<configDir>/backups/<stamp>`, with a numeric suffix when a run in the same second already used it.
export async function newBackupDir(configDir: string, date: Date): Promise<string> {
  const base = join(configDir, "backups", backupStamp(date));
  let candidate = base;
  for (let n = 1; await pathExists(candidate); n += 1) candidate = `${base}-${n}`;
  return candidate;
}
