---
name: omt-ulw
description: ulw / ultrawork in T3 Code. Use when the user says ulw or ultrawork, or asks to build, fix, or ship something with subagents in a T3 thread. Runs a conductor loop that frames the goal, plans units, delegates each to a role-routed child with delegate_task, reviews, tests, and verifies before it reports done.
---

# Ultrawork

Print this banner as your first line, then start step 1:

`omt ultrawork: plan, delegate, review, test, verify.`

You are the conductor. The shared T3 rules are in [delegation.md](../omt/references/delegation.md); read it before your first dispatch. T3 tools appear here by base name; your harness may prefix them, for example `mcp__t3-code__delegate_task`.

## Conductor rules

- Workers edit; you plan, read, and verify. A trivial one-line edit you may make yourself.
- One brief per task. Each brief stands alone ([brief.md](../omt/references/brief.md)).
- Parallel editing units have disjoint scopes. Children share your checkout.
- Done means a check that can fail ran and passed. A worker's claim is not done ([results.md](../omt/references/results.md)).
- Keep your turn short: dispatch, record, end the turn. The wake starts the next turn ([delegation.md](../omt/references/delegation.md#waiting)).
- On a T3 failure code, follow the table in [delegation.md](../omt/references/delegation.md#failure-codes).
- Tick plan items only with `omt plan mark <slug> <id> <done|open|blocked>`.
- After a context reset, re-read the plan (`omt plan status <slug>`) and the ledger (`omt ledger list --plan <slug>`) before you act.

## Steps

### 0. Check your mode

Call `orchestrator_capabilities` and read your `interactionMode` ([delegation.md](../omt/references/delegation.md#your-interaction-mode)). Ultrawork edits files, so in `plan` mode ask the user to switch this thread to default mode, or offer `omt-plan` to deliver a plan in your final message.

Done when: you run in `default` mode, or the user has the question.

### 1. Frame

Write down the objective in one sentence, the done conditions, the tier, and the plan slug.

- Each done condition is a check that can fail: a command, a test, or an observable result.
- Tier LIGHT: one or two units, one area of code, no design decision left. Tier HEAVY: anything else.
- The slug matches `^[a-z0-9][a-z0-9-]{0,63}$`, for example `http-retry`. Explore briefs and `omt ledger stats` need it before the plan file exists.
- Ask the user only for a decision you cannot make from the code; give 2 to 4 options and your recommendation.

Done when: the objective, at least one failable done condition, the tier, and the slug are written in your reply.

### 2. Route

Run `omt roles`. Without the CLI, use the table in [roles.md](../omt/references/roles.md#resolve-by-hand).

Done when: you know a target for each role you plan to use, or you report the role that is `unavailable` and why.

### 3. Explore

Skip this step when you already know the code the change touches. Otherwise dispatch 1 to `maxParallel` read-only `explore` tasks with `--plan <slug> --unit E<k> --round 1 --attempt 1 --title "explore E<k>: <question>"`, one narrow question each, in parallel. Then end the turn and read the results on wake.

Done when: you can name the files and functions each unit will change, each with a `path:line` citation.

### 4. Plan

When `.omt/.gitignore` is missing, run `omt init` first.

- LIGHT: run `omt plan new <slug> --light` and fill it yourself. The plan has no `F2` oracle item.
- HEAVY: run the `omt-plan` skill with the slug before any plan file exists. It creates the plan, runs the `plan-review` rounds, and returns here.

Each unit has a role, a scope, a done condition, a verify command, and its dependencies. Units without a dependency between them have disjoint scopes. Every done condition from step 1 maps to a unit or a final check.

Done when: `omt plan status <slug>` shows every unit, and (HEAVY) the plan review approved it.

### 5. Dispatch

For each unit whose dependencies are done, until a limit is reached:

1. Run `omt ledger stats --plan <slug>`. Dispatch only while it reports `can dispatch: yes`. When it reports `can dispatch: no` and `active: 0`, the run is stalled: stop and follow [delegation.md](../omt/references/delegation.md#limits).
2. Build the arguments: `omt brief <role> --task-file - --title "<role> <unit>: <short unit title>" --scope ... --done ... --verify ... --plan <slug> --unit <id> --round 1 --attempt 1 --json`.
3. Call `delegate_task` with `delegateTask`. Keep `fallbacks`, `taskId`, `childThreadId`, and `childRunId`.
4. Record it: `omt ledger add --plan <slug> --unit <id> --role <role> --round 1 --attempt 1 --status dispatched --task-id <taskId> --client-request-id <id>`.

Then end your turn. When a goal or a stop hook keeps your turn running, wait as [delegation.md](../omt/references/delegation.md#waiting) says instead, then go to step 6.

Done when: every ready unit is dispatched or waits on a limit, each dispatched task has a ledger entry, and your turn has ended or you are waiting.

### 6. On wake

For each task id in the wake message:

1. Call `task_status` and read the result block ([results.md](../omt/references/results.md)).
2. Record the result at once: `omt ledger add --plan <slug> --unit <id> --role <role> --round <n> --attempt <n> --status completed --verdict <VERDICT>`, or `--status failed` ([results.md](../omt/references/results.md#recording)).
3. Check each `DONE` claim as [results.md](../omt/references/results.md#a-claim-is-not-evidence) says: the scope paths changed, no path outside every active scope changed (`.omt/` is not a finding), new files read in full, and one verify command run yourself. Record `--status rejected` when the check disproves the claim.

Then dispatch every unit that became ready (step 5).

Done when: every named task has a terminal ledger entry with its verdict, and each unit is marked for review, re-dispatch, or escalation.

### 7. Review

For each unit that passed step 6, dispatch a fresh `review` task for the same round:

- Write the unit's task text, scope, and done conditions, and the worker's result block, to a temp file such as `$TMPDIR/omt-<slug>-<unit>-r<n>.md`. Pass it with `--context-file`. Pass the brief's data, never the rendered execute brief: that text holds its own brief marker and `Final message` block.
- The task names the scope paths, not git refs: workers do not commit. The reviewer runs `git status --porcelain -- <scope paths>` and `git diff HEAD -- <scope paths>` and reads every untracked file in full.
- From round 2, pass every prior finding with its response in `--prior-file`.
- Use `--plan <slug> --unit <id> --round <n> --attempt 1 --title "review <unit>: <short unit title>"`, and record the dispatch as in step 5.

Done when: the unit has a recorded review verdict for this round. `APPROVE` moves it to step 8. `REQUEST_CHANGES` moves it to step 9. `BLOCK` means a P0 finding or a wrong approach: run `omt plan mark <slug> <unit> blocked`, then re-plan the unit (step 4) or ask the user.

### 8. Test

Dispatch a `test` task with the unit's scope, done conditions, and verify commands (`--plan <slug> --unit <id> --round <n> --attempt 1 --title "test <unit>: <short unit title>"`), and record the dispatch as in step 5. HEAVY runs it for every unit; LIGHT may run the verify commands yourself instead and save the output under `.omt/evidence/`.

On `VERIFIED` with evidence, record the result, run `omt plan mark <slug> <unit> done`, and record `--status verified` for the unit. `NOT VERIFIED` or `INCONCLUSIVE` moves it to step 9.

Done when: the unit is marked done in the plan with a `verified` ledger entry, or it is in step 9.

### 9. Fix

Send the findings or failures, verbatim, to a new fix task for the next round `<n+1>`, with all earlier rounds in `--prior-file`. Use `--plan <slug> --unit <id> --round <n+1> --attempt 1 --title "fix <unit>: <short unit title>"`, and record the dispatch as in step 5. Then return to step 7 for that unit.

| Round | Worker | Next step when its review or test fails |
| --- | --- | --- |
| 1 | `execute` | round 2 |
| 2 | `execute` fix | round 3 |
| 3 | `deep` fix | stop |

To stop: run `omt plan mark <slug> <unit> blocked` and ask the user, with the open findings. Stop at the same point when the next round would exceed `maxReviewRounds`.

Done when: the unit is back in review with a higher round, or it is marked blocked and the user has the question.

### 10. Final gate

When every unit is done:

1. Run every final check in the plan yourself (`F1`, the full test suite and typecheck). Mark each `D` and `F` item with `omt plan mark <slug> <id> done` after its command passes.
2. HEAVY: dispatch one `oracle` task over the whole change, with the objective, every done condition, and the scope paths (or the base ref when the work is committed). Build it with `omt brief oracle --task-file - --title "oracle: <slug>" --plan <slug> --unit F2 --round <n> --attempt 1 --json`, and record the dispatch and the result as in steps 5 and 6. Fix its findings through step 9, then run the oracle again. Count oracle rounds against `maxReviewRounds`; at the limit, stop and report the open findings to the user. Mark `F2` done when it returns `APPROVE`.

LIGHT plans have no `F2` item and no oracle round.

Done when: every `D` and `F` item is done with a command you ran, and (HEAVY) the oracle returned `APPROVE` or the user has the open findings.

### 11. Report

Tell the user:

- What changed, by file or area.
- Each done condition with its evidence: the command and its result line, or the evidence file.
- Review, test, and oracle verdicts per unit.
- Open items: blocked units, notes, and decisions left.

Commit only when the user asked for a commit.

Done when: every done condition from step 1 appears in the report with evidence or as an open item.
