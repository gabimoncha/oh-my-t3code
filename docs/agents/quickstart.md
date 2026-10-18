# Agent quick start

Read this page when your user asks you to evaluate, install, or use oh-my-t3code (`omt`). Do the steps in order. Each step ends with a check. Go to the next step only when the check passes.

## What omt is

omt is a set of skills and a small CLI for agents that run in [T3 Code](https://t3.codes). A T3 thread that runs an omt skill becomes a conductor: it writes a plan, sends each unit to a role-routed model as a T3 child task, and reviews and verifies the result. The CLI has no runtime dependencies, makes no network calls, and sends no telemetry.

## 1. Check the fit

Check each requirement on the user's machine. Ask the user about the items that you cannot check yourself.

| Requirement | How to check |
| --- | --- |
| T3 Code v0.1.0 or later. It is free for macOS, Windows, and Linux. Install it from https://t3.codes. | Ask the user, or look for `~/.t3/userdata/settings.json`. |
| At least one provider signed in and enabled in T3 Settings, Providers: Claude Code (`claude auth login`), Codex with a ChatGPT sign-in, or both. | Run `claude auth status` or `codex login status` when the CLI is on `PATH`. Ask the user to confirm the provider is enabled in T3. |
| Node.js 22.18 or later. | `node --version` |
| git. | `git --version` |
| Optional: `flock` or `lockf`, for shared build locks. Without either, `omt lock run` runs the command with a warning. | `command -v flock || command -v lockf` |

Tell the user what one provider family costs them:

- With both Claude and GPT, `plan-review`, `review`, and `oracle` come from the other family than the worker. This is cross-family review.
- With one family, the same family reviews its own work.
- The `design` and `ui` roles run only on Claude Opus 5.5 and have no fallback. Without Claude Code, omt cannot do design or UI units.

Check: Node is 22.18 or later, git exists, and the user confirms T3 Code and at least one signed-in provider. If T3 Code or a provider is missing, tell the user what to install and stop.

## 2. Find out if you run in a T3 thread

Look in your tool list for the tools of the `t3-code` MCP server, such as `orchestrator_capabilities`, `delegate_task`, and `task_status`. Your harness can add a prefix, such as `mcp__t3-code__orchestrator_capabilities` or `mcp__t3_code__orchestrator_capabilities`. Some harnesses connect MCP servers late. Search your deferred tools once before you decide the tools are missing.

The tools alone do not prove that you run in a T3 thread. An agent outside T3 can connect to the T3 MCP server through OAuth and see the same tools. If the tools are present, call `orchestrator_capabilities` with no arguments and read `parentThreadId` in the result.

- If `parentThreadId` is a string, you run in a T3 thread. You can install omt and also run its skills.
- If `parentThreadId` is `null`, or the tools are missing, you run outside a T3 thread. You can still install omt (steps 3 to 5). Do not run the omt skills. Tell the user: "omt skills run only inside a T3 Code thread, because `delegate_task` and `task_status` need a T3 thread as the caller. After the install, open this project in T3 Code and start a new Claude Code or Codex thread there."

Check: you know the value of `parentThreadId`, or you know that the tools are missing. If you run outside a T3 thread, you told the user.

## 3. Clone omt

Clone omt into a directory outside the user's project, and keep it there. The project install runs the CLI from this clone. This page uses `$HOME/src/oh-my-t3code`. If you pick another directory, replace that path in every command.

```sh
git clone https://github.com/gabimoncha/oh-my-t3code.git "$HOME/src/oh-my-t3code"
```

The project install needs no `pnpm install`. Node runs the TypeScript sources directly.

Check: `node "$HOME/src/oh-my-t3code/src/cli.ts" --help` prints the usage.

## 4. Install omt into the project

Run these commands in the root of the user's project. The project install writes only inside the project and hides its files from git through `.git/info/exclude`. It does not change `~/.agents/skills`, `~/.claude`, or `PATH`. It refuses to run in the home directory.

Add `--hooks` only when the user runs Claude Code. The hook lets the user start ultrawork with the bare `ulw` keyword. Codex gets no hook. Codex users type `$omt-ulw`.

First, show the plan and write nothing:

```sh
node "$HOME/src/oh-my-t3code/src/cli.ts" install --project --hooks --dry-run
```

Then apply it. Without a terminal, the install does not ask. It prints `Re-run with --yes to apply.` and changes nothing, so pass `--yes`:

```sh
node "$HOME/src/oh-my-t3code/src/cli.ts" install --project --hooks --yes
```

Check the install:

```sh
node "$HOME/src/oh-my-t3code/src/cli.ts" doctor --project
```

Expect these lines, with paths in the user's project:

```text
PASS  node     node <version>
PASS  config   15 roles
PASS  skills   9 skills installed in <project>/.agents/skills
PASS  links    9 links in <project>/.claude/skills
PASS  hooks    Claude UserPromptSubmit hook in <project>/.claude/settings.local.json
PASS  shim     <project>/.omt/bin/omt
PASS  exclude  omt block in <project>/.git/info/exclude
PASS  t3       <home>/.t3/userdata/settings.json
```

Without `--hooks`, the `hooks` line is `INFO  hooks  no hook installed; ...`. That is correct for Codex.

A `WARN  t3` line means doctor found no T3 settings file: `... settings.json does not exist; is T3 Code installed?`. The install itself is fine. Ask the user if T3 Code is installed. If T3 Code keeps its data in another place, set `T3CODE_HOME` to that directory and run doctor again.

A `WARN  skills` line means the installed skills do not match the clone. Doctor still exits 0, so read the line. Run the install with `--yes` again. If the line says `modified:`, the user edited an installed skill. Ask the user before you add `--force`, which backs up the edited skill and installs over it.

Check: this command prints the `PASS  skills` line:

```sh
node "$HOME/src/oh-my-t3code/src/cli.ts" doctor --project | grep -E '^PASS +skills '
```

Also check that doctor prints no `FAIL` line, and that `git status --short` shows no new files from the install.

After the install, agents in this project call the CLI as `.omt/bin/omt`. The commands below use that path. If `omt` is on `PATH` from a global install, `omt` works too.

## 5. Restart the agent sessions

A running session does not load new skills. Tell the user to close the T3 threads of this project and start new ones.

If the user runs Codex children, also tell them to open T3 Code Settings, Providers, Codex, and set Launch arguments to `-c thread_unload_delay_secs=60`, with no quotes. Codex 0.163.0 keeps a released thread and its MCP server processes for 30 minutes by default. With this setting, a finished child closes after one minute.

Check: the user confirms that the new threads are open. If you run in one of them, `omt-ulw` is in your skill list.

## 6. Give the user three first tasks

Suggest these tasks, in this order. Each runs in a T3 thread of the project.

1. A small change with the ultrawork loop. Pick a real, small task from the project. For example:

   ```text
   $omt-ulw add a --version flag to the CLI
   ```

   With the Claude Code hook, `ulw add a --version flag to the CLI` works too. A small task gets a LIGHT run: a short plan, one `execute` child per unit, and the profile's review.

2. A review of the uncommitted changes:

   ```text
   $omt-review the uncommitted changes
   ```

3. A cited answer to a question about the project or a library:

   ```text
   $omt-research how does this project load its config?
   ```

`$omt-ulw` is the T3 composer mention. T3 turns it into each provider's form: `/omt-ulw` for Claude Code and `$omt-ulw` for Codex.

The user starts three skills by name. An agent does not pick them on its own:

- `$omt-loop` keeps a plan going across turns until a condition command reports done. On Claude and Codex threads, the skill asks the user to type `/goal <objective>`.
- `$omt-swarm` splits work into independent tracks. Each track runs in its own T3 worktree thread and ends in a pull request. The thread must run in `full-access` runtime mode and `default` interaction mode.
- `$omt` lists the workflows, the CLI commands, and the shared references.

Check: the user knows the three first tasks and how to start the three user-started skills.

## 7. Show the user how to customize roles and profiles

Show the current setup:

```sh
.omt/bin/omt roles
.omt/bin/omt profile list
.omt/bin/omt profile show normal --json
```

`omt roles` prints the selected target of each role. `omt profile list` prints the presets `normal`, `prototype`, and `pr-review`, and any custom profiles. `omt profile show <name> --json` prints the resolved workflow, limits, roles, and models of one profile.

Tell the user how to change them:

- Pick a profile for one run: `$omt-ulw --profile prototype <task>`. Pick a default: set `"profile": "<name>"` in `.omt/config.jsonc`. Switch a running plan: `.omt/bin/omt plan profile <slug> <name>`.
- Write a profile: add it under `profiles` in `.omt/config.jsonc` (this project) or `~/.config/oh-my-t3code/config.jsonc` (all projects). A profile `extends` a preset and can switch workflow steps and override roles, models, and limits. A profile without `extends` inherits `normal`. The README section "Choose a workflow" has an example.
- Add a custom role: add it under `roles` in the same config files. A new role needs `description`, `access`, and `chain`. Its `result` field picks the result block: `work`, `review`, `test`, `research`, `plan`, or `guardrail`.
- Add a persona: write `.omt/roles/<role>.md`. Its content is the persona and rules for that role, and it replaces the bundled persona. The lookup order is `.omt/roles/`, then `~/.config/oh-my-t3code/roles/`, then the bundled personas.

Check: `.omt/bin/omt config validate` reports no errors after each config change.

## 8. Tell the user what a run costs

omt counts child tasks, not tokens. Tell the user:

- A unit costs about 5 child tasks in the `normal` profile, and about 4 in `prototype`: the work, its reviews, and its checks.
- The default budget is 24 child tasks per run. That fits about 3 to 4 units.
- The default limit is 6 child tasks at a time.
- When a run reaches the budget, it stops and says so. Raise the budget of one plan with `.omt/bin/omt plan limit <slug> --tasks <n>`.

Check: the user knows the budget and how to raise it.

## Update omt

Do this when the user asks to update omt. After `git pull`, the CLI runs the new code at once, but the project keeps its copies of the old skills. Doctor then prints `WARN  skills   outdated: <skill> in <project>/.agents/skills; ...` and still exits 0.

1. Pull the clone:

   ```sh
   git -C "$HOME/src/oh-my-t3code" pull --ff-only
   ```

   Check: the command exits 0.

2. In the project root, run the project install again with `--yes`. Use the same flags as the first install. Drop `--hooks` if the user does not run Claude Code.

   ```sh
   node "$HOME/src/oh-my-t3code/src/cli.ts" install --project --hooks --yes
   ```

   Check: the command exits 0.

3. Check the skills:

   ```sh
   node "$HOME/src/oh-my-t3code/src/cli.ts" doctor --project | grep -E '^PASS +skills '
   ```

   Check: the command prints `PASS  skills   9 skills installed in <project>/.agents/skills`. If it prints nothing, read the `skills` line of `doctor --project` and fix it as "4. Install omt into the project" says.

4. Tell the user to close the T3 threads of this project and start new ones. A running session keeps the old skills.

   Check: the user confirms that the new threads are open.

## Uninstall

Run this in the project root:

```sh
node "$HOME/src/oh-my-t3code/src/cli.ts" uninstall --project --yes
```

It removes what the install wrote, except the files that the user changed. It keeps the user's own files in `.omt/`: the plans, the ledger, the evidence, an edited config, the personas, and the backups. It also keeps an edited skill with its links, and the parts of the exclude block and the manifest that the kept files need. The [install guide](../install.md) gives the details. Add `--dry-run` to see the list first. Tell the user to restart the T3 threads of this project.

Check: the uninstall exits 0. Then run a second dry run in the project root:

```sh
node "$HOME/src/oh-my-t3code/src/cli.ts" uninstall --project --dry-run | tail -1 | grep -qx 'Nothing to remove.'
```

Check: the command exits 0. Then the last line of the dry run is `Nothing to remove.`, and nothing that omt can remove is left. If it exits 1, the uninstall is not complete. Run the uninstall again.

Then run `node "$HOME/src/oh-my-t3code/src/cli.ts" uninstall --project --dry-run` without the pipe and read its output. Pass each `keep` line to the user with its reason. For an edited skill, tell the user that `uninstall --project --force --yes` backs up the skill and then removes it. Run it only when the user asks.

Do not judge the uninstall by `git status`. The other changes that it shows are the user's own work. Leave them alone.

## More

- [Walkthrough](../walkthrough.md): two real omt runs, with their plans, tasks, and reviews.
- [Install guide](../install.md): the global install, every path the install writes, and the uninstall details.
- [README](../../README.md): the default roles, the commands, and the limits.
