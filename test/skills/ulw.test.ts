import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SKILLS_DIR, readSkill, section } from "./shared.ts";

test("each mode-check step calls t3_thread_configuration, and no skill reads modes from orchestrator_capabilities (ulw)", () => {
  const modeSteps: Record<string, string> = {
    "omt-ulw": "### 0. ",
    "omt-swarm": "### 1. ",
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

test("delegation.md has a branch check, and both step 0s link to it (ulw)", () => {
  const delegation = readFileSync(join(SKILLS_DIR, "omt", "references", "delegation.md"), "utf8");
  const check = section(delegation, "## Branch check");
  assert.match(check, /refs\/remotes\/origin\/HEAD/);
  assert.match(check, /git merge --ff-only <default>/);
  assert.match(check, /In `plan` mode, only report the count\./);
  for (const name of ["omt-ulw"]) {
    assert.match(section(readSkill(name), "### 0. "), /\(\.\.\/omt\/references\/delegation\.md#branch-check\)/, name);
  }
});

test("omt-swarm does not tell a track to edit limits.maxParallel", () => {
  const text = readSkill("omt-swarm");
  assert.doesNotMatch(text, /limits\.maxParallel/);
  assert.match(text, /omt plan limit <slug>-<track> <k>/);
});

test("skills name the shared evidence directory, not a bare .omt/evidence/ path (ulw)", () => {
  for (const name of ["omt-ulw"]) {
    assert.match(readSkill(name), /`omt paths --evidence`/, name);
  }
});

test("the design and ui personas exist, and no model reviews design artifacts (ulw)", () => {
  const ulw = readSkill("omt-ulw");
  assert.match(section(ulw, "### 7. "), /Leave `docs\/design\/` out of the scope paths/);
  assert.match(section(ulw, "### 10. "), /without `docs\/design\/`/);
  assert.match(section(ulw, "### 8. "), /Design exclusion: for a `ui` unit, leave `docs\/design\/` out of the test scope paths/);
  assert.match(section(ulw, "### 8. "), /leave out every done condition and every piece of context that compares the result with the design/);
  assert.match(section(ulw, "### 9. "), /A `ui` unit uses `ui` in every round/);
});

test("omt-ulw keeps visual checks out of review and oracle briefs of ui units", () => {
  const ulw = readSkill("omt-ulw");
  assert.match(section(ulw, "### 8. "), /every piece of context that compares the result with the design/);
  assert.match(section(ulw, "### 8. "), /Review briefs \(step 7\) and the oracle brief \(step 10\) apply the same exclusion/);
  assert.match(section(ulw, "### 7. "), /For a `ui` unit, also apply the \[design exclusion\]\(#8-test\)/);
  assert.match(section(ulw, "### 10. "), /every done condition except those that the \[design exclusion\]\(#8-test\)/);
});

test("omt-ulw uses the ui role for UI units also in a LIGHT run", () => {
  const ulw = readSkill("omt-ulw");
  assert.match(section(ulw, "## Contract"), /a `ui` child for a unit that implements a design or changes UI, with no fallback to another family/);
  assert.match(section(ulw, "### 5. "), /A `ui` unit uses the `ui` role, also in a LIGHT run\. When `ui` cannot run, stop/);
  assert.match(section(ulw, "### 5. "), /do not fall back to `execute` or to another family/);
});

test("the design check runs before any ui dispatch, also after the omt-plan hand-off (ulw)", () => {
  const ulw = readSkill("omt-ulw");
  const dispatch = section(ulw, "### 5. ");
  const check = dispatch.indexOf("Design check:");
  assert.ok(check >= 0, "step 5 has no design check");
  assert.ok(check < dispatch.indexOf("For each unit"), "the design check comes after the dispatch loop");
  assert.match(dispatch, /also the hand-off from `omt-plan`/);
});

test("omt-ulw asks each owner question once", () => {
  assert.match(section(readSkill("omt-ulw"), "## Conductor rules"), /Ask each owner question once\. Later status messages do not repeat open questions\./);
});

test("omt-ulw step 9 runs a relevance check before each fix round", () => {
  const fix = section(readSkill("omt-ulw"), "### 9. ");
  assert.match(fix, /Relevance check: before each fix round/);
  assert.match(fix, /Record each dropped finding with its reason under `Log` in the plan and in the next `--prior-file`/);
  assert.match(fix, /When you drop every finding, the unit goes to step 8\./);
});

test("omt-ulw fix rounds use deep only when a finding needs investigation", () => {
  const fix = section(readSkill("omt-ulw"), "### 9. ");
  assert.match(fix, /A fix is an `execute` fix, or a `deep` fix when an open finding needs investigation/);
});

test("omt-plan shows the final plan as a page unless visuals.plan is off, and every plan has a summary (ulw)", () => {
  assert.match(section(readSkill("omt-ulw"), "### 4. "), /`## Summary` last by the rule in \[roles\/plan\.md\]/);
});

test("omt-show builds the page with omt visual and shows it with html_render (ulw)", () => {
  assert.match(readSkill("omt"), /\| `omt-show` \|/);
});

test("delegation.md names the plan task budget in the limits and the stalled-run text", () => {
  const limits = section(readFileSync(join(SKILLS_DIR, "omt", "references", "delegation.md"), "utf8"), "## Limits");
  assert.match(limits, /a `max-tasks` key in the plan header replaces `maxTasksPerRun` for that plan/);
  assert.match(limits, /the `dispatched` count/);
  assert.match(limits, /recommend `omt plan limit <slug> --tasks <n>` first, or `limits\.maxTasksPerRun`/);
});

test("omt-ulw starts a stall heartbeat with the profile threshold", () => {
  const delegation = readFileSync(join(SKILLS_DIR, "omt", "references", "delegation.md"), "utf8");
  assert.match(section(delegation, "## Stalled tasks"), /`updatedAt` is older than `build\.stallMinutes` minutes/);
  assert.match(section(delegation, "## Stalled tasks"), /call `task_cancel`, record `--status interrupted --note "stalled"`/);
  assert.match(section(readSkill("omt-ulw"), "### 5. "), /delegation\.md#stalled-tasks/);
});

test("omt-ulw splits BLOCK into a fixable P0 and a wrong approach", () => {
  const review = section(readSkill("omt-ulw"), "### 7. ");
  assert.match(review, /A P0 finding that has a clear fix inside the unit's scope: go to step 9, as for `REQUEST_CHANGES`\./);
  assert.match(review, /A wrong approach, or a P0 whose fix changes the plan: run `omt plan mark <slug> <unit> blocked`/);
});

test("omt-ulw drops a finding only when its case cannot happen, and reopens done units", () => {
  const fix = section(readSkill("omt-ulw"), "### 9. ");
  assert.match(fix, /a case that cannot happen in the planned flow/);
  assert.match(fix, /Never drop a finding because its case is rare or unlikely\./);
  assert.match(fix, /Reopen: when a task or a check finds a defect in code that a done unit owns, run the relevance check on the finding first\./);
  assert.match(fix, /A cycle starts at the unit's first dispatch, or at a reopen/);
  assert.match(fix, /the table and `maxReviewRounds` use the round within the cycle/);
  assert.match(fix, /It is round 1 of a new cycle, with the next `--round` value after the unit's last round\./);
  assert.match(fix, /\| `maxReviewRounds` \(default 4\) \| a fix \| stop \|/);
  assert.match(section(readSkill("omt-ulw"), "### 10. "), /A failing final check reopens the unit that owns the code/);
});

test("omt-ulw shows screenshots and recordings to the user", () => {
  const ulw = readSkill("omt-ulw");
  assert.match(section(ulw, "### 8. "), /show them in your message about the unit: one Markdown image per file with its absolute path/);
  assert.match(section(ulw, "### 11. "), /the latest screenshot or recording of each screen or flow that the change adds or changes/);
});

test("the Mira fixes pin every new rule in the skills and references (ulw)", () => {
  const ulw = readSkill("omt-ulw");
  const fix = section(ulw, "### 9. ");
  assert.match(fix, /Drop the others: a style preference, an input or a state that the plan rules out, or a case that cannot happen in the planned flow\./);
  assert.match(fix, /Keep a missing check on an input shaped like real data for code that reads outside data/);
  assert.match(fix, /run the relevance check on the finding first\. When you drop it, log the drop and leave the unit done\./);
  assert.match(fix, /reopen the unit: run `omt plan mark <slug> <unit> open`/);
  assert.match(fix, /Before a third reopen of the same unit, stop and ask the user/);
  assert.match(fix, /Take the finding out of the fix round of the unit whose task found it\./);
  assert.match(fix, /When that unit has no other kept finding, it waits until the reopened unit is done again, then goes to step 8 for the same round\./);
  assert.match(fix, /Dispatch no new task for a unit that depends on the reopened unit, directly or through other units, until the reopened unit is done again\./);
  assert.match(fix, /Wait until no active task has a scope that overlaps the reopened unit's scope/);
  assert.match(fix, /the first `--round` value of the new cycle/);
  assert.match(fix, /When `maxReviewRounds` is 1, round 1 is also the last round/);
  assert.match(section(ulw, "### 4. "), /has a done condition on an input shaped like real data, also in a LIGHT plan/);
  assert.match(section(ulw, "### 8. "), /Check that each new test file or case maps to a `## Tests` line for the unit\./);
  assert.match(section(ulw, "### 11. "), /from the `EVIDENCE` lines of the verify and `ui` results/);
});

test("omt-ulw pins profile switches, verification, planned tests, and check-ins", () => {
  const text = readSkill("omt-ulw");
  assert.match(text, /A LIGHT run may skip step 3 \(explore\)\./);
  assert.match(text, /It still has the banner, steps 0 to 2, a plan from `omt plan new <slug> --light`, and one `execute` child per unit\./);
  assert.match(text, /Use a `ui` child for a unit that implements a design or changes UI, with no fallback to another family\./);
  assert.match(text, /Apply `build\.review` in step 7, `build\.verify` and `build\.qa` in step 8, and `build\.oracle` in step 10 to both tiers\./);
  assert.match(text, /Record each dispatch and result in the ledger\./);
  assert.match(text, /Run the verify commands and final checks yourself, then report\./);
  assert.match(text, /After a context reset, re-read the plan \(`omt plan status <slug>`\), the ledger \(`omt ledger list --plan <slug>`\), and the profile in step 2 before you act\./);
  assert.match(text, /Read the owner's check-in answers under `Log` too\./);
  assert.match(text, /When the plan file exists, run `omt profile show --plan <slug> --json`\./);
  assert.match(text, /Before the plan exists, run `omt profile show --json`\./);
  assert.match(text, /For `ulw --profile <name>`, use `omt profile show <name> --json` before plan creation\./);
  assert.match(text, /Keep the effective `profile`, `workflow`, `limits`, `roles`, and `models` from the output\./);
  assert.match(text, /Run `omt roles --plan <slug>` for the targets\./);
  assert.match(text, /Before the plan file exists, use the run's selected `--profile <name>` on every `omt brief`, `omt roles`, and `omt route` command\./);
  assert.match(text, /\[The CLI\]\(\.\.\/omt\/references\/delegation\.md#the-cli\) says where to find the CLI\./);
  assert.match(text, /Without it, resolve the profile from config and use \[roles\.md\]\(\.\.\/omt\/references\/roles\.md#resolve-by-hand\)\./);
  assert.match(text, /Before plan creation with a selected profile, run `omt ledger stats --plan <slug>` before each dispatch\./);
  assert.match(text, /Compare `dispatched` with that profile's `limits\.maxTasksPerRun` and `active` with its `limits\.maxParallel`\./);
  assert.match(text, /Dispatch only while both counts are below those limits\./);
  assert.match(text, /Use these comparisons instead of `can dispatch`, which uses the config profile before plan creation\./);
  assert.match(text, /Switch a running plan with `omt plan profile <slug> <name>`\./);
  assert.match(text, /On every wake, read `omt profile show --plan <slug> --json` when the plan file exists\./);
  assert.match(text, /Before plan creation, read `omt profile show <name> --json` with the run's selected `--profile`, or `omt profile show --json` without one\./);
  assert.match(text, /Repeat this lookup after an owner switch or a context reset\./);
  assert.match(text, /Use the new values for the remaining steps\./);
  assert.match(text, /For a run with `--profile <name>`, pass it to plan creation or to `omt-plan`\./);
  assert.match(text, /After plan creation, run `omt profile show --plan <slug> --json`\./);
  assert.match(text, /When you build a `plan` or `plan-review` brief, name the effective `plan\.testLayers` value in the task text\./);
  assert.match(text, /Give every plan a `## Tests` section\./);
  assert.match(text, /Write each approved test as `- <layer> <unit>: <flow or case>\. File: <path>\. Reason: <why>\.` With `build\.qa: planned`, keep only the owner's approved test lines\./);
  assert.match(text, /With `build\.qa: off`, leave `## Tests` empty\./);
  const dispatch = section(text, "### 5. ");
  assert.match(dispatch, /Apply `build\.checkpoint` in step 8 before every dispatch\./);
  assert.match(dispatch, /While a check-in awaits the owner's reply, dispatch nothing new\./);
  assert.match(dispatch, /With `layer`, dispatch only units of the current approved dependency layer until that layer is finished and the owner approves the next layer\./);
  assert.match(dispatch, /With `layer`, count layer 1 as approved when the run starts\./);
  assert.match(dispatch, /Count a reopened unit's fix, review, verify, and qa tasks as part of the current layer\./);
  assert.match(dispatch, /Keep later layers blocked\./);
  assert.match(dispatch, /While a check-in awaits the owner's reply, keep the reopened unit's tasks waiting too\./);
  assert.match(dispatch, /With `unit`, dispatch no new unit after a unit is verified until the owner replies\./);
  assert.ok(dispatch.indexOf("Apply `build.checkpoint`") < dispatch.indexOf("For each unit"));
  assert.match(text, /Build the arguments: `omt brief <role> --task-file - --title "<role> <unit>: <short unit title>" --scope \.\.\. --done \.\.\. --verify \.\.\. --plan <slug> --unit <id> --round 1 --attempt 1 --save --json`\./);
  assert.match(text, /Run the printed `ledger\.dispatched` line after replacing only `<taskId>` with the returned task id\./);
  assert.match(text, /For a retry or fallback, follow \[delegation\.md\]\(\.\.\/omt\/references\/delegation\.md#failure-codes\) with a higher attempt\./);
  assert.match(text, /Record the provider and model of the target that returned the task\./);
  assert.match(dispatch, /Before you end a turn with an active task and no heartbeat exists, start the stall heartbeat \(\[delegation\.md\]\(\.\.\/omt\/references\/delegation\.md#stalled-tasks\)\)\./);
  assert.match(dispatch, /Done when: every ready unit is dispatched or waits on a limit or a check-in, each dispatched task has a ledger entry, and your turn has ended or you are waiting\./);
  assert.match(text, /Read the effective profile again as step 2 says before any new dispatch\./);
  const wake = section(text, "### 6. ");
  assert.match(wake, /Record `--status rejected` when the check disproves the claim\. A verify command that fails on a busy lock, in another unit's file, or while a work or qa task of another unit is active does not disprove the claim\./);
  assert.match(wake, /Send the unit on to step 7, and leave the failure to step 8\./);
  assert.match(text, /Check `build\.checkpoint` as step 8 says before you dispatch every unit that became ready \(step 5\)\./);
  assert.match(text, /Apply `build\.review` to each unit that passed step 6\./);
  assert.match(text, /With `every-round`, dispatch a fresh `review` task for every round\./);
  assert.match(text, /With `first-round`, review only the first implementation round\./);
  assert.match(text, /With `first-round`, send every fix round straight to step 8\./);
  assert.match(text, /With `off`, go straight to step 8 in every round\./);
  assert.match(text, /For each required review:/);
  assert.match(text, /Done when: the unit has a recorded review verdict for this round, or `build\.review` sends it to step 8\./);
  assert.match(text, /Apply `build\.verify` first\./);
  assert.match(text, /With `every-unit`, dispatch `verify` for every unit, including LIGHT units\./);
  assert.match(text, /With `heavy`, dispatch `verify` for every HEAVY unit\./);
  assert.match(text, /For LIGHT with `heavy`, run the verify commands yourself and save their output in the directory that `omt paths --evidence` prints\./);
  assert.match(text, /Give `verify` the unit's scope, done conditions, verify commands, and existing suites that cover the scope\./);
  assert.match(text, /Use `--plan <slug> --unit <id> --round <n> --attempt 1 --title "verify <unit>: <short unit title>"` and dispatch as in step 5\./);
  assert.match(text, /Ask it to check the main flows and name the covering test file for each flow, or `none`\./);
  assert.match(text, /It writes no tests\./);
  assert.match(text, /Route device checks, local-tool retries, and screenshots as \[delegation\.md\]\(\.\.\/omt\/references\/delegation\.md#verification-and-devices\) says\./);
  assert.match(text, /After `VERIFIED`, apply `build\.qa`\./);
  assert.match(text, /With `planned`, dispatch `qa` only when the unit has lines in the plan's `## Tests` section\./);
  assert.match(text, /Give `qa` exactly those test lines and the test paths as its scope\./);
  assert.match(text, /Name the unit's scope paths in the task as the code under test\./);
  assert.match(text, /With `off` or no test lines, skip `qa`\./);
  assert.match(text, /With `build\.failureProofs: on`, require failure proofs in a private copy\./);
  assert.match(text, /With `build\.failureProofs: off`, skip them\./);
  assert.match(text, /Use the resulting `failureProofs: on` or `failureProofs: off` in the `qa` brief's `Tests:` line\./);
  assert.match(text, /Use the unit's current `--round` for every `qa` brief\./);
  assert.match(text, /If that round already has a `qa` dispatch, use the next `--attempt`\./);
  assert.match(text, /Dispatch and record `qa` as in step 5 after verification, never in parallel with it\./);
  assert.match(text, /Check that each new test file or case maps to a `## Tests` line for the unit\./);
  assert.match(text, /Send a test with no line to a `qa` fix task\./);
  assert.match(text, /Workers write no new tests and do not prove that tests can fail\./);
  assert.match(text, /On `VERIFIED` with evidence from verification and every required `qa` task, record the results\./);
  assert.match(text, /Run `omt plan mark <slug> <unit> done` and record `--status verified` for the unit\./);
  assert.match(text, /When the verify result names screenshots or recordings, show them in your message about the unit: one Markdown image per file with its absolute path, such as `!\[library, empty state\]\(\/abs\/path\/u3-library-empty\.png\)`, grouped by screen\./);
  assert.match(text, /`NOT VERIFIED` or `INCONCLUSIVE` moves it to step 9 after any local-tool retry, except for a busy lock, a failure in another unit's file, or a `NOT VERIFIED` failure while a work or qa task of another unit was active\./);
  assert.match(text, /For those exceptions, follow \[delegation\.md\]\(\.\.\/omt\/references\/delegation\.md#shared-builds\)\./);
  assert.match(text, /When you run the verify commands yourself, a pass with saved output counts as `VERIFIED`\./);
  assert.match(text, /A failure counts as `NOT VERIFIED` and goes to step 9, except for a busy lock, a failure in another unit's file, or a `NOT VERIFIED` failure while a work or qa task of another unit was active\. For those exceptions, follow \[delegation\.md\]\(\.\.\/omt\/references\/delegation\.md#shared-builds\)\./);
  assert.match(text, /Check-ins use `build\.checkpoint`\./);
  assert.match(text, /With `none`, continue without a check-in\./);
  assert.match(text, /With `unit`, stop after each verified unit\./);
  assert.match(text, /With `layer`, stop when every unit of the current dependency layer is done or blocked\./);
  assert.match(text, /With `layer`, skip a new check-in when a reopened unit is done again and its current layer already had its check-in\./);
  assert.match(text, /Before the stop, dispatch nothing new and wait for the active tasks of that unit or layer\./);
  assert.match(text, /Record their results without new dispatches\./);
  assert.match(text, /While a check-in waits, dispatch a stalled task's next attempt only after the owner replies\./);
  assert.match(text, /Show the verified units, their screenshots grouped by screen, open findings, and the next layer\./);
  assert.match(text, /Record the check-in under `Log` as waiting for the owner\./);
  assert.match(text, /With `unit`, add a unit verified while a check-in waits to that check-in\./);
  assert.match(text, /Show the added unit to the owner in a short follow-up message\./);
  assert.match(text, /One owner reply answers the check-in for every unit in it\./);
  assert.match(text, /At a check-in, delete the stall heartbeat only when no task is active\./);
  assert.match(text, /Keep it while a task is active\./);
  assert.match(text, /Delete it on any turn, including a wake or a tick, when no task is active and the check-in still waits\./);
  assert.match(text, /End the turn and wait for the owner\./);
  assert.match(text, /A wake, a goal continuation, or an `omt-loop` tick does not answer the check-in\./);
  assert.match(text, /Resume only after the owner replies with continue, steering, or an instruction to stop check-ins for this run\./);
  assert.match(text, /Continue authorizes one more unit or layer\./);
  assert.match(text, /Write the owner's answer under `Log` in the plan\./);
  assert.match(text, /After the owner replies, keep a retained stall heartbeat\./);
  assert.match(text, /Before you end the next turn with an active task, start a heartbeat only when none exists\./);
  assert.match(text, /Read that answer after a context reset and keep any instruction to stop check-ins for the rest of the run\./);
  assert.match(text, /Done when: the unit is marked done with a `verified` ledger entry, or it is in step 9\./);
  assert.match(text, /At a check-in, wait for the owner's answer before more work\./);
  assert.match(text, /Drop the others: a style preference, an input or a state that the plan rules out, or a case that cannot happen in the planned flow\./);
  assert.match(text, /Drop a missing-test finding unless the plan or the task names that test\./);
  assert.match(text, /Keep a CRAP finding when the profile asks for CRAP, with complexity, coverage, and CRAP values instead of a failure scenario\./);
  assert.match(text, /Send test-only findings to `qa` with the unit's approved test lines\./);
  assert.match(text, /Send product failures to the unit's fix role\./);
  assert.match(text, /Only `qa` proves that new tests can fail when `build\.failureProofs` is `on`\./);
  assert.match(text, /Apply `build\.oracle`: `heavy` runs the oracle for HEAVY only, `always` runs it for both tiers, and `off` skips it\./);
  assert.match(text, /When required, dispatch one `oracle` task over the whole change, with the objective, every done condition except those that the \[design exclusion\]\(#8-test\) of step 8 leaves out, and the scope paths without `docs\/design\/` \(or the base ref when the work is committed, with `docs\/design\/` excluded from its diff\)\./);
  assert.match(text, /Build it with `omt brief oracle --task-file - --title "oracle: <slug>" --plan <slug> --unit F2 --round <n> --attempt 1 --against auto --save --json`, and record the dispatch and the result as in steps 5 and 6\./);
  assert.match(text, /Keep an `F2` oracle item only when `build\.oracle` requires it for the run's tier\./);
  assert.match(text, /After plan creation and after a profile switch, edit the plan file's `## Final verification` list, including in a LIGHT plan\./);
  assert.match(text, /When an `F2` oracle item is required but missing, add `- \[ \] F2\. The oracle role approves the whole change\.`\./);
  assert.match(text, /When no oracle is required, remove the `F2` oracle line\./);
  assert.match(text, /Done when: every `D` and command-based `F` item has passed, and each required oracle returned `APPROVE` or the user has the open findings\./);
  assert.match(text, /Review, verify, qa, and oracle verdicts per unit, and each reopen\./);
  assert.match(text, /What the user can see: the latest screenshot or recording of each screen or flow that the change adds or changes, from the `EVIDENCE` lines of the verify and `ui` results, as Markdown images with absolute paths, grouped by screen\./);
});

test("delegation pins saved dispatch, fast mode, device routing, locks, and stalls", () => {
  const text = readFileSync(join(SKILLS_DIR, "omt", "references", "delegation.md"), "utf8");
  assert.match(text, /\| `task` \| the short file pointer from `omt brief --save --json`, or the rendered brief, at most 120,000 characters \|/);
  assert.match(text, /With the CLI: `omt brief <role> --task-file - --title "<role> <unit>: <short unit title>" --scope <p> --done <c> --verify <cmd> --plan <slug> --unit <id> --round <n> --attempt <n> --save --json`\./);
  assert.match(text, /It prints `\{ delegateTask, fallbacks, ledger \}`\./);
  assert.match(text, /In `plan` interaction mode, omit `--save` and keep the brief in `delegateTask\.task` without writing files or ledger entries\./);
  assert.match(text, /With `--save`, the full brief is in `<evidence>\/briefs\/<clientRequestId>\.md`\./);
  assert.match(text, /`delegateTask\.task` names that absolute file path\./);
  assert.match(text, /After dispatch, run the printed `ledger\.dispatched` line with only `<taskId>` replaced by the returned id\./);
  assert.match(text, /After a target change, update its provider and model to the target that returned the task\./);
  assert.match(text, /When you build a `plan` or `plan-review` brief, name the effective `workflow\.plan\.testLayers` value in the task text\./);
  assert.match(text, /Read it from `omt profile show --plan <slug> --json`, or `omt profile show <name> --json` before the plan exists, or `omt profile show --json` without a selected profile\./);
  assert.match(text, /Keep the fast options in `delegateTask\.target\.options` and in each fallback target\./);
  assert.match(text, /The CLI resolves `rung\.fast`, then `roles\.<role>\.fast`, then `models\.<id>\.fast`, then `false`\./);
  assert.match(text, /The default sets `models\.gpt-6\.1-sol\.fast` to `true`\./);
  assert.match(text, /A `true` value maps to `serviceTier: "priority"` or `fastMode: true` when the model offers that option\./);
  assert.match(text, /An explicit key in `rung\.options` wins over the fast mapping\./);
  assert.match(text, /With `fast: false`, the CLI adds no fast option\./);
  assert.match(text, /If fast mode is unavailable, keep the target and report the CLI note\./);
  assert.match(text, /See \[roles\.md\]\(roles\.md#fast-mode\) for capability and manual routing rules\./);
  assert.match(text, /The omt config sets the limits \(defaults in parentheses\): `maxParallel` \(6\), `maxTasksPerRun` \(24\), `maxDepth` \(1\), `maxReviewRounds` \(4\)\./);
  assert.match(text, /Read the profile's limits with `omt profile show --plan <slug> --json`\./);
  assert.match(text, /A plan header's `max-parallel` can only lower the profile's `maxParallel`\./);
  assert.match(text, /Read the selected profile's values as above\./);
  assert.match(text, /Only `verify` drives a device, a Simulator UI, a browser, or a computer\./);
  assert.match(text, /Use `omt brief verify` with the steps and expected results\./);
  assert.match(text, /Keep its routed target\./);
  assert.match(text, /The default chain is Claude Haiku 5\.5, then Claude Sonnet 5\.5, then Codex Sol\./);
  assert.match(text, /The Claude rungs come first because a Codex child could not reach the local device daemon\./);
  assert.match(text, /An edit role can delegate a device check to `verify` at any depth\./);
  assert.match(text, /A read-only role lists the check for the conductor to dispatch\./);
  assert.match(text, /When a `verify` task returns `INCONCLUSIVE` because it cannot reach a local tool, send the same task once to the next rung of another provider\./);
  assert.match(text, /Use the next attempt number and record that target's provider and model\./);
  assert.match(text, /If no such rung exists, report the blocker\./);
  assert.match(text, /After that one retry, send an unresolved result to the fix or stop step of the current workflow\./);
  assert.match(text, /Run one device pass per unit without duplicate checks\./);
  assert.match(text, /A `ui` worker's `verify` child takes only the screenshots for the worker's design comparison\./);
  assert.match(text, /The unit's step 8 `verify` task runs the behavior flows\./);
  assert.match(text, /Neither repeats the other's part\./);
  assert.match(text, /Give `qa` only the planned test lines after verification\./);
  assert.match(text, /`qa` writes tests and makes failure proofs when requested, while `verify` writes no tests\./);
  assert.match(text, /Keep parallel edit scopes disjoint in the same checkout\./);
  assert.match(text, /Run each shared build or test command as `omt lock run <name> \[--wait <seconds>\] -- <command>`\./);
  assert.match(text, /Run a command that the task wraps in `omt lock run` exactly as written\./);
  assert.match(text, /Use one lock name per shared resource\./);
  assert.match(text, /Use the lock for a command whose subprocesses end before the command ends\./);
  assert.match(text, /A command that leaves processes running after it exits, such as a dev server, watcher, or daemon, stays outside `omt lock run`\./);
  assert.match(text, /Make the units that use those processes serial with `omt plan limit <slug> 1`\./);
  assert.match(text, /If neither `flock` nor `lockf` is on `PATH`, the CLI warns and runs without a lock\./);
  assert.match(text, /Keep units with shared build state serial on that system\./);
  assert.match(text, /Retry a failed build or test only when the file is outside your scope and outside the task's named code under test\./);
  assert.match(text, /The file is the one where the error occurs, such as a file with a compile or load error, also when a test in your scope loads it\./);
  assert.match(text, /Wait 60 seconds and run the command once more\./);
  assert.match(text, /When it fails there again, report the command, the outside-scope file, and the message as another unit's state\./);
  assert.match(text, /For a failure in your scope or the named code under test, follow your result block\./);
  assert.match(text, /For `test` results, return `VERDICT: NOT VERIFIED` for that failure\./);
  assert.match(text, /When `omt lock run` exits 75, report the command, the lock name, and its message\./);
  assert.match(text, /Leave the lock to the conductor\./);
  assert.match(text, /For both reports: in `work` results, keep the `STATUS` that your own work earns and put the report under `OPEN`\./);
  assert.match(text, /For `test` results, including `verify` and `qa`, return `VERDICT: INCONCLUSIVE` and put the report under `FAILURES`\./);
  assert.match(text, /For other results, put the report under `NOTES`, or before the result block when it has no `NOTES`\./);
  const execute = readFileSync(join(SKILLS_DIR, "omt", "references", "roles", "execute.md"), "utf8");
  assert.match(execute, /`STATUS: BLOCKED` when something outside your control stops you: a missing file, a change needed outside Scope\. Say what you need under `OPEN`\./);
  const spec = readFileSync(join(SKILLS_DIR, "..", "docs", "spec.md"), "utf8");
  for (const source of [section(text, "## Shared builds"), section(spec, "### 15.2 ")]) {
    assert.match(source, /A busy lock or a failure in another unit's file is not a defect of the unit under test\./);
    assert.match(source, /Keep the unit in step 8 while you handle it\./);
    assert.match(source, /Apply these rules to a `verify` or `qa` result and to a verify command that you run yourself\./);
    assert.match(source, /When a busy lock or a failure in another unit's file makes `verify` or `qa` return `INCONCLUSIVE`, skip the retry on another provider\./);
    assert.match(source, /For a busy lock, run `omt lock list`\./);
    assert.match(source, /When `omt lock list` shows the lock as free, dispatch the next attempt with the same target, or run your own command again\./);
    assert.match(source, /Count that attempt toward the second busy lock\./);
    assert.match(source, /Treat the holder as a task of this run only when an active task of this run gave that command\./);
    assert.match(source, /For that holder, wait for the task to end\./);
    assert.match(source, /Then dispatch the next attempt with the same target, or run your own command again\./);
    assert.match(source, /For any other holder, stop it only when you own it or have permission\./);
    assert.match(source, /Otherwise ask the owner\./);
    assert.match(source, /Never take over or clear a held lock\./);
    assert.match(source, /After a second busy lock for the same unit and step, ask the owner\./);
    assert.match(source, /For a failure in another unit's file, or for a `NOT VERIFIED` result or a failed verify command of your own while a work or qa task of another unit was active, read `omt ledger list --plan <slug> --json`\./);
    assert.match(source, /Another unit's file is any file outside the failed task's scope and named code under test, also a file that no unit's scope contains\./);
    assert.match(source, /For your own command, use the unit's scope\./);
    assert.match(source, /Find the work and qa tasks of other units that were active while the failed attempt ran: dispatched before that attempt ended, with no terminal entry before it started\./);
    assert.match(source, /Wait until each of them has a terminal entry and every reopened unit that the unit under test depends on is done again\./);
    assert.match(source, /While a check-in awaits the owner's reply, also wait for the reply\./);
    assert.match(source, /Then dispatch the next attempt with the same target, or run your own command once more\./);
    assert.match(source, /Do this at most once per round for each of `verify`, `qa`, and your own command\./);
    assert.match(source, /Ask the owner instead when that retry is already used, or when a failure in another unit's file has no such task\./);
    assert.match(source, /Do not apply the step 9 relevance check or Reopen rule to a failure in another unit's file; the owner decides\./);
    assert.match(source, /Name the unit under test, the file, the command, and the message\./);
  }
  assert.match(text, /Before you end a turn with an active task and no heartbeat exists, call `schedule_task` with `schedule: \{"type":"interval","everyMs":600000\}`, bound to your thread\./);
  assert.match(text, /On each tick, read the effective profile and `omt ledger list --plan <slug>`\./);
  assert.match(text, /Use `omt profile show --plan <slug> --json` when the plan file exists\./);
  assert.match(text, /Otherwise use `omt profile show <name> --json` with the run's selected profile, or `omt profile show --json` without one\./);
  assert.match(text, /Use `workflow\.build\.stallMinutes` for the stall threshold, from 10 to 120 minutes\./);
  assert.match(text, /The task is stalled when the thread's `updatedAt` is older than `build\.stallMinutes` minutes\./);
  const stalls = section(text, "## Stalled tasks");
  assert.match(stalls, /When the thread has no result block, or you reject it, call `task_cancel`, record `--status interrupted --note "stalled"`, settle the child \(\[Releasing children\]\(#releasing-children\)\), and check the scope files for half-done edits\./);
  assert.match(stalls, /If a check-in waits, dispatch the next attempt with the same round only after the owner replies\./);
  assert.match(stalls, /Otherwise dispatch the next attempt with the same round\./);
  assert.match(stalls, /When the run ends, call `delete_scheduled_task` with the id\./);
  assert.match(stalls, /At a check-in or another stop for the owner, delete the heartbeat only when no task is active\./);
  assert.match(stalls, /Keep it while a task is active\./);
  assert.match(stalls, /Delete it on any turn, including a wake or a tick, when no task is active and the check-in still waits\./);
});

test("briefs pin the CLI, test policy, saved files, and device exception", () => {
  const text = readFileSync(join(SKILLS_DIR, "omt", "references", "brief.md"), "utf8");
  assert.match(text, /CLI: Run omt as <command>\./);
  assert.match(text, /Tests: <role's test policy; qa ends with failureProofs: on or failureProofs: off>/);
  assert.match(text, /Shared builds: <lock and retry rule>/);
  assert.ok(section(text, "## Layout").includes([
    "- <access line>",
    "- <delegation line>",
    "- <evidence line, edit roles only>",
    "- <plan-mode line, read-only roles only>",
    "- <children line, when the child may start children>",
    "- CLI: Run omt as <command>.",
    "- Tests: <role's test policy; qa ends with failureProofs: on or failureProofs: off>",
    "- You do not see the parent conversation. This brief is your full context. If you need something that is missing, say so in your final message.",
    "- Other agents may edit other files in this repository at the same time. Leave changes outside your scope alone. Do not commit, push, or create branches.",
    "- Processes: <process limits and session cleanup>",
    "- Shared files: <private-copy rule for failure proofs>",
    "- Shared builds: <lock and retry rule>",
    "- Devices: <device rule, except for verify>",
  ].join("\n")));
  assert.match(text, /At maximum depth for `verify` or a read-only role: `Delegation: you are at depth <d> of <max>\. Do all work yourself\. Start no subagents and no delegated tasks\.`/);
  assert.match(text, /At maximum depth for another edit role: ``Delegation: you are at depth <d> of <max>\. Do all work yourself\. Start no subagents and no delegated tasks, except `verify` tasks for device checks \(see Devices\)\.``/);
  assert.match(text, /With a plan or an explicit profile, append `For device checks, pass <selection> to omt brief\.`/);
  assert.match(text, /Below maximum depth, with a plan or an explicit profile: `Delegation: you are at depth <d> of <max>\. You may delegate with the T3 delegate_task tool\. For each child, pass <selection> --depth <d\+1>\[ --max-depth <max>\] to omt brief\.`/);
  assert.match(text, /Here `<selection>` contains `--plan <slug>` when set and `--profile <name>` when explicit\. Keep both flags when both were given\. Include `--max-depth <max>` only when the max differs from the effective config\./);
  assert.match(text, /Every brief has `CLI:`, `Tests:`, and `Shared builds:` lines\./);
  assert.match(text, /The `CLI:` line names `<project root>\/\.omt\/bin\/omt` when it exists, else `omt`\./);
  assert.match(text, /The `Tests:` line gives the role's test policy\./);
  assert.match(text, /For `qa`, it ends with `failureProofs: on` or `failureProofs: off` from `build\.failureProofs`\./);
  assert.match(text, /The `Shared builds:` line requires the task's exact lock command\./);
  const spec = readFileSync(join(SKILLS_DIR, "..", "docs", "spec.md"), "utf8");
  assert.match(spec, /`Shared builds:` requires the exact lock-wrapped command from the task\./);
  for (const source of [text, section(spec, "### 9.2 ")]) {
    assert.match(source, /Retry a failed build or test only when the file is outside your scope and outside the task's named code under test\./);
    assert.match(source, /The file is the one where the error occurs, such as a file with a compile or load error, also when a test in your scope loads it\./);
    assert.match(source, /Wait 60 seconds and run the command once more\./);
    assert.match(source, /When it fails there again, report the command, the outside-scope file, and the message as another unit's state\./);
    assert.match(source, /For a failure in your scope or the named code under test, follow your result block\./);
    assert.match(source, /For `test` results, return `VERDICT: NOT VERIFIED` for that failure\./);
    assert.match(source, /When `omt lock run` exits 75, report the command, the lock name, and its message\./);
    assert.match(source, /Leave the lock to the conductor\./);
    assert.match(source, /For both reports: in `work` results, keep the `STATUS` that your own work earns and put the report under `OPEN`\./);
    assert.match(source, /For `test` results, including `verify` and `qa`, return `VERDICT: INCONCLUSIVE` and put the report under `FAILURES`\./);
    assert.match(source, /For other results, put the report under `NOTES`, or before the result block when it has no `NOTES`\./);
  }
  assert.match(text, /Workers write no new test file or case\./);
  assert.match(text, /A worker updates an existing test only when its change breaks the test and reports that update under `NOTES`\./);
  assert.match(text, /Give `qa` only the unit's approved `## Tests` lines\./);
  assert.match(text, /Give `verify` the checks and main flows without new tests\./);
  assert.match(text, /Read \[delegation\.md\]\(delegation\.md#verification-and-devices\) for device routing and \[delegation\.md\]\(delegation\.md#shared-builds\) for lock handling\./);
  assert.match(text, /  --plan http-retry --unit U2 --round 1 --attempt 1 --save --json/);
  assert.match(text, /Saved brief \(abridged\):/);
  assert.match(text, /Start no subagents and no delegated tasks, except `verify` tasks for device checks \(see Devices\)\./);
  assert.match(section(text, "## Example"), /For device checks, pass --plan http-retry to omt brief\./);
  assert.match(text, /CLI: Run omt as omt\./);
  assert.match(text, /Tests: write no new test file and no new test case, and do not prove that tests can fail\./);
  assert.match(text, /Update an existing test only when your change breaks it, and say so under NOTES\./);
  assert.match(text, /Shared builds: run a command that the task wraps in `omt lock run` exactly as written\./);
  assert.ok(section(text, "## Example").includes([
    "- You do not see the parent conversation. ...",
    "- Other agents may edit other files in this repository at the same time. ...",
    "- Processes: ...",
    "- Shared files: ...",
    "- Shared builds: run a command that the task wraps in `omt lock run` exactly as written. ...",
    "- Devices: ...",
  ].join("\n")));
  assert.match(text, /With `--save --json`, the full brief is in `<evidence>\/briefs\/omt:http-retry:U2:execute:r1:a1\.md`\./);
  assert.match(text, /The JSON output has a short `delegateTask\.task` that names that file, plus `clientRequestId` `omt:http-retry:U2:execute:r1:a1`\./);
  assert.match(text, /Run its `ledger\.dispatched` line with the returned task id in place of `<taskId>`\./);
});

test("omt routes pull request reviews to pr-review and lists the profile commands", () => {
  const text = readSkill("omt");
  assert.match(text, /For a pull request review, load `omt-review` with `omt-review --profile pr-review <number>`\./);
  assert.match(text, /\| `omt brief <role> --task-file - --title "<role> <unit>: <title>" --scope <p> --done <c> --verify <cmd> --plan <slug> --unit <id> --round <n> --attempt <n> \[--against <provider\\\|driver\\\|auto>\] --save --json` \| `\{ delegateTask, fallbacks, ledger \}`; the full brief is in a file and `delegateTask\.task` names it \|/);
  assert.match(text, /\| `omt profile list` \| available workflow profiles \|/);
  assert.match(text, /\| `omt profile show \[<name>\] \[--plan <slug>\] --json` \| the effective `profile`, `source`, `workflow`, `limits`, `roles`, and `models` \|/);
  assert.match(text, /\| `omt plan new <slug> \[--light\] \[--profile <name>\]` \| path of a new plan file under `\.omt\/plans\/`; `--light` leaves out the `F2` oracle item \|/);
  assert.match(text, /\| `omt plan profile <slug> <name\\\|none>` \| switches the plan's profile; `none` removes the plan override \|/);
  assert.match(text, /\| `omt lock run <name> \[--wait <seconds>\] -- <command>` \| runs a command under a shared build lock and returns its exit code \|/);
  assert.match(text, /\| `omt lock list` \| each lock's state and the holder of a held lock \|/);
  assert.match(text, /\| `omt config show` \| the merged config before profile selection, including limits and `visuals` \|/);
  assert.match(text, /Pass `delegateTask` to `delegate_task` unchanged\./);
  assert.match(text, /Record the dispatch with the printed `ledger\.dispatched` line after replacing `<taskId>`\./);
  assert.match(text, /Use \[delegation\.md\]\(references\/delegation\.md#getting-the-arguments\) for retries and plan-mode dispatch\./);
});

test("omt-loop reloads profiles and waits at owner check-ins", () => {
  const text = readSkill("omt-loop");
  assert.match(text, /Before any dispatch, read `omt profile show --plan <slug> --json` and the owner's check-in answers under `Log` in the plan\./);
  assert.match(text, /Run step 3 once per goal continuation turn\./);
  assert.match(text, /Record the schedule id, prompt, and cadence in the plan's log\./);
  assert.match(text, /Read `omt profile show --plan <slug> --json` and the owner's check-in answers under `Log` before any dispatch\./);
  assert.match(text, /Follow `build\.checkpoint` \(`none`, `layer`, or `unit`\) in `omt-ulw` step 8\./);
  for (const part of [section(text, "### 2. "), section(text, "### 3. ")]) {
    assert.match(part, /While a check-in awaits an owner reply:/);
    assert.match(part, /Write the wait under `Log` without a `loop` ledger entry\./);
    assert.match(part, /A tick that waits for the owner's check-in answer does not count toward the cap\./);
    assert.match(part, /Delete this loop's schedule if one exists\./);
    assert.match(part, /Under a goal, ask the owner to type `\/goal clear` while the check-in waits\./);
    assert.match(part, /Under a goal, ask the owner to start `\/goal` again with the same objective after the answer\./);
    assert.match(part, /End the turn without new dispatches\./);
    assert.match(part, /Resume only after the owner's reply\./);
    assert.match(part, /After the owner replies to a scheduled loop, create its schedule again with the same prompt and cadence\./);
    assert.match(part, /- Resume only after the owner's reply\.\n\nAfter the owner replies to a scheduled loop/);
    assert.match(part, /If a check-in now awaits an owner reply, apply the check-in rules above instead of recording a tick\./);
    assert.match(part, /Otherwise record the tick: `omt ledger add --plan <slug> --role loop --status completed --note "tick <n>: exit <code>, <action>"`\./);
  }
  assert.match(text, /Done when: the tick has a ledger entry and its dispatches are recorded, or the loop waits at an owner check-in\./);
});

test("conductors and delegating children settle each finished child", () => {
  const references = join(SKILLS_DIR, "omt", "references");
  const delegation = readFileSync(join(references, "delegation.md"), "utf8");
  const release = section(delegation, "## Releasing children");
  assert.match(release, /The idle release never reaches the Codex native subagents of a child; only a settle releases them\./);
  assert.match(release, /In `plan` interaction mode you record nothing, but you settle all the same\. After `task_cancel`, settle the child after its `cancelled` or `interrupted` entry\. After a `mode: "wait"` return, call `task_status` first/);
  assert.match(release, /- Condition: `status` is `completed`, `failed`, `cancelled`, or `interrupted`, `hasPendingChildRuns` is `false`, and `hasPendingQuestion` is `false`\. You will not send that child a message with `t3_thread_send`\. A new task for the same unit is not a message to the child\./);
  assert.match(release, /call `t3_thread_organize` with `action: "settle"` and `threadId` set to the child's `childThreadId`/);
  assert.match(release, /Never pass the `taskId`\./);
  assert.match(release, /- When the Condition is false, skip the settle\. A settle error never stops the run and never triggers an action from \[Failure codes\]\(#failure-codes\)\. Do not cancel a child to make the settle pass\. The sweep below tries again\./);
  assert.match(release, /- First check: before the first settle of a run, run `git rev-parse --git-dir --git-common-dir`\. When it prints two different paths, you work in a git worktree: settle no child in this run\./);
  assert.match(release, /but only when the provider closes the thread: Codex closes it after its unload delay\. A later task does not use processes that an earlier child left running, and does not count on them being gone; it starts its own\./);
  assert.match(release, /- Settle only your children and their children\. Never settle your own thread, a top-level thread \(an `omt-swarm` track, or a thread from `t3_thread_launch` or `create_threads`\), or any other thread\. Do not use `action: "archive"`\./);
  assert.match(release, /A child that starts children, such as a `verify` task for a device check, settles them itself; its brief says so\. A cancelled or failed child cannot, so the sweep settles its children\./);
  assert.match(release, /- Sweep: run it at your next wake after a skipped or failed settle, after each `task_cancel`, before you stop the run to ask the owner, and at the end of the run before the report\. When another skill called your skill, skip the sweep; the caller runs it\./);
  assert.match(release, /1\. Take your task ids from `omt ledger list --plan <slug> --json`, or the ids that you kept in `plan` mode\. Call `task_status` for each\. Skip an id that returns `task_not_found`: another thread started that task\. It is not a lost task, so do not dispatch it again\./);
  assert.match(release, /2\. A child is done when the Condition above holds\. Skip a child that is not done, and everything below it\./);
  assert.match(release, /3\. Call `t3_thread_list` with `includeSubagents: true`, and again with `cursor` set to the returned `nextCursor` until `nextCursor` is `null`\. Settle each done child whose thread shows `settled: false`\. Then settle each thread below a done child, linked by `relationshipToParent: "subagent"` and `parentThreadId`, that shows `settled: false` and `status` `completed`, `failed`, `cancelled`, or `interrupted`\./);
  assert.match(section(delegation, "## Your interaction mode"), /Settle each child after you read its result \(\[Releasing children\]\(#releasing-children\)\)\./);
  const stalls = section(delegation, "## Stalled tasks");
  assert.match(stalls, /settle the child \(\[Releasing children\]\(#releasing-children\)\)/);
  assert.match(stalls, /When the thread has a result block and you accept it, it counts as the result: check its claims as for any result, record it, and continue at step 6 of your skill\. When that thread still runs, call `task_cancel` for it after you record the result, and record nothing more; the sweep after that cancel settles it\./);
  const recording = section(readFileSync(join(references, "results.md"), "utf8"), "## Recording");
  assert.match(recording, /- Release: after the terminal entry, settle the child as \[delegation\.md\]\(delegation\.md#releasing-children\) says\. In `plan` interaction mode, settle it after you read the result\./);
  const brief = readFileSync(join(references, "brief.md"), "utf8");
  assert.match(brief, /- Children, except at maximum depth for `verify` and for plan-mode roles: ``Children: after you read a child's result, settle the child with the T3 `t3_thread_organize` tool/);
  const ulw = readSkill("omt-ulw");
  assert.match(section(ulw, "### 6. On wake"), /Then settle the child \(\[delegation\.md\]\(\.\.\/omt\/references\/delegation\.md#releasing-children\)\)\./);
  assert.match(ulw, /the run is stalled: run the settle sweep \(\[delegation\.md\]\(\.\.\/omt\/references\/delegation\.md#releasing-children\)\), then stop/);
  assert.match(ulw, /To stop: run `omt plan mark <slug> <unit> blocked`, run the settle sweep \(\[delegation\.md\]\(\.\.\/omt\/references\/delegation\.md#releasing-children\)\), and ask the user/);
  const sweep = /Before you report, run the settle sweep \(\[delegation\.md\]\(\.\.\/omt\/references\/delegation\.md#releasing-children\)\)\./;
  for (const [name, heading] of [["omt-ulw", "### 11. Report"], ["omt-review", "### 6. Write and report"], ["omt-review", "### PR 10. Report"], ["omt-research", "### 4. Synthesize"], ["omt-plan", "### 5. Hand off"], ["omt-design", "### 6. Hand off"]] as const) {
    assert.match(section(readSkill(name), heading), sweep, `${name} ${heading}`);
  }
  assert.match(section(readSkill("omt-review"), "### PR 11. Offers"), /Apply the PR step 3 watch rule before handing back the work, and run the settle sweep \(\[delegation\.md\]\(\.\.\/omt\/references\/delegation\.md#releasing-children\)\)\./);
  const plan = readSkill("omt-plan");
  assert.match(plan, /one narrow question each, then end the turn\. On wake, read the results and record them \(\[results\.md\]\(\.\.\/omt\/references\/results\.md#recording\)\)\./);
  assert.match(plan, /Tell the worker to edit that file and not to run `omt plan new`\. On wake, read its result and record it \(\[results\.md\]\(\.\.\/omt\/references\/results\.md#recording\)\)\./);
  const loop = readSkill("omt-loop");
  assert.match(loop, /3\. Read every finished task with task_status, record it, and settle its child thread as the Releasing children section of the omt skill's references\/delegation\.md says, then follow the omt-ulw steps/);
  assert.match(loop, /5\. Stop: record the tick as in 4\. Run the settle sweep from the Releasing children section of the omt skill's references\/delegation\.md\. Call list_scheduled_tasks/);
  assert.match(loop, /3\. Read finished tasks first, record them, and settle their children \(\[delegation\.md\]\(\.\.\/omt\/references\/delegation\.md#releasing-children\)\), then continue/);
  assert.match(section(loop, "### 4. Stop"), /Run the settle sweep \(\[delegation\.md\]\(\.\.\/omt\/references\/delegation\.md#releasing-children\)\)\./);
});
