# Install oh-my-t3code

omt has two install modes:

- The project install puts omt into one repository. It does not change `~/.agents/skills`, `~/.claude`, or your `PATH`. Start here.
- The global install puts `omt` on your `PATH` and installs the skills for your user, so every project gets them.

Both modes install the same nine skills. After either install, restart your agent sessions in T3 Code. A running session does not load new skills.

If you are a coding agent, follow the [agent quick start](agents/quickstart.md) instead. It has the same project install as steps with checks.

## Requirements

- T3 Code v0.1.0 or later.
- Claude Code, Codex, or both, signed in and enabled in T3 Settings, Providers.
- Node.js 22.18 or later.
- git.
- pnpm, only for the global install.

## Install into one project

The project install runs the CLI from a clone. It needs only Node 22.18 or later. You do not need `pnpm install` to run `node <clone>/src/cli.ts`, because Node runs the TypeScript sources directly.

Clone the repository, then run the CLI from the clone in the target project:

```sh
git clone https://github.com/gabimoncha/oh-my-t3code.git /path/to/oh-my-t3code
cd /path/to/your-project
node /path/to/oh-my-t3code/src/cli.ts install --project --hooks
node /path/to/oh-my-t3code/src/cli.ts doctor --project
```

The install shows its plan first and asks before it writes. Add `--yes` to skip the question. Add `--dry-run` to print the plan and write nothing. `--hooks` adds the Claude Code hook that arms ultrawork with the `ulw` keyword. Leave it out if you use only Codex.

The project install refuses to run in your home directory, because there the project paths are the global paths.

Restart the agent sessions of this project in T3 Code. A running session does not load new skills.

### What the project install writes

The install writes these paths in the project root:

| Path | What |
| --- | --- |
| `.agents/skills/<skill>` | A copy of each skill. Codex, Cursor, OpenCode, Pi, and Antigravity read this directory. |
| `.claude/skills/<skill>` | A relative symlink to the copy, for Claude Code. |
| `.omt/config.jsonc`, `.omt/plans/` | The project config and the plans directory, as `omt init` creates them. |
| `.omt/bin/omt` | A shell script that runs the CLI from your clone. It tries the Node binary that ran the install, and falls back to `node` on `PATH` after a Node upgrade. |
| `.claude/settings.local.json` | The `ulw` hook entry, only with `--hooks`. The hook calls `.omt/bin/omt`. |
| `.omt/install.json`, `.omt/backups/` | The manifest and the backups. |

Agents in the project call the CLI as `.omt/bin/omt` when `omt` is not on `PATH`.

### How git stays clean

Git does not see these files. The install writes one managed block into the repository's `.git/info/exclude`, so `git status` shows nothing new. That file is local to your clone and is never committed. The block names only the files that the install writes. A `.gitignore` with `*` in `.omt/backups/` hides the backups from git.

The plans in `.omt/plans/` are shared by all worktrees and do not show in git, because `.omt/.gitignore` holds `plans/`. To keep a finished plan, copy it outside `.omt/` and commit it there.

Each project root has its own block. In a monorepo, the entries of a package start with the package path, so packages do not hide each other's files.

A repository has one project install, in the main checkout. `install`, `uninstall`, or `doctor` with `--project` in a worktree acts on the main checkout and its `.omt`, which all worktrees share. The skill folders stay in the main checkout. So an agent in a worktree finds them only if its harness reads the skill folders of the main checkout.

### Set up new worktrees

T3 can run a setup script in each new worktree before the agent starts. Without one, a worktree thread has no `node_modules`. `install --project`, `init`, and `doctor --project` each print one line about the setup of the current checkout. Check it in full:

```sh
.omt/bin/omt worktree check
```

For a Bun or pnpm project without a setup script, generate one:

```sh
.omt/bin/omt worktree setup --dry-run
.omt/bin/omt worktree setup --yes
```

This writes `t3.json` and `.t3/omt-worktree-setup.mjs` in the current checkout, also in a linked worktree. For pnpm, it also writes `pnpm-workspace.yaml` with `enableGlobalVirtualStore: true` when that file is missing. The runner uses only Node, so it works in worktrees without omt. It installs from the lockfile with a frozen install and the isolated linker, into a global virtual store, so worktrees share the installed package directories. It needs Bun 1.3.14 or later, or pnpm 10.12.1 or later, already on `PATH`. It downloads no package manager and sets no global configuration. It stops instead of converting an existing `node_modules`.

omt never rewrites an existing `t3.json`, runner, or `pnpm-workspace.yaml`, and never changes a linker or store setting. pnpm needs the store setting in `pnpm-workspace.yaml`: without it, a later `pnpm run` or `pnpm exec` can re-install `node_modules` with a local store. When an existing `pnpm-workspace.yaml` lacks the setting, turns it off, or cannot be read, `omt worktree setup` prints `Setup is incomplete` with the line to add and exits 1, `omt worktree check` shows it on its `store` line, and the runner stops before it installs anything. Add `enableGlobalVirtualStore: true` (or `virtualStoreType: global` with pnpm 11.23.0 or later) as a top-level line.

omt also refuses a `.t3` folder or runner that is a symlink, even one that stays inside the checkout. Node runs a linked script from the link target, so the runner would install in another folder.

The files do nothing until T3 saves the script. T3 runs setup scripts from the project's saved scripts, not from `t3.json`. To activate:

1. Commit `t3.json`, `.t3/`, and for pnpm `pnpm-workspace.yaml` on the branch that new worktrees start from. Before that, a new worktree would lack the runner, and its setup would fail.
2. In T3 Project Settings, import Setup from `t3.json`. Keep the scripts that the project inherits.
3. Check that Setup is the project's setup script, then open a new worktree thread and run `omt worktree check` there.

### When `settings.local.json` shows in git

One file can still show in git. When the repository tracks `.claude/settings.local.json`, `git status` shows it as modified while the hook is installed.

The install edits the file in its own style. It keeps the indentation, and a final newline only when the file had one. It writes the whole file in that indentation, so inline arrays in an indented file become multi-line. When an install changes the layout of the file this way, it first saves the original bytes in `.omt/backups/`.

### Commit the setup instead

The install creates `.omt/.gitignore` only when it is missing, and never edits a file that the repository already has. When an earlier install created the file and nobody edited it, the install adds the new lines to it.

Add `--no-git-exclude` to skip the block, for a setup that you want to commit. It also removes a block that an earlier install wrote. Then the install adds the missing lines to an existing `.omt/.gitignore`, and the uninstall removes them again.

A teammate who clones a committed setup runs `install --project` to get the shim, because `.omt/.gitignore` keeps `.omt/bin/` out of git. That install records the committed skills and links as existing. The block does not hide them, and the uninstall keeps them. When the committed skills are older than the CLI, the install updates them, and git shows them as modified.

### Copy or move a project

After you copy or move the project, run the commands in the new place. They read the manifest relative to the new root and never change the old one.

The install replaces the block of the old path, unless the old path still has its own install in the same exclude file. That happens when you copy a package inside one repository.

### Remove the project install

```sh
node /path/to/oh-my-t3code/src/cli.ts uninstall --project
```

The uninstall removes the skills, the links, the shim, the hook entry, the exclude block, and the manifest. It also removes each file and empty directory that the install created.

When the settings file that is left after the uninstall removes the hook entry equals the backup from the install, the uninstall writes the backup's bytes back and deletes the backup. So the project and `.git/info/exclude` are byte for byte as they were before the install, apart from the plans, the ledger, and the evidence that you added. These stay. When the ledger or the evidence stays, `.omt/.gitignore` stays too, so git does not show them.

A path that `install --force` replaced stays in `.omt/backups/`, and the uninstall does not move it back. Git does not show it there.

The uninstall keeps these files:

- A file that the install created and that you edited.
- A locally modified skill.
- A `settings.local.json` that the install created, when other keys are in it, such as the permissions that Claude Code writes there. The exclude block then keeps only the paths that stay.

When you edited `settings.local.json` while omt was installed, the uninstall cannot write the old bytes back. It removes only the omt entry, and the backups stay in `.omt/backups/`, where git does not see them.

Add `--purge` to also remove an edited `.omt/config.jsonc` that the install created.

While a file that the install created stays, `.omt/install.json` stays too. The uninstall reduces it to a record of these files and of the skills and links that existed before the install. So a later install or uninstall keeps these files hidden from git and keeps the existing skills and links. The uninstall that removes the last of them also removes this record.

The uninstall removes every omt hook entry. This includes an entry that was already in a tracked `settings.local.json` before you installed, such as the entry of another clone. Git then shows that file as modified.

## Install for your user

The global install needs pnpm. Install the CLI from a clone:

```sh
git clone https://github.com/gabimoncha/oh-my-t3code.git
cd oh-my-t3code
pnpm install
pnpm build
pnpm link --global
```

Then install the skills:

```sh
omt install
```

`omt install` shows its plan first and asks before it writes. Add `--yes` to skip the question.

To arm ultrawork with the `ulw` keyword in Claude Code, also install the hook:

```sh
omt install --hooks
```

Check the result:

```sh
omt doctor
```

Restart your agent sessions in T3 Code after the install. A running session does not load new skills.

### What the global install writes

| Path | What |
| --- | --- |
| `~/.agents/skills/<skill>` | A copy of each skill. Codex, Cursor, OpenCode, and Pi read this directory. |
| `~/.claude/skills/<skill>` | A relative symlink to the copy, for Claude Code. |
| `~/.gemini/config/skills/<skill>` | A symlink, only when `~/.gemini` exists or you select the `gemini` target. |
| `~/.config/oh-my-t3code/config.jsonc` | Your config. |
| `~/.config/oh-my-t3code/install.json` | The manifest of what the install added. |
| `~/.config/oh-my-t3code/backups/` | Backups of anything that the install replaced or edited. |
| `~/.claude/settings.json` | One `UserPromptSubmit` hook entry, only with `--hooks`. Other settings stay unchanged. |
| `.omt/` in a project | The project config, plans, ledger, locks, local guardrail proposals, and evidence files, including the plan pages under `evidence/visuals/`. |

Each installed skill directory holds a `.omt-managed.json` marker. The install never overwrites a path that it does not manage, unless you pass `--force`. With `--force`, it moves the old path to the backups directory first.

### Remove the global install

```sh
omt uninstall
```

`omt uninstall` removes the managed skill copies, the links that point at them, the hook entry, and the manifest. It keeps your config. Add `--purge` to remove the config too. It never removes a path that it does not manage. Project `.omt/` directories stay in place.

## Set the Codex unload delay

Do this if you use Codex children, with either install mode. Open T3 Code Settings, Providers, Codex, and set Launch arguments to `-c thread_unload_delay_secs=60`, with no quotes.

As of 2026-10-17, Codex 0.163.0 keeps a released thread and its MCP server processes for 30 minutes by default. With this setting, a child that omt settles closes after one minute. T3 applies the setting when it starts its next Codex app-server.
