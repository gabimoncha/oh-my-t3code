import { createHash, randomBytes } from "node:crypto";
import { chmod, cp, lstat, mkdir, readFile, readdir, readlink, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export const MANAGED_MARKER = ".omt-managed.json";

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export function tempPathFor(target: string): string {
  return join(dirname(target), `.${basename(target)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
}

async function existingMode(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mode & 0o7777;
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

// Keeps the mode of a file it replaces, so a 0600 file never becomes world-readable. `mode` applies to a new file.
export async function writeFileAtomic(path: string, data: string | Uint8Array, options: { mode?: number } = {}): Promise<void> {
  await ensureDir(dirname(path));
  const temp = tempPathFor(path);
  try {
    const mode = (await existingMode(path)) ?? options.mode;
    await writeFile(temp, data, mode === undefined ? undefined : { mode });
    if (mode !== undefined) await chmod(temp, mode);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export async function readFileIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

export async function isSymlink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

export async function copyDir(source: string, target: string): Promise<void> {
  await ensureDir(dirname(target));
  await cp(source, target, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
}

async function listFiles(root: string, relative: string, out: string[]): Promise<void> {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  for (const entry of entries) {
    const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      await listFiles(root, path, out);
    } else if (path !== MANAGED_MARKER && entry.name !== ".DS_Store") {
      out.push(path);
    }
  }
}

// Each file is framed as path, NUL, byte length, NUL, content so that two different trees cannot hash alike.
export async function hashDir(dir: string): Promise<string> {
  const files: string[] = [];
  await listFiles(dir, "", files);
  files.sort();
  const hash = createHash("sha256");
  for (const file of files) {
    const full = join(dir, file);
    const content = (await lstat(full)).isSymbolicLink()
      ? Buffer.from(`symlink:${await readlink(full)}`)
      : await readFile(full);
    hash.update(`${file}\0${content.length}\0`);
    hash.update(content);
  }
  return hash.digest("hex");
}
