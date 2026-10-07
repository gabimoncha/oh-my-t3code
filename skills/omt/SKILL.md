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

Each skill name works as a composer mention: `$omt-ulw` becomes `/omt-ulw` in Claude and Cursor, `/skill:omt-ulw` in Pi, and stays `$omt-ulw` in Codex.

## CLI cheat sheet

To find the CLI (`omt`, `.omt/bin/omt`, or the manual steps), follow [The CLI](references/delegation.md#the-cli).

| Command | Prints |
| --- | --- |
| `omt init` | creates `.omt/config.jsonc`, `.omt/plans/`, `.omt/.gitignore`; adds missing `.gitignore` lines |
| `omt roles` | every role with its target, access, and mode |
| `omt route <role> [--against <provider\|driver\|auto>]` | `delegateTask` and `fallbacks` for one role, as JSON; `--against` names the worker that a cross-family role reviews ([roles.md](references/roles.md#cross-family-roles)) |
| `omt brief <role> --task-file - --title "<role> <unit>: <title>" --scope <p> --done <c> --verify <cmd> --plan <slug> --unit <id> --round <n> --attempt <n> [--against <provider\|driver\|auto>] --json` | `{ delegateTask, fallbacks }`; pass `delegateTask` to `delegate_task` unchanged |
| `omt plan new <slug> [--light]` | path of a new plan file under `.omt/plans/`; `--light` leaves out the `F2` oracle item |
| `omt plan mark <slug> <id> <done\|open\|blocked>` | ticks one plan item, for example `omt plan mark auth U3 done` |
| `omt plan status [<slug>]` | unit counts and the next open unit |
| `omt ledger add --plan <slug> --unit <id> --role <r> --round <n> --attempt <n> --status <s> ...` | appends one ledger entry; a terminal entry closes the matching dispatched entry ([results.md](references/results.md#recording)) |
| `omt ledger stats --plan <slug>` | `dispatched` and `active` counts, the limits, and `can dispatch: yes` or `no` |
| `omt ledger request-id --plan <slug> --unit <id> --role <r> --round <n> --attempt <n>` | the `clientRequestId` |
| `omt config show` | the effective config, including limits |

## Shared references

- [delegation.md](references/delegation.md): the T3 rules. `delegate_task` fields, request ids, limits, waiting, `task_status`, failure codes, top-level threads.
- [roles.md](references/roles.md): the default roles, when to pick each, manual resolution, effort options, fallback, custom roles.
- [brief.md](references/brief.md): the brief layout, how to write the task text, and a full example.
- [results.md](references/results.md): how to read each result block and verify a claim.
- `references/roles/<role>.md`: one persona per role, for example [execute.md](references/roles/execute.md).
- `references/results/<kind>.md`: one result contract per kind, for example [work.md](references/results/work.md).
