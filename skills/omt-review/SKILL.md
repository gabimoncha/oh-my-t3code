---
name: omt-review
description: Code review with subagents in T3 Code. Use when the user asks to review uncommitted changes, a branch, a commit, or a pull request. Sizes the reviewer count by diff size, groups files by directory, runs a fresh review task per round, merges findings, and runs a cross-family oracle pass.
---

# Review

You run parallel `review` tasks over a change, merge their findings, and check the merged list with one `oracle` pass. The T3 rules are in [delegation.md](../omt/references/delegation.md); T3 tools appear by base name and your harness may prefix them, for example `mcp__t3-code__delegate_task`.

## Steps

### 0. Check your mode

Call `t3_thread_configuration` with no `threadId` and read your `interactionMode` ([delegation.md](../omt/references/delegation.md#your-interaction-mode)). In `plan` mode, dispatch only `review` and `oracle`, write no ledger entry and no evidence file, and deliver the merged findings in your final message. The fix loop in step 6 needs default mode.

Done when: you know your mode.

### 1. Pick the target

| Target | Diff command for reviewers |
| --- | --- |
| Uncommitted changes | `git status --porcelain -- <paths>` and `git diff HEAD -- <paths>`; untracked (`??`) files do not show in the diff, so reviewers read them in full |
| Branch versus base | `git diff <base>...<branch>` |
| One commit | `git show <sha>` |
| Pull request | `gh pr diff <number>`, or fetch the head and diff against its base |

Ask the user only when the target is ambiguous. Pick a slug for the review that matches `^[a-z0-9][a-z0-9-]{0,63}$`, for example the branch name in kebab case.

Done when: you have one diff command and the list of changed files (`--stat` or `--name-only`).

### 2. Size and split

Count changed lines (added plus removed) with `git diff --shortstat` or the PR's stats.

| Changed lines | Reviewers |
| --- | --- |
| below 200 | 1 |
| below 1,000 | 2 |
| below 3,000 | 3 |
| 3,000 or more | 4 |

Never use more than `maxParallel` reviewers. Group the files by directory so that each reviewer gets related files, with groups of similar size.

Done when: each changed file is in exactly one group.

### 3. Dispatch the reviewers

In default mode, run `omt init` first when `.omt/.gitignore` is missing; the ledger and the evidence file in step 6 live under `.omt/`. For each group, run `omt ledger stats --plan review-<slug>` and dispatch only while it reports `can dispatch: yes`. Build the brief with `omt brief review --task-file - --title "review G<k>: <group paths>" --round <n> --attempt 1 --plan review-<slug> --unit G<k> --json`. The task gives the diff command limited to the group's paths, and the intent of the change (PR description, commit messages, or the user's words). Reviewers run the diff themselves; paste a diff only when it is short. Each round is a fresh task; from round 2, `--prior-file` carries the earlier findings and the responses.

Record each dispatch with `omt ledger add --plan review-<slug> --unit G<k> --role review --round <n> --attempt 1 --status dispatched --task-id <taskId> --client-request-id <id>`, then end your turn. Groups left over when the limit is reached wait for the next wake.

Done when: every group has a dispatched task with a ledger entry, or waits on a limit.

### 4. Merge

On wake, read each verdict and record it ([results.md](../omt/references/results.md#recording)). Then dispatch the groups that still wait (step 3). When every group has a verdict, merge the findings: drop duplicates (same location and same failure), keep the higher severity, and keep each finding's failure scenario.

Done when: one merged list exists, sorted by severity.

### 5. Oracle pass

Run `omt ledger stats --plan review-<slug>`, then dispatch one `oracle` task (`--plan review-<slug> --unit oracle --round <n> --attempt 1 --title "oracle: <slug>"`) with the merged findings and the full diff command. Record its dispatch and its verdict. Ask it to confirm or refute each finding, and to report confirmed misses. Remove what it refutes with evidence; add what it confirms.

Done when: the oracle verdict is read and the merged list is updated.

### 6. Write and report

Write the merged findings to `.omt/evidence/review-<slug>-r<n>.md`, in the format of [results/review.md](../omt/references/results/review.md), with an overall verdict. Show the user the verdict, the findings by severity, and the file path.

Then offer a fix loop: number the P0 to P2 findings `F1`, `F2`, and so on. Each goes to an `execute` task built with `--plan review-<slug> --unit F<k> --round <n> --attempt 1 --title "fix F<k>: <finding title>"`, recorded in the ledger under the same plan and unit. Then the next review round starts at step 3 with round `<n+1>`. Stop at `maxReviewRounds`.

Done when: the evidence file exists and the user has the verdict and the offer.
