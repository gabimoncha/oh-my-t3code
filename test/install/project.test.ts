import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { PROJECT_STARTER_CONFIG } from "../../src/config/starter.ts";
import type { DoctorReport } from "../../src/install/doctor.ts";
import {
  excludeBegin,
  excludeEnd,
  excludePattern,
  findGitExclude,
  withExcludeBlock,
  withGitignoreLines,
  withoutExcludeBlock,
  withoutExcludeBlocks,
} from "../../src/install/project.ts";
import { detectJsonStyle } from "../../src/install/claudeHook.ts";
import { MANAGED_MARKER } from "../../src/util/fs.ts";
import { childEnv, CLI_PATH, gitRepo } from "../helpers.ts";
import { makeFixture, readJson, snapshot, STAMP } from "./fixture.ts";
import type { Fixture } from "./fixture.ts";

const GIT_EXCLUDE_DEFAULT = "# git ls-files --others --exclude-from=.git/info/exclude\n# *~\n";

interface ProjectFixture extends Fixture {
  project: string;
  exclude: string;
}

// A fixture whose project is a git repository with the default info/exclude.
function projectFixture(t: TestContext, git = true): ProjectFixture {
  const f = makeFixture(t);
  const project = join(f.root, "project");
  const exclude = join(project, ".git", "info", "exclude");
  if (git) {
    mkdirSync(join(project, ".git", "info"), { recursive: true });
    writeFileSync(exclude, GIT_EXCLUDE_DEFAULT);
  }
  return { ...f, project, exclude };
}

function actionLines(output: string): string[] {
  return output
    .split("\n")
    .filter((line) => /^ {2}\S/.test(line))
    .map((line) => line.trim().split(/\s+/)[0] ?? "")
    .filter((action) => action !== "none");
}

function block(root: string, ...entries: string[]): string {
  return [excludeBegin(root), ...entries, excludeEnd(root)].join("\n");
}

const SKILL_ENTRIES = [
  "/.agents/skills/alpha/",
  "/.agents/skills/beta/",
  "/.claude/skills/alpha",
  "/.claude/skills/beta",
  "/.agents/.omt-*/",
  "/.omt/bin/",
  "/.omt/install.json",
  "/.omt/backups/",
];

// The entries for the files in .omt that an install created.
const CREATED_OMT = ["/.omt/config.jsonc", "/.omt/.gitignore"];

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

test("install --project writes copies, relative links, config, shim, .gitignore, manifest, and exclude block", async (t) => {
  const f = projectFixture(t);
  const { code, ctx } = await f.run(["install", "--project", "--yes"]);
  assert.equal(code, 0, ctx.err());

  for (const name of ["alpha", "beta"]) {
    assert.ok(existsSync(join(f.project, ".agents", "skills", name, MANAGED_MARKER)));
    const link = join(f.project, ".claude", "skills", name);
    assert.ok(lstatSync(link).isSymbolicLink());
    assert.equal(readlinkSync(link), `../../.agents/skills/${name}`);
    assert.equal(realpathSync(link), realpathSync(join(f.project, ".agents", "skills", name)));
  }
  assert.equal(readFileSync(join(f.project, ".omt", "config.jsonc"), "utf8"), PROJECT_STARTER_CONFIG);
  assert.ok(statSync(join(f.project, ".omt", "plans")).isDirectory());
  assert.equal(
    readFileSync(join(f.project, ".omt", ".gitignore"), "utf8"),
    "ledger.jsonl\nevidence/\nbin/\ninstall.json\nbackups/\nplans/\n",
  );

  const shim = join(f.project, ".omt", "bin", "omt");
  assert.equal(
    readFileSync(shim, "utf8"),
    `#!/bin/sh\n# oh-my-t3code project shim\nnode="${process.execPath}"\n[ -x "$node" ] || node=node\nexec "$node" "${CLI_PATH}" "$@"\n`,
  );
  assert.equal(statSync(shim).mode & 0o777, 0o755);

  const manifest = readJson(join(f.project, ".omt", "install.json"));
  assert.equal(manifest.scope, "project");
  assert.equal(manifest.root, f.project);
  assert.equal(manifest.skillsRoot, join(f.project, ".agents", "skills"));
  assert.deepEqual(manifest.config, { path: join(f.project, ".omt", "config.jsonc"), created: true });
  const omt = join(f.project, ".omt");
  assert.deepEqual(manifest.project, {
    omtDirCreated: true,
    settingsCreated: false,
    shim,
    gitExclude: f.exclude,
    excludeFile: { created: false, dirCreated: false, addedNewline: false },
    files: [
      { path: join(omt, ".gitignore"), sha256: sha256("ledger.jsonl\nevidence/\nbin/\ninstall.json\nbackups/\nplans/\n") },
      { path: join(omt, "config.jsonc"), sha256: sha256(PROJECT_STARTER_CONFIG) },
    ],
    dirs: [omt, join(omt, "plans"), join(omt, "bin"), ...[".agents", ".agents/skills", ".claude", ".claude/skills"].map((dir) => join(f.project, dir))],
  });

  assert.equal(readFileSync(f.exclude, "utf8"), `${GIT_EXCLUDE_DEFAULT}${block(f.project, ...SKILL_ENTRIES, ...CREATED_OMT)}\n`);
  assert.deepEqual(snapshot(f.home), { "": "dir" }, "the home directory stays untouched");

  const again = await f.run(["install", "--project", "--yes"]);
  assert.equal(again.code, 0, again.ctx.err());
  assert.deepEqual([...new Set(actionLines(again.ctx.out()))], ["unchanged"]);
  assert.match(again.ctx.out(), /Everything is up to date\./);
});

test("install --project --dry-run writes nothing", async (t) => {
  const f = projectFixture(t);
  const before = snapshot(f.root);
  const { code, ctx } = await f.run(["install", "--project", "--hooks", "--dry-run"]);
  assert.equal(code, 0, ctx.err());
  assert.match(ctx.out(), /create {3}.*\.omt[/\\]bin[/\\]omt/);
  assert.match(ctx.out(), /create {3}managed block in /);
  assert.deepEqual(snapshot(f.root), before);
});

test("findGitExclude handles a .git directory, a worktree .git file with commondir, and no .git", async (t) => {
  const f = projectFixture(t);
  assert.deepEqual(await findGitExclude(f.project), { path: f.exclude, top: f.project });

  const main = join(f.root, "main-repo", ".git");
  const worktree = join(f.root, "wt");
  mkdirSync(join(main, "worktrees", "wt"), { recursive: true });
  mkdirSync(worktree, { recursive: true });
  writeFileSync(join(main, "worktrees", "wt", "commondir"), "../..\n");
  writeFileSync(join(worktree, ".git"), `gitdir: ${join(main, "worktrees", "wt")}\n`);
  assert.deepEqual(await findGitExclude(worktree), { path: join(main, "info", "exclude"), top: worktree });

  const noCommon = join(f.root, "wt2");
  mkdirSync(join(f.root, "gitdir2"), { recursive: true });
  mkdirSync(noCommon, { recursive: true });
  writeFileSync(join(noCommon, ".git"), "gitdir: ../gitdir2\n");
  assert.deepEqual(await findGitExclude(noCommon), { path: join(f.root, "gitdir2", "info", "exclude"), top: noCommon });

  const plain = join(f.root, "plain");
  mkdirSync(plain);
  const none = await findGitExclude(plain);
  assert.equal(none.path, undefined);
  assert.match(none.note ?? "", /no \.git/);
});

test("install --project in a worktree installs into the main checkout and its exclude file", async (t) => {
  const f = projectFixture(t, false);
  const mainRepo = join(f.root, "main-repo");
  const main = join(mainRepo, ".git");
  mkdirSync(join(main, "worktrees", "project"), { recursive: true });
  writeFileSync(join(main, "worktrees", "project", "commondir"), "../..\n");
  writeFileSync(join(f.project, ".git"), `gitdir: ${join(main, "worktrees", "project")}\n`);
  const { code, ctx } = await f.run(["install", "--project", "--yes"]);
  assert.equal(code, 0, ctx.err());
  assert.equal(readFileSync(join(main, "info", "exclude"), "utf8"), `${block(mainRepo, ...SKILL_ENTRIES, ...CREATED_OMT)}\n`);
  assert.ok(existsSync(join(mainRepo, ".omt", "install.json")));
  assert.deepEqual(readdirSync(f.project), [".git"], "the worktree gets no files");
});

test("the exclude block replaces an older block and keeps every other line", async (t) => {
  const f = projectFixture(t);
  writeFileSync(f.exclude, `first\n${block(f.project, "/old-entry")}\nlast\n`);
  const { code, ctx } = await f.run(["install", "--project", "--yes"]);
  assert.equal(code, 0, ctx.err());
  assert.match(ctx.out(), /update {3}managed block in /);
  assert.equal(readFileSync(f.exclude, "utf8"), `first\n${block(f.project, ...SKILL_ENTRIES, ...CREATED_OMT)}\nlast\n`);

  assert.equal(withExcludeBlock("a", "/r", ["/x"]), `a\n${block("/r", "/x")}\n`);
  assert.equal(withExcludeBlock(undefined, "/r", ["/x"]), `${block("/r", "/x")}\n`);
  assert.equal(withoutExcludeBlock(`a\n${block("/r", "/x")}\nb\n`, "/r"), "a\nb\n");
  assert.equal(withoutExcludeBlock(`a\n${block("/r", "/x")}\nb\n`, "/other"), `a\n${block("/r", "/x")}\nb\n`);
  assert.equal(withoutExcludeBlock("a\nb\n", "/r"), "a\nb\n");
});

test("install --project without .git prints a note and writes no block", async (t) => {
  const f = projectFixture(t, false);
  mkdirSync(join(f.project, ".omt"));
  const { code, ctx } = await f.run(["install", "--project", "--yes"]);
  assert.equal(code, 0, ctx.err());
  assert.match(ctx.out(), /skip {5}\(.*has no \.git, and no parent directory has one; git exclude skipped\)/);
  assert.match(ctx.out(), /^note: .*has no \.git/m);
  assert.ok(existsSync(join(f.project, ".omt", "bin", "omt")));
  assert.equal(readJson(join(f.project, ".omt", "install.json")).project !== undefined, true);
});

test("--no-git-exclude writes no block; it needs --project", async (t) => {
  const f = projectFixture(t);
  const { code, ctx } = await f.run(["install", "--project", "--no-git-exclude", "--yes"]);
  assert.equal(code, 0, ctx.err());
  assert.match(ctx.out(), /skip {5}\(--no-git-exclude\)/);
  assert.equal(readFileSync(f.exclude, "utf8"), GIT_EXCLUDE_DEFAULT);
  assert.equal((await f.run(["install", "--no-git-exclude", "--yes"])).code, 2);
});

test("created .omt files and /.claude/settings.local.json are excluded only when the install created them", async (t) => {
  const f = projectFixture(t);
  mkdirSync(join(f.project, ".omt"));
  mkdirSync(join(f.project, ".claude"));
  writeFileSync(join(f.project, ".claude", "settings.local.json"), '{ "theme": "dark" }\n');
  assert.equal((await f.run(["install", "--project", "--hooks", "--yes"])).code, 0);
  assert.equal(
    readFileSync(f.exclude, "utf8"),
    `${GIT_EXCLUDE_DEFAULT}${block(f.project, ...SKILL_ENTRIES, ...CREATED_OMT)}\n`,
  );
  const project = readJson(join(f.project, ".omt", "install.json")).project as Record<string, unknown>;
  assert.equal(project.omtDirCreated, false);
  assert.equal(project.settingsCreated, false);
  assert.deepEqual(
    project.dirs,
    [join(".omt", "plans"), join(".omt", "bin"), join(".omt", "backups"), ".agents", join(".agents", "skills"), join(".claude", "skills")].map((dir) => join(f.project, dir)),
  );

  const g = projectFixture(t);
  assert.equal((await g.run(["install", "--project", "--hooks", "--yes"])).code, 0);
  assert.equal(
    readFileSync(g.exclude, "utf8"),
    `${GIT_EXCLUDE_DEFAULT}${block(g.project, ...SKILL_ENTRIES, ...CREATED_OMT, "/.claude/settings.local.json")}\n`,
  );
  // A second run still knows that it created both paths.
  const again = await g.run(["install", "--project", "--hooks", "--yes"]);
  assert.deepEqual([...new Set(actionLines(again.ctx.out()))], ["unchanged"]);
});

test("--hooks --project edits only settings.local.json, and uninstall removes only the omt entry", async (t) => {
  const f = projectFixture(t);
  const local = join(f.project, ".claude", "settings.local.json");
  mkdirSync(join(f.project, ".claude"));
  const mine = { type: "command", command: "echo mine" };
  writeFileSync(local, JSON.stringify({ theme: "dark", hooks: { UserPromptSubmit: [{ hooks: [mine] }] } }, null, 2));
  const { code, ctx } = await f.run(["install", "--project", "--hooks", "--yes"]);
  assert.equal(code, 0, ctx.err());
  assert.ok(!existsSync(f.settings), "the user settings.json stays absent");
  assert.ok(!existsSync(join(f.project, ".claude", "settings.json")));
  const settings = readJson(local) as { theme: string; hooks: { UserPromptSubmit: { hooks: { command: string }[] }[] } };
  assert.equal(settings.hooks.UserPromptSubmit.length, 2);
  assert.match(settings.hooks.UserPromptSubmit[1]?.hooks[0]?.command ?? "", /hook user-prompt-submit # oh-my-t3code$/);

  const removed = await f.run(["uninstall", "--project", "--yes"]);
  assert.equal(removed.code, 0, removed.ctx.err());
  assert.deepEqual(readJson(local), { theme: "dark", hooks: { UserPromptSubmit: [{ hooks: [mine] }] } });
  assert.ok(!existsSync(join(f.project, ".omt", "backups")), "the install-time backup was restored and removed");
});

test("uninstall --project removes what the install added and keeps plans and the ledger", async (t) => {
  const f = projectFixture(t);
  assert.equal((await f.run(["install", "--project", "--hooks", "--yes"])).code, 0);
  writeFileSync(join(f.project, ".omt", "ledger.jsonl"), "{}\n");
  writeFileSync(join(f.project, ".omt", "plans", "demo.md"), "# demo\n");

  const { code, ctx } = await f.run(["uninstall", "--project", "--yes"]);
  assert.equal(code, 0, ctx.err());
  assert.deepEqual(ctx.out().match(/backup/g), null, "a created settings file holding only the omt entry is deleted without a backup");
  assert.match(ctx.out(), /keep {5}.*\.gitignore {2}\(keeps the ledger and evidence that stay out of git\)/);
  assert.match(ctx.out(), /keep {5}.*install\.json {2}\(records the created files that stay\)/);
  assert.equal(readFileSync(f.exclude, "utf8"), `${GIT_EXCLUDE_DEFAULT}${block(f.project, "/.omt/.gitignore", "/.omt/install.json")}\n`);
  assert.deepEqual(readdirSync(f.project).sort(), [".git", ".omt"]);
  assert.deepEqual(readdirSync(join(f.project, ".omt")).sort(), [".gitignore", "install.json", "ledger.jsonl", "plans"]);
  assert.deepEqual(readdirSync(join(f.project, ".omt", "plans")), ["demo.md"]);
  assert.deepEqual(snapshot(f.home), { "": "dir" });

  const g = projectFixture(t);
  assert.equal((await g.run(["install", "--project", "--hooks", "--yes"])).code, 0);
  assert.equal((await g.run(["uninstall", "--project", "--yes"])).code, 0);
  assert.deepEqual(readdirSync(g.project), [".git"]);
});

test("uninstall --project keeps an edited created file; --purge removes an edited created config", async (t) => {
  const f = projectFixture(t);
  assert.equal((await f.run(["install", "--project", "--yes"])).code, 0);
  const config = join(f.project, ".omt", "config.jsonc");
  const gitignore = join(f.project, ".omt", ".gitignore");
  writeFileSync(config, `${PROJECT_STARTER_CONFIG}// mine\n`);
  writeFileSync(gitignore, "mine\n");
  const kept = await f.run(["uninstall", "--project", "--yes"]);
  assert.equal(kept.code, 0, kept.ctx.err());
  assert.match(kept.ctx.out(), /keep {5}.*config\.jsonc {2}\(edited after the install; add --purge to remove it\)/);
  assert.match(kept.ctx.out(), /keep {5}.*\.gitignore {2}\(edited after the install\)/);
  assert.ok(existsSync(config));
  assert.ok(existsSync(gitignore));

  const g = projectFixture(t);
  assert.equal((await g.run(["install", "--project", "--yes"])).code, 0);
  writeFileSync(join(g.project, ".omt", "config.jsonc"), "{}\n");
  const purged = await g.run(["uninstall", "--project", "--purge", "--yes"]);
  assert.equal(purged.code, 0, purged.ctx.err());
  assert.deepEqual(readdirSync(g.project), [".git"]);
});

test("uninstall --project keeps a locally modified skill without --force", async (t) => {
  const f = projectFixture(t);
  assert.equal((await f.run(["install", "--project", "--yes"])).code, 0);
  writeFileSync(join(f.project, ".agents", "skills", "alpha", "SKILL.md"), "edited\n");
  const { code, ctx } = await f.run(["uninstall", "--project", "--yes"]);
  assert.equal(code, 0, ctx.err());
  assert.match(ctx.out(), /keep {5}.*alpha {2}\(locally modified\)/);
  assert.ok(existsSync(join(f.project, ".agents", "skills", "alpha", "SKILL.md")));
  assert.ok(lstatSync(join(f.project, ".claude", "skills", "alpha")).isSymbolicLink());
  assert.ok(!existsSync(join(f.project, ".agents", "skills", "beta")));

  const forced = await f.run(["uninstall", "--project", "--yes", "--force"]);
  assert.equal(forced.code, 0, forced.ctx.err());
  assert.ok(!existsSync(join(f.project, ".agents")));
  assert.ok(existsSync(join(f.project, ".omt", "backups", STAMP, "agents", "alpha", "SKILL.md")));
});

test("uninstall --project --purge removes the config only when the install created it", async (t) => {
  const f = projectFixture(t);
  assert.equal((await f.run(["install", "--project", "--yes"])).code, 0);
  writeFileSync(join(f.project, ".omt", "plans", "demo.md"), "# demo\n");
  const purged = await f.run(["uninstall", "--project", "--purge", "--yes"]);
  assert.equal(purged.code, 0, purged.ctx.err());
  assert.ok(!existsSync(join(f.project, ".omt", "config.jsonc")));
  assert.ok(existsSync(join(f.project, ".omt", "plans", "demo.md")));

  const g = projectFixture(t);
  mkdirSync(join(g.project, ".omt"));
  writeFileSync(join(g.project, ".omt", "config.jsonc"), '{ "version": 1 }\n');
  assert.equal((await g.run(["install", "--project", "--yes"])).code, 0);
  const kept = await g.run(["uninstall", "--project", "--purge", "--yes"]);
  assert.equal(kept.code, 0, kept.ctx.err());
  assert.match(kept.ctx.out(), /keep {5}.*config\.jsonc {2}\(not created by omt install\)/);
  assert.equal(readFileSync(join(g.project, ".omt", "config.jsonc"), "utf8"), '{ "version": 1 }\n');
});

test("--targets gemini with --project is a usage error, and a temp cliPath is refused", async (t) => {
  const f = projectFixture(t);
  const before = snapshot(f.root);
  const gemini = await f.run(["install", "--project", "--targets", "agents,gemini", "--yes"]);
  assert.equal(gemini.code, 2);
  assert.match(gemini.ctx.err(), /gemini target is not available with --project/);

  const temp = await f.run(["install", "--project", "--yes"], { cliPath: join(tmpdir(), "omt-x", "cli.js") });
  assert.equal(temp.code, 1);
  assert.match(temp.ctx.err(), /refusing --project: the omt CLI runs from a temporary path/);
  assert.match(temp.ctx.err(), /^hint: /m);
  assert.deepEqual(snapshot(f.root), before);
});

test("the shim: an unmanaged file conflicts, --force backs it up, and a changed managed shim updates", async (t) => {
  const f = projectFixture(t);
  const shim = join(f.project, ".omt", "bin", "omt");
  mkdirSync(join(f.project, ".omt", "bin"), { recursive: true });
  writeFileSync(shim, "#!/bin/sh\necho mine\n");
  const conflict = await f.run(["install", "--project", "--yes"]);
  assert.equal(conflict.code, 1);
  assert.match(conflict.ctx.out(), /conflict .*omt {2}\(exists and is not managed by omt\)/);

  const forced = await f.run(["install", "--project", "--yes", "--force"]);
  assert.equal(forced.code, 0, forced.ctx.err());
  assert.equal(readFileSync(join(f.project, ".omt", "backups", STAMP, "bin", "omt"), "utf8"), "#!/bin/sh\necho mine\n");
  assert.match(readFileSync(shim, "utf8"), /^# oh-my-t3code project shim$/m);

  const moved = await f.run(["install", "--project", "--yes"], { nodePath: "/opt/node/bin/node" });
  assert.equal(moved.code, 0, moved.ctx.err());
  assert.match(moved.ctx.out(), /update {3}.*\.omt[/\\]bin[/\\]omt/);
  assert.match(readFileSync(shim, "utf8"), /^node="\/opt\/node\/bin\/node"$/m);
});

test("a directory at the shim path is a conflict", async (t) => {
  const f = projectFixture(t);
  mkdirSync(join(f.project, ".omt", "bin", "omt"), { recursive: true });
  const { code, ctx } = await f.run(["install", "--project", "--yes"]);
  assert.equal(code, 1);
  assert.match(ctx.out(), /conflict .*omt {2}\(exists and is not a file\)/);
});

test("withGitignoreLines appends the missing lines and keeps the others", () => {
  assert.equal(withGitignoreLines(undefined), "ledger.jsonl\nevidence/\nbin/\ninstall.json\nbackups/\nplans/\n");
  assert.equal(withGitignoreLines("ledger.jsonl\nevidence/\nmine"), "ledger.jsonl\nevidence/\nmine\nbin/\ninstall.json\nbackups/\nplans/\n");
  const full = "x\nbackups/\nbin/\ninstall.json\nevidence/\nledger.jsonl\nplans/\n";
  assert.equal(withGitignoreLines(full), full);
});

test("install --project leaves an existing .omt/.gitignore alone; --no-git-exclude appends the missing lines", async (t) => {
  const f = projectFixture(t);
  mkdirSync(join(f.project, ".omt"));
  writeFileSync(join(f.project, ".omt", ".gitignore"), "ledger.jsonl\nevidence/\nnotes/\n");
  assert.equal((await f.run(["install", "--project", "--yes"])).code, 0);
  assert.equal(readFileSync(join(f.project, ".omt", ".gitignore"), "utf8"), "ledger.jsonl\nevidence/\nnotes/\n");
  assert.doesNotMatch(readFileSync(f.exclude, "utf8"), /\.gitignore/);

  const g = projectFixture(t);
  mkdirSync(join(g.project, ".omt"));
  writeFileSync(join(g.project, ".omt", ".gitignore"), "ledger.jsonl\nevidence/\nnotes/\n");
  assert.equal((await g.run(["install", "--project", "--no-git-exclude", "--yes"])).code, 0);
  assert.equal(
    readFileSync(join(g.project, ".omt", ".gitignore"), "utf8"),
    "ledger.jsonl\nevidence/\nnotes/\nbin/\ninstall.json\nbackups/\nplans/\n",
  );
});

const OLD_GITIGNORE = "ledger.jsonl\nevidence/\nbin/\ninstall.json\nbackups/\n";

function gitignoreRecord(manifest: Record<string, unknown>, gitignore: string): { path: string; sha256: string } | undefined {
  const project = manifest.project as { files: { path: string; sha256: string }[] };
  return project.files.find((file) => file.path === gitignore);
}

// Writes the .gitignore and manifest hash that an earlier install with five lines left.
function downgradeGitignore(f: ProjectFixture, text: string, recorded: string): void {
  const gitignore = join(f.project, ".omt", ".gitignore");
  writeFileSync(gitignore, text);
  const manifestPath = join(f.project, ".omt", "install.json");
  const manifest = readJson(manifestPath);
  const record = gitignoreRecord(manifest, gitignore);
  if (record !== undefined) record.sha256 = sha256(recorded);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

test("a reinstall appends plans/ to an unedited .omt/.gitignore that an earlier install created", async (t) => {
  const f = projectFixture(t);
  assert.equal((await f.run(["install", "--project", "--yes"])).code, 0);
  downgradeGitignore(f, OLD_GITIGNORE, OLD_GITIGNORE);
  const { code, ctx } = await f.run(["install", "--project", "--yes"]);
  assert.equal(code, 0, ctx.err());
  assert.match(ctx.out(), /update {3}.*\.gitignore/);
  const gitignore = join(f.project, ".omt", ".gitignore");
  assert.equal(readFileSync(gitignore, "utf8"), `${OLD_GITIGNORE}plans/\n`);
  const record = gitignoreRecord(readJson(join(f.project, ".omt", "install.json")), gitignore);
  assert.equal(record?.sha256, sha256(`${OLD_GITIGNORE}plans/\n`));
});

test("a reinstall leaves an edited .omt/.gitignore alone", async (t) => {
  const f = projectFixture(t);
  assert.equal((await f.run(["install", "--project", "--yes"])).code, 0);
  downgradeGitignore(f, `${OLD_GITIGNORE}mine\n`, OLD_GITIGNORE);
  assert.equal((await f.run(["install", "--project", "--yes"])).code, 0);
  assert.equal(readFileSync(join(f.project, ".omt", ".gitignore"), "utf8"), `${OLD_GITIGNORE}mine\n`);
});

async function doctor(f: Fixture, options = {}) {
  const { code, ctx } = await f.run(["doctor", "--project", "--json"], options);
  const report = JSON.parse(ctx.out()) as DoctorReport;
  return { code, report, status: (id: string) => report.checks.find((c) => c.id === id)?.status };
}

test("doctor --project checks the shim and the exclude block, and skips path and homes", async (t) => {
  const f = projectFixture(t);
  const empty = await doctor(f);
  assert.deepEqual(
    empty.report.checks.map((c) => c.id),
    ["node", "config", "skills", "links", "hooks", "shim", "exclude", "t3"],
  );
  assert.equal(empty.status("shim"), "WARN");
  assert.equal(empty.status("exclude"), "WARN");

  assert.equal((await f.run(["install", "--project", "--hooks", "--yes"])).code, 0);
  const ok = await doctor(f);
  assert.equal(ok.status("skills"), "PASS");
  assert.equal(ok.status("links"), "PASS");
  assert.equal(ok.status("hooks"), "PASS");
  assert.equal(ok.status("shim"), "PASS");
  assert.equal(ok.status("exclude"), "PASS");

  const shim = join(f.project, ".omt", "bin", "omt");
  writeFileSync(shim, readFileSync(shim, "utf8").replace(CLI_PATH, join(f.root, "gone", "cli.ts")));
  const broken = await doctor(f);
  assert.equal(broken.status("shim"), "FAIL");
  assert.equal(broken.code, 1);

  writeFileSync(f.exclude, GIT_EXCLUDE_DEFAULT);
  assert.equal((await doctor(f)).status("exclude"), "WARN");

  const g = projectFixture(t, false);
  mkdirSync(join(g.project, ".omt"));
  assert.equal((await doctor(g)).status("exclude"), "INFO");
  assert.deepEqual(readdirSync(g.project), [".omt"], "doctor writes nothing");
});

// A fixture whose project is a real git repository with one commit.
function gitFixture(t: TestContext, files: Record<string, string> = {}) {
  const f = projectFixture(t, false);
  const git = gitRepo(f.root, f.project, files);
  const status = (cwd = f.project) => git(["status", "--porcelain", "--ignored", "--untracked-files=all"], cwd);
  return { ...f, git, status };
}

const SETTINGS = { permissions: { allow: ["Bash(ls)"] }, theme: "dark" };

test("a settings.local.json in its own style is edited in that style and restored byte for byte", async (t) => {
  const styles: Record<string, string> = {
    "4 spaces, newline": `${JSON.stringify(SETTINGS, null, 4)}\n`,
    "4 spaces, no newline": JSON.stringify(SETTINGS, null, 4),
    "tab, newline": `${JSON.stringify(SETTINGS, null, "\t")}\n`,
    "tab, no newline": JSON.stringify(SETTINGS, null, "\t"),
    "compact, newline": `${JSON.stringify(SETTINGS)}\n`,
    "compact, no newline": JSON.stringify(SETTINGS),
  };
  for (const [name, text] of Object.entries(styles)) {
    const f = gitFixture(t, { ".claude/settings.local.json": text });
    const local = join(f.project, ".claude", "settings.local.json");
    const before = f.status();
    const installed = await f.run(["install", "--project", "--hooks", "--yes"]);
    assert.equal(installed.code, 0, installed.ctx.err());
    assert.equal(f.git(["status", "--porcelain"]), " M .claude/settings.local.json\n", name);
    const edited = readFileSync(local, "utf8");
    const indent = name.startsWith("4") ? 4 : name.startsWith("tab") ? "\t" : undefined;
    const newline = name.endsWith(", newline") ? "\n" : "";
    assert.equal(edited, `${JSON.stringify(JSON.parse(edited), null, indent)}${newline}`, `${name}: the edit keeps the style`);
    assert.equal(readFileSync(join(f.project, ".omt", "backups", ".gitignore"), "utf8"), "*\n", name);

    const removed = await f.run(["uninstall", "--project", "--yes"]);
    assert.equal(removed.code, 0, removed.ctx.err());
    assert.equal(readFileSync(local, "utf8"), text, `${name}: restored byte for byte`);
    assert.equal(f.git(["status", "--porcelain"]), "", name);
    assert.equal(f.status(), before, name);
    assert.ok(!existsSync(join(f.project, ".omt")), `${name}: the backup and .omt are gone`);
  }
});

test("backups/.gitignore hides a backup that the uninstall keeps", async (t) => {
  const f = gitFixture(t, { ".claude/settings.local.json": `${JSON.stringify(SETTINGS, null, 2)}\n` });
  const local = join(f.project, ".claude", "settings.local.json");
  assert.equal((await f.run(["install", "--project", "--hooks", "--yes"])).code, 0);
  const ignore = join(f.project, ".omt", "backups", ".gitignore");
  assert.equal(readFileSync(ignore, "utf8"), "*\n");
  const manifest = readJson(join(f.project, ".omt", "install.json"));
  const files = (manifest.project as { files: { path: string }[] }).files.map((file) => file.path);
  assert.ok(files.includes(ignore));
  assert.equal((manifest.hooks as { backup?: string }[])[0]?.backup, join(f.project, ".omt", "backups", STAMP, "claude-settings.json"));

  // The user edits the file while omt is installed, so the uninstall cannot restore the backup.
  writeFileSync(local, JSON.stringify({ ...readJson(local), model: "opus" }, null, 2) + "\n");
  const removed = await f.run(["uninstall", "--project", "--yes"], { now: () => new Date("2026-01-02T03:04:06.000Z") });
  assert.equal(removed.code, 0, removed.ctx.err());
  assert.deepEqual(readJson(local), { ...SETTINGS, model: "opus" });
  assert.ok(existsSync(join(f.project, ".omt", "backups", "20260102030406", "claude-settings.json")));
  assert.equal(readFileSync(ignore, "utf8"), "*\n");
  assert.equal(f.git(["status", "--porcelain"]), " M .claude/settings.local.json\n", "git shows no backup");
});

test("an exclude file that cannot be written stops the install before any other write", { skip: process.getuid?.() === 0 }, async (t) => {
  const f = projectFixture(t);
  const info = dirname(f.exclude);
  chmodSync(f.exclude, 0o444);
  chmodSync(info, 0o555);
  const before = snapshot(f.root);
  const { code, ctx } = await f.run(["install", "--project", "--hooks", "--yes"]);
  chmodSync(info, 0o755);
  chmodSync(f.exclude, 0o644);
  assert.equal(code, 1);
  assert.match(ctx.err(), /cannot write the git exclude block/);
  assert.match(ctx.err(), /--no-git-exclude/);
  assert.deepEqual(snapshot(f.root), before);
});

test("the provisional manifest records what the install will create before the other writes", { skip: process.getuid?.() === 0 }, async (t) => {
  const f = projectFixture(t);
  // A read-only .agents makes the skill copy fail after the exclude block and the manifest.
  mkdirSync(join(f.project, ".agents"));
  chmodSync(join(f.project, ".agents"), 0o555);
  const failed = await f.run(["install", "--project", "--yes"]);
  chmodSync(join(f.project, ".agents"), 0o755);
  assert.equal(failed.code, 1);
  assert.match(readFileSync(f.exclude, "utf8"), /^\/\.omt\/config\.jsonc$/m);
  const manifest = readJson(join(f.project, ".omt", "install.json"));
  const project = manifest.project as { omtDirCreated: boolean; dirs: string[]; files: { path: string }[] };
  assert.equal(project.omtDirCreated, true);
  assert.ok(project.dirs.includes(join(f.project, ".omt", "plans")));
  assert.ok(project.files.some((file) => file.path === join(f.project, ".omt", "config.jsonc")));
});

test("uninstall keeps a reduced exclude block for the paths that stay", async (t) => {
  const f = projectFixture(t);
  assert.equal((await f.run(["install", "--project", "--yes"])).code, 0);
  writeFileSync(join(f.project, ".agents", "skills", "alpha", "SKILL.md"), "edited\n");
  const kept = await f.run(["uninstall", "--project", "--yes"]);
  assert.equal(kept.code, 0, kept.ctx.err());
  assert.match(kept.ctx.out(), /update {3}managed block in .*\(keeps only the paths that stay\)/);
  assert.equal(
    readFileSync(f.exclude, "utf8"),
    `${GIT_EXCLUDE_DEFAULT}${block(f.project, "/.agents/skills/alpha/", "/.claude/skills/alpha", "/.omt/install.json")}\n`,
  );
  assert.equal((await f.run(["uninstall", "--project", "--yes", "--force"])).code, 0);
  assert.equal(readFileSync(f.exclude, "utf8"), GIT_EXCLUDE_DEFAULT);
});

test("installs from two worktrees make one install with one block in the main checkout", async (t) => {
  const f = gitFixture(t);
  const w1 = join(f.root, "w1");
  const w2 = join(f.root, "w2");
  f.git(["worktree", "add", "-q", w1]);
  f.git(["worktree", "add", "-q", w2]);
  const exclude = join(f.project, ".git", "info", "exclude");
  const before = readFileSync(exclude, "utf8");
  assert.equal((await f.run(["install", "--project", "--yes"], { cwd: w1 })).code, 0);
  const again = await f.run(["install", "--project", "--yes"], { cwd: w2 });
  assert.equal(again.code, 0, again.ctx.err());
  assert.deepEqual([...new Set(actionLines(again.ctx.out()))], ["unchanged"]);
  const text = readFileSync(exclude, "utf8");
  assert.equal(excludeBlockCount(text), 1);
  assert.ok(text.includes(excludeBegin(f.project)), "the block has the root that a cwd in the main checkout gives");
  for (const wt of [w1, w2]) {
    for (const path of [".agents", ".claude", ".omt"]) assert.ok(!existsSync(join(wt, path)), `no ${path} in ${wt}`);
  }
  assert.ok(existsSync(join(f.project, ".omt", "install.json")));
  assert.equal(f.git(["status", "--porcelain"]), "");

  assert.equal((await f.run(["uninstall", "--project", "--yes"], { cwd: w2 })).code, 0);
  assert.ok(!existsSync(join(f.project, ".omt", "install.json")), "an uninstall from a worktree removes the one install");
  assert.equal(readFileSync(exclude, "utf8"), before);
});

function excludeBlockCount(text: string): number {
  return text.split("\n").filter((line) => line.startsWith("# >>> oh-my-t3code project install: ")).length;
}

test("a monorepo package with its own .omt uses the repository's exclude file with prefixed entries", async (t) => {
  const f = gitFixture(t, { "pkg/.omt/notes.md": "# x\n", "pkg/index.ts": "export {};\n" });
  const pkg = join(f.project, "pkg");
  const before = f.status();
  const installed = await f.run(["install", "--project", "--yes"], { cwd: pkg });
  assert.equal(installed.code, 0, installed.ctx.err());
  const text = readFileSync(join(f.project, ".git", "info", "exclude"), "utf8");
  assert.match(text, /^\/pkg\/\.agents\/skills\/alpha\/$/m);
  assert.match(text, /^\/pkg\/\.omt\/config\.jsonc$/m);
  assert.equal(f.git(["status", "--porcelain"]), "");
  assert.equal((await f.run(["uninstall", "--project", "--yes"], { cwd: pkg })).code, 0);
  assert.equal(f.status(), before);
});

test("a BEGIN marker without its END marker counts as no block", async (t) => {
  const f = projectFixture(t);
  const original = `${GIT_EXCLUDE_DEFAULT}${excludeBegin(f.project)}\nmine-1\nmine-2\n`;
  writeFileSync(f.exclude, original);
  assert.equal((await f.run(["install", "--project", "--yes"])).code, 0);
  assert.equal(readFileSync(f.exclude, "utf8"), `${original}${block(f.project, ...SKILL_ENTRIES, ...CREATED_OMT)}\n`);
  assert.equal((await f.run(["install", "--project", "--yes"])).code, 0);
  assert.equal(readFileSync(f.exclude, "utf8"), `${original}${block(f.project, ...SKILL_ENTRIES, ...CREATED_OMT)}\n`);
  assert.equal((await f.run(["uninstall", "--project", "--yes"])).code, 0);
  assert.equal(readFileSync(f.exclude, "utf8"), original);
});

test("uninstall keeps .omt/bin and .omt/backups that the user created", async (t) => {
  const f = projectFixture(t);
  mkdirSync(join(f.project, ".omt", "bin"), { recursive: true });
  mkdirSync(join(f.project, ".omt", "backups"));
  assert.equal((await f.run(["install", "--project", "--yes"])).code, 0);
  const dirs = (readJson(join(f.project, ".omt", "install.json")).project as { dirs: string[] }).dirs;
  assert.ok(!dirs.includes(join(f.project, ".omt", "bin")));
  assert.equal((await f.run(["uninstall", "--project", "--yes"])).code, 0);
  assert.deepEqual(readdirSync(join(f.project, ".omt")).sort(), ["backups", "bin"]);
  assert.deepEqual(readdirSync(join(f.project, ".omt", "bin")), []);
});

test("the shim falls back to node on PATH when the recorded node is missing", async (t) => {
  const f = projectFixture(t);
  assert.equal((await f.run(["install", "--project", "--yes"], { nodePath: join(f.root, "gone", "node") })).code, 0);
  const shim = join(f.project, ".omt", "bin", "omt");
  const env = { ...childEnv(f.root), PATH: `${dirname(process.execPath)}:/usr/bin:/bin` };
  const out = execFileSync(shim, ["--version"], { cwd: f.project, env, encoding: "utf8" });
  assert.match(out, /^\d+\.\d+\.\d+/);
  const report = await doctor(f);
  assert.equal(report.status("shim"), "WARN");
});

test("the project hook command calls the shim", async (t) => {
  const f = projectFixture(t);
  assert.equal((await f.run(["install", "--project", "--hooks", "--yes"])).code, 0);
  const shim = join(f.project, ".omt", "bin", "omt");
  const settings = readJson(join(f.project, ".claude", "settings.local.json")) as {
    hooks: { UserPromptSubmit: { hooks: { command: string }[] }[] };
  };
  const command = settings.hooks.UserPromptSubmit[0]?.hooks[0]?.command ?? "";
  assert.equal(command, `"${shim}" hook user-prompt-submit # oh-my-t3code`);
  const out = execFileSync("/bin/sh", ["-c", command], {
    cwd: f.project,
    env: childEnv(f.root),
    input: JSON.stringify({ prompt: "ulw fix the bug", hook_event_name: "UserPromptSubmit" }),
    encoding: "utf8",
  });
  assert.match(out, /omt-ulw/);
  assert.equal((await doctor(f)).status("hooks"), "PASS");
});

test("doctor --project names the running CLI in its install hint", async (t) => {
  const f = projectFixture(t);
  assert.equal((await f.run(["install", "--project", "--yes"])).code, 0);
  const shim = join(f.project, ".omt", "bin", "omt");
  writeFileSync(shim, readFileSync(shim, "utf8").replace(CLI_PATH, join(f.root, "moved", "cli.ts")));
  const { report } = await doctor(f);
  const message = report.checks.find((c) => c.id === "shim")?.message ?? "";
  assert.ok(message.includes(`run node ${CLI_PATH} install --project`), message);
});

// Every path under `dir` except .git, with the bytes of each file and the target of each link.
function contentTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (path: string, rel: string) => {
    for (const name of readdirSync(path).sort()) {
      if (rel === "" && name === ".git") continue;
      const full = join(path, name);
      const key = rel === "" ? name : `${rel}/${name}`;
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) out[key] = `link:${readlinkSync(full)}`;
      else if (stat.isDirectory()) {
        out[key] = "dir";
        walk(full, key);
      } else out[key] = `file:${sha256(readFileSync(full, "utf8"))}`;
    }
  };
  walk(dir, "");
  return out;
}

const INLINE_SETTINGS = '{\n  "permissions": { "allow": ["Bash(ls)"] }\n}\n';

test("uninstall in a copied project changes only the copy, and an install there records only the copy's paths", async (t) => {
  const f = gitFixture(t, { ".claude/settings.local.json": INLINE_SETTINGS });
  const treeBefore = contentTree(f.project);
  const statusBefore = f.status();
  assert.equal((await f.run(["install", "--project", "--hooks", "--yes"])).code, 0);
  const copy = join(f.root, "copy");
  cpSync(f.project, copy, { recursive: true, verbatimSymlinks: true });
  const original = contentTree(f.project);

  const removed = await f.run(["uninstall", "--project", "--yes"], { cwd: copy });
  assert.equal(removed.code, 0, removed.ctx.err());
  assert.doesNotMatch(removed.ctx.out(), new RegExp(`${f.project}/`), "the plan names no path of the original");
  assert.deepEqual(contentTree(f.project), original, "the original install stays");
  assert.deepEqual(contentTree(copy), treeBefore, "the copy is back to the tree before the install");
  assert.equal(f.status(copy), statusBefore);
  assert.equal(readFileSync(join(copy, ".git", "info", "exclude"), "utf8"), readFileSync(join(f.project, ".git", "info", "exclude"), "utf8").replace(/# >>>[^]*<<<[^\n]*\n/, ""));

  const second = join(f.root, "second");
  cpSync(f.project, second, { recursive: true, verbatimSymlinks: true });
  assert.equal((await f.run(["install", "--project", "--hooks", "--yes"], { cwd: second })).code, 0);
  const manifest = readFileSync(join(second, ".omt", "install.json"), "utf8");
  assert.ok(!manifest.includes(`${f.project}/`), "the manifest of the copy names no path of the original");
  const exclude = readFileSync(join(second, ".git", "info", "exclude"), "utf8");
  assert.ok(!exclude.includes("/../"), exclude);
  assert.ok(!exclude.includes(excludeBegin(f.project)), "the copied block of the original is replaced");
  assert.equal(f.git(["status", "--porcelain", "-uall"], second), " M .claude/settings.local.json\n", "git shows only the tracked settings file");
});

test("a tracked project manifest with paths outside the root never touches the user install", async (t) => {
  const f = projectFixture(t);
  assert.equal((await f.run(["install", "--hooks", "--yes"])).code, 0);
  const user = snapshot(f.home);
  mkdirSync(join(f.project, ".omt"));
  const manifest = {
    scope: "project",
    root: f.project,
    package: "oh-my-t3code",
    version: "0.1.0",
    installedAt: "",
    skillsRoot: f.agents,
    skills: ["alpha", "beta"],
    links: [{ path: join(f.claudeSkills, "alpha"), target: "../../.agents/skills/alpha" }],
    config: { path: join(f.configDir, "config.jsonc"), created: true },
    hooks: [{ kind: "claude-user-prompt-submit", settingsPath: f.settings, command: "x # oh-my-t3code", created: true }],
    backups: [],
    project: { omtDirCreated: false, settingsCreated: false, shim: join(f.root, "elsewhere", "omt"), files: [{ path: join(f.configDir, "config.jsonc"), sha256: "x" }], dirs: [f.agents] },
  };
  writeFileSync(join(f.project, ".omt", "install.json"), JSON.stringify(manifest));
  const removed = await f.run(["uninstall", "--project", "--yes"]);
  assert.equal(removed.code, 0, removed.ctx.err());
  assert.doesNotMatch(removed.ctx.out(), new RegExp(f.home));
  assert.deepEqual(snapshot(f.home), user);
});

test("a moved clone: doctor, reinstall, and uninstall give back the tree and the tracked settings byte for byte", async (t) => {
  const f = gitFixture(t, { ".claude/settings.local.json": INLINE_SETTINGS });
  const treeBefore = contentTree(f.project);
  const statusBefore = f.status();
  const excludeBefore = readFileSync(join(f.project, ".git", "info", "exclude"), "utf8");
  assert.equal((await f.run(["install", "--project", "--hooks", "--yes"])).code, 0);
  const moved = join(f.root, "moved");
  renameSync(f.project, moved);

  const report = await doctor({ ...f, run: (argv, options = {}) => f.run(argv, { cwd: moved, ...options }) });
  assert.equal(report.status("hooks"), "FAIL");
  assert.match(report.report.checks.find((c) => c.id === "hooks")?.message ?? "", /install --project --hooks/);

  const reinstalled = await f.run(["install", "--project", "--hooks", "--yes"], { cwd: moved });
  assert.equal(reinstalled.code, 0, reinstalled.ctx.err());
  assert.doesNotMatch(reinstalled.ctx.out(), /^backup/m, "the update needs no new backup");
  const exclude = readFileSync(join(moved, ".git", "info", "exclude"), "utf8");
  assert.ok(!exclude.includes(excludeBegin(f.project)), "the block of the old root is replaced");
  assert.ok(exclude.includes(excludeBegin(moved)));
  assert.equal(f.git(["status", "--porcelain", "-uall"], moved), " M .claude/settings.local.json\n");

  const removed = await f.run(["uninstall", "--project", "--yes"], { cwd: moved });
  assert.equal(removed.code, 0, removed.ctx.err());
  assert.equal(readFileSync(join(moved, ".claude", "settings.local.json"), "utf8"), INLINE_SETTINGS);
  assert.equal(f.status(moved), statusBefore);
  assert.equal(readFileSync(join(moved, ".git", "info", "exclude"), "utf8"), excludeBefore);
  assert.deepEqual(contentTree(moved), treeBefore);
});

test("uninstall of a moved clone without a reinstall removes the old root's block and every created path", async (t) => {
  const f = gitFixture(t);
  const treeBefore = contentTree(f.project);
  const excludeBefore = readFileSync(join(f.project, ".git", "info", "exclude"), "utf8");
  assert.equal((await f.run(["install", "--project", "--hooks", "--yes"])).code, 0);
  const moved = join(f.root, "moved");
  renameSync(f.project, moved);
  const removed = await f.run(["uninstall", "--project", "--yes"], { cwd: moved });
  assert.equal(removed.code, 0, removed.ctx.err());
  assert.equal(readFileSync(join(moved, ".git", "info", "exclude"), "utf8"), excludeBefore);
  assert.deepEqual(contentTree(moved), treeBefore);
});

test("--project refuses a root that is the home directory or shares the user-scope paths", async (t) => {
  const f = projectFixture(t);
  assert.equal((await f.run(["install", "--yes"])).code, 0);
  const user = snapshot(f.home);
  for (const command of ["install", "uninstall", "doctor"]) {
    const { code, ctx } = await f.run([command, "--project", "--yes"].slice(0, command === "doctor" ? 2 : 3), { cwd: f.home });
    assert.equal(code, 2, `${command}: ${ctx.err()}`);
    assert.match(ctx.err(), /refusing --project: the project root .* is your home directory/);
    assert.match(ctx.err(), /^hint: /m);
  }
  mkdirSync(join(f.home, ".git"));
  mkdirSync(join(f.home, "scratch"));
  const nested = await f.run(["uninstall", "--project", "--yes"], { cwd: join(f.home, "scratch") });
  assert.equal(nested.code, 2);
  rmSync(join(f.home, ".git"), { recursive: true });
  rmSync(join(f.home, "scratch"), { recursive: true });
  assert.deepEqual(snapshot(f.home), user, "the user install stays");
});

test("a dangling settings symlink stays a symlink, and uninstall removes only the target the install created", async (t) => {
  const f = projectFixture(t);
  const local = join(f.project, ".claude", "settings.local.json");
  const target = join(f.root, "dot", "settings.local.json");
  mkdirSync(join(f.project, ".claude"));
  symlinkSync(target, local);
  assert.equal((await f.run(["install", "--project", "--hooks", "--yes"])).code, 0);
  assert.ok(lstatSync(local).isSymbolicLink());
  assert.match(readFileSync(target, "utf8"), /# oh-my-t3code/);
  assert.doesNotMatch(readFileSync(f.exclude, "utf8"), /settings\.local\.json/, "the link is the user's");
  assert.equal((await f.run(["uninstall", "--project", "--yes"])).code, 0);
  assert.ok(lstatSync(local).isSymbolicLink(), "the user's link stays");
  assert.equal(readlinkSync(local), target);
  assert.ok(!existsSync(target), "the target that the install created goes");

  const g = projectFixture(t);
  const userTarget = join(g.root, "dot", "settings.json");
  mkdirSync(dirname(g.settings), { recursive: true });
  symlinkSync(userTarget, g.settings);
  assert.equal((await g.run(["install", "--hooks", "--yes"])).code, 0);
  assert.match(readFileSync(userTarget, "utf8"), /# oh-my-t3code/);
  assert.equal((await g.run(["uninstall", "--yes"])).code, 0);
  assert.ok(lstatSync(g.settings).isSymbolicLink());
  assert.ok(!existsSync(userTarget));
});

test("a failed delete names the scratch directory, git does not show it, and the next run removes it", { skip: process.getuid?.() === 0 }, async (t) => {
  const f = gitFixture(t);
  const statusBefore = f.status();
  assert.equal((await f.run(["install", "--project", "--yes"])).code, 0);
  const locked = join(f.project, ".agents", "skills", "beta", "references");
  chmodSync(locked, 0o555);
  const failed = await f.run(["uninstall", "--project", "--yes"]);
  const scratch = readdirSync(join(f.project, ".agents")).filter((name) => name.startsWith(".omt-old-"));
  for (const name of scratch) chmodSync(join(f.project, ".agents", name, "references"), 0o755);
  chmodSync(join(f.project, ".agents"), 0o755);
  assert.equal(failed.code, 1);
  assert.match(failed.ctx.err(), /cannot delete the scratch directory .*\.omt-old-[0-9a-f]+/);
  assert.equal(scratch.length, 1);
  assert.equal(f.git(["status", "--porcelain", "-uall"]), "", "the exclude block hides the scratch directory");

  const again = await f.run(["uninstall", "--project", "--yes"]);
  assert.equal(again.code, 0, again.ctx.err());
  assert.match(again.ctx.out(), /remove {3}.*\.omt-old-[0-9a-f]+ {2}\(left by an interrupted run\)/);
  assert.ok(!existsSync(join(f.project, ".agents")));
  assert.equal(f.status(), statusBefore);
});

test("excludePattern escapes the characters that git reads as globs", () => {
  assert.equal(excludePattern("/r", "/r/pkg[1]/a*b?/c\\d", true), "/pkg\\[1\\]/a\\*b\\?/c\\\\d/");
  assert.equal(excludePattern("/r", "/r/x/name  "), "/x/name\\ \\ ");
});

test("a monorepo package whose path holds glob characters is hidden from git", async (t) => {
  const f = gitFixture(t, { "pkg[1]/.omt/config.jsonc": "{}\n", "pkg1/keep.txt": "x\n" });
  const pkg = join(f.project, "pkg[1]");
  const before = f.status();
  assert.equal((await f.run(["install", "--project", "--yes"], { cwd: pkg })).code, 0);
  assert.equal(f.git(["status", "--porcelain", "-uall"]), "");
  writeFileSync(join(f.project, "pkg1", "new.txt"), "x\n");
  assert.match(f.git(["status", "--porcelain"]), /^\?\? pkg1\/new\.txt$/m, "the block does not hide a sibling");
  rmSync(join(f.project, "pkg1", "new.txt"));
  assert.equal((await f.run(["uninstall", "--project", "--yes"], { cwd: pkg })).code, 0);
  assert.equal(f.status(), before);
});

test("the block names only the files the install writes, so new files in .omt of another worktree show in git", async (t) => {
  const f = gitFixture(t);
  const wt = join(f.root, "wt");
  f.git(["worktree", "add", "-q", wt]);
  const installed = await f.run(["install", "--project", "--yes"], { cwd: wt });
  assert.equal(installed.code, 0, installed.ctx.err());
  assert.match(installed.ctx.out(), /managed block in .*\(shared by all worktrees\)/);
  writeFileSync(join(f.project, ".omt", "notes.md"), "# p\n");
  mkdirSync(join(wt, ".omt", "plans"), { recursive: true });
  writeFileSync(join(wt, ".omt", "plans", "mine.md"), "# mine\n");
  assert.match(f.git(["status", "--porcelain", "-uall"]), /^\?\? \.omt\/notes\.md$/m);
  assert.match(f.git(["status", "--porcelain", "-uall"], wt), /^\?\? \.omt\/plans\/mine\.md$/m);
});

test("a block whose root no longer exists: doctor warns, and the next install or uninstall removes it", async (t) => {
  const f = gitFixture(t);
  const wt = join(f.root, "wt");
  f.git(["worktree", "add", "-q", wt]);
  const exclude = join(f.project, ".git", "info", "exclude");
  // An install of an older omt wrote a block for the worktree itself.
  writeFileSync(exclude, withExcludeBlock(readFileSync(exclude, "utf8"), wt, ["/.omt/install.json"]));
  f.git(["worktree", "remove", "--force", wt]);
  assert.ok(readFileSync(exclude, "utf8").includes(excludeBegin(wt)));
  const report = await doctor(f);
  assert.equal(report.status("exclude"), "WARN");
  assert.match(report.report.checks.find((c) => c.id === "exclude")?.message ?? "", /no longer exists/);
  assert.equal((await f.run(["install", "--project", "--yes"])).code, 0);
  assert.ok(!readFileSync(exclude, "utf8").includes(excludeBegin(wt)));
});

test("--no-git-exclude: uninstall removes the lines it appended to a tracked .omt/.gitignore", async (t) => {
  const f = gitFixture(t, { ".omt/.gitignore": "foo\n" });
  const statusBefore = f.status();
  assert.equal((await f.run(["install", "--project", "--no-git-exclude", "--yes"])).code, 0);
  assert.equal(readFileSync(join(f.project, ".omt", ".gitignore"), "utf8"), "foo\nledger.jsonl\nevidence/\nbin/\ninstall.json\nbackups/\nplans/\n");
  const removed = await f.run(["uninstall", "--project", "--yes"]);
  assert.equal(removed.code, 0, removed.ctx.err());
  assert.match(removed.ctx.out(), /update {3}.*\.gitignore {2}\(removes the lines that the install added\)/);
  assert.equal(readFileSync(join(f.project, ".omt", ".gitignore"), "utf8"), "foo\n");
  assert.equal(f.status(), statusBefore);
});

test("--no-git-exclude on a reinstall removes the earlier block, and doctor reports the choice as INFO", async (t) => {
  const f = projectFixture(t);
  assert.equal((await f.run(["install", "--project", "--hooks", "--yes"])).code, 0);
  const again = await f.run(["install", "--project", "--hooks", "--no-git-exclude", "--yes"]);
  assert.equal(again.code, 0, again.ctx.err());
  assert.match(again.ctx.out(), /remove {3}managed block in .*\(--no-git-exclude\)/);
  assert.equal(readFileSync(f.exclude, "utf8"), GIT_EXCLUDE_DEFAULT);
  const report = await doctor(f);
  assert.equal(report.status("exclude"), "INFO");
  assert.match(report.report.checks.find((c) => c.id === "exclude")?.message ?? "", /--no-git-exclude/);
  assert.equal((await f.run(["install", "--project", "--hooks", "--yes"])).code, 0);
  assert.equal((await doctor(f)).status("exclude"), "PASS");
});

test("the exclude file gets its exact bytes back: no final newline, or no file and no info directory", async (t) => {
  const f = projectFixture(t);
  writeFileSync(f.exclude, "*.log");
  assert.equal((await f.run(["install", "--project", "--yes"])).code, 0);
  assert.equal((await f.run(["uninstall", "--project", "--yes"])).code, 0);
  assert.equal(readFileSync(f.exclude, "utf8"), "*.log");

  const g = projectFixture(t);
  rmSync(dirname(g.exclude), { recursive: true });
  assert.equal((await g.run(["install", "--project", "--yes"])).code, 0);
  assert.ok(existsSync(g.exclude));
  assert.equal((await g.run(["uninstall", "--project", "--yes"])).code, 0);
  assert.ok(!existsSync(dirname(g.exclude)), "the info directory that the install created goes");

  const text = withExcludeBlock("a", "/r", ["/x"]);
  assert.equal(withoutExcludeBlocks(text, ["/r"], true), "a");
  assert.equal(withoutExcludeBlocks(text, ["/r"]), "a\n");
  assert.equal(withoutExcludeBlocks(`${block("/r", "/x")}\nb`, ["/r"]), "b");
});

test("install and uninstall through a symlinked path of the same project run once and leave no block", async (t) => {
  const f = gitFixture(t);
  const alias = join(f.root, "alias");
  symlinkSync(f.project, alias);
  const treeBefore = contentTree(f.project);
  const excludeBefore = readFileSync(join(f.project, ".git", "info", "exclude"), "utf8");
  assert.equal((await f.run(["install", "--project", "--hooks", "--yes"], { cwd: alias })).code, 0);
  const second = await f.run(["install", "--project", "--hooks", "--yes"]);
  assert.equal(second.code, 0, second.ctx.err());
  assert.equal(excludeBlockCount(readFileSync(join(f.project, ".git", "info", "exclude"), "utf8")), 1);
  const removed = await f.run(["uninstall", "--project", "--yes"], { cwd: alias });
  assert.equal(removed.code, 0, removed.ctx.err());
  assert.equal(readFileSync(join(f.project, ".git", "info", "exclude"), "utf8"), excludeBefore);
  assert.deepEqual(contentTree(f.project), treeBefore);

  assert.equal((await f.run(["install", "--project", "--hooks", "--yes"], { cwd: alias })).code, 0);
  const direct = await f.run(["uninstall", "--project", "--yes"]);
  assert.equal(direct.code, 0, direct.ctx.err());
  assert.equal(readFileSync(join(f.project, ".git", "info", "exclude"), "utf8"), excludeBefore);
  assert.deepEqual(contentTree(f.project), treeBefore);
});

test("a created settings.local.json that keeps other keys stays hidden from git after uninstall", async (t) => {
  const f = gitFixture(t);
  const statusBefore = f.status();
  assert.equal((await f.run(["install", "--project", "--hooks", "--yes"])).code, 0);
  const local = join(f.project, ".claude", "settings.local.json");
  writeFileSync(local, JSON.stringify({ ...readJson(local), permissions: { allow: ["Bash(ls)"] } }, null, 2));
  const removed = await f.run(["uninstall", "--project", "--yes"]);
  assert.equal(removed.code, 0, removed.ctx.err());
  assert.deepEqual(readJson(local), { permissions: { allow: ["Bash(ls)"] } });
  assert.equal(f.git(["status", "--porcelain", "-uall"]), "");
  assert.notEqual(f.status(), statusBefore, "the kept file shows only as ignored");
});

test("the ledger and evidence stay out of git after uninstall", async (t) => {
  const f = gitFixture(t);
  assert.equal((await f.run(["install", "--project", "--yes"])).code, 0);
  writeFileSync(join(f.project, ".omt", "ledger.jsonl"), "{}\n");
  mkdirSync(join(f.project, ".omt", "evidence"));
  writeFileSync(join(f.project, ".omt", "evidence", "run.txt"), "ok\n");
  assert.equal((await f.run(["uninstall", "--project", "--yes"])).code, 0);
  assert.equal(f.git(["status", "--porcelain", "-uall"]), "");
});

test("a hook install into a new settings file writes no backups .gitignore; a failed run leaves nothing that git shows", { skip: process.getuid?.() === 0 }, async (t) => {
  const f = projectFixture(t);
  assert.equal((await f.run(["install", "--project", "--hooks", "--yes"])).code, 0);
  assert.ok(!existsSync(join(f.project, ".omt", "backups")));

  const g = gitFixture(t, { ".claude/skills/.keep": "", ".claude/settings.local.json": INLINE_SETTINGS });
  const treeBefore = contentTree(g.project);
  const exclude = join(g.project, ".git", "info", "exclude");
  const excludeBefore = readFileSync(exclude, "utf8");
  chmodSync(join(g.project, ".claude"), 0o555);
  const failed = await g.run(["install", "--project", "--hooks", "--yes"]);
  chmodSync(join(g.project, ".claude"), 0o755);
  assert.equal(failed.code, 1);
  const manifest = readJson(join(g.project, ".omt", "install.json"));
  const files = (manifest.project as { files: { path: string }[] }).files.map((file) => file.path);
  assert.ok(files.includes(join(g.project, ".omt", "backups", ".gitignore")), "the provisional manifest records the backups .gitignore");
  assert.equal(g.git(["status", "--porcelain", "-uall"]), "", "git shows nothing after the failed run");
  const removed = await g.run(["uninstall", "--project", "--yes"]);
  assert.equal(removed.code, 0, removed.ctx.err());
  const after = contentTree(g.project);
  const added = Object.keys(after).filter((path) => !(path in treeBefore));
  // The backup of the settings write that failed stays, hidden by the backups .gitignore.
  assert.deepEqual(added, [".omt", ".omt/backups", ".omt/backups/.gitignore", `.omt/backups/${STAMP}`, `.omt/backups/${STAMP}/claude-settings.json`]);
  assert.equal(readFileSync(exclude, "utf8"), excludeBefore, "no block hides a leftover");
  assert.equal(g.git(["status", "--porcelain", "-uall"]), "");
  for (const path of Object.keys(treeBefore)) assert.equal(after[path], treeBefore[path], path);
});

// Each case edits the install the way normal use does, so the uninstall keeps a file that it created.
const KEPT_CASES: Record<string, (project: string) => void> = {
  "Claude Code permissions": (project) => {
    const local = join(project, ".claude", "settings.local.json");
    writeFileSync(local, JSON.stringify({ ...readJson(local), permissions: { allow: ["Bash(ls)"] } }, null, 2));
  },
  "the ledger": (project) => writeFileSync(join(project, ".omt", "ledger.jsonl"), "{}\n"),
  "an edited config": (project) => writeFileSync(join(project, ".omt", "config.jsonc"), `${PROJECT_STARTER_CONFIG}// mine\n`),
};

test("after an uninstall keeps created files, a reinstall and further uninstalls show nothing in git", async (t) => {
  for (const [name, edit] of Object.entries(KEPT_CASES)) {
    const f = gitFixture(t);
    assert.equal((await f.run(["install", "--project", "--hooks", "--yes"])).code, 0, name);
    edit(f.project);
    const clean = (step: string) => assert.equal(f.git(["status", "--porcelain", "-uall"]), "", `${name}: ${step}`);
    assert.equal((await f.run(["uninstall", "--project", "--yes"])).code, 0, name);
    clean("first uninstall");
    const second = await f.run(["uninstall", "--project", "--yes"]);
    assert.equal(second.code, 0, second.ctx.err());
    assert.match(second.ctx.out(), /Nothing to remove/, name);
    clean("second uninstall");
    const reinstalled = await f.run(["install", "--project", "--hooks", "--yes"]);
    assert.equal(reinstalled.code, 0, reinstalled.ctx.err());
    clean("reinstall");
    assert.equal((await f.run(["uninstall", "--project", "--yes"])).code, 0, name);
    clean("uninstall after the reinstall");
    assert.equal((await f.run(["uninstall", "--project", "--yes"])).code, 0, name);
    clean("last uninstall");
  }
});

test("the reduced manifest goes with the last created file that stays", async (t) => {
  const f = gitFixture(t);
  const treeBefore = contentTree(f.project);
  const excludeBefore = readFileSync(join(f.project, ".git", "info", "exclude"), "utf8");
  assert.equal((await f.run(["install", "--project", "--yes"])).code, 0);
  const ledger = join(f.project, ".omt", "ledger.jsonl");
  writeFileSync(ledger, "{}\n");
  assert.equal((await f.run(["uninstall", "--project", "--yes"])).code, 0);
  const manifest = readJson(join(f.project, ".omt", "install.json"));
  assert.deepEqual(manifest.skills, []);
  assert.deepEqual((manifest.project as { files: { path: string }[] }).files.map((file) => file.path), [join(f.project, ".omt", ".gitignore")]);
  rmSync(ledger);
  const last = await f.run(["uninstall", "--project", "--yes"]);
  assert.equal(last.code, 0, last.ctx.err());
  assert.equal(readFileSync(join(f.project, ".git", "info", "exclude"), "utf8"), excludeBefore);
  assert.deepEqual(contentTree(f.project), treeBefore);
});

test("an uninstall that fails midway keeps the block, names the path, and the next run finishes", { skip: process.getuid?.() === 0 }, async (t) => {
  const f = gitFixture(t);
  const treeBefore = contentTree(f.project);
  const exclude = join(f.project, ".git", "info", "exclude");
  const excludeBefore = readFileSync(exclude, "utf8");
  assert.equal((await f.run(["install", "--project", "--yes"])).code, 0);
  const omt = join(f.project, ".omt");
  chmodSync(omt, 0o555);
  const failed = await f.run(["uninstall", "--project", "--yes"]);
  chmodSync(omt, 0o755);
  assert.equal(failed.code, 1);
  assert.match(failed.ctx.err(), /cannot delete .*\.omt\/\.gitignore/);
  assert.match(failed.ctx.err(), /run the command again/);
  assert.doesNotMatch(failed.ctx.err(), /unexpected error/);
  assert.ok(readFileSync(exclude, "utf8").includes(excludeBegin(f.project)), "the block stays until the last step");
  assert.equal(f.git(["status", "--porcelain", "-uall"]), "");
  const again = await f.run(["uninstall", "--project", "--yes"]);
  assert.equal(again.code, 0, again.ctx.err());
  assert.equal(readFileSync(exclude, "utf8"), excludeBefore);
  assert.deepEqual(contentTree(f.project), treeBefore);
});

test("a symlinked exclude file or .omt/.gitignore stays a symlink through install and uninstall", async (t) => {
  const f = gitFixture(t);
  const exclude = join(f.project, ".git", "info", "exclude");
  const dot = join(f.root, "dot", "exclude");
  mkdirSync(dirname(dot), { recursive: true });
  writeFileSync(dot, "*.log\n");
  rmSync(exclude);
  symlinkSync(dot, exclude);
  assert.equal((await f.run(["install", "--project", "--yes"])).code, 0);
  assert.ok(lstatSync(exclude).isSymbolicLink());
  assert.ok(readFileSync(dot, "utf8").includes(excludeBegin(f.project)));
  assert.equal(f.git(["status", "--porcelain", "-uall"]), "");
  assert.equal((await f.run(["uninstall", "--project", "--yes"])).code, 0);
  assert.ok(lstatSync(exclude).isSymbolicLink());
  assert.equal(readFileSync(dot, "utf8"), "*.log\n");

  const g = gitFixture(t, { ".omt/plans/.keep": "" });
  const gitignore = join(g.project, ".omt", ".gitignore");
  const target = join(g.root, "dot", "omt-gitignore");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, "mine\n");
  symlinkSync(target, gitignore);
  assert.equal((await g.run(["install", "--project", "--no-git-exclude", "--yes"])).code, 0);
  assert.ok(lstatSync(gitignore).isSymbolicLink());
  assert.match(readFileSync(target, "utf8"), /^mine\nledger\.jsonl\n/);
  assert.equal((await g.run(["uninstall", "--project", "--yes"])).code, 0);
  assert.ok(lstatSync(gitignore).isSymbolicLink());
  assert.equal(readFileSync(target, "utf8"), "mine\n");
});

test("a crafted tracked manifest never makes the uninstall delete or hide a file that omt did not create", async (t) => {
  const elsewhere = "/somewhere/else";
  const readme = "# demo\n";
  const manifest = {
    scope: "project",
    root: elsewhere,
    package: "oh-my-t3code",
    version: "0.1.0",
    installedAt: "",
    skillsRoot: elsewhere,
    skills: ["../../src", "src"],
    links: [{ path: `${elsewhere}/src`, target: "x" }],
    config: { path: `${elsewhere}/README.md`, created: true },
    hooks: [{ kind: "claude-user-prompt-submit", settingsPath: `${elsewhere}/data.json`, command: "x # oh-my-t3code", backup: `${elsewhere}/other.json` }],
    backups: [`${elsewhere}/src`],
    project: {
      omtDirCreated: true,
      settingsCreated: true,
      shim: `${elsewhere}/README.md`,
      files: [{ path: `${elsewhere}/README.md`, sha256: sha256(readme) }, { path: `${elsewhere}/src/index.ts`, sha256: sha256("export {};\n") }],
      dirs: [`${elsewhere}/empty`],
    },
  };
  const f = gitFixture(t, {
    ".omt/install.json": JSON.stringify(manifest),
    "src/index.ts": "export {};\n",
    "data.json": "{}\n",
    "other.json": "{}\n",
    "empty/.keep": "",
  });
  rmSync(join(f.project, "empty", ".keep"));
  f.git(["add", "-A"]);
  f.git(["commit", "-q", "-m", "empty"]);
  assert.equal((await f.run(["install", "--project", "--yes"])).code, 0);
  const exclude = readFileSync(join(f.project, ".git", "info", "exclude"), "utf8");
  assert.doesNotMatch(exclude, /^\/(src|\.\.|README\.md)/m, exclude);
  const removed = await f.run(["uninstall", "--project", "--yes"]);
  assert.equal(removed.code, 0, removed.ctx.err());
  assert.doesNotMatch(removed.ctx.out(), /README|src|data\.json|other\.json/);
  for (const path of ["README.md", "src/index.ts", "data.json", "other.json", "empty"]) assert.ok(existsSync(join(f.project, path)), path);
  assert.equal(f.git(["status", "--porcelain", "-uall"]), " D .omt/install.json\n", "only the tracked manifest changed");
});

test("a package copied inside the same repository keeps the original's block", async (t) => {
  const f = gitFixture(t, { "pkg/a/.omt/plans/x.md": "# x\n", "pkg/a/index.ts": "export {};\n" });
  const a = join(f.project, "pkg", "a");
  const b = join(f.project, "pkg", "b");
  assert.equal((await f.run(["install", "--project", "--yes"], { cwd: a })).code, 0);
  cpSync(a, b, { recursive: true, verbatimSymlinks: true });
  const exclude = join(f.project, ".git", "info", "exclude");
  const underA = () => f.git(["status", "--porcelain", "-uall"]).split("\n").filter((line) => line.includes("pkg/a/"));
  for (const argv of [["install", "--project", "--yes"], ["uninstall", "--project", "--yes"]]) {
    const run = await f.run(argv, { cwd: b });
    assert.equal(run.code, 0, run.ctx.err());
    assert.ok(readFileSync(exclude, "utf8").includes(excludeBegin(a)), `${argv[0]} in the copy keeps the block of the original`);
    assert.deepEqual(underA(), [], `${argv[0]} in the copy shows no file of the original`);
  }
});

test("detectJsonStyle gives an empty object the default indentation", () => {
  for (const text of ["{}\n", "{\n}\n", "{ }"]) assert.equal(detectJsonStyle(text).indent, "  ", JSON.stringify(text));
  assert.equal(detectJsonStyle('{"a":1}\n').indent, "");
});

test("a clone of a committed --no-git-exclude setup: install and uninstall keep the tracked skills and links", async (t) => {
  const f = gitFixture(t);
  assert.equal((await f.run(["install", "--project", "--no-git-exclude", "--yes"])).code, 0);
  f.git(["add", "-A"]);
  f.git(["commit", "-q", "-m", "omt setup"]);
  const bob = join(f.root, "bob");
  f.git(["clone", "-q", f.project, bob], f.root);
  const treeBefore = contentTree(bob);
  const excludeBefore = readFileSync(join(bob, ".git", "info", "exclude"), "utf8");

  const installed = await f.run(["install", "--project", "--yes"], { cwd: bob });
  assert.equal(installed.code, 0, installed.ctx.err());
  assert.equal(f.git(["status", "--porcelain", "-uall"], bob), "");
  const manifest = readJson(join(bob, ".omt", "install.json"));
  assert.deepEqual(manifest.skills, []);
  assert.deepEqual(manifest.links, []);
  assert.deepEqual((manifest.project as { existing: unknown }).existing, {
    skills: ["alpha", "beta"],
    links: ["alpha", "beta"].map((name) => join(bob, ".claude", "skills", name)),
  });
  assert.doesNotMatch(readFileSync(join(bob, ".git", "info", "exclude"), "utf8"), /skills/, "the block does not hide the tracked setup");

  const removed = await f.run(["uninstall", "--project", "--yes"], { cwd: bob });
  assert.equal(removed.code, 0, removed.ctx.err());
  assert.match(removed.ctx.out(), /keep {5}.*alpha {2}\(existed before the install\)/);
  assert.doesNotMatch(removed.ctx.out(), /locally modified/);
  assert.equal(f.git(["status", "--porcelain", "-uall"], bob), "");
  assert.deepEqual(contentTree(bob), treeBefore);
  assert.equal(readFileSync(join(bob, ".git", "info", "exclude"), "utf8"), excludeBefore);
});

test("a clone of a committed setup: a second uninstall after a reduced manifest keeps the tracked skills", async (t) => {
  const f = gitFixture(t);
  assert.equal((await f.run(["install", "--project", "--no-git-exclude", "--yes"])).code, 0);
  f.git(["add", "-A"]);
  f.git(["commit", "-q", "-m", "omt setup"]);
  const bob = join(f.root, "bob");
  f.git(["clone", "-q", f.project, bob], f.root);
  assert.equal((await f.run(["install", "--project", "--hooks", "--yes"], { cwd: bob })).code, 0);
  const local = join(bob, ".claude", "settings.local.json");
  const settings = readJson(local);
  writeFileSync(local, `${JSON.stringify({ ...settings, permissions: { allow: ["Bash(ls)"] } }, null, 2)}\n`);

  const first = await f.run(["uninstall", "--project", "--yes"], { cwd: bob });
  assert.equal(first.code, 0, first.ctx.err());
  assert.match(first.ctx.out(), /records the created files that stay/);
  const reduced = readJson(join(bob, ".omt", "install.json"));
  assert.deepEqual((reduced.project as { existing: unknown }).existing, {
    skills: ["alpha", "beta"],
    links: ["alpha", "beta"].map((name) => join(bob, ".claude", "skills", name)),
  });

  const second = await f.run(["uninstall", "--project", "--yes"], { cwd: bob });
  assert.equal(second.code, 0, second.ctx.err());
  assert.match(second.ctx.out(), /keep {5}.*alpha {2}\(existed before the install\)/);
  assert.equal(f.git(["status", "--porcelain", "-uall"], bob), "");
});

test("uninstall --project keeps a project link that points at the user install", async (t) => {
  const f = projectFixture(t);
  assert.equal((await f.run(["install", "--yes"])).code, 0);
  const mine = join(f.project, ".claude", "skills", "mine");
  mkdirSync(dirname(mine), { recursive: true });
  symlinkSync(join(f.agents, "alpha"), mine);
  assert.equal((await f.run(["install", "--project", "--yes"])).code, 0);
  const removed = await f.run(["uninstall", "--project", "--yes"]);
  assert.equal(removed.code, 0, removed.ctx.err());
  assert.equal(readlinkSync(mine), join(f.agents, "alpha"), "the user's link stays");
  assert.ok(!existsSync(join(f.project, ".claude", "skills", "alpha")));
});

test("a project hook update backs up a settings file that is not in the layout omt writes", async (t) => {
  const f = projectFixture(t);
  const local = join(f.project, ".claude", "settings.local.json");
  mkdirSync(dirname(local));
  const other = '"/other/clone/.omt/bin/omt" hook user-prompt-submit # oh-my-t3code';
  const text = `{\n  "permissions": { "allow": ["Bash(ls)", "Bash(cat)"] },\n  "hooks": { "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": ${JSON.stringify(other)} }] }] }\n}\n`;
  writeFileSync(local, text);
  const installed = await f.run(["install", "--project", "--hooks", "--yes"]);
  assert.equal(installed.code, 0, installed.ctx.err());
  assert.match(installed.ctx.out(), /update {3}Claude UserPromptSubmit/);
  assert.equal(readFileSync(join(f.project, ".omt", "backups", STAMP, "claude-settings.json"), "utf8"), text, "the original bytes stay recoverable");
  assert.equal(readFileSync(join(f.project, ".omt", "backups", ".gitignore"), "utf8"), "*\n");
  const manifest = readJson(join(f.project, ".omt", "install.json"));
  assert.equal((manifest.hooks as { backup?: string }[])[0]?.backup, undefined, "an update backup is not the install-time backup");

  // A file in the layout that omt writes changes only in the command, so it gets no new backup.
  writeFileSync(local, readFileSync(local, "utf8").replace(join(f.project, ".omt"), "/moved/.omt"));
  const moved = await f.run(["install", "--project", "--hooks", "--yes"], { now: () => new Date("2026-01-02T03:04:10.000Z") });
  assert.equal(moved.code, 0, moved.ctx.err());
  assert.match(moved.ctx.out(), /update {3}Claude UserPromptSubmit/);
  assert.ok(!existsSync(join(f.project, ".omt", "backups", "20260102030410")));
});

test("a dangling .omt/.gitignore symlink is the user's: the install writes nothing outside the project", async (t) => {
  const f = gitFixture(t);
  const gitignore = join(f.project, ".omt", ".gitignore");
  const target = join(f.root, "dot", "omt-gitignore");
  mkdirSync(dirname(gitignore));
  symlinkSync(target, gitignore);
  const statusBefore = f.status();
  const treeBefore = contentTree(f.project);
  const installed = await f.run(["install", "--project", "--yes"]);
  assert.equal(installed.code, 0, installed.ctx.err());
  assert.match(installed.ctx.out(), /keep {5}.*\.gitignore {2}\(a dangling symlink; left alone\)/);
  assert.ok(!existsSync(target), "the link target stays absent");
  const files = (readJson(join(f.project, ".omt", "install.json")).project as { files: { path: string }[] }).files.map((file) => file.path);
  assert.ok(!files.includes(gitignore));
  assert.equal((await f.run(["uninstall", "--project", "--yes"])).code, 0);
  assert.ok(!existsSync(target));
  assert.deepEqual(contentTree(f.project), treeBefore);
  assert.equal(f.status(), statusBefore);
});

test("an install from main and a worktree is one install; an uninstall from either cwd gives the exclude file back byte for byte", async (t) => {
  for (const from of ["main", "worktree"]) {
    for (const start of ["*.log", undefined]) {
      const name = `uninstall from ${from}, ${start === undefined ? "no exclude file" : "no final newline"}`;
      const f = gitFixture(t);
      const wt = join(f.root, "wt");
      f.git(["worktree", "add", "-q", wt]);
      const info = join(f.project, ".git", "info");
      const exclude = join(info, "exclude");
      if (start === undefined) rmSync(info, { recursive: true });
      else writeFileSync(exclude, start);
      assert.equal((await f.run(["install", "--project", "--yes"], { cwd: f.project })).code, 0, name);
      const again = await f.run(["install", "--project", "--yes"], { cwd: wt });
      assert.equal(again.code, 0, name);
      assert.deepEqual([...new Set(actionLines(again.ctx.out()))], ["unchanged"], `${name}: the second install is a rerun`);
      const removed = await f.run(["uninstall", "--project", "--yes"], { cwd: from === "main" ? f.project : wt });
      assert.equal(removed.code, 0, name);
      assert.ok(!existsSync(join(f.project, ".omt", "install.json")), `${name}: the one install goes`);
      if (start === undefined) assert.ok(!existsSync(info), `${name}: the info directory goes`);
      else assert.equal(readFileSync(exclude, "utf8"), start, name);
    }
  }
});

test("--no-git-exclude: an uninstall that keeps an edited config leaves no manifest that git shows", async (t) => {
  const f = gitFixture(t);
  assert.equal((await f.run(["install", "--project", "--no-git-exclude", "--yes"])).code, 0);
  writeFileSync(join(f.project, ".omt", "config.jsonc"), `${PROJECT_STARTER_CONFIG}// mine\n`);
  const removed = await f.run(["uninstall", "--project", "--yes"]);
  assert.equal(removed.code, 0, removed.ctx.err());
  assert.match(removed.ctx.out(), /remove {3}.*install\.json/);
  assert.ok(!existsSync(join(f.project, ".omt", "install.json")));
  assert.equal(f.git(["status", "--porcelain", "-uall"]), "?? .omt/config.jsonc\n", "only the user's edited config shows");
});

test("a manifest hook backup outside .omt/backups is dropped, so the uninstall never writes or deletes that file", async (t) => {
  const f = projectFixture(t);
  const local = join(f.project, ".claude", "settings.local.json");
  const other = join(f.project, "other.json");
  const otherText = '{\n  "theme": "dark"\n}\n';
  mkdirSync(dirname(local));
  const command = "x # oh-my-t3code";
  writeFileSync(local, JSON.stringify({ theme: "dark", hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command }] }] } }, null, 2));
  writeFileSync(other, otherText);
  mkdirSync(join(f.project, ".omt"));
  const manifest = {
    scope: "project",
    root: f.project,
    package: "oh-my-t3code",
    version: "0.1.0",
    installedAt: "",
    skillsRoot: "",
    skills: [],
    links: [],
    hooks: [{ kind: "claude-user-prompt-submit", settingsPath: local, command, backup: other }],
    backups: [],
    project: { omtDirCreated: false, settingsCreated: false },
  };
  writeFileSync(join(f.project, ".omt", "install.json"), JSON.stringify(manifest));
  const removed = await f.run(["uninstall", "--project", "--yes"]);
  assert.equal(removed.code, 0, removed.ctx.err());
  assert.doesNotMatch(removed.ctx.out(), /restores the backup/);
  assert.equal(readFileSync(other, "utf8"), otherText, "the file that the manifest names stays");
  assert.deepEqual(readJson(local), { theme: "dark" });
});

test("install and uninstall remove a stale block next to the root's own block", async (t) => {
  const f = projectFixture(t);
  const gone = join(f.root, "gone");
  assert.equal((await f.run(["install", "--project", "--yes"])).code, 0);
  const own = readFileSync(f.exclude, "utf8");
  writeFileSync(f.exclude, `${own}${block(gone, "/x")}\n`);
  assert.equal((await f.run(["install", "--project", "--yes"])).code, 0);
  assert.equal(readFileSync(f.exclude, "utf8"), own, "the install removes the stale block");

  writeFileSync(f.exclude, `${own}${block(gone, "/x")}\n`);
  writeFileSync(join(f.project, ".omt", "ledger.jsonl"), "{}\n");
  assert.equal((await f.run(["uninstall", "--project", "--yes"])).code, 0);
  assert.equal(
    readFileSync(f.exclude, "utf8"),
    `${GIT_EXCLUDE_DEFAULT}${block(f.project, "/.omt/.gitignore", "/.omt/install.json")}\n`,
    "the uninstall that keeps a reduced block removes the stale block",
  );
});

test("install --project removes a scratch directory that an interrupted run left", async (t) => {
  const f = projectFixture(t);
  const scratch = join(f.project, ".agents", ".omt-tmp-0123abcd");
  mkdirSync(join(scratch, "alpha"), { recursive: true });
  const { code, ctx } = await f.run(["install", "--project", "--yes"]);
  assert.equal(code, 0, ctx.err());
  assert.match(ctx.out(), /remove {3}.*\.omt-tmp-0123abcd {2}\(left by an interrupted run\)/);
  assert.ok(!existsSync(scratch));
});

test("the exclude file gets its exact bytes back after a reinstall", async (t) => {
  const f = projectFixture(t);
  writeFileSync(f.exclude, "*.log");
  assert.equal((await f.run(["install", "--project", "--yes"])).code, 0);
  assert.equal((await f.run(["install", "--project", "--yes"])).code, 0);
  assert.equal((await f.run(["uninstall", "--project", "--yes"])).code, 0);
  assert.equal(readFileSync(f.exclude, "utf8"), "*.log");
});

test("--project refuses a root whose paths are the user-scope Claude, config, or agents paths", async (t) => {
  const f = projectFixture(t);
  const cases: Record<string, () => Partial<Record<string, string>>> = {
    CLAUDE_CONFIG_DIR: () => ({ CLAUDE_CONFIG_DIR: join(f.project, ".claude") }),
    OMT_CONFIG_DIR: () => ({ OMT_CONFIG_DIR: join(f.project, ".omt") }),
    "a symlinked ~/.agents": () => {
      mkdirSync(join(f.project, ".agents", "skills"), { recursive: true });
      symlinkSync(join(f.project, ".agents"), join(f.home, ".agents"));
      return {};
    },
  };
  for (const [name, setup] of Object.entries(cases)) {
    const env = { HOME: f.home, ...setup() };
    const { code, ctx } = await f.run(["install", "--project", "--yes"], { env });
    assert.equal(code, 2, `${name}: ${ctx.err()}`);
    assert.match(ctx.err(), /shares paths with the user install/, name);
  }
});

test("a kept edited config that the user reverts goes with the next uninstall", async (t) => {
  const f = gitFixture(t);
  const treeBefore = contentTree(f.project);
  assert.equal((await f.run(["install", "--project", "--yes"])).code, 0);
  const config = join(f.project, ".omt", "config.jsonc");
  writeFileSync(config, `${PROJECT_STARTER_CONFIG}// mine\n`);
  const kept = await f.run(["uninstall", "--project", "--yes"]);
  assert.equal(kept.code, 0, kept.ctx.err());
  assert.ok(existsSync(config));
  writeFileSync(config, PROJECT_STARTER_CONFIG);
  const last = await f.run(["uninstall", "--project", "--yes"]);
  assert.equal(last.code, 0, last.ctx.err());
  assert.match(last.ctx.out(), /remove {3}.*config\.jsonc/);
  assert.deepEqual(contentTree(f.project), treeBefore);
});
