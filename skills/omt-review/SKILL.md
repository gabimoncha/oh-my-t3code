---
name: omt-review
description: Code review with subagents in T3 Code. Use when the user asks to review uncommitted changes, a branch, a commit, or a pull request. Accepts --profile. Sizes reviewers, groups files, merges findings, and runs the profile's oracle pass. For a PR, runs target, rules, CI, coverage, round 1, merge and oracle, CI fixes, guardrails, CRAP, report, and owner-approved offers in order.
---

# Review

You run parallel `review` tasks over a change and merge their findings. The effective profile controls the reviewers, the oracle pass, and the fix offer. The T3 rules are in [delegation.md](../omt/references/delegation.md); T3 tools appear by base name and your harness may prefix them, for example `mcp__t3-code__delegate_task`.

## Steps

### 0. Check your mode

Call `t3_thread_configuration` with no `threadId` and read your `interactionMode` ([delegation.md](../omt/references/delegation.md#your-interaction-mode)). In `plan` mode, dispatch only `review` and `oracle`, write no ledger entry and no evidence file, and deliver the merged findings in your final message. The fix loop in step 6 needs default mode.

Accept `omt-review --profile <name> <target>` for one run. With `--profile`, run `omt profile show <name> --json`. Otherwise run `omt profile show --json` to use the config's profile. Read `profile`, `workflow.review`, `limits`, `roles`, and `models` from the output. Use the output's `profile` as `<profile>` in every brief and role lookup. Read the profile again on each wake, with the run's `--profile` override when one exists. The `review-<slug>` id is ledger-only, so do not use `omt profile show --plan review-<slug>`.

In `plan` mode, omit `--save` from every brief command. For a PR step that needs a checkout, a file write, or an edit role, ask the owner to switch to default mode and stop.

Done when: you know your mode and effective profile.

### 1. Pick the target

| Target | Diff command for reviewers |
| --- | --- |
| Uncommitted changes | `git status --porcelain -- <paths>` and `git diff HEAD -- <paths>`; untracked (`??`) files do not show in the diff, so reviewers read them in full |
| Branch versus base | `git diff <base>...<branch>` |
| One commit | `git show <sha>` |
| Pull request | `gh pr diff <number>`, or fetch the head and diff against its base |

Ask the user only when the target is ambiguous. Pick a slug for the review that matches `^[a-z0-9][a-z0-9-]{0,63}$`, for example the branch name in kebab case.

For a pull request, follow PR steps 1 to 11 below in order instead of continuing at step 2.

Done when: you have one diff command and the list of changed files (`--stat` or `--name-only`).

### 2. Size and split

When `review.reviewers` is `auto`, count changed lines with `git diff --shortstat` or the PR's stats and use this table.

| Changed lines | Reviewers |
| --- | --- |
| below 200 | 1 |
| below 1,000 | 2 |
| below 3,000 | 3 |
| 3,000 or more | 4 |

Leave every file under `docs/design/` out of the groups and the line count: the owner reviews designs, not a model. When the change holds only design files, dispatch no reviewer and no oracle; list the files for the owner's review and stop.

When `review.reviewers` is a number from 1 to 4, use that number of groups. With `review.families: one`, dispatch one reviewer per group. With `review.families: both`, dispatch one reviewer from each family per group. Never run more than `maxParallel` reviewers at once, from the effective profile's `limits.maxParallel`. Queue the remaining family reviews for the next wake. Group the files by directory so that each reviewer gets related files, with groups of similar size.

Done when: each changed file outside `docs/design/` is in exactly one group, and the design files are listed for the owner.

### 3. Dispatch the reviewers

In default mode, run `omt init` first when `.omt/.gitignore` is missing; the ledger and the evidence file in step 6 live under `.omt/`. Before every task dispatch, run `omt ledger stats --plan review-<slug>`. Use `dispatched` and `active` from the output. Use `limits.maxTasksPerRun` and `limits.maxParallel` from `omt profile show <profile> --json`. Dispatch only when `dispatched` is below `limits.maxTasksPerRun` and `active` is below `limits.maxParallel`. Ignore the `can dispatch` line because it uses the config's profile limits. Build each group brief with `omt brief review --task-file - --title "review G<k>: <group paths>" --round <n> --attempt 1 --plan review-<slug> --unit G<k> --profile <profile> --save --json`. The task gives the diff command limited to the group's paths, which never include `docs/design/`, and the intent of the change (PR description, commit messages, or the user's words). Reviewers run the diff themselves; paste a diff only when it is short. Each round is a fresh task; from round 2, `--prior-file` carries the earlier findings and the responses.

Round 1 reviews a change whose author is unknown. Pass no `--against`, so the configured order applies.

For `review.families: both`, use units `G<k>.codex` and `G<k>.claude` with `--against claudeAgent` and `--against codex`, respectively. Check each resolved target's family with [roles.md](../omt/references/roles.md#cross-family-roles). If both calls resolve to one family, report the unavailable family and stop instead of counting two reviews from one family.

A round after a fix loop (step 6) reviews each fix on its own, not each group. Dispatch one review per fix with `--unit F<k>`, `--title "review F<k>: <finding title>"`, and `--against auto`. Its task gives the finding, the fix task's result block, and the diff command limited to the paths that the fix changed. `--against auto` with `--unit F<k>` finds the worker of that fix, so the reviewer comes from the other family.

Build every task with `omt brief <role> ... --profile <profile> --save --json`, including oracle, fix, verify, guardrail, and qa tasks. Pass `delegateTask` to `delegate_task` and retain its `taskId`. Record the dispatch with the returned `ledger.dispatched` command after replacing only `<taskId>`. For a fallback, use the provider and model of the target that you actually sent ([results.md](../omt/references/results.md#recording)). `<a>` is 1 for the first call, or the higher attempt of a retry or a fallback call ([delegation.md](../omt/references/delegation.md#failure-codes)). Groups or fixes left over when the limit is reached wait for the next wake. In default mode, end your turn after recording the dispatches. For PR step 5, record the review and verify dispatches before ending the turn. That step adds the pending-CI watch just before the turn ends.

Give every edit child an explicit file scope. Run edit tasks with overlapping scopes one at a time. Let no child commit or push. Keep child changes uncommitted for the conductor. Workers write no new tests. Only an owner-approved `qa` task writes its listed tests.

Done when: every group, or every fix after a fix loop, has a dispatched task with a ledger entry, or waits on a limit.

### 4. Merge

On wake, read each verdict and record it ([results.md](../omt/references/results.md#recording)). Then dispatch the groups or fixes that still wait (step 3). When each of them has a verdict, merge the findings. Drop duplicates with the same location and failure, and keep the higher severity. For each non-CRAP finding, keep its failure scenario. For each CRAP finding, keep the changed function and its complexity, coverage, and CRAP values. Keep a missing-test finding only when the plan or task names that test. In a PR review, list other uncovered flows in the report instead.

Done when: one merged list exists, sorted by severity.

### 5. Oracle pass

With `review.oracle: off`, skip this step. With `review.oracle: on`, run the following pass.

Run `omt ledger stats --plan review-<slug>`, then dispatch one `oracle` task (`--plan review-<slug> --unit oracle --round <n> --attempt 1 --against <provider> --title "oracle: <slug>"`) with the merged findings and the full diff command with `docs/design/` excluded (for example `git diff HEAD -- . ':(exclude)docs/design'`). `<provider>` is the provider that most review tasks of this round ran on, so the oracle checks the reviewers from the other family. Record its dispatch with `--provider` and `--model`, and record its verdict. Ask it to confirm or refute each finding, and to report confirmed misses. Remove what it refutes with evidence; add what it confirms.

Done when: the oracle verdict is read and the merged list is updated.

### 6. Write and report

Before you report, run the settle sweep ([delegation.md](../omt/references/delegation.md#releasing-children)).

Write the merged findings to `review-<slug>-r<n>.md` in the evidence directory that `omt paths --evidence` prints, in the format of [results/review.md](../omt/references/results/review.md), with an overall verdict. Show the user the verdict, the findings by severity, and the file path. When the change holds design files, list them for the owner's review.

With `review.fixLoop: off`, report without a fix offer. With `review.fixLoop: offer`, ask the owner before each fix loop and wait for yes. After yes, number the P0 to P2 findings `F1`, `F2`, and so on. Each goes to an `execute` task built with `--plan review-<slug> --unit F<k> --round <n> --attempt 1 --title "fix F<k>: <finding title>"`, recorded in the ledger under the same plan and unit, with `--provider` and `--model` on the dispatch. Then the next review round starts at step 3 with round `<n+1>`, with one review per fix. Stop at `maxReviewRounds`.

Done when: the evidence file exists and the user has the verdict and the offer.

## PR review

Run these eleven steps for a pull request with any profile. `omt-review --profile pr-review <number>` enables all PR steps. Steps 1, 2, 6, and 10 always run. Step 11 applies its named switches. For a switch set to `off`, mark its step skipped and continue in order. Use the mode, dispatch, ledger, limit, and design-exclusion rules above throughout this path. Post no comment and no review to GitHub.

### PR 1. Target

Run `gh pr view <n> --json number,title,body,url,baseRefName,headRefName,files,additions,deletions` for the intent and file list. When `link_pull_request` exists, call it with the PR URL immediately. Save the current branch name with `git branch --show-current`. If the branch name is empty, save the detached HEAD commit with `git rev-parse HEAD`. A PR-head step needs a clean checkout when `review.ci` is `fix`, `review.verify` is `changed-flows`, `review.tests` is `offer`, or `review.crap` is `report`. Run `git status --porcelain` before such a step. If the output is nonempty, stop and ask the owner how to handle the changes. If the output is empty, run `gh pr checkout <n>` and record the PR branch name. When no step needs a checkout, keep the current branch. Keep the original branch or detached HEAD commit for the report's return command. Use step 2 above to size and group the change with `review.reviewers` and `review.families`.

Run `gh pr view <n> --json baseRefOid,headRefOid` once, with or without a PR checkout. Save `baseRefOid` and `headRefOid` for all PR review rounds. Run `git fetch origin <baseRefName> pull/<n>/head` once.

Apply these rules only to round-1 review tasks and the round-1 oracle task of the PR. Replace the default diff command with `git diff <baseRefOid>...<headRefOid> -- <paths> ':(exclude)docs/design'`. Give each round-1 review task only its group's paths. Give the oracle `.` as `<paths>`. Use `git show <headRefOid>:<path>` to read whole files. When the PR is not checked out, tell these tasks not to run tests or builds on the working tree because it does not hold the PR.

For reviews of uncommitted CI fixes, fix-loop changes, and qa changes, use `git diff HEAD -- <fix paths>`.

For the oracle task of a round after a fix loop, give `git status --porcelain -- <the round's fix paths>` and `git diff HEAD -- <the round's fix paths> ':(exclude)docs/design'`. Tell it to read whole files from the working tree.

Done when: the PR is linked when supported, and the target, groups, and required checkout are ready.

### PR 2. Rules

List `AGENTS.md` and `CLAUDE.md` in the root and each directory above a changed file. Add `CONTRIBUTING.md` and the docs that these rule files link to. Add relevant project skills from `.claude/skills/*/SKILL.md` and `.agents/skills/*/SKILL.md` by their descriptions. Add the lint, format, type-check, and CI config files. Give every review task this list. Require each finding that breaks a written rule to cite its rule file and line. This step always runs.

Done when: the rule-file list and project commands are ready for the briefs.

### PR 3. CI

With `review.ci: off`, skip CI. Otherwise run `gh pr checks <n> --json name,state,bucket,link,workflow`. Run this command again on every task-result or PR-event wake. Treat the current checks as CI state. Keep no separate CI-state record. For each failing GitHub Actions check, get the job id from its link. Save the last 400 lines of `gh run view --job <job-id> --log-failed` to `<evidence>/ci-<slug>-<check>.log`. For a failing check outside GitHub Actions, save its link instead. Resolve `<evidence>` with `omt paths --evidence` and use a safe filename for `<check>`.

With `review.ci: check` and no checks, report `no CI checks`. With `review.ci: fix` and no checks, run the project's check command from its rules or package scripts as `omt lock run check -- <command>`. Treat a failure of that command as a failing check. Run the check and coverage commands one at a time. With neither `flock` nor `lockf` on `PATH`, `omt lock run` warns and runs the command without a lock.

While any check is pending, end the turn with `watch_pull_request` as the last action. On the first turn, apply this rule after the PR step 5 dispatches. When no check is pending and you end a turn to wait for the owner, call `unwatch_pull_request` first. Call `unwatch_pull_request` when no check is pending and the review ends, or when the owner stops the review. If the watch tool is unavailable, report pending checks and the missing tool.

Done when: each check has a current state and each failure has a log or link.

### PR 4. Coverage

With `review.crap: off`, skip coverage. With `review.crap: report`, find a `coverage` or `test:coverage` script, or a CI step that writes coverage. When one exists, run it once as `omt lock run coverage -- <command>` with lcov output to `<evidence>/coverage-<slug>.lcov`. Use that command's supported output option or copy its lcov file to this path after the run. When no coverage command exists, give reviewers no coverage file. Finish any check command before starting coverage, also on a system without a lock tool.

Done when: reviewers have the measured coverage path or know that coverage data is absent.

### PR 5. Round 1

Dispatch the read-only review groups on the PR head with the rule-file list and coverage path, using step 3 above. Apply the PR step 1 diff and file-read rules to every review task. With `review.crap: report`, ask each reviewer to compute the values in PR step 9 for every added or changed function in its group. With `review.verify: changed-flows`, dispatch one `verify` task when the PR changes a screen, a CLI command, or an API route. Name the changed flows from the PR body and diff, and the build and run commands from the rules. Name the PR's changed paths, excluding `docs/design/`, as the code under test in the `verify` task. Require the verify result to name each flow's covering test file, or `none`. The `verify` task writes no tests and changes no product files. Only `verify` drives a device, a Simulator UI, a browser, or a computer. With `review.verify: off`, skip this task. When verify returns `INCONCLUSIVE` because it cannot reach a local tool, send the same task once to the next rung of another provider.

Record the dispatches, then apply the PR step 3 watch rule before ending the turn. On wake, refresh CI at PR step 3 and collect every round-1 verdict before PR step 6.

Done when: every group and any required verify task has a verdict, or waits on an active task or a limit.

### PR 6. Merge and oracle

Merge the findings with step 4 above. Turn each flow that verify returns as `NOT VERIFIED` into a P1 finding with its evidence. Apply step 5 above only when `review.oracle` is `on`. Apply the PR step 1 diff and file-read rules to the oracle task. Keep every confirmed rule citation and CRAP value in the merged list.

Done when: the merged list includes verify failures and the enabled oracle's verdict.

### PR 7. CI fixes

With `review.ci: check`, report failures without a CI fix task. With `review.ci: off`, skip this step. With `review.ci: fix`, wait for every round-1 review and verify verdict before dispatching fixes. Send each failing check to an `execute` task with its log or external-check link, under a distinct `F<k>` unit. Tell the task to reproduce with the matching local command, fix the failure, and run the command again. A failure that cannot be reproduced because of secrets or outside services returns `STATUS: BLOCKED` with the reason. Review each fix once as in step 3 above, with `--unit F<k> --against auto` and the fix result in its task. Keep each fix's changed paths for the report and the commit. Apply `maxReviewRounds` to repeated CI fixes.

Done when: every failing check has a reviewed fix or a reported blocker, or its task waits on a limit.

### PR 8. Guardrails

With `review.guardrails: off`, skip this step. With `review.guardrails: propose`, dispatch one read-only `guardrail` task after the enabled oracle pass and CI fix reviews. Give it the merged findings, CI failures, rule-file list, CRAP results, and `.omt/guardrails.md` when that file exists. Require the [guardrail result block](../omt/references/results/guardrail.md). Ask for the first applicable class per finding: `check`, then `rule-fix`, then `new-rule`. A `check` proposal names the tool, config change, and proof command that fails on the PR head and passes after the change. A `rule-fix` proposal cites an unclear or conflicting written rule and its correction. A `new-rule` proposal states the rule and destination file when no written rule covers the case. For a finding that only judgment can catch, require a note with the reason and no proposal. Skip proposals already in `.omt/guardrails.md`.

Before the append, run `omt init` if `.omt/.gitignore` lacks `guardrails.md`. Append each new proposal to `.omt/guardrails.md` as `- [ ] G<k> <date> PR #<n> <class>: <proposal>. Where: <file>. Proof: <command or none>.`. Set `<k>` one above the highest id in the file for each new proposal. Leave implementation of the proposals to owner-approved omt-ulw work on a separate branch.

Done when: each finding has a new proposal or a reason for none, and the conductor has saved the new proposals.

### PR 9. CRAP

With `review.crap: off`, skip this step. With `review.crap: report`, collect the reviewer calculations requested in PR step 5. For each added or changed function, use `CRAP = complexity² × (1 − coverage)³ + complexity`. Count McCabe complexity as 1, plus 1 for each `if`, `else if`, loop, `case`, `catch`, `&&`, `||`, `??`, and `?:`. Coverage is the share of the function's lines that the lcov file marks as hit. Without a coverage file, use coverage 0 and say `no coverage data`. Report each changed function with CRAP above 30 as P2, with its complexity, coverage, and CRAP values. Include CRAP findings in the merge and oracle input before the guardrail task. When complexity lint or a coverage gate is missing and `review.guardrails` is `propose`, require a `check` proposal in PR step 8. With `review.guardrails: off`, list each missing complexity lint rule or coverage gate as a note in the report.

Done when: every added or changed function has its calculation and every CRAP finding has its three values.

### PR 10. Report

Before you report, run the settle sweep ([delegation.md](../omt/references/delegation.md#releasing-children)).

Write `review-<slug>-r<n>.md` in the directory that `omt paths --evidence` prints, using the review result format from step 6 above. Include the verdict and findings by severity, with each applicable rule file and line. Include the CI state and each CI fix with its changed paths. Include verify results with screenshots and the CRAP findings. List each verified flow that no test covers and the guardrail proposals. Show the branch or detached HEAD commit left in the checkout. For an original branch, give `git switch <branch>` as the return command. For an original detached HEAD, give `git switch --detach <commit>` as the return command. List design files for the owner's review. This step always runs.

If checks remain pending, list them in the report and apply the PR step 3 watch rule. When their results arrive, run PR step 7 for new failures, then update the report through PR steps 8 to 10.

Done when: the report exists and the owner has the verdict, evidence, pending checks, and branch-return command.

### PR 11. Offers

After the owner approves a fix loop or `qa` task, check whether PR step 1 checked out the PR. If it did not, run the PR step 1 checkout procedure before dispatching any edit task. After a late checkout, tell the owner the PR branch now in the checkout. Give `git switch <branch>` for an original branch or `git switch --detach <commit>` for an original detached HEAD.

With `review.fixLoop: offer`, ask before each fix loop as in step 6 above. With `review.fixLoop: off`, make no fix-loop offer. With `review.tests: offer`, list one e2e test per verified flow that no test covers, with its flow and file path. Ask the owner before each `qa` task and wait for yes on that task's exact test lines. Then dispatch `qa` with only those lines. Name the PR's changed paths, excluding `docs/design/`, as the code under test in the `qa` task. When the project has no e2e test framework, require `INCONCLUSIVE` with that reason. With `review.tests: off`, offer no `qa` task. Leave qa changes uncommitted and review each qa change once before the commit. Send product failures from qa to an owner-approved fix loop.

Before finishing, call `list_thread_pull_requests` when available. Link this PR if it is missing from the list. Report a failed linking call as a failure.

Commit and push by the [Git actions](../omt/references/delegation.md#git-actions) rules, with `--profile <profile>`. Make one commit per fix and per qa task using only its changed paths. Combine changes to the same file into one commit. Push to the PR branch. After the push, call `watch_pull_request` only when `review.ci` is not `off` and PR step 3 found checks. End the turn immediately after `watch_pull_request`. Otherwise, call `unwatch_pull_request` and end the review. With `review.ci: fix`, if a check fails again, use the next CI fix round up to `maxReviewRounds`.

When no check is pending and you end a turn to wait for the owner, call `unwatch_pull_request` first. Apply the PR step 3 watch rule before handing back the work, and run the settle sweep ([delegation.md](../omt/references/delegation.md#releasing-children)). Post nothing to GitHub except a push that the [Git actions](../omt/references/delegation.md#git-actions) rules allow.

Done when: each offer has an owner decision or awaits one, and the PR is unwatched when the review ends.
