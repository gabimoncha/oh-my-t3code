import { mkdirSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claudeConfigDir,
  claudeSettingsPath,
  configDir,
  evidenceDir,
  findProjectRoot,
  ledgerPath,
  manifestPath,
  omtDir,
  plansDir,
  projectConfigPath,
  projectRolesDir,
  skillRoots,
  t3HomeDir,
  t3SettingsPath,
  userConfigPath,
  userRolesDir,
} from "../src/paths.ts";
import { tempDir } from "./helpers.ts";

const HOME = "/fake/home";

test("configDir prefers OMT_CONFIG_DIR, then XDG_CONFIG_HOME, then ~/.config", () => {
  assert.equal(configDir({ OMT_CONFIG_DIR: "/omt", XDG_CONFIG_HOME: "/xdg" }, HOME), "/omt");
  assert.equal(configDir({ XDG_CONFIG_HOME: "/xdg" }, HOME), "/xdg/oh-my-t3code");
  assert.equal(configDir({}, HOME), "/fake/home/.config/oh-my-t3code");
  assert.equal(configDir({ OMT_CONFIG_DIR: "", XDG_CONFIG_HOME: "" }, HOME), "/fake/home/.config/oh-my-t3code");
});

test("user config files live in the config directory", () => {
  assert.equal(userConfigPath({}, HOME), "/fake/home/.config/oh-my-t3code/config.jsonc");
  assert.equal(manifestPath({}, HOME), "/fake/home/.config/oh-my-t3code/install.json");
  assert.equal(userRolesDir({}, HOME), "/fake/home/.config/oh-my-t3code/roles");
  assert.equal(userConfigPath({ OMT_CONFIG_DIR: "/omt" }, HOME), "/omt/config.jsonc");
  assert.equal(manifestPath({ OMT_CONFIG_DIR: "/omt" }, HOME), "/omt/install.json");
  assert.equal(userRolesDir({ OMT_CONFIG_DIR: "/omt" }, HOME), "/omt/roles");
});

test("project paths live under <root>/.omt", () => {
  assert.equal(omtDir("/repo"), "/repo/.omt");
  assert.equal(projectConfigPath("/repo"), "/repo/.omt/config.jsonc");
  assert.equal(projectRolesDir("/repo"), "/repo/.omt/roles");
  assert.equal(plansDir("/repo"), "/repo/.omt/plans");
  assert.equal(ledgerPath("/repo"), "/repo/.omt/ledger.jsonl");
  assert.equal(evidenceDir("/repo"), "/repo/.omt/evidence");
});

test("claude paths honor CLAUDE_CONFIG_DIR", () => {
  assert.equal(claudeConfigDir({}, HOME), "/fake/home/.claude");
  assert.equal(claudeConfigDir({ CLAUDE_CONFIG_DIR: "/cc" }, HOME), "/cc");
  assert.equal(claudeSettingsPath({}, HOME), "/fake/home/.claude/settings.json");
  assert.equal(claudeSettingsPath({ CLAUDE_CONFIG_DIR: "/cc" }, HOME), "/cc/settings.json");
});

test("skillRoots uses the agents, claude, and gemini roots", () => {
  assert.deepEqual(skillRoots({}, HOME), {
    agents: "/fake/home/.agents/skills",
    claude: "/fake/home/.claude/skills",
    gemini: "/fake/home/.gemini/config/skills",
  });
  assert.equal(skillRoots({ CLAUDE_CONFIG_DIR: "/cc" }, HOME).claude, "/cc/skills");
});

test("t3 paths honor T3CODE_HOME", () => {
  assert.equal(t3HomeDir({}, HOME), "/fake/home/.t3");
  assert.equal(t3HomeDir({ T3CODE_HOME: "/t3" }, HOME), "/t3");
  assert.equal(t3SettingsPath({}, HOME), "/fake/home/.t3/userdata/settings.json");
  assert.equal(t3SettingsPath({ T3CODE_HOME: "/t3" }, HOME), "/t3/userdata/settings.json");
});

test("findProjectRoot finds the nearest ancestor with .git or .omt", (t) => {
  const root = tempDir(t);
  const repo = join(root, "repo");
  const deep = join(repo, "a", "b");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(deep, { recursive: true });
  assert.equal(findProjectRoot(deep), repo);
  assert.equal(findProjectRoot(repo), repo);

  mkdirSync(join(repo, "a", ".omt"));
  assert.equal(findProjectRoot(deep), join(repo, "a"));
});

test("findProjectRoot accepts .git as a file, as in a worktree", (t) => {
  const root = tempDir(t);
  const worktree = join(root, "wt");
  mkdirSync(join(worktree, "src"), { recursive: true });
  writeFileSync(join(worktree, ".git"), "gitdir: /elsewhere/.git/worktrees/wt\n");
  assert.equal(findProjectRoot(join(worktree, "src")), worktree);
});

test("findProjectRoot returns cwd when no marker exists", (t) => {
  const root = tempDir(t);
  const dir = join(root, "plain", "dir");
  mkdirSync(dir, { recursive: true });
  const found = findProjectRoot(dir);
  // On some machines the temp directory sits inside a repository; then the root is above `root`.
  assert.ok(found === dir || root.startsWith(`${found}${sep}`), found);
});
