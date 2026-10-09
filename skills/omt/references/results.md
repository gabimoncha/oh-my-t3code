# Reading results

Every role ends with a fixed result block. `task_status.summary` is the child's last assistant message, so the block is the last thing in it. Read the first word after each label.

| Kind | Roles | Contract | First label |
| --- | --- | --- | --- |
| `work` | execute, quick, deep, writing | [results/work.md](results/work.md) | `STATUS: DONE \| BLOCKED \| ESCALATE` |
| `review` | review, oracle, plan-review | [results/review.md](results/review.md) | `VERDICT: APPROVE \| REQUEST_CHANGES \| BLOCK` |
| `test` | test | [results/test.md](results/test.md) | `VERDICT: VERIFIED \| NOT VERIFIED \| INCONCLUSIVE` |
| `research` | explore, research | [results/research.md](results/research.md) | `ANSWER:` |
| `plan` | plan | [results/plan.md](results/plan.md) | `PLAN:` |

## A claim is not evidence

A worker's `DONE` is a claim. It stays a claim until you or a `test` task checks it against the real artifact. Measured in this project: a Codex child on a small model at low effort reported a file's line count as 23 without running any tool. The file had 5 lines.

For every `DONE`:

Workers do not commit, and `git diff` does not show untracked files. Check both tracked and new files:

1. Check that each path under `CHANGES` changed: `git status --porcelain -- <scope paths>` lists it (`??` marks a new file), and `git diff HEAD -- <scope paths>` shows the staged and unstaged edits to tracked files. Read each new file in full.
2. Check that no file outside the scopes changed: from the repository root, run `git status --porcelain -- . ':(exclude).omt'` and compare it with the union of the scopes of every active unit. The command leaves out `.omt/`, because `omt init`, `omt plan mark`, and the ledger change it on every run. Other units' files show up there too; a path outside every active scope is a finding.
3. Run at least one `VERIFY` command yourself, or send the unit to a `test` task. A `VERIFY` line without a matching run is unverified.
4. Open the `EVIDENCE` files when any are named.

## Recording

Every dispatch opens a ledger slot, and a terminal entry closes it. `omt ledger stats` counts open slots as `active`, so an unclosed slot blocks later dispatches.

- Dispatch: `omt ledger add --plan <slug> --unit <id> --role <role> --round <n> --attempt <n> --status dispatched --task-id <taskId> --client-request-id <id> --provider <provider> --model <model>`. Keep the task id; `task_status` needs it.
- Set `--provider` to `target.providerInstanceId`, or to `target.driverKind` when the target has no instance id. Set `--model` to `target.model`. Use the target of the `delegate_task` call that returned the task. After a fallback, that is the fallback's target. `--against auto` reads these fields to find the worker.
- Result: after each `task_status` with a terminal result, record one terminal entry with the same plan, unit, role, round, and attempt: `omt ledger add --plan <slug> --unit <id> --role <role> --round <n> --attempt <n> --status completed --verdict <VERDICT>`. Use `failed` when the run failed or returned no usable block. A terminal entry with the same `--task-id`, or with the same five fields, closes the slot, so you do not need to paste the task id.
- Check: record `verified` or `rejected` after your own check or a `test` task. These close a slot too, but record the `completed` or `failed` result first in any case.
- A terminal entry that matches no dispatched entry prints `omt: no dispatched entry matches; nothing was closed`. For `completed`, `failed`, `verified`, or `rejected`, the warning means a field is wrong: fix it and record the entry again. A `verified` or `rejected` entry recorded after the result matches the same dispatch and prints no warning. An entry with no dispatch at all, such as an `omt-loop` tick, always prints the warning, and that is expected.

Ledger statuses:

| Status | When |
| --- | --- |
| `dispatched` | right after `delegate_task` returns a `taskId` |
| `completed` | you read a terminal result block |
| `failed` | the run failed or returned no usable block |
| `cancelled` | you called `task_cancel` |
| `interrupted` | the run was interrupted before it reached a result |
| `verified` | your own check or a `test` task confirmed the unit |
| `rejected` | your check disproved the claim |

## By kind

- **work**
  - `DONE`: verify as above, then send the unit to review.
  - `BLOCKED`: read `OPEN`. Resolve the blocker (a missing file, a scope change, an owner decision), then dispatch again with the next attempt.
  - `ESCALATE`: the unit needs a decision or more depth. Re-plan it, move it to `deep`, or ask the user.
- **review**
  - `APPROVE`: the round passes. `NOTES` are optional work.
  - `REQUEST_CHANGES`: each P0, P1, and P2 finding goes to a fix task. P3 findings are optional.
  - `BLOCK`: a P0 finding or a wrong approach. A P0 with a clear fix inside the unit's scope goes to a fix task. A wrong approach, or a P0 whose fix changes the plan, stops the unit for a re-plan before more fixes.
  - Check that every finding names a concrete failure scenario. Drop a finding you disprove by reading the code, and say so in the next round's `Prior rounds`.
  - Severity levels are defined in [roles/review.md](roles/review.md).
- **test**
  - `VERIFIED`: every check ran and passed. Spot-check one `CHECKS` line against its `EVIDENCE` file.
  - `NOT VERIFIED`: `FAILURES` go to a fix task, verbatim.
  - `INCONCLUSIVE`: a check could not run. Fix the environment or the check, then test again. It is not a pass.
- **research**: Use `FINDINGS` only with their citations. Spot-check one citation per task. Carry `UNKNOWN` into your answer or your next questions.
- **plan**: Open the file at `PLAN`. Bring each `DECISIONS NEEDED` item to the user before review rounds.

## When the block is missing

- `Child task completed without an assistant result.`: read the child with `t3_thread_read`, view `messages`. A plan-mode child may have put its block in a proposed plan.
- A provider error in `summary`: the run failed. Follow [delegation.md](delegation.md#failure-codes).
- A message without the block: the child stopped early or ran out of turns. Read the thread with view `activity`, then dispatch again with the next attempt and a sharper stop condition.
