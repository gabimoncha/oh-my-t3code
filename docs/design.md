# About the design of oh-my-t3code

oh-my-t3code is an orchestration layer for [T3 Code](https://t3.codes). It gives any agent inside a T3 thread a disciplined way to plan, delegate, review, and verify work through T3's own orchestrator. The ideas come from oh-my-openagent (OmO) and oh-my-pi (omp). The mechanism is T3 orchestrator v2.

The research behind every decision on this page is in [`docs/research/`](research/). The exact contracts for the code are in [`spec.md`](spec.md).

## Who this is for

The user is a developer who runs Claude Code, Codex, Cursor, Pi, or OpenCode agents from T3 Code. That developer wants one sentence ("ulw: add OAuth to the API") to turn into a planned run. Each unit then goes to the right model, gets a review, and ends with tests that ran. Before the run counts as done, a reviewer from another model family attacks the result.

The maintainer inherits a small TypeScript CLI with no runtime dependencies, a set of portable skills, and one config file. Every subagent runs as a T3 child thread, so the T3 UI already shows progress, cancellation, and results. oh-my-t3code adds no server and no daemon.

## What T3 already gives us

T3 orchestrator v2 exposes app-owned orchestration to every provider session through the `t3-code` MCP server. The parts that matter here:

- `delegate_task` starts a child thread on any provider instance and model, with model options such as reasoning effort. The child gets only the task text.
- `task_status` and `task_cancel` manage the child. A finished async child wakes the parent with a short message that names the task ids.
- `orchestrator_capabilities` lists the live provider and model catalog, including the option descriptors for each model.
- `t3_thread_launch` starts a top-level thread in its own git worktree.
- `schedule_task`, `watch_pull_request`, and native `/goal` keep work going across turns.

T3 does not give us roles, model routing, briefs, review loops, or done criteria. A `role` argument adds one line of text. Children share the parent's checkout. No limit stops a fan-out storm. These gaps are what oh-my-t3code fills.

## Decisions

### Roles, not model names

Skills and plans name a role such as `execute`, `review`, or `test`. One config maps each role to an ordered chain of rungs. A rung is a provider, a model, and an effort level. The first rung that T3 can run wins.

This comes from omp model roles and OmO categories. It matters more in T3 than in either source, because T3 can reach several providers at once. A role chain such as "Opus 5.5 at medium effort, then GPT-6.1-Sol at xhigh effort" survives a missing subscription or a disabled provider.

T3 validates `target.options` strictly. An unknown option id or a value outside the list fails the whole call. Each driver also names effort differently: Claude uses `effort`, Codex uses `reasoningEffort`, Pi uses `thinking`. So the CLI maps one effort ladder (`off` to `max`) onto the option that each model advertises, and picks the nearest supported value.

### Reviewers come from the other family

The `plan-review`, `review`, and `oracle` roles are cross-family. The skill passes the worker's provider to `omt brief --against`, and the CLI tries the rungs of the other family first. A reviewer from another family misses fewer of the worker's blind spots. The owner chose this rule. When the other family is not available, the same family reviews, because a review from the same family is better than no review. The family is the driver, so a driver that runs models of several vendors (Cursor, OpenCode) counts as its own family.

The ledger records the provider of each dispatch. So `--against auto` finds the worker of a unit, or the main implementer of a plan, without help from the agent.

### Designs come from Opus, and the owner steers

The `design` role makes design directions and the design spec, and the `ui` role implements a UI unit from that spec. Both run only on Claude Opus 5.5: `design` at high effort, `ui` at medium. Neither has a fallback to another family. The owner chose this rule, because Opus is far better at design, and a human steers taste. No model reviews a design: `review`, `oracle`, and `plan-review` tasks leave `docs/design/` out. The owner picks a direction, steers it in their own words, and approves the spec. Code review of `ui` units still runs as for any other unit.

### A CLI for the deterministic parts, skills for the judgment

Config merging, chain resolution, option mapping, brief rendering, and plan counting are deterministic. An LLM does them badly and expensively, so the `omt` CLI does them. Planning, splitting work, reading results, and deciding what to do next need judgment, so skills carry them.

The CLI cannot call T3 itself. Claude and Codex sessions get the T3 MCP server through config, not through environment variables, so a shell command has no credential. Routing is therefore unverified by default: the CLI trusts the chain and maps the effort, `delegate_task` validates the target, and the skill moves to the next rung on a typed T3 error. An agent can pass a saved copy of `orchestrator_capabilities` to check the chains ahead of time.

The skills also work without the CLI. They tell the agent to try a role's chain in order and to fall back on a typed T3 error. T3 is the final validator either way.

### Briefs and result contracts

A child sees nothing of the parent conversation. Every task therefore carries a brief with a fixed shape: role persona, task, context, scope, constraints, done condition, verify commands, and the required final message format. OmO's worker contract (task, deliverable, scope, verify, stop condition) is the model for this.

`task_status.summary` is the child's last assistant message. Each role therefore ends with a fixed result block: `STATUS` for workers, `VERDICT` for reviewers and testers, `ANSWER` for researchers. The parent reads the block and checks the evidence itself. A worker's "done" is a claim until the parent or a tester confirms it.

### Read-only roles run in plan mode

A live experiment showed that a Claude child in T3 `plan` interaction mode runs read-only commands, stays in plan mode, and returns its final message intact. Explore, research, review, oracle, and plan-review roles therefore default to `interactionMode: "plan"`. On Claude, Codex, Cursor, and OpenCode, T3 enforces read-only access for those children, and the brief does not have to rely on the child's restraint. T3 has no plan-mode handling for Pi, so a Pi child in a read-only role relies on its brief alone. No default rung uses Pi; a custom chain that adds Pi to a read-only role accepts that risk.

Plan mode has one trap. T3 stores a proposed plan as its own item type, and `task_status.summary` reads only assistant messages. A child that answers with a proposed plan (Claude's ExitPlanMode, or Codex plan output) can hide its result block from the summary. Every plan-mode brief therefore tells the child to stay in plan mode and put the block in its final assistant message. When a summary still comes back empty, the conductor reads the child thread, which includes proposed plans.

### Children share the checkout

A delegated child works in the parent's project, branch, and worktree. Two editing children on overlapping files corrupt each other's work. The plan therefore gives every unit an explicit scope, and the conductor runs editing units in parallel only when their scopes do not overlap. Truly independent tracks go to separate worktree threads through `t3_thread_launch`, and only when the user asks for that, as T3's own rules require. The `omt-swarm` skill is that explicit ask.

### Limits that T3 does not set

T3 has no cap on concurrent tasks or nesting depth. The config sets four limits: parallel tasks, tasks per run, depth, and review rounds. Every brief states the child's depth. At the maximum depth a child does the work itself.

### State lives in the repository

A long run outlives the agent's context. The plan (`.omt/plans/<slug>.md`) and the ledger (`.omt/ledger.jsonl`) hold the state: units, scopes, done conditions, task ids, rounds, and verdicts. After compaction the conductor re-reads both files. The plan uses checkbox grammar that people can read and that `omt plan status` can count.

### Continuation uses T3, not new hooks

OmO re-prompts the agent with hooks until a plan is done. T3 already ships native `/goal` for Claude and Codex threads, and async children wake the parent when they finish. oh-my-t3code uses those. The only hook it installs is optional: a Claude Code `UserPromptSubmit` hook that arms ultrawork when the prompt contains `ulw` or `ultrawork`. It injects a short pointer to the `omt-ulw` skill, the same approach as OmO's Codex edition.

### Install follows the user's existing layout

The installer copies each skill to `~/.agents/skills/<name>`. Codex, Cursor, OpenCode, and Pi read that root. It adds a relative symlink in `~/.claude/skills/<name>` for Claude Code, which does not read `~/.agents/skills`. The installer shows the full plan first, asks once, keeps backups, and records a manifest so that `omt uninstall` removes exactly what it added. This mirrors OmO's consent-first setup.

## What is out of scope

- A T3 fork or a T3 plugin API. oh-my-t3code uses only the surfaces T3 already exposes.
- A DAG scheduler, team mailboxes, memory, or computer use. T3 child threads and worktree threads cover the common cases.
- Hooks for Codex, Cursor, and OpenCode. Codex hooks need per-hook trust. They are a later step.
- Copied code or prompt text from OmO. Its license (Sustainable Use License 1.0) does not allow that. oh-my-t3code re-implements ideas in its own words. omp and T3 Code are MIT.

## Credits

- [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) for categories with fallback chains, the ultrawork loop, plan review rounds, and evidence-based done criteria.
- [oh-my-pi](https://github.com/can1357/oh-my-pi) for model roles, agent definitions, fan-out with shared context, and the review recipe.
- [T3 Code](https://github.com/pingdotgg/t3code) for orchestrator v2, which does the actual work.
