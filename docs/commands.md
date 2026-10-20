# omt commands

Every command accepts `--help`. The [spec](spec.md) describes each command in detail. In a project install without `omt` on `PATH`, run the commands as `.omt/bin/omt`.

| Command | What it does |
| --- | --- |
| `omt install` | Installs the skills, the links, and the starter config. `--hooks` adds the Claude Code hook. `--project` installs into the current project and prints the worktree setup state of the current checkout. |
| `omt uninstall` | Removes what `omt install` added. `--project` removes the project install. |
| `omt doctor` | Checks Node, the config, the skills, the links, the hook, `PATH`, and T3. `--project` checks the project install and the worktree setup of the current checkout. |
| `omt init` | Creates `.omt/` in the project with a starter config, and prints the worktree setup state of the current checkout. |
| `omt config` | Shows, finds, validates, or creates the config. |
| `omt roles` | Prints how every role resolves. |
| `omt route <role>` | Prints the `delegate_task` arguments for one role as JSON. `--against <provider>` names the worker that a cross-family role reviews. |
| `omt brief <role> --task <text>` | Renders a brief. `--save --json` saves the brief and returns a short dispatch task and a ledger command. |
| `omt profile` | Lists the profiles. `show [<name>] [--plan <slug>] --json` shows the resolved workflow settings. |
| `omt lock` | Runs a command under a shared build lock, or lists the held and free locks. |
| `omt plan` | Creates plan files and shows their progress. `new --profile <name>` selects a profile, and `new <slug> --light` leaves out the oracle item. `profile <slug> <name\|none>` switches the profile. `mark <slug> <id> <done\|open\|blocked>` marks one item. `status <slug>` prints the next item and the `ready:` units. |
| `omt ledger` | Records and counts the delegated tasks in `.omt/ledger.jsonl`. A result entry with a terminal status, such as `completed` or `failed`, closes the dispatch that has the same `--task-id`. Without a task id, it closes the dispatch with the same plan, unit, role, round, and attempt. |
| `omt visual` | Builds a self-contained HTML page with flowcharts, tables, and status cards. `--plan <slug>` adds the plan summary, the unit flowchart, and the checks. `--spec` adds tabs from a JSON page spec. |
| `omt worktree` | `check` (the default) reports the current checkout's package manager, lockfile, linker settings, `t3.json` setup script, and the T3 activation step. It writes nothing and starts no process. `setup [--dry-run] [--yes]` writes a missing `t3.json` and `.t3/omt-worktree-setup.mjs` for a Bun or pnpm project, and for pnpm a missing `pnpm-workspace.yaml` with `enableGlobalVirtualStore: true`. The runner installs dependencies into a global virtual store before the agent starts. Neither subcommand rewrites an existing file. In a linked worktree, the files go into that worktree. |
| `omt paths` | Prints the absolute paths of the project root, `.omt`, the plans, the ledger, the evidence directory, the project config, and the shim. In a linked git worktree, the paths point into the main checkout. `--json` prints them as an object. |
| `omt hook user-prompt-submit` | Runs the Claude Code hook. The hook calls this command. You do not run it. |
