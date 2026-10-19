<img src="assets/icon.svg" width="64" height="64" alt="">

# oh-my-t3code

oh-my-t3code (`omt`) adds plans, roles, task briefs, and review loops to the agents that you run in [T3 Code](https://t3.codes). You write one sentence, such as `ulw add OAuth to the API`. The agent plans the work in units, sends each unit to the right model as a T3 child task, and reviews and verifies the result.

## Who it is for

omt is for you if:

- You use T3 Code and want an agent to plan and finish multi-step work with subagents.
- You have Claude Code, Codex, or both, and want one model family to review the work of the other.
- You want the plan, the task count, and the review verdicts in files that you can read.

omt is not for you if:

- You do not use T3 Code. The skills start child tasks with T3's `delegate_task` tool, which works only from a T3 thread.
- You want a quick edit with no plan and no review. omt runs its full loop even for a small task, and a unit costs about 5 child tasks.
- You want a hosted service or a background scheduler. omt adds no server and no daemon.

## Requirements

- [T3 Code](https://t3.codes) v0.1.0 or later. It is free, for macOS, Windows, and Linux.
- Claude Code (`claude auth login`), Codex with a ChatGPT sign-in, or both, enabled in T3 Settings, Providers.
  - With both, a model from the other family reviews each change. With one family, the same family reviews its own work.
  - The `design` and `ui` roles run only on Claude. Without Claude Code, omt cannot do design or UI units.
- Node.js 22.18 or later.
- git.
- pnpm, only for the global install.

## For agents

To have your coding agent install omt, paste this prompt into Codex or Claude Code in your project:

```text
Install oh-my-t3code (omt) for this project. Follow
https://github.com/gabimoncha/oh-my-t3code/blob/main/docs/agents/quickstart.md
step by step, run the check at the end of each step, and tell me what to restart.
```

The prompt points at the [agent quick start](docs/agents/quickstart.md). It checks the fit, installs omt for one project, and lists the first tasks to try.

## Quick start

Install omt into one project. This writes only inside the project and hides its files from git. It needs no `pnpm install`.

```sh
git clone https://github.com/gabimoncha/oh-my-t3code.git ~/src/oh-my-t3code
cd /path/to/your-project
node ~/src/oh-my-t3code/src/cli.ts install --project --hooks
node ~/src/oh-my-t3code/src/cli.ts doctor --project
```

The install shows its plan and asks before it writes. `--hooks` adds the `ulw` keyword for Claude Code. Leave it out if you use only Codex. Doctor prints one line per check. Expect `PASS` lines and no `FAIL` line. A `WARN t3` line means that doctor found no T3 Code settings file.

Then restart the agent sessions of this project in T3 Code. A running session does not load new skills.

To put `omt` on your `PATH` and install the skills for all projects, use the global install:

```sh
cd ~/src/oh-my-t3code
pnpm install
pnpm build
pnpm link --global
omt install
omt doctor
```

The [install guide](docs/install.md) has the details: every path that each install writes, how git stays clean, the Codex setting, and the uninstall.

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

The agent frames the goal, explores the code, writes a plan in `.omt/plans/`, and dispatches each unit. The profile selects reviews, verification, planned tests, and the final oracle. The project install already creates `.omt/`. After a global install, run `omt init` in the project first if you want a project config and a `.gitignore` for the plans and the ledger.


## What a run looks like

The [walkthrough](docs/walkthrough.md) shows two real runs on this repository, from the plan files, the ledger, and `git log`.

- `code-health` had 4 units and dispatched 29 child tasks: 4 plan-review, 6 execute, 12 review, 5 test, and 2 oracle. The plan needed 3 review rounds. The first oracle round reopened one unit, and the second approved. The run took 2 hours 20 minutes. It landed one commit with 353 fewer lines of TypeScript, and all 521 tests passed.
- `workflow-profiles` had 10 units and dispatched 128 child tasks over 5 days of work, from 2026-10-09 to 2026-10-17. The owner raised its task budget in steps to 130. The plan file and the ledger kept the state between sessions.

![The Units tab of the code-health plan page: a flowchart of U1 to U4, each unit depending on the one before it, and a table of the units with their dependencies](docs/assets/walkthrough-plan.png)

## What omt does today

| Mode | What omt does today | How to start it | Limit |
| --- | --- | --- | --- |
| Loop | `omt-loop` keeps a plan going across turns until a condition command reports done. | Type `$omt-loop`. You start it yourself. | No tool can set a T3 goal. On Claude and Codex threads, you type `/goal <objective>` yourself. Other providers use a scheduled heartbeat. |
| Graph | Each plan is a dependency graph: every unit lists its `Depends on` units. `omt plan status <slug>` prints a `ready:` line with the open units whose dependencies are done. `omt visual` and `omt-show` draw the units as a flowchart. | `$omt-ulw` or `$omt-plan` writes the plan. Run `omt plan status <slug>` to see the ready units. | No scheduler process runs. The conductor dispatches the ready units on its own turns, and units run in parallel only when their file scopes do not overlap. |
| Swarm | `omt-swarm` splits work into independent tracks. Each track runs `omt-ulw` in its own T3 worktree thread and ends in a pull request. | Type `$omt-swarm`. You start it yourself. | The thread must run in `full-access` runtime mode and `default` interaction mode. Tracks share no files. Uncommitted edits stay in your checkout. |
| Zero-to-one | The plan and the ledger in `.omt/` survive context compaction and new sessions, so one plan can run for days. | `$omt-ulw <goal>`. A HEAVY goal gets a reviewed plan first. | The default budget is 24 child tasks per run, about 3 to 4 units. Raise it with `omt plan limit <slug> --tasks <n>`. The 10-unit `workflow-profiles` run used 128. |
| Custom agents and workflows | A custom role has its own model chain and a persona file in `.omt/roles/<role>.md`. A profile extends a preset, switches workflow steps, and overrides roles, models, and limits. | Add roles and profiles to `.omt/config.jsonc`. Run `omt profile list`, then `$omt-ulw --profile <name> <task>`. | The skills fix the order of the steps. A profile turns steps on or off and changes their settings, but cannot add a step or reorder them. |

## Glossary

- Conductor: the T3 thread that runs an omt skill. It writes the plan, dispatches child tasks, reads their results, and decides what runs next.
- Unit: one piece of planned work. It has a role, a file scope, a done condition, a verify command, and its dependencies.
- Brief: the complete task text that a child gets. It has the task, the scope, the done conditions, the verify commands, and a fixed result block. `omt brief` renders it.
- Ledger: `.omt/ledger.jsonl`. It has one line for each dispatch and each result. omt counts the task budget from it.
- Profile: a named set of workflow switches, limits, and role overrides. The presets are `normal`, `prototype`, and `pr-review`.
- Cross-family review: a reviewer from the other model family than the worker. GPT reviews Claude work, and Claude reviews GPT work.
- Oracle: a final review of the whole change before it counts as done.
- LIGHT and HEAVY: the two tiers of a run. A LIGHT run has one or two units in one area of code, with no design decision left. Any other run is HEAVY. A HEAVY run gets a reviewed plan, and the `normal` profile adds a final oracle.

## How it builds on T3 orchestrator v2

oh-my-t3code has two parts:

- A set of skills that tell the agent how to plan, delegate, review, and verify.
- A small CLI, `omt`, that does the deterministic parts. It merges the config, picks a model for each role, renders briefs, and counts plan and ledger state.

The CLI has no runtime dependencies. It makes no network calls and sends no telemetry.

T3 orchestrator v2 gives every agent session the `t3-code` MCP server. With it, an agent can start child tasks on any provider and model (`delegate_task`), check and cancel them (`task_status`, `task_cancel`), and read the live model catalog (`orchestrator_capabilities`). Every child runs as a T3 thread, so the T3 UI already shows its progress and its result.

T3 does not give you roles, model routing, briefs, review loops, or limits. oh-my-t3code adds them on top of the T3 tools. It adds no server and no daemon. It does not change T3 itself.

- A role, such as `execute` or `review`, maps to an ordered chain of provider, model, and effort. When the first choice is not available, the agent falls back to the next one.
- Every child gets a complete brief. The brief has the task, the scope, the done conditions, the verify commands, and a fixed result block.
- The plan and the ledger live in `.omt/` in your project, so a long run survives context compaction.
- Profiles select workflow steps and can override roles, models, and limits. The default permits 6 parallel tasks in one checkout.

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
| `verify` | Run the artifact, existing checks, and device flows | Claude Haiku 5.5, medium | Claude Sonnet 5.5, low; then GPT-6.1-Sol, low |
| `qa` | Write only the approved test lines after verification | GPT-6.1-Sol, medium | Claude Sonnet 5.5, medium |
| `guardrail` | Propose checks and rule fixes for review findings | Claude Opus 5.5, high | GPT-6-Astra, high |
| `writing` | Write or edit documentation | Claude Opus 5.5, high | GPT-6-Astra, medium |
| `design` | Design screens and flows, and write a design spec | Claude Opus 5.5, high | none |
| `ui` | Implement one UI unit from its design spec | Claude Opus 5.5, medium | none |

The fallback runs only when T3 refuses the first choice. For the cross-family roles below, the first choice depends on the worker. `design` and `ui` have no fallback: designs come only from Claude Opus 5.5, and you are the design review.

`plan-review`, `review`, and `oracle` are cross-family roles. A reviewer comes from the other model family than the worker whose change it reviews. GPT-6-Astra reviews Claude work, and Claude Opus 5.5 reviews GPT work. The skills pass the worker to `omt brief --against`, and the CLI puts the rungs of the other family first. When the other family is not available, the same family reviews. The build oracle runs on the family other than the main implementer's. A review oracle uses the family other than most reviewers.

Claude models run on the `claudeAgent` driver. GPT models run on the `codex` driver. Each default rung also names the T3 built-in provider instance of its driver, whose id is `claudeAgent` or `codex`. T3 checks a named instance again before it refuses it, but it can refuse a driver-only target because of a stale provider snapshot. The read-only roles (`explore`, `research`, `plan-review`, `review`, `oracle`, `guardrail`) run in T3 plan mode. On Claude, Codex, Cursor, and OpenCode, plan mode keeps the child from editing files. T3 has no plan-mode handling for Pi, so a Pi child in a read-only role is held back only by its brief. No default role uses Pi.

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

## Choose a workflow

Run `omt profile list` to see the presets and your custom profiles. Run `omt profile show prototype --json` to see a resolved workflow, its limits, roles, and models.

- `normal` reviews every build round. It verifies each HEAVY unit and runs its final oracle. LIGHT runs use the conductor's verify commands.
- `prototype` reviews the first implementation round and verifies every unit. It skips the oracle and failure proofs, limits review cycles to 2 rounds, and waits for you after each dependency layer.
- `pr-review` adds CI fixes, changed-flow verification, CRAP reports, test offers, and guardrail proposals to the normal review workflow.

In a T3 thread, select the prototype profile for one build:

```text
ulw --profile prototype build a demo of the search screen
```

At a check-in, reply with continue, steering, or an instruction to stop check-ins for that run. Continue authorizes one more layer or unit. To switch a running plan, use `omt plan profile <slug> normal`. `none` removes the plan override. The next wake reads the new profile.

Selection uses the explicit `--profile`, then the plan header, project config, user config, and finally `normal`. Root config layers merge first. The selected profile then applies its inheritance chain.

Add a custom profile to your user or project config:

```jsonc
{
  "profile": "hackathon",
  "profiles": {
    "hackathon": {
      "description": "Use the prototype workflow with fast workers and no check-ins.",
      "extends": "prototype",
      "workflow": { "build": { "checkpoint": "none" } },
      "roles": { "execute": { "fast": true }, "ui": { "fast": true } }
    }
  }
}
```

A custom profile without `extends` inherits `normal`. `omt config show` prints the merged config before profile application. Use `omt profile show hackathon --json` for the resolved values.

Set fast mode per role in either config layer:

```jsonc
{
  "roles": {
    "execute": { "fast": true },
    "verify": { "fast": false }
  }
}
```

The first set value wins: rung `fast`, role `fast`, model `fast`, then `false`. GPT-6.1-Sol has model fast mode on by default. Supported models map `true` to `serviceTier: "priority"` or `fastMode: true`. An unsupported model keeps its target and reports a note. Explicit `rung.options` wins over the mapping. `false` adds no fast option.

On upgrade, move each `roles.test` override to `verify` for checks or `qa` for test writing. The old key now warns and has only custom-role behavior. A partial `roles.test` override fails validation when it lacks `description`, `access`, and `chain`.

## Review a pull request

In a T3 thread, run the skill:

```text
omt-review --profile pr-review <number>
```

The skill runs these steps in order:

1. Read and link the PR. Save the original branch and check out the PR when a step needs it. A checkout requires a clean working tree.
2. Read the project rules. Each finding that breaks a written rule cites its file and line.
3. Read CI checks and save failure logs. Pending checks use T3's PR watch. With no CI checks, run the project's check command.
4. Run the project's coverage command once when one exists and save lcov for the reviewers.
5. Review file groups on the PR head. A verify task runs changed screens, CLI commands, and API routes and lists their covering tests.
6. Merge findings. An oracle from the other reviewer family checks them. Failed verified flows become P1 findings.
7. Send each failing CI check to an execute task and review its fix. Changes stay uncommitted.
8. Propose deterministic checks, rule corrections, or new rules. Save new proposals in ignored `.omt/guardrails.md` for separate work.
9. Report CRAP for changed functions. CRAP combines complexity and coverage. Values above 30 become P2 findings. Without coverage data, the calculation uses zero coverage.
10. Report findings, CI fixes, screenshots, uncovered flows, proposals, and the command to return to your original branch.
11. Offer a fix loop, exact e2e test lines for uncovered verified flows, and commit and push. Each needs your approval. Qa reports `INCONCLUSIVE` if no e2e framework exists.

Round-1 reviewers and the oracle read the saved PR commits. Reviews and oracles after fixes read the working tree. The skill posts no GitHub comment or review. Other profiles can skip steps through `workflow.review`; [the spec](docs/spec.md#154-pull-request-review) lists the switches and rules.

## Checks and shared builds

Workers add no new tests. The plan lists each proposed test under `## Tests`, with its flow, file, and reason. You approve those lines with the plan. Verify runs the artifact and existing checks first. Qa then writes only the approved tests. The normal profile also requires qa to prove each new test can fail in a private working-tree copy. An empty test list means no new tests.

Parallel workers share one checkout and have disjoint file scopes. Commands that share build state use one lock name per resource:

```sh
omt lock run build -- pnpm build
omt lock list
```

A busy command waits up to 900 seconds by default. `--wait <seconds>` changes that wait. A timeout exits 75. The lock uses `flock` or `lockf` and is never taken over. Without either tool, the command runs with a warning and the planner keeps shared builds serial. Commands that leave servers or watchers running also need a serial plan and run outside the lock.

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

- `omt config show --defaults` prints the built-in profiles, roles, models, limits, and visuals.
- `omt config show` prints the merged config before profile application.
- `omt config validate` reports problems in your files.

## Skills

| Skill | Use it when |
| --- | --- |
| `omt-ulw` | You want a task built, fixed, or shipped end to end with subagents. The `ulw` and `ultrawork` keywords start it. |
| `omt-plan` | You want a reviewed plan before any code changes. |
| `omt-design` | You want designs, mockups, or screens before UI work. You pick and steer screen variants. The profile sets the count, normally 3. |
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
| `omt brief <role> --task <text>` | Renders a brief. `--save --json` saves it and returns a short dispatch task plus a ledger command. |
| `omt profile` | Lists profiles or shows resolved workflow settings with `show [<name>] [--plan <slug>] --json`. |
| `omt lock` | Runs a command under a shared build lock or lists held and free locks. |
| `omt plan` | Creates plan files and shows their progress. `new --profile <name>` selects a profile. `profile <slug> <name\|none>` switches it. `plan new <slug> --light` leaves out the oracle item. `plan mark <slug> <id> <done\|open\|blocked>` ticks one item. |
| `omt ledger` | Records and counts delegated tasks in `.omt/ledger.jsonl`. A result entry (`completed`, `failed`, and the other terminal statuses) closes the dispatch with the same `--task-id`, or with the same plan, unit, role, round, and attempt. |
| `omt visual` | Builds a self-contained HTML page with flowcharts, tables, and status cards. `--plan <slug>` adds the plan's summary, unit flowchart, and checks; `--spec` adds tabs from a JSON page spec. |
| `omt paths` | Prints the absolute paths of the project root, `.omt`, the plans, the ledger, the evidence directory, the project config, and the shim. From a linked git worktree, the paths are in the main checkout. `--json` prints them as an object. |
| `omt hook user-prompt-submit` | Runs the Claude Code hook. The hook calls it, not you. |

Every command accepts `--help`. [`docs/spec.md`](docs/spec.md) describes each command in detail.

## Limits and known gaps

- This is version 0.1. Expect changes to the config and the CLI output.
- The `ulw` hook works only in Claude Code. Codex hooks need per-hook trust, so this version installs none. In Codex, start the loop with `$omt-ulw`.
- No tool can set a T3 goal. To keep work going across turns on Claude and Codex threads, `omt-loop` asks you to type `/goal <objective>` yourself.
- The CLI cannot call T3. Without `--capabilities`, it trusts the role chains, and T3 checks the target when the agent calls `delegate_task`. The skills then fall back to the next model on a typed T3 error.
- Child tasks share the parent's checkout, because omt does not yet use T3's worktree isolation (`delegate_task` with `isolation: "worktree"`, available since T3 Code v0.1.0). The plan gives each unit a scope, and editing units run in parallel only when their scopes do not overlap.
- As of 2026-10-17, Codex 0.163.0 keeps a released thread and its MCP server processes for 30 minutes by default. If you use Codex children, set the launch argument in [the install guide](docs/install.md#set-the-codex-unload-delay), so a settled child closes after one minute.

## Credits

oh-my-t3code takes its ideas from these projects:

- [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) for categories with fallback chains, the ultrawork loop, plan review rounds, and evidence-based done criteria.
- [oh-my-pi](https://github.com/can1357/oh-my-pi) for model roles, agent definitions, fan-out with shared context, and the review recipe.
- [T3 Code](https://github.com/pingdotgg/t3code) for orchestrator v2, which does the actual work.

No code or prompt text from oh-my-openagent is copied here. Its license does not allow that, so oh-my-t3code re-implements the ideas in its own words.

## License

MIT. See [LICENSE](LICENSE).
