# Install oh-my-t3code

You install omt in two parts. First, install the `omt` CLI from a package registry or as a release binary. You do not clone the repository. Then let the CLI install the skills, in one of two modes:

- The project install puts omt into one repository. It does not change `~/.agents/skills`, `~/.claude`, or your `PATH`. Start here.
- The global install installs the skills for your user, so every project gets them.

Both modes install the same nine skills. After either install, restart your agent sessions in T3 Code. A running session does not load new skills.

If you are a coding agent, follow the [agent quick start](agents/quickstart.md) instead. It has the same project install as steps with checks.

## Requirements

- T3 Code v0.1.0 or later.
- Claude Code, Codex, or both, signed in and enabled in T3 Settings, Providers.
- git.
- For the npm package: Node.js 22 or later on `PATH`. On a machine with only Bun 1.4.3 or later, see [Run the npm package with Bun only](#run-the-npm-package-with-bun-only). The release binary needs neither Node nor Bun.

## Install the CLI

Pick one channel. The commands that each channel gives are in the last column.

| Channel | Command | Run omt as |
| --- | --- | --- |
| mise, release binary | `mise use -g github:gabimoncha/oh-my-t3code` | `omt` |
| mise, npm package | `mise use -g npm:oh-my-t3code` | `omt` |
| npm, global | `npm i -g oh-my-t3code` | `omt` |
| pnpm, global | `pnpm add -g oh-my-t3code` | `omt` |
| Bun, global | `bun add -g oh-my-t3code` | `omt` |
| npm, dev dependency | `npm i -D oh-my-t3code` | `npx omt` |
| pnpm, dev dependency | `pnpm add -D oh-my-t3code` | `pnpm exec omt` |
| Bun, dev dependency | `bun add -D oh-my-t3code` | `bunx omt` |
| One-shot | none | `npx omt3`, `bunx omt3`, or `pnpm dlx omt3` |

To check the install, run the command of the last column with `--version`. It prints the omt version, such as `0.1.0`.

The `omt` command of the npm package needs `node` on `PATH`. This applies to the mise npm channel and to the global npm, pnpm, and Bun channels. On a machine with Bun but no Node, use the release binary, or run the package as [Run the npm package with Bun only](#run-the-npm-package-with-bun-only) shows.

### Release binary

`mise use -g github:gabimoncha/oh-my-t3code` downloads a binary from the GitHub release. The binary holds the skills and needs neither Node nor Bun. The release has binaries for macOS on arm64 and x64, and for Linux on arm64 and x64, with glibc or musl. Windows has no binary yet.

To pin a version, add it after `@`. For example, `mise use -g github:gabimoncha/oh-my-t3code@0.1.0` installs version 0.1.0.

By default, recent mise versions hide a release for its first 24 hours, through the setting `minimum_release_age`. In that time, `mise use -g github:gabimoncha/oh-my-t3code` installs the previous release, or fails with `no versions found ... matching minimum_release_age` when no older release exists. A pinned version, such as `@0.1.0`, installs the new release at once.

mise checks the archive against the `SHA256SUMS` file of the release. mise puts `omt` on your `PATH` only in a shell where mise is active, or where the mise shims directory is on `PATH`. `mise which omt` prints the path of the binary.

### npm package

The npm package `oh-my-t3code` holds one JavaScript file, `dist/cli.js`, and the skills. It has no dependencies. It gives three commands: `omt`, `omt3`, and `oh-my-t3code`. All three run the same file. The file starts with `#!/usr/bin/env node`, so these commands need Node 22 or later on `PATH`. Bun 1.4.3 or later can also run the file, through `bunx` or `bun`.

`mise use -g npm:oh-my-t3code` installs the npm package through mise. To make mise install it with Bun instead of npm, set the mise setting first:

```sh
mise settings set npm.package_manager bun
```

This setting changes only the package manager. The `omt` command still needs Node on `PATH`.

A dev dependency installs omt into one project only. The project needs a `package.json`. The install changes `package.json` and the lockfile, and git shows these changes. Run omt through the package manager of the project, as the table shows.

### One-shot run

A one-shot run installs no CLI. The runner downloads the npm package `omt3` and runs it once:

```sh
npx omt3 install --project
bunx omt3 install --project
pnpm dlx omt3 install --project
```

`omt3` is the same build as `oh-my-t3code`, under a name that a runner can download. Use `npx omt3`, not `npx omt`. Outside a project that installed omt, `npx omt` downloads a different npm package named `omt`.

A one-shot run can install only into a project. A global install from a one-shot run is refused, because no `omt` command would stay for the skills and the hook.

### Run the npm package with Bun only

On a machine with Bun 1.4.3 or later and no Node, the bare `omt` command fails with `env: node: No such file or directory` and exit code 127. For this machine, the release binary is the best channel, because it needs neither Node nor Bun. To use the npm package, run it through Bun:

| Channel | Run omt as |
| --- | --- |
| Bun, dev dependency | `bunx omt` |
| One-shot | `bunx omt3` |
| Bun, global | `bun "$(bun pm bin -g)/omt"` |
| Any copy of the package | `bun <package>/dist/cli.js` |

When `node` is not on `PATH`, `bunx` runs the package with Bun. To run it with Bun also when an old Node is on `PATH`, add `--bun`, such as `bunx --bun omt`. `bun pm bin -g` prints the directory of the global Bun commands.

An install that runs through Bun records Bun in the shim, so `.omt/bin/omt` works with no Node. A one-shot shim runs `bunx omt3@<version>`, which also works with no Node.

The global install through Bun works too: `bun "$(bun pm bin -g)/omt" install`. But the skills look for the CLI as `omt` on `PATH` first, then as `.omt/bin/omt`. With no Node, `omt` on `PATH` cannot run. So when the directory that `bun pm bin -g` prints is on `PATH`, the skills find an `omt` that fails. On a machine with only Bun, use the release binary, a Bun dev dependency, or a one-shot run.

## Install into one project

Run the install in the project root, with the command of your channel. This example uses `omt`:

```sh
cd /path/to/your-project
omt install --project --hooks
omt doctor --project
```

After a dev-dependency install, run `npx omt install --project`, `pnpm exec omt install --project`, or `bunx omt install --project`. For a one-shot run, run `npx omt3 install --project`, `bunx omt3 install --project`, or `pnpm dlx omt3 install --project`.

The install shows its plan first and asks before it writes. Add `--yes` to skip the question. Add `--dry-run` to print the plan and write nothing. `--hooks` adds the Claude Code hook that arms ultrawork with the `ulw` keyword. Leave it out if you use only Codex.

The first line of `omt doctor --project` names what runs omt. It is `PASS  runtime  omt 0.1.0 binary` for the release binary, or the runtime and its version, such as `PASS  runtime  node 22.21.1` or `PASS  runtime  bun 1.4.3`. Node older than 22 or Bun older than 1.4.3 gives a `FAIL` line.

The project install refuses to run in your home directory, because there the project paths are the global paths. It also refuses to run when the CLI is in the temp directory, other than a runner cache, because such a path can disappear. The refusal lists the install channels.

Restart the agent sessions of this project in T3 Code. A running session does not load new skills.

### What the project install writes

The install writes these paths in the project root:

| Path | What |
| --- | --- |
| `.agents/skills/<skill>` | A copy of each skill. Codex, Cursor, OpenCode, Pi, and Antigravity read this directory. |
| `.claude/skills/<skill>` | A relative symlink to the copy, for Claude Code. |
| `.omt/config.jsonc`, `.omt/plans/` | The project config and the plans directory, as `omt init` creates them. |
| `.omt/bin/omt` | The shim: a shell script that runs the CLI that made the install. The next section lists its forms. |
| `.claude/settings.local.json` | The `ulw` hook entry, only with `--hooks`. The hook calls `.omt/bin/omt`. |
| `.omt/install.json`, `.omt/backups/` | The manifest and the backups. |

Agents in the project call the CLI as `.omt/bin/omt` when `omt` is not on `PATH`.

### What the shim runs

The install records the CLI that made the install in `.omt/bin/omt`. The shim has one of these forms:

| CLI that made the install | The shim runs | When the recorded file is gone |
| --- | --- | --- |
| The release binary | The recorded binary. | The fallback order below. |
| The npm package: global, mise, or a dev dependency | The recorded `dist/cli.js` with the recorded Node or Bun. When that runtime is gone, it uses `node` on `PATH`, so a Node upgrade does not break the shim. | The fallback order below. |
| A one-shot run | `npx --yes omt3@<version>`, `bunx omt3@<version>`, or `pnpm dlx omt3@<version>`, with the version that made the install. | The runner downloads the package again. |
| A clone of the repository | The recorded `src/cli.ts` with the recorded Bun, or `bun` on `PATH`. | No fallback. |

For the release binary and the npm package, the shim tries these commands in order when the recorded file is gone, for example after an upgrade moves it:

1. `<project>/node_modules/.bin/omt`, from a dev dependency.
2. The first `omt` on `PATH` that is not the shim itself.
3. None. The shim prints `omt: the omt CLI is not installed; see https://github.com/gabimoncha/oh-my-t3code#install` and exits 127.

A one-shot shim calls the runner on each call. After the runner's cache is cleared, the next call downloads the package again and needs the network. The install prints a `note:` line that says so.

With `--hooks`, the Claude Code hook calls the shim on each prompt. After a one-shot install, the hook therefore runs the runner on each prompt. If the runner's cache is cleared and the network is down, the hook can pass its 10-second timeout. For a project that uses the hook, a global install or a dev dependency is more reliable.

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
.omt/bin/omt uninstall --project
```

The uninstall removes the shim. Run later commands with the command of your channel, such as `omt` or `npx omt3`.

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

The global install needs `omt` on your `PATH`. Install the CLI with a global channel first: `mise use -g github:gabimoncha/oh-my-t3code`, `mise use -g npm:oh-my-t3code`, `npm i -g oh-my-t3code`, `pnpm add -g oh-my-t3code`, or `bun add -g oh-my-t3code`. The npm package channels need Node on `PATH`. On a machine with only Bun, use the release binary, as [Run the npm package with Bun only](#run-the-npm-package-with-bun-only) explains.

Then install the skills:

```sh
omt install
```

`omt install` shows its plan first and asks before it writes. Add `--yes` to skip the question.

To arm ultrawork with the `ulw` keyword in Claude Code, also install the hook:

```sh
omt install --hooks
```

The hook command in `~/.claude/settings.json` names the CLI that made the install: the binary, or the runtime and `dist/cli.js` of the npm package. When an upgrade moves one of these files, `omt doctor` prints a `FAIL  hooks` line. Run `omt install --hooks` again to write the new paths.

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

`omt uninstall` does not remove the CLI. To remove it, use the command of its channel, such as `mise unuse -g github:gabimoncha/oh-my-t3code`, `npm rm -g oh-my-t3code`, `pnpm rm -g oh-my-t3code`, or `bun rm -g oh-my-t3code`.

## Set the Codex unload delay

Do this if you use Codex children, with either install mode. Open T3 Code Settings, Providers, Codex, and set Launch arguments to `-c thread_unload_delay_secs=60`, with no quotes.

As of 2026-10-17, Codex 0.163.0 keeps a released thread and its MCP server processes for 30 minutes by default. With this setting, a child that omt settles closes after one minute. T3 applies the setting when it starts its next Codex app-server.
