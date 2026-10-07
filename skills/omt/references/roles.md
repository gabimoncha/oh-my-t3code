# Roles

A role names a kind of work. The config maps each role to a chain of rungs (provider, model, effort). The first rung that T3 can run wins. Plans and briefs name roles, never models.

## Default roles

| Role | Access | Result | Choose it for |
| --- | --- | --- | --- |
| `explore` | read-only | research | One narrow question about this repository, answered with `path:line` citations. |
| `research` | read-only | research | A question that needs docs, the web, or other repositories. |
| `plan` | edit | plan | Turning a goal into a plan file. Use it when the plan is large enough to hand off. |
| `plan-review` | read-only | review | Checking a plan for gaps before any unit runs. Cross-family. Pass the plan author's provider with `--against`. |
| `execute` | edit | work | One planned unit inside its scope. The default worker. |
| `quick` | edit | work | A small mechanical change: a rename, a typo, a one-file edit. |
| `deep` | edit | work | A hard or cross-cutting problem that needs investigation first, also a round 2 or 3 fix whose cause is unknown or whose previous fix failed for the same reason. |
| `review` | read-only | review | One review round of a diff against its brief. Cross-family. Pass the worker with `--against`. |
| `oracle` | read-only | review | The final gate. Attack the finished change from the family other than the main implementer's. Cross-family. |
| `test` | edit | test | Writing and running tests and real checks for a verdict with evidence. |
| `writing` | edit | work | Documentation and other prose. |
| `design` | edit | work | Design variants of each screen and the design spec for screens and flows ([omt-design](../../omt-design/SKILL.md)). Opus only, no fallback. |
| `ui` | edit | work | One UI unit built from its design spec, in every round of that unit. Opus only, no fallback. |

Read-only roles run in `plan` interaction mode; edit roles run in `default`. Every default role inherits your runtime mode. The persona for each role is `roles/<role>.md`, for example [roles/execute.md](roles/execute.md). The result block for each kind is `results/<kind>.md`, for example [results/work.md](results/work.md).

## Resolve with the CLI

- `omt roles` prints every role with its status, target, access, and mode. `--json` prints the full report.
- `omt route <role>` prints `delegateTask` (target, role, modes) and `fallbacks` for one role.
- `--against <provider|driver|auto>` on `omt route` and `omt brief` names the worker whose change the task reviews. See [Cross-family roles](#cross-family-roles).
- `omt brief <role> ... --json` resolves the role and renders the brief in one step ([delegation.md](delegation.md#getting-the-arguments)).

Status `unverified` is the normal case: the CLI trusts the chain and T3 checks the target at dispatch. To check the chains first, save the `orchestrator_capabilities` result to a temp file, never inside the repository, and pass `--capabilities <file>`. On ACP providers whose T3 tools are missing, write it with:

```sh
ELECTRON_RUN_AS_NODE=1 "$T3_ACP_MCP_NODE" ${T3_ACP_MCP_ENTRYPOINT:+"$T3_ACP_MCP_ENTRYPOINT"} acp-mcp-call orchestrator_capabilities '{}' > "$TMPDIR/omt-caps.json"
```
 Status `unavailable` lists the reason for each rung.

## Resolve by hand

When neither `omt` nor `.omt/bin/omt` is found (see [The CLI](delegation.md#the-cli)), use the default chains below, or the chains in `.omt/config.jsonc` and `~/.config/oh-my-t3code/config.jsonc` when they exist (the project file wins).

| Role | Rung 1 | Rung 2 |
| --- | --- | --- |
| `explore` | codex / gpt-6-luna / low | claudeAgent / claude-sonnet-5-5 / low |
| `research` | codex / gpt-6.1-sol / low | claudeAgent / claude-opus-5-5 / low |
| `plan` | claudeAgent / claude-opus-5-5 / xhigh | codex / gpt-6-astra / xhigh |
| `plan-review` | codex / gpt-6-astra / high | claudeAgent / claude-opus-5-5 / high |
| `execute` | claudeAgent / claude-opus-5-5 / medium | codex / gpt-6.1-sol / xhigh |
| `quick` | codex / gpt-6-luna / high | claudeAgent / claude-sonnet-5-5 / low |
| `deep` | claudeAgent / claude-opus-5-5 / max | codex / gpt-6-astra / xhigh |
| `review` | codex / gpt-6-astra / high | claudeAgent / claude-opus-5-5 / high |
| `oracle` | codex / gpt-6-astra / high | claudeAgent / claude-opus-5-5 / high |
| `test` | codex / gpt-6.1-sol / low | claudeAgent / claude-sonnet-5-5 / low |
| `writing` | claudeAgent / claude-opus-5-5 / high | codex / gpt-6-astra / medium |
| `design` | claudeAgent / claude-opus-5-5 / high | none |
| `ui` | claudeAgent / claude-opus-5-5 / medium | none |

The cross-family roles are `plan-review`, `review`, and `oracle`. For these roles, try the rungs outside the worker's family first, then the rungs in the worker's family, each in table order. When no rung outside the worker's family can run, the same family reviews.

- The family of a provider is the `driver` of the first configured rung that names this provider and a driver, or the provider itself when no such rung exists.
- The family of a rung is its `driver`, or the family of its `provider` when it names no driver.
- The worker's family is the family of the provider recorded for the unit's last work dispatch in `.omt/ledger.jsonl`.

Build the target as `{ "providerInstanceId": "<driver>", "model": "<model>", "options": { "<id>": "<effort>" } }`. Each default rung names the T3 built-in provider instance, and its id is the driver kind. For a config rung, use its `provider` as `providerInstanceId`. Use `driverKind` only for a config rung that names no provider.

A rung names its provider instance because T3 checks a named instance again before it refuses it. T3 picks a `driverKind`-only target from a cached provider snapshot, and that snapshot can be stale.

The effort option id depends on the driver:

| Driver | Option id | Value rule |
| --- | --- | --- |
| `claudeAgent` | `effort` | `off` and `minimal` become `low` |
| `codex` | `reasoningEffort` | `off` and `minimal` become `low` |
| `grok` | `reasoningEffort` | unchanged |
| `pi` | `thinking` | unchanged |
| `opencode` | `variant` | `off` and `minimal` become `low`; `max` becomes `xhigh` |

For any other driver, send no `options`. Set `role` to the T3 role (`research` for explore and research, `design` for plan and design, `review` for plan-review, review, and oracle, `implementation` for execute, quick, deep, writing, and ui, `test` for test). Set `interactionMode` from the Access column (`plan` for read-only, `default` for edit) and `runtimeMode` to `inherit`.

## Cross-family roles

A role with `crossFamily: true` reviews from the family other than the worker's. The family of a rung is its driver. The defaults set it for `plan-review`, `review`, and `oracle`.

- `--against <provider|driver>` names the worker. A provider instance id, in `--against` or in a rung without a `driver`, maps to its driver through `--capabilities`, or through a configured rung that names both the provider and the driver. When no rung is in the worker's family, a note says so and the configured order applies.
- `--against auto` reads the worker from `.omt/ledger.jsonl` and needs `--plan`. With `--unit`, when that unit has a work or plan dispatch, the worker is the provider of its last one. When the unit has none, or `--unit` is missing, the worker is the provider that most units of the plan ran on.
- The CLI tries the rungs outside the worker's family first. When none can run, the worker's family reviews, and a note says so.
- Without `--against`, the configured order applies.
- On a role without `crossFamily`, `--against` has no effect.

`auto` works only when every dispatch record carries `--provider` and `--model` ([results.md](results.md#recording)).

## Fall back to the next rung

On `provider_unavailable`, `model_unavailable`, or an `invalid_request` about options, move to the next rung. A `driverKind`-only target gets one retry on the same rung first ([delegation.md](delegation.md#failure-codes)). `fallbacks` from `omt brief --json` lists the remaining rungs in order. The first fallback is `fallbacks[0]`, and the next is `fallbacks[1]`.

1. Run the same `omt brief ... --json` command again with `--attempt <n+1>`. This gives a new `clientRequestId`.
2. Set `delegateTask.target` to the next unused fallback. Change nothing else.
3. Call `delegate_task` with that payload.
4. Record the new call as a new `dispatched` entry with `--attempt <n+1>`, its `--task-id`, and the fallback's `--provider` and `--model` ([results.md](results.md#recording)). The failed call returned no task, so it has no ledger entry to close.

A role with one rung (`design` and `ui`) has no fallback. When T3 refuses its rung, stop and tell the user which target failed.

A mode escalation error is not a rung problem: stop and report it ([delegation.md](delegation.md#failure-codes)).

## Custom roles and personas

- Add or override a role in `.omt/config.jsonc` (project) or `~/.config/oh-my-t3code/config.jsonc` (user). A new role needs `description`, `access`, and `chain`. `omt config show --defaults` prints the built-in config; `omt config validate` checks a file.
- A persona file `<role>.md` overrides the bundled one. Lookup order: `.omt/roles/`, then `~/.config/oh-my-t3code/roles/`, then the bundled `roles/`, then [roles/_generic.md](roles/_generic.md).
- A custom role gets its result block from its `result` field: `work`, `review`, `test`, `research`, or `plan`.
