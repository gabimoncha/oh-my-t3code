# Worktree setup

T3 runs a project's setup script in each new worktree. Without one, saved in T3 or inherited, a worktree thread starts with no `node_modules`, and the checks that need dependencies fail. Use this page on the first omt run in a project, and when `omt worktree check` prints `WARN`. Do not repeat it on every command.

T3 tools appear here by base name. Your harness may add a prefix, such as `mcp__t3-code__t3_project_read`.

## 1. Check the checkout

Run `omt worktree check` in the checkout you work in. It reads only that checkout. In a linked worktree it reports the worktree's own files, while `.omt` stays in the main checkout.

Read the `setup` line and the `next:` line:

| `setup` state | Meaning |
| --- | --- |
| no setup needed | no `package.json` or lockfile; stop here |
| `t3.json` missing | the repository has no setup script; a saved or inherited T3 setup can still exist (step 2), so activation is unverified |
| invalid, or no `runOnWorktreeCreate` script | fix `t3.json` by hand; omt never rewrites it |
| runs `node .t3/omt-worktree-setup.mjs` | the omt runner; for pnpm, the setup is complete only when the `store` line is `PASS` |
| any other command | a custom setup; omt keeps it and cannot verify it |

Done when: you know the `setup` state and the `next:` action.

## 2. Read the effective setup in T3

`t3.json` is a file in the repository. T3 does not read it when it creates a worktree. T3 runs the setup from the project's saved scripts. Work out the saved scripts in this order, the order of T3's `resolveProjectScripts`:

1. `projectSettingsOverrides[<projectId>].defaultProjectScripts` in T3 settings, when it is set. An empty list wins too: it means no scripts.
2. When `projectSettingsFolded` is true: `defaultProjectScripts`, the scripts inherited from the environment.
3. Otherwise the legacy `projectScriptOverrides[<projectId>]`. `null` means `defaultProjectScripts`.
4. Otherwise the project's own `scripts` when the list is not empty, else `defaultProjectScripts`.

The setup is the first script with `runOnWorktreeCreate: true`. `async: false` makes T3 wait for it before the agent starts.

Read the project with `t3_project_read` when you have it. Read the settings from `$T3CODE_HOME/userdata/settings.json`, or `~/.t3/userdata/settings.json`, when you can. Never edit that file. A project read alone is not enough: an empty `scripts` list does not rule out an inherited setup script. When you cannot read a source, say that the effective setup is unverified.

Done when: you name the effective setup script, or you say which source you could not read.

## 3. Keep a compatible setup

When the effective setup or `t3.json` already has a setup script, keep it. Do not replace it with the omt runner.

Verify a custom command before you count it as working:

1. It installs from the lockfile without changing it, such as `pnpm install --frozen-lockfile` or `bun install --frozen-lockfile`.
2. It waits (`async: false`).
3. Two checkouts reuse one store: the real path of one dependency is the same in both, for example `realpath node_modules/<package>`.

Report each check that you could not run as unverified.

Done when: the setup is verified, or you list what is unverified.

## 4. Generate a missing setup

Only when no setup exists, and only with the owner's yes:

1. `omt worktree setup --dry-run`. It plans `t3.json` and `.t3/omt-worktree-setup.mjs` in the current checkout, and for pnpm a missing `pnpm-workspace.yaml` with `enableGlobalVirtualStore: true`. It refuses an unsupported or ambiguous package manager, a version range, a pinned version below the minimum, an explicit linker other than `isolated`, or a symlinked `.t3` folder or runner. Report the refusal and its action to the owner.
2. `omt worktree setup --yes`.
3. For pnpm, when the output says `Setup is incomplete`, an existing `pnpm-workspace.yaml` does not select the global store. omt never changes that file. Show the owner the line to add. Without it, the runner stops before it installs anything, because a later `pnpm run` would re-install `node_modules` with a local store.

Done when: the files exist and `omt worktree check` shows no `WARN` on `store` or `setup`, or you reported why setup refused or what the owner must add.

## 5. Activate only on the base branch

New worktrees start from a branch. A setup script that the branch lacks fails in every new worktree. So:

1. The owner commits `t3.json`, `.t3/`, and for pnpm `pnpm-workspace.yaml` on the branch that new worktrees start from.
2. Only after that, and only when the owner's yes covers activation, import Setup. Use T3 Project Settings, which writes `projectSettingsOverrides[<projectId>].defaultProjectScripts`. Use an app tool only when it writes that same override. Updating only the project's `scripts` does not activate the setup when `projectSettingsFolded` is true.
3. A new project override replaces the inherited scripts. Copy the inherited scripts into it, then add Setup.
4. Never change `defaultProjectScripts`, the environment defaults.
5. Read the effective scripts again in the order of step 2, and confirm that Setup is the first `runOnWorktreeCreate` script.

When you cannot do step 5, report activation as unverified, with the remaining step for the owner.

Done when: the read-back shows Setup as the effective setup, or you reported the pending activation step.
