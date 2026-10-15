<img src="assets/icon.svg" width="64" height="64" alt="">

# oh-my-t3code

oh-my-t3code (`omt`) adds roles, task briefs, plans, and review loops to the agents that you run in [T3 Code](https://t3.codes). You write one sentence, such as `ulw add OAuth to the API`. The agent then plans the work in units and sends each unit to the right model as a T3 child task. A reviewer checks each unit, and tests that actually ran prove it. Before the run counts as done, a reviewer from another model family attacks the result.

oh-my-t3code has two parts:

- A set of skills that tell the agent how to plan, delegate, review, and verify.
- A small CLI, `omt`, that does the deterministic parts. It merges the config, picks a model for each role, renders briefs, and counts plan and ledger state.

The CLI has no runtime dependencies. It makes no network calls and sends no telemetry.

## How it builds on T3 orchestrator v2

T3 orchestrator v2 gives every agent session the `t3-code` MCP server. With it, an agent can start child tasks on any provider and model (`delegate_task`), check and cancel them (`task_status`, `task_cancel`), and read the live model catalog (`orchestrator_capabilities`). Every child runs as a T3 thread, so the T3 UI already shows its progress and its result.

T3 does not give you roles, model routing, briefs, review loops, or limits. oh-my-t3code adds them on top of the T3 tools. It adds no server and no daemon. It does not change T3 itself.

- A role, such as `execute` or `review`, maps to an ordered chain of provider, model, and effort. When the first choice is not available, the agent falls back to the next one.
- Every child gets a complete brief. The brief has the task, the scope, the done conditions, the verify commands, and a fixed result block.
- The plan and the ledger live in `.omt/` in your project, so a long run survives context compaction.
- The config sets limits for parallel tasks, tasks per run, nesting depth, and review rounds.

## Install

You need Node.js 22.18 or later, pnpm, and T3 Code.

Install the CLI from a clone:

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

## Try it in one project

You can try oh-my-t3code in one repository without a global link. This mode does not change `~/.agents/skills`, `~/.claude`, or your `PATH`. It refuses to run in your home directory, because there the project paths are the global paths. Clone the repository, then run the CLI from the clone in the target project. This needs only Node 22.18 or later. You do not need `pnpm install` to run `node <clone>/src/cli.ts`:

```sh
cd /path/to/your-project
node /path/to/oh-my-t3code/src/cli.ts install --project --hooks
```

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

Git does not see these files. The install writes one managed block into the repository's `.git/info/exclude`, so `git status` shows nothing new. That file is local to your clone and is never committed. The block names only the files that the install writes. The plans in `.omt/plans/` are shared by all worktrees and do not show in git, because `.omt/.gitignore` holds `plans/`. To keep a finished plan, copy it outside `.omt/` and commit it there. Each project root has its own block. In a monorepo, the entries of a package start with the package path, so packages do not hide each other's files. A repository has one project install, in the main checkout, and `install`, `uninstall`, or `doctor` with `--project` in a worktree acts on the main checkout and its `.omt`, which all worktrees share. The skill folders stay in the main checkout, so an agent in a worktree finds them only if its harness reads the skill folders of the main checkout. A `.gitignore` with `*` in `.omt/backups/` hides the backups from git.

One file can still show in git. When the repository tracks `.claude/settings.local.json`, `git status` shows it as modified while the hook is installed. The install edits the file in its own style. It keeps the indentation, and a final newline only when the file had one. It writes the whole file in that indentation, so inline arrays in an indented file become multi-line. When an install changes the layout of the file this way, it first saves the original bytes in `.omt/backups/`. The install creates `.omt/.gitignore` only when it is missing, and never edits a file that the repository already has. When an earlier install created the file and nobody edited it, the install adds the new lines to it. Add `--no-git-exclude` to skip the block, for a setup that you want to commit. It also removes a block that an earlier install wrote. Then the install adds the missing lines to an existing `.omt/.gitignore`, and the uninstall removes them again. A teammate who clones a committed setup runs `install --project` to get the shim, because `.omt/.gitignore` keeps `.omt/bin/` out of git. That install records the committed skills and links as existing. The block does not hide them, and the uninstall keeps them. When the committed skills are older than the CLI, the install updates them, and git shows them as modified.

After you copy or move the project, run the commands in the new place. They read the manifest relative to the new root and never change the old one. The install replaces the block of the old path, unless the old path still has its own install in the same exclude file. That happens when you copy a package inside one repository.

Restart the agent sessions of this project in T3 Code. A running session does not load new skills.

To remove the project install:

```sh
node /path/to/oh-my-t3code/src/cli.ts uninstall --project
```

It removes the skills, the links, the shim, the hook entry, the exclude block, and the manifest. It also removes each file and empty directory that the install created. When the settings file left after the hook entry goes equals the backup from the install, the uninstall writes the backup's bytes back and deletes the backup. So the project and `.git/info/exclude` are byte for byte as they were before the install, apart from the plans, the ledger, and the evidence that you added. These stay. When the ledger or the evidence stays, `.omt/.gitignore` stays too, so git does not show them. A path that `install --force` replaced stays in `.omt/backups/`, and the uninstall does not move it back. Git does not show it there.

It keeps a file that the install created and that you edited, and a locally modified skill. A `settings.local.json` that the install created stays when other keys are in it, such as the permissions that Claude Code writes there. The exclude block then keeps only the paths that stay. When you edited `settings.local.json` while omt was installed, the uninstall cannot write the old bytes back: it removes only the omt entry, and the backups stay in `.omt/backups/`, where git does not see them. Add `--purge` to also remove an edited `.omt/config.jsonc` that the install created. While a file that the install created stays, `.omt/install.json` stays too, reduced to a record of these files and of the skills and links that existed before the install. So a later install or uninstall keeps these files hidden from git and keeps the existing skills and links. The uninstall that removes the last of them also removes this record. The uninstall removes every omt hook entry, also one that was already in a tracked `settings.local.json` before you installed, such as the entry of another clone. Git then shows that file as modified.

## First run

In a T3 thread, start the ultrawork loop with the skill:

```text
$omt-ulw add rate limiting to the public API
```

`$omt-ulw` is the T3 composer mention. T3 turns it into each provider's own form: `/omt-ulw` for Claude Code and Cursor, `/skill:omt-ulw` for Pi, and `$omt-ulw` for Codex.

With the Claude Code hook installed, the keyword is enough:

```text
ulw add rate limiting to the public API
```

The agent frames the goal, explores the code, writes a plan in `.omt/plans/`, dispatches each unit, reviews and tests it, and runs a final cross-family check. Run `omt init` in the project first if you want a project config and a `.gitignore` for the plans and the ledger.

## Default roles

| Role | Use | First choice | Fallback |
| --- | --- | --- | --- |
| `explore` | Answer one narrow question about this repository | GPT-6-Luna, low | Claude Sonnet 5.5, low |
| `research` | Answer a question from docs, the web, and code | GPT-6.1-Sol, low | Claude Opus 5.5, low |
| `plan` | Turn a goal into a plan file | Claude Opus 5.5, xhigh | GPT-6-Astra, xhigh |
| `plan-review` | Check a plan for gaps | GPT-6-Astra, high | Claude Opus 5.5, high |
| `execute` | Implement one planned unit | Claude Opus 5.5, medium | GPT-6.1-Sol, xhigh |
| `quick` | Make a small, mechanical change | GPT-6-Luna, high | Claude Sonnet 5.5, low |
| `deep` | Solve a hard or cross-cutting problem | Claude Opus 5.5, max | GPT-6-Astra, xhigh |
| `review` | Review a diff against its brief | GPT-6-Astra, high | Claude Opus 5.5, high |
| `oracle` | Attack the finished change before it counts as done | GPT-6-Astra, high | Claude Opus 5.5, high |
| `test` | Write and run tests, then report a verdict | GPT-6.1-Sol, low | Claude Sonnet 5.5, low |
| `writing` | Write or edit documentation | Claude Opus 5.5, high | GPT-6-Astra, medium |
| `design` | Design screens and flows, and write a design spec | Claude Opus 5.5, high | none |
| `ui` | Implement one UI unit from its design spec | Claude Opus 5.5, medium | none |

The fallback runs only when T3 refuses the first choice. For the cross-family roles below, the first choice depends on the worker. `design` and `ui` have no fallback: designs come only from Claude Opus 5.5, and you are the design review.

`plan-review`, `review`, and `oracle` are cross-family roles. A reviewer comes from the other model family than the worker whose change it reviews. GPT-6-Astra reviews Claude work, and Claude Opus 5.5 reviews GPT work. The skills pass the worker to `omt brief --against`, and the CLI puts the rungs of the other family first. When the other family is not available, the same family reviews. The oracle runs on the family other than the main implementer's.

Claude models run on the `claudeAgent` driver. GPT models run on the `codex` driver. Each default rung also names the T3 built-in provider instance of its driver, whose id is `claudeAgent` or `codex`. T3 checks a named instance again before it refuses it, but it can refuse a driver-only target because of a stale provider snapshot. The read-only roles (`explore`, `research`, `plan-review`, `review`, `oracle`) run in T3 plan mode. On Claude, Codex, Cursor, and OpenCode, plan mode keeps the child from editing files. T3 has no plan-mode handling for Pi, so a Pi child in a read-only role is held back only by its brief. No default role uses Pi.

Run `omt roles` to see how each role resolves with your config.

## Change a role

Your config is `~/.config/oh-my-t3code/config.jsonc`. `omt install` creates it. A project config in `.omt/config.jsonc` overrides it for one project.

This example turns off cross-family review. Then `review` always starts on GPT-6-Astra and falls back to Claude Opus 5.5, also when GPT made the change.

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/gabimoncha/oh-my-t3code/main/schema/omt.schema.json",
  "version": 1,
  "roles": {
    "review": {
      "crossFamily": false
    }
  }
}
```

A `chain` replaces the old chain as a whole. Other fields of the role keep their values. In a rung, `provider` names one T3 provider instance and `driver` names its driver. Set a role to `null` to remove it.

## Plan pages

When a plan is final, `omt-plan` shows it as a page in the T3 thread. The page has the plan summary, status cards, the units as a flowchart by dependency layer, a unit table, the checks, and flowcharts and tables that explain the design. T3 draws no flowcharts in chat, so `omt visual` builds the page and the T3 `html_render` tool shows it. A copy stays in the evidence directory (`omt paths --evidence`), under `visuals/<slug>.html`, so you can also open it in a browser.

To get the plan summary as text in the reply instead, turn the page off in your config:

```jsonc
{
  "visuals": { "plan": false }
}
```

You can also ask for a page at any time, for example "show me the plan as a flowchart". That runs `omt-show`.

Useful commands:

- `omt config show --defaults` prints the built-in roles, limits, and visuals.
- `omt config show` prints the effective config.
- `omt config validate` reports problems in your files.

## Skills

| Skill | Use it when |
| --- | --- |
| `omt-ulw` | You want a task built, fixed, or shipped end to end with subagents. The `ulw` and `ultrawork` keywords start it. |
| `omt-plan` | You want a reviewed plan before any code changes. |
| `omt-design` | You want designs, mockups, or screens before UI work. You pick one of 3 variants for each screen and steer them. |
| `omt-review` | You want a review of uncommitted changes, a branch, a commit, or a pull request. |
| `omt-research` | You need a cited answer from the repository, library docs, or the web. |
| `omt-show` | You want to see a plan, a flow, or a status as a page with flowcharts and tables. `omt-plan` runs it when it hands off a plan. |
| `omt-swarm` | You have independent tracks that should each run in their own worktree thread and end in a pull request. You start it yourself. |
| `omt-loop` | Work must continue across turns until a condition holds. You start it yourself. |
| `omt` | You want the list of workflows, the CLI commands, and the shared references. You start it yourself. |

The agent can pick the first six on its own. You start the last three by name.

## Commands

| Command | What it does |
| --- | --- |
| `omt install` | Installs the skills, the links, the starter config, and with `--hooks` the Claude Code hook. `--project` installs into the current project. |
| `omt uninstall` | Removes what `omt install` added. `--project` removes the project install. |
| `omt doctor` | Checks Node, the config, the skills, the links, the hook, `PATH`, and T3. `--project` checks the project install. |
| `omt init` | Creates `.omt/` in the project with a starter config. |
| `omt config` | Shows, locates, validates, or creates the config. |
| `omt roles` | Prints how every role resolves. |
| `omt route <role>` | Prints the `delegate_task` arguments for one role as JSON. `--against <provider>` names the worker that a cross-family role reviews. |
| `omt brief <role> --task <text>` | Renders a child brief, or a full `delegate_task` payload with `--json`. |
| `omt plan` | Creates plan files and shows their progress. `plan new <slug> --light` leaves out the oracle item. `plan mark <slug> <id> <done\|open\|blocked>` ticks one item. |
| `omt ledger` | Records and counts delegated tasks in `.omt/ledger.jsonl`. A result entry (`completed`, `failed`, and the other terminal statuses) closes the dispatch with the same `--task-id`, or with the same plan, unit, role, round, and attempt. |
| `omt visual` | Builds a self-contained HTML page with flowcharts, tables, and status cards. `--plan <slug>` adds the plan's summary, unit flowchart, and checks; `--spec` adds tabs from a JSON page spec. |
| `omt hook user-prompt-submit` | Runs the Claude Code hook. The hook calls it, not you. |

Every command accepts `--help`. [`docs/spec.md`](docs/spec.md) describes each command in detail.

## What gets written where

| Path | What |
| --- | --- |
| `~/.agents/skills/<skill>` | A copy of each skill. Codex, Cursor, OpenCode, and Pi read this directory. |
| `~/.claude/skills/<skill>` | A relative symlink to the copy, for Claude Code. |
| `~/.gemini/config/skills/<skill>` | A symlink, only when `~/.gemini` exists or you select the `gemini` target. |
| `~/.config/oh-my-t3code/config.jsonc` | Your config. |
| `~/.config/oh-my-t3code/install.json` | The manifest of what the install added. |
| `~/.config/oh-my-t3code/backups/` | Backups of anything that the install replaced or edited. |
| `~/.claude/settings.json` | One `UserPromptSubmit` hook entry, only with `--hooks`. Other settings stay unchanged. |
| `.omt/` in a project | The project config, the plans, the ledger, and evidence files, including the plan pages under `evidence/visuals/`. |

Each installed skill directory holds a `.omt-managed.json` marker. The install never overwrites a path that it does not manage, unless you pass `--force`. With `--force`, it moves the old path to the backups directory first.

`omt uninstall` removes the managed skill copies, the links that point at them, the hook entry, and the manifest. It keeps your config. Add `--purge` to remove the config too. It never removes a path that it does not manage. Project `.omt/` directories stay in place.

## Limits and known gaps

- This is version 0.1. Expect changes to the config and the CLI output.
- The `ulw` hook works only in Claude Code. Codex hooks need per-hook trust, so this version installs none. In Codex, start the loop with `$omt-ulw`.
- No tool can set a T3 goal. To keep work going across turns on Claude and Codex threads, `omt-loop` asks you to type `/goal <objective>` yourself.
- The CLI cannot call T3. Without `--capabilities`, it trusts the role chains, and T3 checks the target when the agent calls `delegate_task`. The skills then fall back to the next model on a typed T3 error.
- Child tasks share the parent's checkout. The plan gives each unit a scope, and editing units run in parallel only when their scopes do not overlap.

## Credits

oh-my-t3code takes its ideas from these projects:

- [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) for categories with fallback chains, the ultrawork loop, plan review rounds, and evidence-based done criteria.
- [oh-my-pi](https://github.com/can1357/oh-my-pi) for model roles, agent definitions, fan-out with shared context, and the review recipe.
- [T3 Code](https://github.com/pingdotgg/t3code) for orchestrator v2, which does the actual work.

No code or prompt text from oh-my-openagent is copied here. Its license does not allow that, so oh-my-t3code re-implements the ideas in its own words.

## License

MIT. See [LICENSE](LICENSE).
