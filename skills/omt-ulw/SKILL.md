---
name: omt-ulw
description: ulw / ultrawork in T3 Code. Use when the user says ulw or ultrawork, or asks to build, fix, or ship something with subagents in a T3 thread. Runs a conductor loop that frames the goal, plans units, delegates each to a role-routed child with delegate_task, reviews, tests, and verifies before it reports done.
---

# Ultrawork

Print this banner as your first line, then start step 0:

`omt ultrawork: plan, delegate, review, test, verify.`

## Contract

The user typed ulw to get the loop. Run the full loop for every task, however small. A small task gets a LIGHT run, not a shortcut.

- You edit no product files: code, tests, docs, or config. Your own writes go only to `.omt/` (plan, ledger, evidence) and to brief temp files in `$TMPDIR`.
- A LIGHT run may skip step 3 (explore). It still has the banner, steps 0 to 2, a plan from `omt plan new <slug> --light`, and one `execute` child per unit. Use a `ui` child for a unit that implements a design or changes UI, with no fallback to another family. Apply `build.review` in step 7, `build.verify` and `build.qa` in step 8, and `build.oracle` in step 10 to both tiers. Record each dispatch and result in the ledger. Run the verify commands and final checks yourself, then report.
- When no child can do an edit (role `unavailable`, no `delegate_task`, a stop code, or a limit), stop and tell the user. Do not make the edit yourself.

You are the conductor. The shared T3 rules are in [delegation.md](../omt/references/delegation.md); read it before your first dispatch. T3 tools appear here by base name; your harness may prefix them, for example `mcp__t3-code__delegate_task`.

## Conductor rules

- You plan, dispatch, read, and verify (see Contract).
- One brief per task. Each brief stands alone ([brief.md](../omt/references/brief.md)).
- Parallel editing units have disjoint scopes. Children share your checkout.
- Done means a check that can fail ran and passed. A worker's claim is not done ([results.md](../omt/references/results.md)).
- Keep your turn short: dispatch, record, end the turn. The wake starts the next turn ([delegation.md](../omt/references/delegation.md#waiting)).
- On a T3 failure code, follow the table in [delegation.md](../omt/references/delegation.md#failure-codes).
- Tick plan items only with `omt plan mark <slug> <id> <done|open|blocked>`.
- After a context reset, re-read the plan (`omt plan status <slug>`), the ledger (`omt ledger list --plan <slug>`), and the profile in step 2 before you act. Read the owner's check-in answers under `Log` too.
- Ask each owner question once. Later status messages do not repeat open questions. Only the message that stops the run to wait for the answers lists them again.

## Steps

### 0. Check your mode

Call `t3_thread_configuration` with no `threadId` and read your `interactionMode` ([delegation.md](../omt/references/delegation.md#your-interaction-mode)). Ultrawork edits files, so in `plan` mode ask the user to switch this thread to default mode, or offer `omt-plan` to deliver a plan in your final message.

Then run the [branch check](../omt/references/delegation.md#branch-check).

Done when: you run in `default` mode, or the user has the question.

### 1. Frame

Write down the objective in one sentence, the done conditions, the tier, and the plan slug.

- Each done condition is a check that can fail: a command, a test, or an observable result.
- Tier LIGHT: one or two units, one area of code, no design decision left. LIGHT changes how much review and testing runs, not whether children run (see Contract). Tier HEAVY: anything else.
- The slug matches `^[a-z0-9][a-z0-9-]{0,63}$`, for example `http-retry`. Explore briefs and `omt ledger stats` need it before the plan file exists.
- Ask the user only for a decision you cannot make from the code; give 2 to 4 options and your recommendation.

Done when: the objective, at least one failable done condition, the tier, and the slug are written in your reply.

### 2. Route

When the plan file exists, run `omt profile show --plan <slug> --json`. Before the plan exists, run `omt profile show --json`. For `ulw --profile <name>`, use `omt profile show <name> --json` before plan creation. Keep the effective `profile`, `workflow`, `limits`, `roles`, and `models` from the output. Run `omt roles --plan <slug>` for the targets. Before the plan file exists, use the run's selected `--profile <name>` on every `omt brief`, `omt roles`, and `omt route` command. [The CLI](../omt/references/delegation.md#the-cli) says where to find the CLI. Without it, resolve the profile from config and use [roles.md](../omt/references/roles.md#resolve-by-hand).

Before plan creation with a selected profile, run `omt ledger stats --plan <slug>` before each dispatch. Compare `dispatched` with that profile's `limits.maxTasksPerRun` and `active` with its `limits.maxParallel`. Dispatch only while both counts are below those limits. Use these comparisons instead of `can dispatch`, which uses the config profile before plan creation.

Switch a running plan with `omt plan profile <slug> <name>`. On every wake, read `omt profile show --plan <slug> --json` when the plan file exists. Before plan creation, read `omt profile show <name> --json` with the run's selected `--profile`, or `omt profile show --json` without one. Repeat this lookup after an owner switch or a context reset. Use the new values for the remaining steps.

Done when: you know a target for each role you plan to use, or you report the role that is `unavailable` and why.

### 3. Explore

Skip this step when you already know the code the change touches. Otherwise dispatch 1 to `maxParallel` read-only `explore` tasks with `--plan <slug> --unit E<k> --round 1 --attempt 1 --title "explore E<k>: <question>"`, one narrow question each, in parallel. Then end the turn and read the results on wake.

Done when: you can name the files and functions each unit will change, each with a `path:line` citation.

### 4. Plan

When `.omt/.gitignore` is missing, run `omt init` first.

- LIGHT: run `omt plan new <slug> --light` and fill it yourself, `## Summary` last by the rule in [roles/plan.md](../omt/references/roles/plan.md).
- HEAVY: run the `omt-plan` skill with the slug before any plan file exists. It creates the plan, runs the `plan-review` rounds, and returns here.

For a run with `--profile <name>`, pass it to plan creation or to `omt-plan`. After plan creation, run `omt profile show --plan <slug> --json`. When you build a `plan` or `plan-review` brief, name the effective `plan.testLayers` value in the task text. Give every plan a `## Tests` section. Write each approved test as `- <layer> <unit>: <flow or case>. File: <path>. Reason: <why>.` With `build.qa: planned`, keep only the owner's approved test lines. With `build.qa: off`, leave `## Tests` empty.

Each unit has a role, a scope, a done condition, a verify command, and its dependencies. Units without a dependency between them have disjoint scopes. A unit that reads outside data, such as recordings, files, or API responses, has a done condition on an input shaped like real data, also in a LIGHT plan. Every done condition from step 1 maps to a unit or a final check.

A unit that implements a design or changes UI has the role `ui`, also in a LIGHT plan. Each `ui` unit cites the design spec. Step 5 runs the design check before any dispatch.

Done when: `omt plan status <slug>` shows every unit, and (HEAVY) the plan review approved it.

### 5. Dispatch

Design check: when the plan asks for an `omt-design` step that has not run, run the `omt-design` skill with the plan slug first, and dispatch no `ui` unit until it returns an approved spec. Every path into this step runs this check, also the hand-off from `omt-plan`.

A `ui` unit uses the `ui` role, also in a LIGHT run. When `ui` cannot run, stop and tell the user; do not fall back to `execute` or to another family.

Apply `build.checkpoint` in step 8 before every dispatch. While a check-in awaits the owner's reply, dispatch nothing new. With `layer`, dispatch only units of the current approved dependency layer until that layer is finished and the owner approves the next layer. With `layer`, count layer 1 as approved when the run starts. Count a reopened unit's fix, review, verify, and qa tasks as part of the current layer. Keep later layers blocked. While a check-in awaits the owner's reply, keep the reopened unit's tasks waiting too. With `unit`, dispatch no new unit after a unit is verified until the owner replies.

Run `omt plan status <slug>`. Its `ready:` line lists the open units whose dependencies are done. Start only the units on that line that the run has not dispatched yet: units with no entry in `omt ledger list --plan <slug>`. A unit with ledger entries keeps its current path: review, test, and fix through steps 6 to 9, retries through the [failure codes](../omt/references/delegation.md#failure-codes), and a reopen through step 9. When `ready:` is `none`, open units remain, and no task is active, run `omt visual --plan <slug> --json` and report its dependency warnings to the user.

For each unit on the `ready:` line that the run has not dispatched, until a limit is reached:

1. Run `omt ledger stats --plan <slug>`. Dispatch only while it reports `can dispatch: yes`. When it reports `can dispatch: no` and `active: 0`, the run is stalled: run the settle sweep ([delegation.md](../omt/references/delegation.md#releasing-children)), then stop and follow [delegation.md](../omt/references/delegation.md#limits).
2. Build the arguments: `omt brief <role> --task-file - --title "<role> <unit>: <short unit title>" --scope ... --done ... --verify ... --plan <slug> --unit <id> --round 1 --attempt 1 --save --json`.
3. Call `delegate_task` with `delegateTask`. Keep `fallbacks`, `taskId`, `childThreadId`, and `childRunId`.
4. Run the printed `ledger.dispatched` line after replacing only `<taskId>` with the returned task id. For a retry or fallback, follow [delegation.md](../omt/references/delegation.md#failure-codes) with a higher attempt. Record the provider and model of the target that returned the task.

Before you end a turn with an active task and no heartbeat exists, start the stall heartbeat ([delegation.md](../omt/references/delegation.md#stalled-tasks)). Then end your turn. When a goal or a stop hook keeps your turn running, wait as [delegation.md](../omt/references/delegation.md#waiting) says instead, then go to step 6.

Done when: every ready unit is dispatched or waits on a limit or a check-in, each dispatched task has a ledger entry, and your turn has ended or you are waiting.

### 6. On wake

Read the effective profile again as step 2 says before any new dispatch.

For each task id in the wake message:

1. Call `task_status` and read the result block ([results.md](../omt/references/results.md)).
2. Record the result at once: `omt ledger add --plan <slug> --unit <id> --role <role> --round <n> --attempt <n> --status completed --verdict <VERDICT>`, or `--status failed` ([results.md](../omt/references/results.md#recording)). Then settle the child ([delegation.md](../omt/references/delegation.md#releasing-children)).
3. Check each `DONE` claim as [results.md](../omt/references/results.md#a-claim-is-not-evidence) says: the scope paths changed, no path outside every active scope changed (`.omt/` is not a finding), new files read in full, and one verify command run yourself. Record `--status rejected` when the check disproves the claim. A verify command that fails on a busy lock, in another unit's file, or while a work or qa task of another unit is active does not disprove the claim. Send the unit on to step 7, and leave the failure to step 8.

Check `build.checkpoint` as step 8 says before you dispatch every unit that became ready (step 5).

Done when: every named task has a terminal ledger entry with its verdict, and each unit is marked for review, re-dispatch, or escalation.

### 7. Review

Apply `build.review` to each unit that passed step 6. With `every-round`, dispatch a fresh `review` task for every round. With `first-round`, review only the first implementation round. With `first-round`, send every fix round straight to step 8. With `off`, go straight to step 8 in every round.

For each required review:

- Write the unit's task text, scope, and done conditions, and the worker's result block, to a temp file such as `$TMPDIR/omt-<slug>-<unit>-r<n>.md`. Pass it with `--context-file`. Pass the brief's data, never the rendered execute brief: that text holds its own brief marker and `Final message` block.
- The task names the scope paths, not git refs: workers do not commit. Leave `docs/design/` out of the scope paths: the owner reviews designs, not a model. For a `ui` unit, also apply the [design exclusion](#8-test) of step 8 to the done conditions and the context. Code review of `ui` units stays. The reviewer runs `git status --porcelain -- <scope paths>` and `git diff HEAD -- <scope paths>` and reads every untracked file in full.
- From round 2, pass every prior finding with its response in `--prior-file`.
- Use `--plan <slug> --unit <id> --round <n> --attempt 1 --against auto --title "review <unit>: <short unit title>"`, and record the dispatch as in step 5. `--against auto` puts the reviewer on the family other than the unit's worker.

Done when: the unit has a recorded review verdict for this round, or `build.review` sends it to step 8. `APPROVE` moves it to step 8. `REQUEST_CHANGES` moves it to step 9. `BLOCK` has two causes, so read its findings:

- A P0 finding that has a clear fix inside the unit's scope: go to step 9, as for `REQUEST_CHANGES`.
- A wrong approach, or a P0 whose fix changes the plan: run `omt plan mark <slug> <unit> blocked`, then re-plan the unit (step 4) or ask the user.

### 8. Test

Apply `build.verify` first. With `every-unit`, dispatch `verify` for every unit, including LIGHT units. With `heavy`, dispatch `verify` for every HEAVY unit. For LIGHT with `heavy`, run the verify commands yourself and save their output in the directory that `omt paths --evidence` prints.

Give `verify` the unit's scope, done conditions, verify commands, and existing suites that cover the scope. Use `--plan <slug> --unit <id> --round <n> --attempt 1 --title "verify <unit>: <short unit title>"` and dispatch as in step 5. Ask it to check the main flows and name the covering test file for each flow, or `none`. It writes no tests. Route device checks, local-tool retries, and screenshots as [delegation.md](../omt/references/delegation.md#verification-and-devices) says.

After `VERIFIED`, apply `build.qa`. With `planned`, dispatch `qa` only when the unit has lines in the plan's `## Tests` section. Give `qa` exactly those test lines and the test paths as its scope. Name the unit's scope paths in the task as the code under test. With `off` or no test lines, skip `qa`. With `build.failureProofs: on`, require failure proofs in a private copy. With `build.failureProofs: off`, skip them. Use the resulting `failureProofs: on` or `failureProofs: off` in the `qa` brief's `Tests:` line. Use the unit's current `--round` for every `qa` brief. If that round already has a `qa` dispatch, use the next `--attempt`. Dispatch and record `qa` as in step 5 after verification, never in parallel with it. Check that each new test file or case maps to a `## Tests` line for the unit. Send a test with no line to a `qa` fix task. Workers write no new tests and do not prove that tests can fail.

Design exclusion: for a `ui` unit, leave `docs/design/` out of the test scope paths, and leave out every done condition and every piece of context that compares the result with the design, such as screens, screenshots, or a visual match. Keep the code and behavior checks: build, unit tests, and `agent-device` flows that check behavior, not looks. The `ui` task and the owner do the visual comparison. Review briefs (step 7) and the oracle brief (step 10) apply the same exclusion.

On `VERIFIED` with evidence from verification and every required `qa` task, record the results. Run `omt plan mark <slug> <unit> done` and record `--status verified` for the unit. When the verify result names screenshots or recordings, show them in your message about the unit: one Markdown image per file with its absolute path, such as `![library, empty state](/abs/path/u3-library-empty.png)`, grouped by screen. `NOT VERIFIED` or `INCONCLUSIVE` moves it to step 9 after any local-tool retry, except for a busy lock, a failure in another unit's file, or a `NOT VERIFIED` failure while a work or qa task of another unit was active. For those exceptions, follow [delegation.md](../omt/references/delegation.md#shared-builds). When you run the verify commands yourself, a pass with saved output counts as `VERIFIED`. A failure counts as `NOT VERIFIED` and goes to step 9, except for a busy lock, a failure in another unit's file, or a `NOT VERIFIED` failure while a work or qa task of another unit was active. For those exceptions, follow [delegation.md](../omt/references/delegation.md#shared-builds).

Check-ins use `build.checkpoint`. With `none`, continue without a check-in. With `unit`, stop after each verified unit. With `layer`, stop when every unit of the current dependency layer is done or blocked. With `layer`, skip a new check-in when a reopened unit is done again and its current layer already had its check-in. Before the stop, dispatch nothing new and wait for the active tasks of that unit or layer. Record their results without new dispatches. While a check-in waits, dispatch a stalled task's next attempt only after the owner replies. Show the verified units, their screenshots grouped by screen, open findings, and the next layer. Record the check-in under `Log` as waiting for the owner. With `unit`, add a unit verified while a check-in waits to that check-in. Show the added unit to the owner in a short follow-up message. One owner reply answers the check-in for every unit in it. At a check-in, delete the stall heartbeat only when no task is active. Keep it while a task is active. Delete it on any turn, including a wake or a tick, when no task is active and the check-in still waits. End the turn and wait for the owner. A wake, a goal continuation, or an `omt-loop` tick does not answer the check-in. Resume only after the owner replies with continue, steering, or an instruction to stop check-ins for this run. Continue authorizes one more unit or layer. Write the owner's answer under `Log` in the plan. After the owner replies, keep a retained stall heartbeat. Before you end the next turn with an active task, start a heartbeat only when none exists. Read that answer after a context reset and keep any instruction to stop check-ins for the rest of the run.

Done when: the unit is marked done with a `verified` ledger entry, or it is in step 9. At a check-in, wait for the owner's answer before more work.

### 9. Fix

Relevance check: before each fix round, check each finding against the plan. Keep a finding when it breaks a done condition, a plan requirement, or the correctness of the changed code for inputs the plan covers. Drop the others: a style preference, an input or a state that the plan rules out, or a case that cannot happen in the planned flow. Drop a missing-test finding unless the plan or the task names that test. Keep a CRAP finding when the profile asks for CRAP, with complexity, coverage, and CRAP values instead of a failure scenario. Keep a missing check on an input shaped like real data for code that reads outside data, also when a seeded sample already passes. Never drop a finding because its case is rare or unlikely. A race or an order of events that the planned flow allows breaks correctness. Record each dropped finding with its reason under `Log` in the plan and in the next `--prior-file`. When you drop every finding, the unit goes to step 8. When you drop every finding of an oracle round, record the drops under `Log` in the plan and mark `F2` done. The step 11 report lists the dropped oracle findings.

Send the kept findings or failures, verbatim, to a new fix task for the next round `<n+1>`, with all earlier rounds in `--prior-file`. Use `--plan <slug> --unit <id> --round <n+1> --attempt 1 --title "fix <unit>: <short unit title>"`, and record the dispatch with its `--provider` and `--model` as in step 5. Send test-only findings to `qa` with the unit's approved test lines. Send product failures to the unit's fix role. Only `qa` proves that new tests can fail when `build.failureProofs` is `on`. Then return to step 7 for that unit.

Rounds count per cycle. A cycle starts at the unit's first dispatch, or at a reopen (below). The `--round` value in briefs and in the ledger goes on rising across cycles; the table and `maxReviewRounds` use the round within the cycle.

| Round in the cycle | Worker | Next step when its review or test fails |
| --- | --- | --- |
| 1 | the unit's planned role; after a reopen, a fix | round 2 |
| 2 to `maxReviewRounds` - 1 | a fix | the next round |
| `maxReviewRounds` (default 3) | a fix | stop |

When `maxReviewRounds` is 1, round 1 is also the last round, so a failure in round 1 stops the unit.

A fix is an `execute` fix, or a `deep` fix when an open finding needs investigation: its cause is unknown, the previous fix failed for the same reason, or the fix changes the design.

A `ui` unit uses `ui` in every round, never `execute` or `deep`. When `ui` cannot run, stop and tell the user; do not fall back to another role or family.

To stop: run `omt plan mark <slug> <unit> blocked`, run the settle sweep ([delegation.md](../omt/references/delegation.md#releasing-children)), and ask the user, with the open findings. Stop at the same point when the next round in the cycle would exceed `maxReviewRounds`.

Reopen: when a task or a check finds a defect in code that a done unit owns, run the relevance check on the finding first. When you drop it, log the drop and leave the unit done. When you keep it, reopen the unit: run `omt plan mark <slug> <unit> open`, and write under `Log` in the plan the defect, the task or check that found it, and the first `--round` value of the new cycle. Take the finding out of the fix round of the unit whose task found it. When that unit has no other kept finding, it waits until the reopened unit is done again, then goes to step 8 for the same round. Dispatch no new task for a unit that depends on the reopened unit, directly or through other units, until the reopened unit is done again. Wait until no active task has a scope that overlaps the reopened unit's scope, then send a fix task for the reopened unit. It is round 1 of a new cycle, with the next `--round` value after the unit's last round. The task budget still applies. Before a third reopen of the same unit, stop and ask the user, because two fixes may be breaking each other. The step 11 report lists each reopen.

Done when: the unit is back in review with a higher round, or it is marked blocked and the user has the question.

### 10. Final gate

When every unit is done:

1. Run every final check in the plan yourself (`F1`, the full test suite and typecheck). Mark each `D` and `F` item with `omt plan mark <slug> <id> done` after its command passes. A failing final check reopens the unit that owns the code (see Reopen in step 9).
2. Apply `build.oracle`: `heavy` runs the oracle for HEAVY only, `always` runs it for both tiers, and `off` skips it. When required, dispatch one `oracle` task over the whole change, with the objective, every done condition except those that the [design exclusion](#8-test) of step 8 leaves out, and the scope paths without `docs/design/` (or the base ref when the work is committed, with `docs/design/` excluded from its diff). Leave design context out of the task text too. Build it with `omt brief oracle --task-file - --title "oracle: <slug>" --plan <slug> --unit F2 --round <n> --attempt 1 --against auto --save --json`, and record the dispatch and the result as in steps 5 and 6. `--against auto` puts the oracle on the family other than the main implementer's. Fix its findings through step 9, then run the oracle again. From oracle round 2, pass the earlier oracle findings with your response to each in `--prior-file`. Count oracle rounds against `maxReviewRounds`; at the limit, stop and report the open findings to the user. Mark `F2` done when it returns `APPROVE`.

Keep an `F2` oracle item only when `build.oracle` requires it for the run's tier. After plan creation and after a profile switch, edit the plan file's `## Final verification` list, including in a LIGHT plan. When an `F2` oracle item is required but missing, add `- [ ] F2. The oracle role approves the whole change.`. When no oracle is required, remove the `F2` oracle line.

Done when: every `D` and command-based `F` item has passed, and each required oracle returned `APPROVE` or the user has the open findings.

### 11. Report

Before you report, run the settle sweep ([delegation.md](../omt/references/delegation.md#releasing-children)).

Tell the user:

- What changed, by file or area.
- Each done condition with its evidence: the command and its result line, or the evidence file.
- Review, verify, qa, and oracle verdicts per unit, and each reopen.
- What the user can see: the latest screenshot or recording of each screen or flow that the change adds or changes, from the `EVIDENCE` lines of the verify and `ui` results, as Markdown images with absolute paths, grouped by screen. When no device check ran, say so.
- Open items: blocked units, notes, and decisions left.

Delete the stall heartbeat with `delete_scheduled_task`.

Commit only when the user asked for a commit.

Done when: every done condition from step 1 appears in the report with evidence or as an open item.
