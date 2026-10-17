---
name: omt
description: oh-my-t3code router. Lists the omt workflows for T3 Code, when to use each, the omt CLI commands, and the shared references.
disable-model-invocation: true
---

# oh-my-t3code

omt turns this T3 thread into a conductor: it plans, delegates each unit to a role-routed subagent through the T3 `delegate_task` tool, reviews, tests, and verifies. Pick the workflow that matches the request, then load that skill.

## Workflows

| Skill | Use it when |
| --- | --- |
| `omt-ulw` | The user wants something built or fixed end to end with subagents ("ulw", "ultrawork"). The default. |
| `omt-plan` | The user wants a reviewed plan before any code changes, or `omt-ulw` needs one for a HEAVY task. |
| `omt-design` | The user wants designs, mockups, screens, or a design pass, or a plan needs a design spec before its UI units. |
| `omt-review` | The user wants a review of uncommitted changes, a branch, a commit, or a PR. |
| `omt-research` | The user wants a cited answer from this repository, docs, or the web, with no code changes. |
| `omt-swarm` | The user asks for separate threads: independent tracks in their own worktrees, each ending in a PR. |
| `omt-loop` | The user wants the work to keep going across turns until a condition holds. |
| `omt-show` | The user wants to see a plan, a flow, or a status as a page with flowcharts and tables. `omt-plan` runs it when it hands off a plan. |

For a pull request review, load `omt-review` with `omt-review --profile pr-review <number>`.

Each skill name works as a composer mention: `$omt-ulw` becomes `/omt-ulw` in Claude and Cursor, `/skill:omt-ulw` in Pi, and stays `$omt-ulw` in Codex.

## CLI cheat sheet

To find the CLI (`omt`, `.omt/bin/omt`, or the manual steps), follow [The CLI](references/delegation.md#the-cli).

| Command | Prints |
| --- | --- |
| `omt init` | creates `.omt/config.jsonc`, `.omt/plans/`, `.omt/.gitignore`; adds missing `.gitignore` lines |
| `omt roles` | every role with its target, access, and mode |
| `omt route <role> [--against <provider\|driver\|auto>]` | `delegateTask` and `fallbacks` for one role, as JSON; `--against` names the worker that a cross-family role reviews ([roles.md](references/roles.md#cross-family-roles)) |
| `omt brief <role> --task-file - --title "<role> <unit>: <title>" --scope <p> --done <c> --verify <cmd> --plan <slug> --unit <id> --round <n> --attempt <n> [--against <provider\|driver\|auto>] --save --json` | `{ delegateTask, fallbacks, ledger }`; the full brief is in a file and `delegateTask.task` names it |
| `omt profile list` | available workflow profiles |
| `omt profile show [<name>] [--plan <slug>] --json` | the effective `profile`, `source`, `workflow`, `limits`, `roles`, and `models` |
| `omt plan new <slug> [--light] [--profile <name>]` | path of a new plan file under `.omt/plans/`; `--light` leaves out the `F2` oracle item |
| `omt plan profile <slug> <name\|none>` | switches the plan's profile; `none` removes the plan override |
| `omt plan mark <slug> <id> <done\|open\|blocked>` | ticks one plan item, for example `omt plan mark auth U3 done` |
| `omt plan status [<slug>]` | unit counts and the next open unit |
| `omt ledger add --plan <slug> --unit <id> --role <r> --round <n> --attempt <n> --status <s> ...` | appends one ledger entry; a terminal entry closes the matching dispatched entry ([results.md](references/results.md#recording)) |
| `omt ledger stats --plan <slug>` | `dispatched` and `active` counts, the limits, and `can dispatch: yes` or `no` |
| `omt ledger request-id --plan <slug> --unit <id> --role <r> --round <n> --attempt <n>` | the `clientRequestId` |
| `omt config show` | the merged config before profile selection, including limits and `visuals` |
| `omt lock run <name> [--wait <seconds>] -- <command>` | runs a command under a shared build lock and returns its exit code |
| `omt lock list` | each lock's state and the holder of a held lock |
| `omt visual [--plan <slug>] --spec - --json` | path of a self-contained HTML page: the plan's summary, units by dependency layer, and checks, plus the tabs of the spec ([page-spec.md](../omt-show/references/page-spec.md)) |

Pass `delegateTask` to `delegate_task` unchanged. Record the dispatch with the printed `ledger.dispatched` line after replacing `<taskId>`. Use [delegation.md](references/delegation.md#getting-the-arguments) for retries and plan-mode dispatch.

## Shared references

- [delegation.md](references/delegation.md): the T3 rules. `delegate_task` fields, request ids, limits, waiting, `task_status`, releasing children, failure codes, top-level threads.
- [roles.md](references/roles.md): the default roles, when to pick each, manual resolution, effort options, fallback, custom roles.
- [brief.md](references/brief.md): the brief layout, how to write the task text, and a full example.
- [results.md](references/results.md): how to read each result block and verify a claim.
- `references/roles/<role>.md`: one persona per role, for example [execute.md](references/roles/execute.md).
- `references/results/<kind>.md`: one result contract per kind, for example [work.md](references/results/work.md).
