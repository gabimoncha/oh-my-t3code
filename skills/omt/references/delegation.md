# Delegation in T3

The T3 rules for every omt skill. The T3 MCP server key is `t3-code`. Skills name its tools by base name (`delegate_task`, `task_status`). Your harness may add a prefix, such as `mcp__t3-code__delegate_task` or `mcp__t3_code__delegate_task`: call the tool under the name your tool list shows.

## The CLI

Look up the CLI in this order, and use the first one that exists:

1. `omt` on `PATH` (`command -v omt`). A global install puts it there: `npm i -g oh-my-t3code`, `pnpm add -g oh-my-t3code`, `bun add -g oh-my-t3code`, or `mise use -g github:gabimoncha/oh-my-t3code`.
2. `.omt/bin/omt` in the project root. `omt install --project` creates it, also from a dev dependency or from a one-shot run such as `npx omt3 install --project`.
3. The shim of the main checkout, for a linked worktree: `"$(git rev-parse --path-format=absolute --git-common-dir)/../.omt/bin/omt"`.

A shim from a one-shot run calls its runner (`npx`, `pnpm dlx`, or `bunx`) with the pinned version. After the runner's cache is cleared, the next call downloads the package again and needs the network.

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
- `plan`: you are read-only too. Dispatch only read-only roles (`explore`, `research`, `plan-review`, `review`, `oracle`). Write no files: run no `omt init`, `omt plan new`, `omt plan mark`, or `omt ledger add`, and save no evidence files. Commands that only print (`omt roles`, `omt brief`, `omt ledger stats`, `omt plan status`) are fine. Count your dispatched and active tasks yourself against the limits. Settle each child after you read its result ([Releasing children](#releasing-children)). Deliver the plan or the report in your final message. When the work needs files or edit roles, ask the user to switch the thread to default mode and stop.

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
| `task` | the short file pointer from `omt brief --save --json`, or the rendered brief, at most 120,000 characters |
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

1. With the CLI: `omt brief <role> --task-file - --title "<role> <unit>: <short unit title>" --scope <p> --done <c> --verify <cmd> --plan <slug> --unit <id> --round <n> --attempt <n> --save --json`. It prints `{ delegateTask, fallbacks, ledger }`. Pass `delegateTask` to `delegate_task` unchanged. Keep `fallbacks` for [the fallback rule](roles.md#fall-back-to-the-next-rung).
   - Always pass `--title`. The default title is the task text cut at 72 characters, which says nothing when the task starts with a long path.
   - `--max-depth <n>` overrides the configured `maxDepth` for this brief. A `--depth` above the effective maximum is an error.
   - `--plan` must match the plan slug pattern, and `--unit` must match `^[A-Za-z0-9._-]{1,64}$`.
2. For the target alone: `omt route <role>`.
3. Without the CLI: write the brief by hand ([brief.md](brief.md)) and pick the target from the role table ([roles.md](roles.md)).

In `plan` interaction mode, omit `--save` and keep the brief in `delegateTask.task` without writing files or ledger entries. With `--save`, the full brief is in `<evidence>/briefs/<clientRequestId>.md`. `delegateTask.task` names that absolute file path. After dispatch, run the printed `ledger.dispatched` line with only `<taskId>` replaced by the returned id. After a target change, update its provider and model to the target that returned the task. When you build a `plan` or `plan-review` brief, name the effective `workflow.plan.testLayers` value in the task text. Read it from `omt profile show --plan <slug> --json`, or `omt profile show <name> --json` before the plan exists, or `omt profile show --json` without a selected profile.

A brief over 120,000 characters fails. Cut the context, or point the child at files to read.

### Fast mode

Keep the fast options in `delegateTask.target.options` and in each fallback target. The CLI resolves `rung.fast`, then `roles.<role>.fast`, then `models.<id>.fast`, then `false`. The default sets `models.gpt-6.1-sol.fast` to `true`. A `true` value maps to `serviceTier: "priority"` or `fastMode: true` when the model offers that option. An explicit key in `rung.options` wins over the fast mapping. With `fast: false`, the CLI adds no fast option. If fast mode is unavailable, keep the target and report the CLI note. See [roles.md](roles.md#fast-mode) for capability and manual routing rules.

### Request ids

Use `clientRequestId` `omt:<plan>:<unit>:<role>:r<round>:a<attempt>` (`omt ledger request-id` prints it). Within one provider session, a retry with the same id returns the same task.

- Reuse an id only to resend the same payload after a lost response.
- Increase the attempt for the same round on a fallback rung, or after a child failed.
- Increase the round for each new review or fix round.

After a lost response, call `t3_thread_list` with `includeSubagents` and look for the child before you retry.

## Limits

T3 sets no limit on concurrent tasks or nesting depth, and children can delegate again. The omt config sets the limits (defaults in parentheses): `maxParallel` (6), `maxTasksPerRun` (24), `maxDepth` (1), `maxReviewRounds` (3). Read the profile's limits with `omt profile show --plan <slug> --json`. A plan header's `max-parallel` can only lower the profile's `maxParallel`.

Before each dispatch, run `omt ledger stats --plan <slug>`. Dispatch only while it reports `can dispatch: yes`. The command compares `active` with `maxParallel` and `dispatched` with `maxTasksPerRun` for you. With `--plan`, a `max-tasks` key in the plan header replaces `maxTasksPerRun` for that plan. `active` counts dispatched entries that no terminal entry has closed yet, so record every result ([results.md](results.md#recording)). Without the CLI, count the open task ids in the plan's log and compare the counts with the limits yourself. Every brief states the child's depth; at `maxDepth` the child does the work itself.

When `omt ledger stats --plan <slug>` reports `can dispatch: no` and `active: 0`, no wake will come and the run is stalled. Stop and tell the user which limit was hit (`dispatched` reached `max tasks per run`, or `max parallel` is 0) and the `dispatched` count. To raise the task budget, recommend `omt plan limit <slug> --tasks <n>` first, or `limits.maxTasksPerRun` in `.omt/config.jsonc`. To raise `max parallel`, name `limits.maxParallel` in `.omt/config.jsonc`. Read the selected profile's values as above.

## Waiting

Every write tool, `delegate_task` included, needs your own active turn. After the turn ends, writes fail with `parent_not_active`.

1. Dispatch async tasks, record them, then end your turn. A Claude parent never gets the wake inside a running turn; it arrives as a new queued turn.
2. The wake names only task ids. For one task it reads `Delegated task <id> reached a terminal state. Use task_status with taskId <id> to read the result.` For several tasks it reads `Delegated tasks <id1>, <id2> reached terminal states. Use task_status with each taskId to read the results.` The message holds no result: call `task_status` for each id.
3. A later wake that names tasks you already read needs no action.

When your turn cannot end (a goal or a stop hook keeps it running):

- For one blocking task, call `delegate_task` with `mode: "wait"` and `timeoutMs` at most 3,600,000. On `waitTimedOut: true`, the task still runs; read it later with `task_status`.
- For parallel tasks, call `t3_thread_wait` with `threadId: childThreadId` and `runId: childRunId` for each task (default 10 minutes, max 60), then `task_status` for each. Without `runId`, `t3_thread_wait` returns at once on a thread that is idle between runs. It does not cancel on timeout and does not acknowledge the result.

## Verification and devices

Only `verify` drives a device, a Simulator UI, a browser, or a computer. Use `omt brief verify` with the steps and expected results. Keep its routed target. The default chain is Claude Haiku 5.5, then Claude Sonnet 5.5, then Codex Sol. The Claude rungs come first because a Codex child could not reach the local device daemon.

An edit role can delegate a device check to `verify` at any depth. A read-only role lists the check for the conductor to dispatch. When a `verify` task returns `INCONCLUSIVE` because it cannot reach a local tool, send the same task once to the next rung of another provider. Use the next attempt number and record that target's provider and model. If no such rung exists, report the blocker. After that one retry, send an unresolved result to the fix or stop step of the current workflow.

Run one device pass per unit without duplicate checks. A `ui` worker's `verify` child takes only the screenshots for the worker's design comparison. The unit's step 8 `verify` task runs the behavior flows. Neither repeats the other's part. Give `qa` only the planned test lines after verification. `qa` writes tests and makes failure proofs when requested, while `verify` writes no tests.

## Shared builds

Keep parallel edit scopes disjoint in the same checkout. Run each shared build or test command as `omt lock run <name> [--wait <seconds>] -- <command>`. Run a command that the task wraps in `omt lock run` exactly as written. Use one lock name per shared resource. Use the lock for a command whose subprocesses end before the command ends. A command that leaves processes running after it exits, such as a dev server, watcher, or daemon, stays outside `omt lock run`. Make the units that use those processes serial with `omt plan limit <slug> 1`. If neither `flock` nor `lockf` is on `PATH`, the CLI warns and runs without a lock. Keep units with shared build state serial on that system.

Retry a failed build or test only when the file is outside your scope and outside the task's named code under test. The file is the one where the error occurs, such as a file with a compile or load error, also when a test in your scope loads it. Wait 60 seconds and run the command once more. When it fails there again, report the command, the outside-scope file, and the message as another unit's state. For a failure in your scope or the named code under test, follow your result block. For `test` results, return `VERDICT: NOT VERIFIED` for that failure. When `omt lock run` exits 75, report the command, the lock name, and its message. Leave the lock to the conductor. For both reports: in `work` results, keep the `STATUS` that your own work earns and put the report under `OPEN`. For `test` results, including `verify` and `qa`, return `VERDICT: INCONCLUSIVE` and put the report under `FAILURES`. For other results, put the report under `NOTES`, or before the result block when it has no `NOTES`.

A busy lock or a failure in another unit's file is not a defect of the unit under test. Keep the unit in step 8 while you handle it. Apply these rules to a `verify` or `qa` result and to a verify command that you run yourself. When a busy lock or a failure in another unit's file makes `verify` or `qa` return `INCONCLUSIVE`, skip the retry on another provider.

For a busy lock, run `omt lock list`. When `omt lock list` shows the lock as free, dispatch the next attempt with the same target, or run your own command again. Count that attempt toward the second busy lock. Treat the holder as a task of this run only when an active task of this run gave that command. For that holder, wait for the task to end. Then dispatch the next attempt with the same target, or run your own command again. For any other holder, stop it only when you own it or have permission. Otherwise ask the owner. Never take over or clear a held lock. After a second busy lock for the same unit and step, ask the owner.

For a failure in another unit's file, or for a `NOT VERIFIED` result or a failed verify command of your own while a work or qa task of another unit was active, read `omt ledger list --plan <slug> --json`. Another unit's file is any file outside the failed task's scope and named code under test, also a file that no unit's scope contains. For your own command, use the unit's scope. Find the work and qa tasks of other units that were active while the failed attempt ran: dispatched before that attempt ended, with no terminal entry before it started. Wait until each of them has a terminal entry and every reopened unit that the unit under test depends on is done again. While a check-in awaits the owner's reply, also wait for the reply. Then dispatch the next attempt with the same target, or run your own command once more. Do this at most once per round for each of `verify`, `qa`, and your own command. Ask the owner instead when that retry is already used, or when a failure in another unit's file has no such task. Do not apply the step 9 relevance check or Reopen rule to a failure in another unit's file; the owner decides. Name the unit under test, the file, the command, and the message.

## Stalled tasks

A child can go silent: its run hangs, or T3 stops it and no wake comes. Nothing wakes you then, so check active tasks on a timer.

1. Before you end a turn with an active task and no heartbeat exists, call `schedule_task` with `schedule: {"type":"interval","everyMs":600000}`, bound to your thread. The prompt names the plan slug and says: "Stall check for plan <slug>. Follow delegation.md#stalled-tasks." Keep the returned id.
2. On each tick, read the effective profile and `omt ledger list --plan <slug>`. Use `omt profile show --plan <slug> --json` when the plan file exists. Otherwise use `omt profile show <name> --json` with the run's selected profile, or `omt profile show --json` without one. For each dispatched task without a terminal entry, call `t3_thread_read` on its child thread with `limit: 1`. Use `workflow.build.stallMinutes` for the stall threshold, from 10 to 120 minutes. The task is stalled when the thread's `updatedAt` is older than `build.stallMinutes` minutes.
3. For a stalled task, call `task_status`. When it has a result block, record it and continue at step 6 of your skill. Otherwise read the child's last items with view `activity`. When the thread has a result block and you accept it, it counts as the result: check its claims as for any result, record it, and continue at step 6 of your skill. When that thread still runs, call `task_cancel` for it after you record the result, and record nothing more; the sweep after that cancel settles it. When the thread has no result block, or you reject it, call `task_cancel`, record `--status interrupted --note "stalled"`, settle the child ([Releasing children](#releasing-children)), and check the scope files for half-done edits. If a check-in waits, dispatch the next attempt with the same round only after the owner replies. Otherwise dispatch the next attempt with the same round. Tell that attempt what the stalled attempt left in the files.
4. A tick with no stalled task ends at once, with no message to the user.
5. When the run ends, call `delete_scheduled_task` with the id. At a check-in or another stop for the owner, delete the heartbeat only when no task is active. Keep it while a task is active. Delete it on any turn, including a wake or a tick, when no task is active and the check-in still waits.

## `task_status` and `task_cancel`

- `task_status` returns `summary`: the child's last assistant message, or the provider error for a failed run. `workState` is `working`, `waiting_for_children`, or `result_available`. Reading a terminal result acknowledges its delivery.
- When `summary` is `Child task completed without an assistant result.`, read the child with `t3_thread_read` (view `messages`, which includes proposed plans) before you dispatch again.
- `t3_thread_read` view `activity` shows what the child ran.
- `task_cancel` stops the child and everything it delegated. Cancel a child whose scope you are about to give to another task.

## Releasing children

A finished child stays loaded. T3 waits 30 idle minutes before it releases the child's process or Codex thread, and Codex then keeps the thread and its MCP server processes for its own unload delay. The idle release never reaches the Codex native subagents of a child; only a settle releases them. Settle each child when you are done with it.

- First check: before the first settle of a run, run `git rev-parse --git-dir --git-common-dir`. When it prints two different paths, you work in a git worktree: settle no child in this run. T3 runs the project's settle script, also one inherited from T3 settings, in a settled thread's worktree, and a child that shares your checkout has your worktree. In the main checkout, T3 runs no settle script. T3 releases the children of a worktree run after 30 idle minutes.
- When: right after you read the child's final result with `task_status`, and after you record it when the run keeps a ledger. In `plan` interaction mode you record nothing, but you settle all the same. After `task_cancel`, settle the child after its `cancelled` or `interrupted` entry. After a `mode: "wait"` return, call `task_status` first, because the wait result has no `hasPendingChildRuns` or `hasPendingQuestion`.
- Condition: `status` is `completed`, `failed`, `cancelled`, or `interrupted`, `hasPendingChildRuns` is `false`, and `hasPendingQuestion` is `false`. You will not send that child a message with `t3_thread_send`. A new task for the same unit is not a message to the child.
- How: call `t3_thread_organize` with `action: "settle"` and `threadId` set to the child's `childThreadId` from `delegate_task` or `task_status`. Never pass the `taskId`. Call it in your own active turn.
- When the Condition is false, skip the settle. A settle error never stops the run and never triggers an action from [Failure codes](#failure-codes). Do not cancel a child to make the settle pass. The sweep below tries again.
- A settle ends what the child left running, such as a background terminal or a dev server, but only when the provider closes the thread: Codex closes it after its unload delay. A later task does not use processes that an earlier child left running, and does not count on them being gone; it starts its own.
- Settle only your children and their children. Never settle your own thread, a top-level thread (an `omt-swarm` track, or a thread from `t3_thread_launch` or `create_threads`), or any other thread. Do not use `action: "archive"`. A child that starts children, such as a `verify` task for a device check, settles them itself; its brief says so. A cancelled or failed child cannot, so the sweep settles its children.
- Sweep: run it at your next wake after a skipped or failed settle, after each `task_cancel`, before you stop the run to ask the owner, and at the end of the run before the report. When another skill called your skill, skip the sweep; the caller runs it.
  1. Take your task ids from `omt ledger list --plan <slug> --json`, or the ids that you kept in `plan` mode. Call `task_status` for each. Skip an id that returns `task_not_found`: another thread started that task. It is not a lost task, so do not dispatch it again.
  2. A child is done when the Condition above holds. Skip a child that is not done, and everything below it.
  3. Call `t3_thread_list` with `includeSubagents: true`, and again with `cursor` set to the returned `nextCursor` until `nextCursor` is `null`. Settle each done child whose thread shows `settled: false`. Then settle each thread below a done child, linked by `relationshipToParent: "subagent"` and `parentThreadId`, that shows `settled: false` and `status` `completed`, `failed`, `cancelled`, or `interrupted`.
- You can still read a settled child with `t3_thread_read`. A message with `t3_thread_send` unsettles it.

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
