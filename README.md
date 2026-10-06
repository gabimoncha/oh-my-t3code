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

The agent frames the goal, explores the code, writes a plan in `.omt/plans/`, dispatches each unit, reviews and tests it, and runs a final cross-family check. Run `omt init` in the project first if you want a project config and a `.gitignore` for the ledger.

## Default roles

| Role | Use | First choice | Fallback |
| --- | --- | --- | --- |
| `explore` | Answer one narrow question about this repository | Claude Sonnet 5.5, low | GPT-6-Luna, low |
| `research` | Answer a question from docs, the web, and code | Claude Sonnet 5.5, medium | GPT-6.1-Sol, medium |
| `plan` | Turn a goal into a plan file | Claude Opus 5.5, high | GPT-6-Astra, high |
| `plan-review` | Check a plan for gaps | GPT-6-Astra, high | Claude Opus 5.5, high |
| `execute` | Implement one planned unit | Claude Opus 5.5, medium | GPT-6.1-Sol, medium |
| `quick` | Make a small, mechanical change | Claude Sonnet 5.5, low | GPT-6-Luna, low |
| `deep` | Solve a hard or cross-cutting problem | Claude Opus 5.5, xhigh | GPT-6-Astra, xhigh |
| `review` | Review a diff against its brief | Claude Opus 5.5, high | GPT-6-Astra, high |
| `oracle` | Attack finished work from another model family | GPT-6-Astra, high | Claude Opus 5.5, high |
| `test` | Write and run tests, then report a verdict | Claude Sonnet 5.5, medium | GPT-6.1-Sol, medium |
| `writing` | Write or edit documentation | Claude Opus 5.5, medium | GPT-6.1-Sol, medium |

Claude models run on the `claudeAgent` driver. GPT models run on the `codex` driver. The read-only roles (`explore`, `research`, `plan-review`, `review`, `oracle`) run in T3 plan mode. On Claude, Codex, Cursor, and OpenCode, plan mode keeps the child from editing files. T3 has no plan-mode handling for Pi, so a Pi child in a read-only role is held back only by its brief. No default role uses Pi.

Run `omt roles` to see how each role resolves with your config.

## Change a role

Your config is `~/.config/oh-my-t3code/config.jsonc`. `omt install` creates it. A project config in `.omt/config.jsonc` overrides it for one project.

This example runs reviews on Codex first and falls back to Claude:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/gabimoncha/oh-my-t3code/main/schema/omt.schema.json",
  "version": 1,
  "roles": {
    "review": {
      "chain": [
        { "driver": "codex", "model": "gpt-6-astra", "effort": "high" },
        { "driver": "claudeAgent", "model": "claude-opus-5-5", "effort": "high" }
      ]
    }
  }
}
```

A `chain` replaces the old chain as a whole. Other fields of the role keep their values. Use `provider` instead of `driver` to name one T3 provider instance. Set a role to `null` to remove it.

Useful commands:

- `omt config show --defaults` prints the built-in roles and limits.
- `omt config show` prints the effective config.
- `omt config validate` reports problems in your files.

## Skills

| Skill | Use it when |
| --- | --- |
| `omt-ulw` | You want a task built, fixed, or shipped end to end with subagents. The `ulw` and `ultrawork` keywords start it. |
| `omt-plan` | You want a reviewed plan before any code changes. |
| `omt-review` | You want a review of uncommitted changes, a branch, a commit, or a pull request. |
| `omt-research` | You need a cited answer from the repository, library docs, or the web. |
| `omt-swarm` | You have independent tracks that should each run in their own worktree thread and end in a pull request. You start it yourself. |
| `omt-loop` | Work must continue across turns until a condition holds. You start it yourself. |
| `omt` | You want the list of workflows, the CLI commands, and the shared references. You start it yourself. |

The agent can pick the first four on its own. You start the last three by name.

## Commands

| Command | What it does |
| --- | --- |
| `omt install` | Installs the skills, the links, the starter config, and with `--hooks` the Claude Code hook. |
| `omt uninstall` | Removes what `omt install` added. |
| `omt doctor` | Checks Node, the config, the skills, the links, the hook, `PATH`, and T3. |
| `omt init` | Creates `.omt/` in the project with a starter config. |
| `omt config` | Shows, locates, validates, or creates the config. |
| `omt roles` | Prints how every role resolves. |
| `omt route <role>` | Prints the `delegate_task` arguments for one role as JSON. |
| `omt brief <role> --task <text>` | Renders a child brief, or a full `delegate_task` payload with `--json`. |
| `omt plan` | Creates plan files and shows their progress. `plan new <slug> --light` leaves out the oracle item. `plan mark <slug> <id> <done\|open\|blocked>` ticks one item. |
| `omt ledger` | Records and counts delegated tasks in `.omt/ledger.jsonl`. A result entry (`completed`, `failed`, and the other terminal statuses) closes the dispatch with the same `--task-id`, or with the same plan, unit, role, round, and attempt. |
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
| `.omt/` in a project | The project config, the plans, the ledger, and evidence files. |

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
