# Delegation in T3

The T3 rules for every omt skill. The T3 MCP server key is `t3-code`. Skills name its tools by base name (`delegate_task`, `task_status`). Your harness may add a prefix, such as `mcp__t3-code__delegate_task` or `mcp__t3_code__delegate_task`: call the tool under the name your tool list shows.

## The CLI

Look up the CLI in this order, and use the first one that exists:

1. `omt` on `PATH` (`command -v omt`).
2. `.omt/bin/omt` in the project root. `omt install --project` creates it.
3. The shim of the main checkout, for a linked worktree: `"$(git rev-parse --path-format=absolute --git-common-dir)/../.omt/bin/omt"`.

When none exists, follow the manual steps in [roles.md](roles.md) and [brief.md](brief.md).

## What a child is

- A child gets only the task text, after one line T3 adds: `Act as the <role> sub-agent for this task.` It does not see your conversation. The brief is its full context ([brief.md](brief.md)).
- A child works in the same project, branch, and worktree as you. Two editing children with overlapping files damage each other's work. Run editing children in parallel only when their scopes are disjoint.
- A child may keep or narrow your modes, never widen them. Runtime: `approval-required` < `auto-accept-edits` < `auto` < `full-access`. Interaction: `plan` < `default`. From a `plan` thread you can dispatch only read-only roles.
- A child in `plan` interaction mode is read-only. Its brief tells it to stay in plan mode and put the result block in its final assistant message, because a proposed plan does not show in `task_status.summary`.

## Your interaction mode

Each omt skill that dispatches work checks its modes first. It calls `t3_thread_configuration` with no `threadId`. It returns only this thread's `modelSelection`, `runtimeMode`, and `interactionMode`. Read your own `interactionMode` from it. On ACP providers whose T3 tools are missing, call it with:

```sh
ELECTRON_RUN_AS_NODE=1 "$T3_ACP_MCP_NODE" ${T3_ACP_MCP_ENTRYPOINT:+"$T3_ACP_MCP_ENTRYPOINT"} acp-mcp-call t3_thread_configuration '{}'
```

Do not call `orchestrator_capabilities` to read your modes. Use it only for the provider and model catalog ([roles.md](roles.md)). Its result is large, so save it to a temp file and read only the fields you need.

- `default`: follow the skill as written.
- `plan`: you are read-only too. Dispatch only read-only roles (`explore`, `research`, `plan-review`, `review`, `oracle`). Write no files: run no `omt init`, `omt plan new`, `omt plan mark`, or `omt ledger add`, and save no evidence files. Commands that only print (`omt roles`, `omt brief`, `omt ledger stats`, `omt plan status`) are fine. Count your dispatched and active tasks yourself against the limits. Deliver the plan or the report in your final message. When the work needs files or edit roles, ask the user to switch the thread to default mode and stop.

## Branch check

Step 0 checks whether the current branch is behind the default branch. A worktree can start from an old base.

1. Find the default branch from the repository metadata. Use the first that gives a result:
   1. `git symbolic-ref --quiet --short refs/remotes/origin/HEAD`, with the `origin/` prefix removed.
   2. `git config init.defaultBranch`, when that branch exists (`git rev-parse --verify --quiet <name>`).
   3. `main` or `master`, whichever exists.

   When none gives a result, skip the check and tell the user that you skipped it.
2. Count the commits: `git rev-list --count HEAD..<default>`. When the count is 0, continue.
3. When the count is above 0:
   - In `plan` mode, only report the count.
   - In `default` mode, when `git status --porcelain` prints nothing and `git merge-base --is-ancestor HEAD <default>` succeeds, run `git merge --ff-only <default>` and report it. Otherwise report the count and ask the user how to continue.

## `delegate_task`

| Field | Value |
| --- | --- |
| `task` | the rendered brief, at most 120,000 characters |
| `target` | `providerInstanceId` or `driverKind`, plus `model` and `options` |
| `title` | thread title |
| `role` | `implementation`, `research`, `review`, `design`, `test`, or `general` (adds only the first line of text) |
| `mode` | `async` (default) or `wait` |
| `timeoutMs` | `wait` only; default 600,000, max 3,600,000 |
| `clientRequestId` | retry key, at most 256 characters |
| `runtimeMode`, `interactionMode` | the child's modes; `inherit` keeps yours |

It returns `taskId`, `childThreadId`, `childRunId`, `status`, `workState`, `summary`, and `waitTimedOut`. Record `taskId` in the ledger at once ([results.md](results.md#recording)). Keep `childThreadId` and `childRunId` for `t3_thread_wait`.

T3 checks `target.options` strictly. An unknown option id, a wrong type, or a value outside the list fails the whole call with `invalid_request`. The effort option id differs per driver; [roles.md](roles.md) has the table.

### Getting the arguments

1. With the CLI: `omt brief <role> --task-file - --title "<role> <unit>: <short unit title>" --scope <p> --done <c> --verify <cmd> --plan <slug> --unit <id> --round <n> --attempt <n> --json`. It prints `{ delegateTask, fallbacks }`. Pass `delegateTask` to `delegate_task` unchanged. Keep `fallbacks` for [the fallback rule](roles.md#fall-back-to-the-next-rung).
   - Always pass `--title`. The default title is the task text cut at 72 characters, which says nothing when the task starts with a long path.
   - `--max-depth <n>` overrides the configured `maxDepth` for this brief. A `--depth` above the effective maximum is an error.
   - `--plan` must match the plan slug pattern, and `--unit` must match `^[A-Za-z0-9._-]{1,64}$`.
2. For the target alone: `omt route <role>`.
3. Without the CLI: write the brief by hand ([brief.md](brief.md)) and pick the target from the role table ([roles.md](roles.md)).

A brief over 120,000 characters fails. Cut the context, or point the child at files to read.

### Request ids

Use `clientRequestId` `omt:<plan>:<unit>:<role>:r<round>:a<attempt>` (`omt ledger request-id` prints it). Within one provider session, a retry with the same id returns the same task.

- Reuse an id only to resend the same payload after a lost response.
- Increase the attempt for the same round on a fallback rung, or after a child failed.
- Increase the round for each new review or fix round.

After a lost response, call `t3_thread_list` with `includeSubagents` and look for the child before you retry.

## Limits

T3 sets no limit on concurrent tasks or nesting depth, and children can delegate again. The omt config sets the limits (defaults in parentheses): `maxParallel` (4), `maxTasksPerRun` (24), `maxDepth` (1), `maxReviewRounds` (3). `omt config show` prints the effective values.

Before each dispatch, run `omt ledger stats --plan <slug>`. Dispatch only while it reports `can dispatch: yes`. The command compares `active` with `maxParallel` and `dispatched` with `maxTasksPerRun` for you. With `--plan`, a `max-tasks` key in the plan header replaces `maxTasksPerRun` for that plan. `active` counts dispatched entries that no terminal entry has closed yet, so record every result ([results.md](results.md#recording)). Without the CLI, count the open task ids in the plan's log and compare the counts with the limits yourself. Every brief states the child's depth; at `maxDepth` the child does the work itself.

When `omt ledger stats --plan <slug>` reports `can dispatch: no` and `active: 0`, no wake will come and the run is stalled. Stop and tell the user which limit was hit (`dispatched` reached `max tasks per run`, or `max parallel` is 0) and the `dispatched` count. To raise the task budget, recommend `omt plan limit <slug> --tasks <n>` first, or `limits.maxTasksPerRun` in `.omt/config.jsonc`. To raise `max parallel`, name `limits.maxParallel` in `.omt/config.jsonc`. `omt config show` prints the current values.

## Waiting

Every write tool, `delegate_task` included, needs your own active turn. After the turn ends, writes fail with `parent_not_active`.

1. Dispatch async tasks, record them, then end your turn. A Claude parent never gets the wake inside a running turn; it arrives as a new queued turn.
2. The wake names only task ids. For one task it reads `Delegated task <id> reached a terminal state. Use task_status with taskId <id> to read the result.` For several tasks it reads `Delegated tasks <id1>, <id2> reached terminal states. Use task_status with each taskId to read the results.` The message holds no result: call `task_status` for each id.
3. A later wake that names tasks you already read needs no action.

When your turn cannot end (a goal or a stop hook keeps it running):

- For one blocking task, call `delegate_task` with `mode: "wait"` and `timeoutMs` at most 3,600,000. On `waitTimedOut: true`, the task still runs; read it later with `task_status`.
- For parallel tasks, call `t3_thread_wait` with `threadId: childThreadId` and `runId: childRunId` for each task (default 10 minutes, max 60), then `task_status` for each. Without `runId`, `t3_thread_wait` returns at once on a thread that is idle between runs. It does not cancel on timeout and does not acknowledge the result.

## `task_status` and `task_cancel`

- `task_status` returns `summary`: the child's last assistant message, or the provider error for a failed run. `workState` is `working`, `waiting_for_children`, or `result_available`. Reading a terminal result acknowledges its delivery.
- When `summary` is `Child task completed without an assistant result.`, read the child with `t3_thread_read` (view `messages`, which includes proposed plans) before you dispatch again.
- `t3_thread_read` view `activity` shows what the child ran.
- `task_cancel` stops the child and everything it delegated. Cancel a child whose scope you are about to give to another task.

## Failure codes

T3 returns these as tool results. Act on each one as follows.

| Code | Action |
| --- | --- |
| `provider_unavailable`, `model_unavailable` | Fall back to the next rung ([roles.md](roles.md#fall-back-to-the-next-rung)). When no rung is left, report the role as unavailable. |
| `invalid_request` about `target.options` | Same as above. Any other `invalid_request`: fix the arguments once; if it fails again, report it. |
| `runtime_mode_escalation_denied`, `interaction_mode_escalation_denied` | Stop. Report the role and both modes to the user. Do not fall back: every rung needs the same modes. |
| `capability_denied` | Stop and report. The thread lacks the needed capability or mode. |
| `parent_not_active` | Your turn is not active. Do the call in your next active turn. If it happens inside an active turn, report it. |
| `task_not_found`, `thread_not_found`, `run_not_found` | Check the id against the ledger and `t3_thread_list` with `includeSubagents`. Correct it, or mark the unit lost and dispatch it again with the next attempt. |
| `task_not_cancellable` | The task has no live run. Read it with `task_status`. |
| `thread_not_sendable`, `thread_not_interruptible` | The thread is archived or idle. Read it instead. |
| `orchestration_error` | Check for the child with `t3_thread_list` (`includeSubagents`), then retry once with the same `clientRequestId`. If it fails again, report it. |

On `provider_unavailable` for a target that names only `driverKind`, retry that target once before you fall back. T3 checks a named provider instance again before it refuses it, but it takes a `driverKind`-only target from a cached snapshot that can be stale.

1. Keep the exact target that failed. It is `delegateTask.target` of the first call, or the fallback that you sent.
2. Run the same `omt brief ... --json` command again with `--attempt <n+1>`. This gives a new `clientRequestId`.
3. Set `delegateTask.target` to the kept target, with `driverKind` replaced by `providerInstanceId` set to the same value. Change nothing else.
4. Call `delegate_task` with that payload. Record it as a new `dispatched` entry with `--attempt <n+1>`, its `--task-id`, and the `--provider` and `--model` of the target you sent ([results.md](results.md#recording)).

When the retry fails too, send the next unused fallback with the next attempt number ([roles.md](roles.md#fall-back-to-the-next-rung)). The retry does not use up a fallback.

Record a fallback dispatch with the fallback's provider and model, not the provider and model of the failed rung.

A failed child run (a provider error in `summary`) counts as a failed attempt. Record it as `failed`, then dispatch the same round again with the next attempt number, on the next rung if the error names the provider.

## Top-level threads

`delegate_task` makes children. Two other tools make ordinary top-level threads; use them only when the user explicitly asks for separate threads. Invoking `omt-swarm` is that request.

- `t3_thread_launch` starts one thread in its own workspace. `workspaceStrategy` is `{type:"worktree", baseRef, branch?, startFromOrigin?}`, `{type:"existing_worktree", worktreePath, branch?}`, or `{type:"root"}`. The task goes in `message`. The caller must run in `full-access` runtime mode and `default` interaction mode. It has no retry key: after a failed or lost response, check `t3_thread_list` before you launch again. Uncommitted edits are not copied into a new worktree.
- `create_threads` makes up to 20 threads that share your checkout.
