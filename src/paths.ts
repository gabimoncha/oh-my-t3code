import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export type Env = Record<string, string | undefined>;

export interface SkillRoots {
  agents: string;
  claude: string;
  gemini: string;
}

function envPath(env: Env, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === "" ? undefined : value;
}

export function configDir(env: Env, homedir: string): string {
  const explicit = envPath(env, "OMT_CONFIG_DIR");
  if (explicit !== undefined) return explicit;
  const xdg = envPath(env, "XDG_CONFIG_HOME");
  if (xdg !== undefined) return join(xdg, "oh-my-t3code");
  return join(homedir, ".config", "oh-my-t3code");
}

export function userConfigPath(env: Env, homedir: string): string {
  return join(configDir(env, homedir), "config.jsonc");
}

export function manifestPath(env: Env, homedir: string): string {
  return join(configDir(env, homedir), "install.json");
}

export function userRolesDir(env: Env, homedir: string): string {
  return join(configDir(env, homedir), "roles");
}

// The main checkout of a linked worktree, read from `<root>/.git` and `commondir` without running git.
// Undefined for a normal checkout, a submodule, a bare or unknown layout, or any read error.
export function mainCheckoutOf(root: string): string | undefined {
  try {
    const dotGit = join(root, ".git");
    if (!lstatSync(dotGit).isFile()) return undefined;
    const first = readFileSync(dotGit, "utf8").split(/\r?\n/, 1)[0] ?? "";
    const match = /^gitdir:\s*(.+?)\s*$/.exec(first);
    if (match === null || match[1] === undefined) return undefined;
    const gitDir = resolve(root, match[1]);
    const commonDir = readFileSync(join(gitDir, "commondir"), "utf8").trim();
    if (commonDir === "") return undefined;
    const common = resolve(gitDir, commonDir);
    if (basename(common) !== ".git" || !statSync(common).isDirectory()) return undefined;
    return isBareRepo(common) ? undefined : dirname(common);
  } catch {
    return undefined;
  }
}

// Reads the plain `bare = true` form that git writes. Hand-edited forms (quoted values, repeated
// keys, an entry on the section line) are not supported. A missing config counts as not bare,
// because git treats such a common dir as a checkout.
function isBareRepo(commonDir: string): boolean {
  const config = join(commonDir, "config");
  if (!existsSync(config)) return false;
  let core = false;
  for (const raw of readFileSync(config, "utf8").split(/\r?\n/)) {
    const line = raw.replace(/[;#].*$/, "").trim();
    const section = /^\[(.*)\]/.exec(line);
    if (section !== null) {
      core = section[1]?.trim().toLowerCase() === "core";
      continue;
    }
    if (!core) continue;
    const entry = /^bare\s*(?:=\s*(.*))?$/i.exec(line);
    if (entry !== null) return entry[1] === undefined || /^(true|yes|on|1)$/i.test(entry[1].trim());
  }
  return false;
}

export function hasProjectMarker(cwd: string): boolean {
  return nearestMarker(cwd) !== undefined;
}

function nearestMarker(cwd: string): string | undefined {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, ".omt")) || existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

// git writes `gitdir:` as a real path. Rebuilding the main checkout under the nearest ancestor of
// the worktree whose real path contains it keeps the root that a main-checkout cwd gives, such as
// /var instead of /private/var, so both find the same project root string.
function underLogicalAncestor(worktree: string, main: string): string {
  let dir = worktree;
  for (;;) {
    try {
      const rel = relative(realpathSync(dir), main);
      if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return join(dir, rel);
    } catch {
      return main;
    }
    const parent = dirname(dir);
    if (parent === dir) return main;
    dir = parent;
  }
}

// A linked worktree resolves to its main checkout, so all worktrees share one .omt.
export function findProjectRoot(cwd: string): string {
  const dir = nearestMarker(cwd);
  if (dir === undefined) return resolve(cwd);
  const main = mainCheckoutOf(dir);
  return main === undefined ? dir : underLogicalAncestor(dir, main);
}

// A linked worktree whose own .omt holds plans or a ledger that omt no longer reads.
export function shadowedWorktreeState(cwd: string): { worktree: string; main: string } | undefined {
  const worktree = nearestMarker(cwd);
  if (worktree === undefined) return undefined;
  const found = mainCheckoutOf(worktree);
  if (found === undefined) return undefined;
  const main = underLogicalAncestor(worktree, found);
  const own = omtDir(worktree);
  let plans = false;
  try {
    plans = readdirSync(join(own, "plans"), { withFileTypes: true }).some(
      (entry) => entry.isFile() && entry.name.endsWith(".md"),
    );
  } catch {
    // No plans directory.
  }
  if (!plans && !isFile(join(own, "ledger.jsonl"))) return undefined;
  return { worktree, main };
}

function isFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

export function omtDir(root: string): string {
  return join(root, ".omt");
}

export function projectConfigPath(root: string): string {
  return join(omtDir(root), "config.jsonc");
}

export function projectRolesDir(root: string): string {
  return join(omtDir(root), "roles");
}

export function plansDir(root: string): string {
  return join(omtDir(root), "plans");
}

export function ledgerPath(root: string): string {
  return join(omtDir(root), "ledger.jsonl");
}

export function evidenceDir(root: string): string {
  return join(omtDir(root), "evidence");
}

export function projectManifestPath(root: string): string {
  return join(omtDir(root), "install.json");
}

export function projectShimPath(root: string): string {
  return join(omtDir(root), "bin", "omt");
}

export function projectSkillRoots(root: string): { agents: string; claude: string } {
  return { agents: join(root, ".agents", "skills"), claude: join(root, ".claude", "skills") };
}

export function projectClaudeSettingsPath(root: string): string {
  return join(root, ".claude", "settings.local.json");
}

export function claudeConfigDir(env: Env, homedir: string): string {
  return envPath(env, "CLAUDE_CONFIG_DIR") ?? join(homedir, ".claude");
}

export function skillRoots(env: Env, homedir: string): SkillRoots {
  return {
    agents: join(homedir, ".agents", "skills"),
    claude: join(claudeConfigDir(env, homedir), "skills"),
    gemini: join(homedir, ".gemini", "config", "skills"),
  };
}

export function claudeSettingsPath(env: Env, homedir: string): string {
  return join(claudeConfigDir(env, homedir), "settings.json");
}

export function t3HomeDir(env: Env, homedir: string): string {
  return envPath(env, "T3CODE_HOME") ?? join(homedir, ".t3");
}

export function t3SettingsPath(env: Env, homedir: string): string {
  return join(t3HomeDir(env, homedir), "userdata", "settings.json");
}
