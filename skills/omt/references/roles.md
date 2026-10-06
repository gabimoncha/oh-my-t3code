# Roles

A role names a kind of work. The config maps each role to a chain of rungs (provider, model, effort). The first rung that T3 can run wins. Plans and briefs name roles, never models.

## Default roles

| Role | Access | Result | Choose it for |
| --- | --- | --- | --- |
| `explore` | read-only | research | One narrow question about this repository, answered with `path:line` citations. |
| `research` | read-only | research | A question that needs docs, the web, or other repositories. |
| `plan` | edit | plan | Turning a goal into a plan file. Use it when the plan is large enough to hand off. |
| `plan-review` | read-only | review | Checking a plan for gaps before any unit runs. Cross-family by default. |
| `execute` | edit | work | One planned unit inside its scope. The default worker. |
| `quick` | edit | work | A small mechanical change: a rename, a typo, a one-file edit. |
| `deep` | edit | work | A hard or cross-cutting problem that needs investigation first, or the last fix round of a unit whose review failed twice. |
| `review` | read-only | review | One review round of a diff against its brief. Same family as `execute` by default. |
| `oracle` | read-only | review | The final gate: attack finished work from another model family. |
| `test` | edit | test | Writing and running tests and real checks for a verdict with evidence. |
| `writing` | edit | work | Documentation and other prose. |

Read-only roles run in `plan` interaction mode; edit roles run in `default`. Every default role inherits your runtime mode. The persona for each role is `roles/<role>.md`, for example [roles/execute.md](roles/execute.md). The result block for each kind is `results/<kind>.md`, for example [results/work.md](results/work.md).

## Resolve with the CLI

- `omt roles` prints every role with its status, target, access, and mode. `--json` prints the full report.
- `omt route <role>` prints `delegateTask` (target, role, modes) and `fallbacks` for one role.
- `omt brief <role> ... --json` resolves the role and renders the brief in one step ([delegation.md](delegation.md#getting-the-arguments)).

Status `unverified` is the normal case: the CLI trusts the chain and T3 checks the target at dispatch. To check the chains first, save the `orchestrator_capabilities` result to a temp file, never inside the repository, and pass `--capabilities <file>`. On ACP providers whose T3 tools are missing, write it with:

```sh
ELECTRON_RUN_AS_NODE=1 "$T3_ACP_MCP_NODE" ${T3_ACP_MCP_ENTRYPOINT:+"$T3_ACP_MCP_ENTRYPOINT"} acp-mcp-call orchestrator_capabilities '{}' > "$TMPDIR/omt-caps.json"
```
 Status `unavailable` lists the reason for each rung.

## Resolve by hand

When `omt` is not on `PATH`, use the default chains below, or the chains in `.omt/config.jsonc` and `~/.config/oh-my-t3code/config.jsonc` when they exist (the project file wins).

| Role | Rung 1 | Rung 2 |
| --- | --- | --- |
| `explore` | claudeAgent / claude-sonnet-5-5 / low | codex / gpt-6-luna / low |
| `research` | claudeAgent / claude-sonnet-5-5 / medium | codex / gpt-6.1-sol / medium |
| `plan` | claudeAgent / claude-opus-5-5 / high | codex / gpt-6-astra / high |
| `plan-review` | codex / gpt-6-astra / high | claudeAgent / claude-opus-5-5 / high |
| `execute` | claudeAgent / claude-opus-5-5 / medium | codex / gpt-6.1-sol / medium |
| `quick` | claudeAgent / claude-sonnet-5-5 / low | codex / gpt-6-luna / low |
| `deep` | claudeAgent / claude-opus-5-5 / xhigh | codex / gpt-6-astra / xhigh |
| `review` | claudeAgent / claude-opus-5-5 / high | codex / gpt-6-astra / high |
| `oracle` | codex / gpt-6-astra / high | claudeAgent / claude-opus-5-5 / high |
| `test` | claudeAgent / claude-sonnet-5-5 / medium | codex / gpt-6.1-sol / medium |
| `writing` | claudeAgent / claude-opus-5-5 / medium | codex / gpt-6.1-sol / medium |

Build the target as `{ "driverKind": "<driver>", "model": "<model>", "options": { "<id>": "<effort>" } }`. The effort option id depends on the driver:

| Driver | Option id | Value rule |
| --- | --- | --- |
| `claudeAgent` | `effort` | `off` and `minimal` become `low` |
| `codex` | `reasoningEffort` | `off` and `minimal` become `low` |
| `grok` | `reasoningEffort` | unchanged |
| `pi` | `thinking` | unchanged |
| `opencode` | `variant` | `off` and `minimal` become `low`; `max` becomes `xhigh` |

For any other driver, send no `options`. Set `role` to the T3 role (`research` for explore and research, `design` for plan, `review` for plan-review, review, and oracle, `implementation` for execute, quick, deep, and writing, `test` for test). Set `interactionMode` from the Access column (`plan` for read-only, `default` for edit) and `runtimeMode` to `inherit`.

## Fall back to the next rung

On `provider_unavailable`, `model_unavailable`, or an `invalid_request` about options, move to the next rung. `fallbacks` from `omt brief --json` lists the remaining rungs in order: the first fallback is `fallbacks[0]`, the next is `fallbacks[1]`.

1. Run the same `omt brief ... --json` command again with `--attempt <n+1>`. This gives a new `clientRequestId`.
2. Set `delegateTask.target` to the next unused fallback. Change nothing else.
3. Call `delegate_task` with that payload.
4. Record the new call as a new `dispatched` entry with `--attempt <n+1>` and its `--task-id` ([results.md](results.md#recording)). The failed call returned no task, so it has no ledger entry to close.

A mode escalation error is not a rung problem: stop and report it ([delegation.md](delegation.md#failure-codes)).

## Custom roles and personas

- Add or override a role in `.omt/config.jsonc` (project) or `~/.config/oh-my-t3code/config.jsonc` (user). A new role needs `description`, `access`, and `chain`. `omt config show --defaults` prints the built-in config; `omt config validate` checks a file.
- A persona file `<role>.md` overrides the bundled one. Lookup order: `.omt/roles/`, then `~/.config/oh-my-t3code/roles/`, then the bundled `roles/`, then [roles/_generic.md](roles/_generic.md).
- A custom role gets its result block from its `result` field: `work`, `review`, `test`, `research`, or `plan`.
