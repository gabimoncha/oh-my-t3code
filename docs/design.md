# About the design of oh-my-t3code

oh-my-t3code is an orchestration layer for [T3 Code](https://t3.codes). It gives any agent inside a T3 thread a disciplined way to plan, delegate, review, and verify work through T3's own orchestrator. The ideas come from oh-my-openagent (OmO) and oh-my-pi (omp). The mechanism is T3 orchestrator v2.

The [T3 orchestration report](research/t3-orchestrator-v2.md), [OmO report](research/oh-my-openagent.md), and [omp report](research/oh-my-pi.md) record the research behind the original design. The exact contracts for the code are in [`spec.md`](spec.md).

## Who this is for

The user is a developer who runs Claude Code, Codex, Cursor, Pi, or OpenCode agents from T3 Code. That developer wants one sentence ("ulw: add OAuth to the API") to turn into a planned run. Each unit goes to a role-routed model and gets the checks that its profile requires. The normal profile reviews each unit and requires a final cross-family oracle for HEAVY work.

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

Skills and plans name a role such as `execute`, `review`, or `verify`. One config maps each role to an ordered chain of rungs. A rung is a provider, a model, and an effort level. The first rung that T3 can run wins.

This comes from omp model roles and OmO categories. It matters more in T3 than in either source, because T3 can reach several providers at once. A role chain such as "Opus 5.5 at medium effort, then GPT-6.1-Sol at xhigh effort" survives a missing subscription or a disabled provider.

T3 validates `target.options` strictly. An unknown option id or a value outside the list fails the whole call. Each driver also names effort differently: Claude uses `effort`, Codex uses `reasoningEffort`, Pi uses `thinking`. So the CLI maps one effort ladder (`off` to `max`) onto the option that each model advertises, and picks the nearest supported value.

### Reviewers come from the other family

The `plan-review`, `review`, and `oracle` roles are cross-family. The skill passes the worker's provider to `omt brief --against`, and the CLI tries the rungs of the other family first. A reviewer from another family misses fewer of the worker's blind spots. The owner chose this rule. When the other family is not available, the same family reviews, because a review from the same family is better than no review. The family is the driver, so a driver that runs models of several vendors (Cursor, OpenCode) counts as its own family.

The ledger records the provider of each dispatch. So `--against auto` finds the worker of a unit, or the main implementer of a plan, without help from the agent.

### Designs come from Opus, and the owner steers

The `design` role makes design variants and the design spec, and the `ui` role implements a UI unit from that spec. Both run only on Claude Opus 5.5: `design` at high effort, `ui` at medium. Neither has a fallback to another family. The owner chose this rule, because Opus is far better at design, and a human steers taste. No model reviews a design: `review`, `oracle`, and `plan-review` tasks leave `docs/design/` out. The designer makes a new Paper file for each project and uses `design.variants` for each screen, 3 in the normal profile, so the owner compares real options side by side. The owner picks one variant per screen, may mix variants across screens, steers them in their own words, and approves the spec. Code review of `ui` units still runs as for any other unit.

### A CLI for the deterministic parts, skills for the judgment

Config merging, chain resolution, option mapping, brief rendering, and plan counting are deterministic. An LLM does them badly and expensively, so the `omt` CLI does them. Planning, splitting work, reading results, and deciding what to do next need judgment, so skills carry them.

The CLI cannot call T3 itself. Claude and Codex sessions get the T3 MCP server through config, not through environment variables, so a shell command has no credential. Routing is therefore unverified by default: the CLI trusts the chain and maps the effort, `delegate_task` validates the target, and the skill moves to the next rung on a typed T3 error. An agent can pass a saved copy of `orchestrator_capabilities` to check the chains ahead of time.

The skills also work without the CLI. They tell the agent to try a role's chain in order and to fall back on a typed T3 error. T3 is the final validator either way.

### The owner sees a plan as a page

The owner does not read long plans. Each plan therefore opens with a summary of at most 15 lines in plain words, and a plan reviewer blocks a summary line that the plan does not support, because the owner may read nothing else. A summary still hides the shape of the work: which units wait for which, and how a new process runs. T3 renders no flowcharts in chat, but its `html_render` tool shows an HTML page above the agent's reply. So when a plan is final, `omt-plan` shows it as a page with the summary, the units as a flowchart by dependency layer, the checks, and up to 3 flowcharts or tables of the design.

The split follows the rule of the section above. The `omt-show` skill decides what to draw, which needs judgment. `omt visual` lays out the page: the rows of a flowchart, the edge routes, the text wrapping, and the escaping. Agents that draw SVG by hand get coordinates wrong, edges cross boxes, and each page looks different. A fixed layout gives every plan the same look and a check for crossing edges. The page uses T3's theme variables, so it follows the reader's light or dark theme. The owner can turn the page off with `visuals.plan`, and then the summary goes in the reply as text.

### Briefs and result contracts

A child sees nothing of the parent conversation. Every task therefore carries a brief with a fixed shape: role persona, task, context, scope, constraints, done condition, verify commands, and the required final message format. OmO's worker contract (task, deliverable, scope, verify, stop condition) is the model for this.

`task_status.summary` is the child's last assistant message. Each role therefore ends with a fixed result block: `STATUS` for workers, `VERDICT` for reviewers, verify, qa, and guardrail tasks, and `ANSWER` for researchers. The parent reads the block and checks the evidence itself. A worker's "done" is a claim until the parent or a `verify` task confirms it.

### Read-only roles run in plan mode

A live experiment showed that a Claude child in T3 `plan` interaction mode runs read-only commands, stays in plan mode, and returns its final message intact. Explore, research, review, oracle, plan-review, and guardrail roles therefore default to `interactionMode: "plan"`. On Claude, Codex, Cursor, and OpenCode, T3 enforces read-only access for those children, and the brief does not have to rely on the child's restraint. T3 has no plan-mode handling for Pi, so a Pi child in a read-only role relies on its brief alone. No default rung uses Pi; a custom chain that adds Pi to a read-only role accepts that risk.

Plan mode has one trap. T3 stores a proposed plan as its own item type, and `task_status.summary` reads only assistant messages. A child that answers with a proposed plan (Claude's ExitPlanMode, or Codex plan output) can hide its result block from the summary. Every plan-mode brief therefore tells the child to stay in plan mode and put the block in its final assistant message. When a summary still comes back empty, the conductor reads the child thread, which includes proposed plans.

### Children share the checkout

Delegated units stay in one checkout so their changes are integrated throughout the run. A worktree per unit would need repeated setup, integration, and checks after merge. Each unit has an explicit file scope. Only disjoint edit scopes run in parallel, up to the default `maxParallel` of 6. Shared build state uses a lock. Independent tracks can use `omt-swarm` when the owner asks for separate worktree threads.

### Finished children are settled

T3 keeps a finished child loaded for 30 idle minutes. Codex then keeps the thread for its unload delay, which is 1800 seconds from Codex 0.163.0. Each loaded Codex thread starts its own stdio MCP server processes. In one long run, a single Codex app-server had 1,042 child processes: up to 174 copies of each of its 6 MCP servers. Codex native subagents of an idle parent stay loaded until the app-server stops, because T3's idle release unsubscribes only the parent. A settle releases the child at once and unsubscribes its native subagents too. So the conductor settles each child after it records the result. Owners also set `-c thread_unload_delay_secs=60` in T3's Codex launch arguments, which makes Codex close a settled thread after one minute.

### Profiles select the workflow

A role selects a model. A profile selects the plan, build, and review steps. Keeping those choices separate lets a project use the same roles for normal work, prototypes, and PR reviews. Sparse profile overrides inherit `normal`, so a custom workflow states only its differences. A plan header keeps the selected profile across context resets. The conductor reloads it on wake so an owner can switch the remaining work.

### Verification and test writing are separate

`verify` runs the artifact and existing checks. `qa` writes the approved tests after verification passes. The split avoids new tests on every worker attempt and keeps device checks on a role that can reach local tools. Only qa makes required failure proofs. A ui worker requests design screenshots, while unit verification checks behavior without a second design comparison.

### New tests need a plan line

Each new test maps to an owner-approved `## Tests` line. This makes the test's flow, file, and reason reviewable before qa writes it. The default proposal is one e2e test per main flow. Other layers need a reason and owner approval. An empty list means no new tests, while verification still checks the artifact.

### Build locks follow open files

A kernel lock on an inherited fd 3 survives a wrapper crash while another holder remains. Nothing guesses that a lock is stale or takes it over. The lock file keeps its inode, and the kernel releases the lock when the last holder closes it. Commands that leave processes behind run outside the lock with a serial plan. Without `flock` or `lockf`, the CLI still runs the command and the plan keeps shared builds serial.

### Guardrails prefer checks that can fail

A lint rule, type rule, test, or CI check can catch a repeated defect without another model judgment. The guardrail role therefore proposes a deterministic check before a rule correction or a new rule. Each check proposal names a command that fails before the fix and passes after it. Judgment-only findings get no proposal. Local `.omt/guardrails.md` records proposals for separate work without adding them to the PR branch.

### Limits that T3 does not set

T3 has no cap on concurrent tasks or nesting depth. The config sets four limits: parallel tasks, tasks per run, depth, and review rounds. Every brief states the child's depth. At the maximum depth a child does the work itself.

One config limit on tasks does not fit every plan. A dogfood run hit the task limit after 2 of 16 units. So `omt-plan` asks the owner for a task budget per HEAVY plan, with an estimate from the unit count, and stores it in the plan header. When a run stalls, the conductor names the plan budget first, because raising it changes no other plan.

### State lives in the repository

A long run outlives the agent's context. The plan (`.omt/plans/<slug>.md`) and the ledger (`.omt/ledger.jsonl`) hold the state: units, scopes, done conditions, task ids, rounds, and verdicts. After compaction the conductor re-reads both files. The plan uses checkbox grammar that people can read and that `omt plan status` can count.

Live plans stay out of git. All worktrees share the one `.omt` in the main checkout, and omt reads and edits only that copy. A committed plan gives every worktree branch a tracked copy that goes stale, and that copy makes every omt command warn about shadowed state. So `.omt/.gitignore` holds `plans/`. To keep a finished plan as a record, copy it to a path outside `.omt/`, such as `docs/`, and commit it there.

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
