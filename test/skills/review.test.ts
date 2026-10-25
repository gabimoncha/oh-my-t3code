import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SKILLS_DIR, readSkill, section } from "./shared.ts";

test("each mode-check step calls t3_thread_configuration, and no skill reads modes from orchestrator_capabilities (review)", () => {
  const modeSteps: Record<string, string> = {
    "omt-review": "### 0. ",
  };
  for (const [name, heading] of Object.entries(modeSteps)) {
    const text = readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8");
    const start = text.indexOf(`\n${heading}`);
    assert.ok(start >= 0, `${name} has no step ${heading.trim()}`);
    const end = text.indexOf("\n### ", start + 1);
    const step = text.slice(start, end < 0 ? undefined : end);
    assert.match(step, /t3_thread_configuration/, `${name} mode step`);
    assert.doesNotMatch(step, /orchestrator_capabilities/, `${name} mode step`);
  }
});

test("skills name the shared evidence directory, not a bare .omt/evidence/ path (review)", () => {
  for (const name of ["omt-review"]) {
    assert.match(readSkill(name), /`omt paths --evidence`/, name);
  }
});

test("the design and ui personas exist, and no model reviews design artifacts (review)", () => {
  const review = readSkill("omt-review");
  assert.match(section(review, "### 2. "), /Leave every file under `docs\/design\/` out of the groups/);
  assert.match(section(review, "### 3. "), /never include `docs\/design\/`/);
  assert.match(section(review, "### 5. "), /`docs\/design\/` excluded/);
});

test("omt-review describes the profile switch and PR steps", () => {
  const text = /^description: (.+)$/m.exec(readSkill("omt-review"))?.[1] ?? "";
  assert.match(text, /Accepts --profile\./);
  assert.match(text, /Sizes reviewers, groups files, merges findings, and runs the profile's oracle pass\./);
  assert.match(text, /For a PR, runs target, rules, CI, coverage, round 1, merge and oracle, CI fixes, guardrails, CRAP, report, and owner-approved offers in order\./);
});

test("omt-review introduces the profile controls", () => {
  const text = readSkill("omt-review");
  assert.match(text, /You run parallel `review` tasks over a change and merge their findings\./);
  assert.match(text, /The effective profile controls the reviewers, the oracle pass, and the fix offer\./);
});

test("omt-review pins 0. Check your mode", () => {
  const text = section(readSkill("omt-review"), "### 0. Check your mode");
  assert.match(text, /Accept `omt-review --profile <name> <target>` for one run\./);
  assert.match(text, /With `--profile`, run `omt profile show <name> --json`\./);
  assert.match(text, /Otherwise run `omt profile show --json` to use the config's profile\./);
  assert.match(text, /Read `profile`, `workflow\.review`, `limits`, `roles`, and `models` from the output\./);
  assert.match(text, /Use the output's `profile` as `<profile>` in every brief and role lookup\./);
  assert.match(text, /Read the profile again on each wake, with the run's `--profile` override when one exists\./);
  assert.match(text, /The `review-<slug>` id is ledger-only, so do not use `omt profile show --plan review-<slug>`\./);
  assert.match(text, /In `plan` mode, omit `--save` from every brief command\./);
  assert.match(text, /For a PR step that needs a checkout, a file write, or an edit role, ask the owner to switch to default mode and stop\./);
  assert.match(text, /Done when: you know your mode and effective profile\./);
});

test("omt-review pins 1. Pick the target", () => {
  const text = section(readSkill("omt-review"), "### 1. Pick the target");
  assert.match(text, /For a pull request, follow PR steps 1 to 11 below in order instead of continuing at step 2\./);
});

test("omt-review pins 2. Size and split", () => {
  const text = section(readSkill("omt-review"), "### 2. Size and split");
  assert.match(text, /When `review\.reviewers` is `auto`, count changed lines with `git diff --shortstat` or the PR's stats and use this table\./);
  assert.match(text, /When `review\.reviewers` is a number from 1 to 4, use that number of groups\./);
  assert.match(text, /With `review\.families: one`, dispatch one reviewer per group\./);
  assert.match(text, /With `review\.families: both`, dispatch one reviewer from each family per group\./);
  assert.match(text, /Never run more than `maxParallel` reviewers at once, from the effective profile's `limits\.maxParallel`\./);
  assert.match(text, /Queue the remaining family reviews for the next wake\./);
});

test("omt-review pins 3. Dispatch the reviewers", () => {
  const text = section(readSkill("omt-review"), "### 3. Dispatch the reviewers");
  assert.match(text, /Before every task dispatch, run `omt ledger stats --plan review-<slug>`\./);
  assert.match(text, /Use `dispatched` and `active` from the output\./);
  assert.match(text, /Use `limits\.maxTasksPerRun` and `limits\.maxParallel` from `omt profile show <profile> --json`\./);
  assert.match(text, /Dispatch only when `dispatched` is below `limits\.maxTasksPerRun` and `active` is below `limits\.maxParallel`\./);
  assert.match(text, /Ignore the `can dispatch` line because it uses the config's profile limits\./);
  assert.match(text, /Build each group brief with `omt brief review --task-file - --title "review G<k>: <group paths>" --round <n> --attempt 1 --plan review-<slug> --unit G<k> --profile <profile> --save --json`\./);
  assert.match(text, /For `review\.families: both`, use units `G<k>\.codex` and `G<k>\.claude` with `--against claudeAgent` and `--against codex`, respectively\./);
  assert.match(text, /Check each resolved target's family with \[roles\.md\]\(\.\.\/omt\/references\/roles\.md#cross-family-roles\)\./);
  assert.match(text, /If both calls resolve to one family, report the unavailable family and stop instead of counting two reviews from one family\./);
  assert.match(text, /Build every task with `omt brief <role> \.\.\. --profile <profile> --save --json`, including oracle, fix, verify, guardrail, and qa tasks\./);
  assert.match(text, /Pass `delegateTask` to `delegate_task` and retain its `taskId`\./);
  assert.match(text, /Record the dispatch with the returned `ledger\.dispatched` command after replacing only `<taskId>`\./);
  assert.match(text, /For a fallback, use the provider and model of the target that you actually sent \(\[results\.md\]\(\.\.\/omt\/references\/results\.md#recording\)\)\./);
  assert.match(text, /In default mode, end your turn after recording the dispatches\./);
  assert.match(text, /For PR step 5, record the review and verify dispatches before ending the turn\./);
  assert.match(text, /That step adds the pending-CI watch just before the turn ends\./);
  assert.match(text, /Give every edit child an explicit file scope\./);
  assert.match(text, /Run edit tasks with overlapping scopes one at a time\./);
  assert.match(text, /Let no child commit or push\./);
  assert.match(text, /Keep child changes uncommitted for the conductor\./);
  assert.match(text, /Workers write no new tests\./);
  assert.match(text, /Only an owner-approved `qa` task writes its listed tests\./);
});

test("omt-review pins 4. Merge", () => {
  const text = section(readSkill("omt-review"), "### 4. Merge");
  assert.match(text, /Drop duplicates with the same location and failure, and keep the higher severity\./);
  assert.match(text, /For each non-CRAP finding, keep its failure scenario\./);
  assert.match(text, /For each CRAP finding, keep the changed function and its complexity, coverage, and CRAP values\./);
  assert.match(text, /Keep a missing-test finding only when the plan or task names that test\./);
  assert.match(text, /In a PR review, list other uncovered flows in the report instead\./);
});

test("omt-review pins 5. Oracle pass", () => {
  const text = section(readSkill("omt-review"), "### 5. Oracle pass");
  assert.match(text, /With `review\.oracle: off`, skip this step\./);
  assert.match(text, /With `review\.oracle: on`, run the following pass\./);
});

test("omt-review pins 6. Write and report", () => {
  const text = section(readSkill("omt-review"), "### 6. Write and report");
  assert.match(text, /With `review\.fixLoop: off`, report without a fix offer\./);
  assert.match(text, /With `review\.fixLoop: offer`, ask the owner before each fix loop and wait for yes\./);
  assert.match(text, /After yes, number the P0 to P2 findings `F1`, `F2`, and so on\./);
});

test("omt-review pins the PR path and switches", () => {
  const text = section(readSkill("omt-review"), "## PR review");
  assert.match(text, /Run these eleven steps for a pull request with any profile\./);
  assert.match(text, /`omt-review --profile pr-review <number>` enables all PR steps\./);
  assert.match(text, /Steps 1, 2, 6, and 10 always run\./);
  assert.match(text, /Step 11 applies its named switches\./);
  assert.match(text, /For a switch set to `off`, mark its step skipped and continue in order\./);
  assert.match(text, /Use the mode, dispatch, ledger, limit, and design-exclusion rules above throughout this path\./);
  assert.match(text, /Post no comment and no review to GitHub\./);
});

test("omt-review pins PR 1. Target", () => {
  const text = section(readSkill("omt-review"), "### PR 1. Target");
  assert.match(text, /Run `gh pr view <n> --json number,title,body,url,baseRefName,headRefName,files,additions,deletions` for the intent and file list\./);
  assert.match(text, /When `link_pull_request` exists, call it with the PR URL immediately\./);
  assert.match(text, /Save the current branch name with `git branch --show-current`\./);
  assert.match(text, /If the branch name is empty, save the detached HEAD commit with `git rev-parse HEAD`\./);
  assert.match(text, /A PR-head step needs a clean checkout when `review\.ci` is `fix`, `review\.verify` is `changed-flows`, `review\.tests` is `offer`, or `review\.crap` is `report`\./);
  assert.match(text, /Run `git status --porcelain` before such a step\./);
  assert.match(text, /If the output is nonempty, stop and ask the owner how to handle the changes\./);
  assert.match(text, /If the output is empty, run `gh pr checkout <n>` and record the PR branch name\./);
  assert.match(text, /When no step needs a checkout, keep the current branch\./);
  assert.match(text, /Keep the original branch or detached HEAD commit for the report's return command\./);
  assert.match(text, /Use step 2 above to size and group the change with `review\.reviewers` and `review\.families`\./);
  assert.match(text, /Run `gh pr view <n> --json baseRefOid,headRefOid` once, with or without a PR checkout\./);
  assert.match(text, /Save `baseRefOid` and `headRefOid` for all PR review rounds\./);
  assert.match(text, /Run `git fetch origin <baseRefName> pull\/<n>\/head` once\./);
  assert.match(text, /Apply these rules only to round-1 review tasks and the round-1 oracle task of the PR\./);
  assert.match(text, /Replace the default diff command with `git diff <baseRefOid>\.\.\.<headRefOid> -- <paths> ':\(exclude\)docs\/design'`\./);
  assert.match(text, /Give each round-1 review task only its group's paths\./);
  assert.match(text, /Give the oracle `\.` as `<paths>`\./);
  assert.match(text, /Use `git show <headRefOid>:<path>` to read whole files\./);
  assert.match(text, /When the PR is not checked out, tell these tasks not to run tests or builds on the working tree because it does not hold the PR\./);
  assert.match(text, /For reviews of uncommitted CI fixes, fix-loop changes, and qa changes, use `git diff HEAD -- <fix paths>`\./);
  assert.match(text, /For the oracle task of a round after a fix loop, give `git status --porcelain -- <the round's fix paths>` and `git diff HEAD -- <the round's fix paths> ':\(exclude\)docs\/design'`\./);
  assert.match(text, /Tell it to read whole files from the working tree\./);
  assert.match(text, /Done when: the PR is linked when supported, and the target, groups, and required checkout are ready\./);
});

test("omt-review pins PR 2. Rules", () => {
  const text = section(readSkill("omt-review"), "### PR 2. Rules");
  assert.match(text, /List `AGENTS\.md` and `CLAUDE\.md` in the root and each directory above a changed file\./);
  assert.match(text, /Add `CONTRIBUTING\.md` and the docs that these rule files link to\./);
  assert.match(text, /Add relevant project skills from `\.claude\/skills\/\*\/SKILL\.md` and `\.agents\/skills\/\*\/SKILL\.md` by their descriptions\./);
  assert.match(text, /Add the lint, format, type-check, and CI config files\./);
  assert.match(text, /Give every review task this list\./);
  assert.match(text, /Require each finding that breaks a written rule to cite its rule file and line\./);
  assert.match(text, /This step always runs\./);
  assert.match(text, /Done when: the rule-file list and project commands are ready for the briefs\./);
});

test("omt-review pins PR 3. CI", () => {
  const text = section(readSkill("omt-review"), "### PR 3. CI");
  assert.match(text, /With `review\.ci: off`, skip CI\./);
  assert.match(text, /Otherwise run `gh pr checks <n> --json name,state,bucket,link,workflow`\./);
  assert.match(text, /Run this command again on every task-result or PR-event wake\./);
  assert.match(text, /Treat the current checks as CI state\./);
  assert.match(text, /Keep no separate CI-state record\./);
  assert.match(text, /For each failing GitHub Actions check, get the job id from its link\./);
  assert.match(text, /Save the last 400 lines of `gh run view --job <job-id> --log-failed` to `<evidence>\/ci-<slug>-<check>\.log`\./);
  assert.match(text, /For a failing check outside GitHub Actions, save its link instead\./);
  assert.match(text, /Resolve `<evidence>` with `omt paths --evidence` and use a safe filename for `<check>`\./);
  assert.match(text, /With `review\.ci: check` and no checks, report `no CI checks`\./);
  assert.match(text, /With `review\.ci: fix` and no checks, run the project's check command from its rules or package scripts as `omt lock run check -- <command>`\./);
  assert.match(text, /Treat a failure of that command as a failing check\./);
  assert.match(text, /Run the check and coverage commands one at a time\./);
  assert.match(text, /With neither `flock` nor `lockf` on `PATH`, `omt lock run` warns and runs the command without a lock\./);
  assert.match(text, /While any check is pending, end the turn with `watch_pull_request` as the last action\./);
  assert.match(text, /On the first turn, apply this rule after the PR step 5 dispatches\./);
  assert.match(text, /When no check is pending and you end a turn to wait for the owner, call `unwatch_pull_request` first\./);
  assert.match(text, /Call `unwatch_pull_request` when no check is pending and the review ends, or when the owner stops the review\./);
  assert.match(text, /If the watch tool is unavailable, report pending checks and the missing tool\./);
  assert.match(text, /Done when: each check has a current state and each failure has a log or link\./);
});

test("omt-review pins PR 4. Coverage", () => {
  const text = section(readSkill("omt-review"), "### PR 4. Coverage");
  assert.match(text, /With `review\.crap: off`, skip coverage\./);
  assert.match(text, /With `review\.crap: report`, find a `coverage` or `test:coverage` script, or a CI step that writes coverage\./);
  assert.match(text, /When one exists, run it once as `omt lock run coverage -- <command>` with lcov output to `<evidence>\/coverage-<slug>\.lcov`\./);
  assert.match(text, /Use that command's supported output option or copy its lcov file to this path after the run\./);
  assert.match(text, /When no coverage command exists, give reviewers no coverage file\./);
  assert.match(text, /Finish any check command before starting coverage, also on a system without a lock tool\./);
  assert.match(text, /Done when: reviewers have the measured coverage path or know that coverage data is absent\./);
});

test("omt-review pins PR 5. Round 1", () => {
  const text = section(readSkill("omt-review"), "### PR 5. Round 1");
  assert.match(text, /Dispatch the read-only review groups on the PR head with the rule-file list and coverage path, using step 3 above\./);
  assert.match(text, /Apply the PR step 1 diff and file-read rules to every review task\./);
  assert.match(text, /With `review\.crap: report`, ask each reviewer to compute the values in PR step 9 for every added or changed function in its group\./);
  assert.match(text, /With `review\.verify: changed-flows`, dispatch one `verify` task when the PR changes a screen, a CLI command, or an API route\./);
  assert.match(text, /Name the changed flows from the PR body and diff, and the build and run commands from the rules\./);
  assert.match(text, /Name the PR's changed paths, excluding `docs\/design\/`, as the code under test in the `verify` task\./);
  assert.match(text, /Require the verify result to name each flow's covering test file, or `none`\./);
  assert.match(text, /The `verify` task writes no tests and changes no product files\./);
  assert.match(text, /Only `verify` drives a device, a Simulator UI, a browser, or a computer\./);
  assert.match(text, /With `review\.verify: off`, skip this task\./);
  assert.match(text, /When verify returns `INCONCLUSIVE` because it cannot reach a local tool, send the same task once to the next rung of another provider\./);
  assert.match(text, /Record the dispatches, then apply the PR step 3 watch rule before ending the turn\./);
  assert.match(text, /On wake, refresh CI at PR step 3 and collect every round-1 verdict before PR step 6\./);
  assert.match(text, /Done when: every group and any required verify task has a verdict, or waits on an active task or a limit\./);
});

test("omt-review pins PR 6. Merge and oracle", () => {
  const text = section(readSkill("omt-review"), "### PR 6. Merge and oracle");
  assert.match(text, /Merge the findings with step 4 above\./);
  assert.match(text, /Turn each flow that verify returns as `NOT VERIFIED` into a P1 finding with its evidence\./);
  assert.match(text, /Apply step 5 above only when `review\.oracle` is `on`\./);
  assert.match(text, /Apply the PR step 1 diff and file-read rules to the oracle task\./);
  assert.match(text, /Keep every confirmed rule citation and CRAP value in the merged list\./);
  assert.match(text, /Done when: the merged list includes verify failures and the enabled oracle's verdict\./);
});

test("omt-review pins PR 7. CI fixes", () => {
  const text = section(readSkill("omt-review"), "### PR 7. CI fixes");
  assert.match(text, /With `review\.ci: check`, report failures without a CI fix task\./);
  assert.match(text, /With `review\.ci: off`, skip this step\./);
  assert.match(text, /With `review\.ci: fix`, wait for every round-1 review and verify verdict before dispatching fixes\./);
  assert.match(text, /Send each failing check to an `execute` task with its log or external-check link, under a distinct `F<k>` unit\./);
  assert.match(text, /Tell the task to reproduce with the matching local command, fix the failure, and run the command again\./);
  assert.match(text, /A failure that cannot be reproduced because of secrets or outside services returns `STATUS: BLOCKED` with the reason\./);
  assert.match(text, /Review each fix once as in step 3 above, with `--unit F<k> --against auto` and the fix result in its task\./);
  assert.match(text, /Keep each fix's changed paths for the report and the commit\./);
  assert.match(text, /Apply `maxReviewRounds` to repeated CI fixes\./);
  assert.match(text, /Done when: every failing check has a reviewed fix or a reported blocker, or its task waits on a limit\./);
});

test("omt-review pins PR 8. Guardrails", () => {
  const text = section(readSkill("omt-review"), "### PR 8. Guardrails");
  assert.match(text, /With `review\.guardrails: off`, skip this step\./);
  assert.match(text, /With `review\.guardrails: propose`, dispatch one read-only `guardrail` task after the enabled oracle pass and CI fix reviews\./);
  assert.match(text, /Give it the merged findings, CI failures, rule-file list, CRAP results, and `\.omt\/guardrails\.md` when that file exists\./);
  assert.match(text, /Require the \[guardrail result block\]\(\.\.\/omt\/references\/results\/guardrail\.md\)\./);
  assert.match(text, /Ask for the first applicable class per finding: `check`, then `rule-fix`, then `new-rule`\./);
  assert.match(text, /A `check` proposal names the tool, config change, and proof command that fails on the PR head and passes after the change\./);
  assert.match(text, /A `rule-fix` proposal cites an unclear or conflicting written rule and its correction\./);
  assert.match(text, /A `new-rule` proposal states the rule and destination file when no written rule covers the case\./);
  assert.match(text, /For a finding that only judgment can catch, require a note with the reason and no proposal\./);
  assert.match(text, /Skip proposals already in `\.omt\/guardrails\.md`\./);
  assert.match(text, /Before the append, run `omt init` if `\.omt\/\.gitignore` lacks `guardrails\.md`\./);
  assert.match(text, /Append each new proposal to `\.omt\/guardrails\.md` as `- \[ \] G<k> <date> PR #<n> <class>: <proposal>\. Where: <file>\. Proof: <command or none>\.`\./);
  assert.match(text, /Set `<k>` one above the highest id in the file for each new proposal\./);
  assert.match(text, /Leave implementation of the proposals to owner-approved omt-ulw work on a separate branch\./);
  assert.match(text, /Done when: each finding has a new proposal or a reason for none, and the conductor has saved the new proposals\./);
});

test("omt-review pins PR 9. CRAP", () => {
  const text = section(readSkill("omt-review"), "### PR 9. CRAP");
  assert.match(text, /With `review\.crap: off`, skip this step\./);
  assert.match(text, /With `review\.crap: report`, collect the reviewer calculations requested in PR step 5\./);
  assert.match(text, /For each added or changed function, use `CRAP = complexity² × \(1 − coverage\)³ \+ complexity`\./);
  assert.match(text, /Count McCabe complexity as 1, plus 1 for each `if`, `else if`, loop, `case`, `catch`, `&&`, `\|\|`, `\?\?`, and `\?:`\./);
  assert.match(text, /Coverage is the share of the function's lines that the lcov file marks as hit\./);
  assert.match(text, /Without a coverage file, use coverage 0 and say `no coverage data`\./);
  assert.match(text, /Report each changed function with CRAP above 30 as P2, with its complexity, coverage, and CRAP values\./);
  assert.match(text, /Include CRAP findings in the merge and oracle input before the guardrail task\./);
  assert.match(text, /When complexity lint or a coverage gate is missing and `review\.guardrails` is `propose`, require a `check` proposal in PR step 8\./);
  assert.match(text, /With `review\.guardrails: off`, list each missing complexity lint rule or coverage gate as a note in the report\./);
  assert.match(text, /Done when: every added or changed function has its calculation and every CRAP finding has its three values\./);
});

test("omt-review pins PR 10. Report", () => {
  const text = section(readSkill("omt-review"), "### PR 10. Report");
  assert.match(text, /Write `review-<slug>-r<n>\.md` in the directory that `omt paths --evidence` prints, using the review result format from step 6 above\./);
  assert.match(text, /Include the verdict and findings by severity, with each applicable rule file and line\./);
  assert.match(text, /Include the CI state and each CI fix with its changed paths\./);
  assert.match(text, /Include verify results with screenshots and the CRAP findings\./);
  assert.match(text, /List each verified flow that no test covers and the guardrail proposals\./);
  assert.match(text, /Show the branch or detached HEAD commit left in the checkout\./);
  assert.match(text, /For an original branch, give `git switch <branch>` as the return command\./);
  assert.match(text, /For an original detached HEAD, give `git switch --detach <commit>` as the return command\./);
  assert.match(text, /List design files for the owner's review\./);
  assert.match(text, /This step always runs\./);
  assert.match(text, /If checks remain pending, list them in the report and apply the PR step 3 watch rule\./);
  assert.match(text, /When their results arrive, run PR step 7 for new failures, then update the report through PR steps 8 to 10\./);
  assert.match(text, /Done when: the report exists and the owner has the verdict, evidence, pending checks, and branch-return command\./);
});

test("omt-review pins PR 11. Offers", () => {
  const text = section(readSkill("omt-review"), "### PR 11. Offers");
  assert.match(text, /After the owner approves a fix loop or `qa` task, check whether PR step 1 checked out the PR\./);
  assert.match(text, /If it did not, run the PR step 1 checkout procedure before dispatching any edit task\./);
  assert.match(text, /After a late checkout, tell the owner the PR branch now in the checkout\./);
  assert.match(text, /Give `git switch <branch>` for an original branch or `git switch --detach <commit>` for an original detached HEAD\./);
  assert.match(text, /With `review\.fixLoop: offer`, ask before each fix loop as in step 6 above\./);
  assert.match(text, /With `review\.fixLoop: off`, make no fix-loop offer\./);
  assert.match(text, /With `review\.tests: offer`, list one e2e test per verified flow that no test covers, with its flow and file path\./);
  assert.match(text, /Ask the owner before each `qa` task and wait for yes on that task's exact test lines\./);
  assert.match(text, /Then dispatch `qa` with only those lines\./);
  assert.match(text, /Name the PR's changed paths, excluding `docs\/design\/`, as the code under test in the `qa` task\./);
  assert.match(text, /When the project has no e2e test framework, require `INCONCLUSIVE` with that reason\./);
  assert.match(text, /With `review\.tests: off`, offer no `qa` task\./);
  assert.match(text, /Leave qa changes uncommitted and review each qa change once before the commit\./);
  assert.match(text, /Send product failures from qa to an owner-approved fix loop\./);
  assert.match(text, /Commit and push by the \[Git actions\]\(\.\.\/omt\/references\/delegation\.md#git-actions\) rules, with `--profile <profile>`\./);
  assert.match(text, /Make one commit per fix and per qa task using only its changed paths\./);
  assert.match(text, /Combine changes to the same file into one commit\./);
  assert.match(text, /Push to the PR branch\./);
  assert.match(text, /After the push, call `watch_pull_request` only when `review\.ci` is not `off` and PR step 3 found checks\./);
  assert.match(text, /End the turn immediately after `watch_pull_request`\./);
  assert.match(text, /Otherwise, call `unwatch_pull_request` and end the review\./);
  assert.match(text, /With `review\.ci: fix`, if a check fails again, use the next CI fix round up to `maxReviewRounds`\./);
  assert.match(text, /When no check is pending and you end a turn to wait for the owner, call `unwatch_pull_request` first\./);
  assert.match(text, /Apply the PR step 3 watch rule before handing back the work, and run the settle sweep/);
  assert.match(text, /Before finishing, call `list_thread_pull_requests` when available\./);
  assert.match(text, /Link this PR if it is missing from the list\./);
  assert.match(text, /Report a failed linking call as a failure\./);
  const push = text.indexOf("Push to the PR branch.");
  assert.ok(text.indexOf("Before finishing, call `list_thread_pull_requests` when available.") < push);
  assert.ok(text.indexOf("Link this PR if it is missing from the list.") < push);
  assert.ok(text.indexOf("Report a failed linking call as a failure.") < push);
  assert.match(text, /Post nothing to GitHub except a push that the \[Git actions\]\(\.\.\/omt\/references\/delegation\.md#git-actions\) rules allow\./);
  assert.match(text, /Done when: each offer has an owner decision or awaits one, and the PR is unwatched when the review ends\./);
});

test("omt-review keeps all eleven PR steps in order", () => {
  const text = readSkill("omt-review");
  assert.deepEqual([...text.matchAll(/^### PR \d+\. .+$/gm)].map((match) => match[0]), [
    "### PR 1. Target",
    "### PR 2. Rules",
    "### PR 3. CI",
    "### PR 4. Coverage",
    "### PR 5. Round 1",
    "### PR 6. Merge and oracle",
    "### PR 7. CI fixes",
    "### PR 8. Guardrails",
    "### PR 9. CRAP",
    "### PR 10. Report",
    "### PR 11. Offers",
  ]);
  assert.doesNotMatch(section(text, "### PR 11. Offers"), /require `BLOCKED`/);
});
