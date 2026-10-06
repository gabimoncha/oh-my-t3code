import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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

export function findProjectRoot(cwd: string): string {
  const start = resolve(cwd);
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, ".omt")) || existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
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
