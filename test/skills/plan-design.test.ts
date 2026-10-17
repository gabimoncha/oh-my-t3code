import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SKILLS_DIR, readSkill, section } from "./shared.ts";

test("each mode-check step calls t3_thread_configuration, and no skill reads modes from orchestrator_capabilities (plan-design)", () => {
  const modeSteps: Record<string, string> = {
    "omt-plan": "### 0. ",
    "omt-design": "### 0. ",
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

test("delegation.md has a branch check, and both step 0s link to it (plan-design)", () => {
  for (const name of ["omt-plan", "omt-design"]) {
    assert.match(section(readSkill(name), "### 0. "), /\(\.\.\/omt\/references\/delegation\.md#branch-check\)/, name);
  }
});

test("omt-plan asks in one message after independent work and runs one plan-review per family in round 1", () => {
  const text = readSkill("omt-plan");
  const ask = section(text, "### 2. ");
  assert.match(ask, /finish all work that does not depend on the answers/);
  assert.match(ask, /ask every owner decision in one message/);
  const rounds = section(text, "### 4. ");
  for (const fragment of ["--unit plan.claude --against codex", "--unit plan.codex --against claudeAgent", "do not fall back"]) {
    assert.ok(rounds.includes(fragment), fragment);
  }
  assert.doesNotMatch(rounds, /omt ledger stats(?! --plan <slug>)/);
  assert.doesNotMatch(text, /\.omt\/plans\/<slug>\.md/);
});

test("omt-plan reads the effective profile before a plan exists and keeps it in a new plan", () => {
  const plan = readSkill("omt-plan");
  const explore = section(plan, "### 1. ");
  assert.match(explore, /When the plan file exists, run `omt profile show --plan <slug> --json`\./);
  assert.match(explore, /Before the plan file exists, use `omt profile show <name> --json` for an explicit profile name\./);
  assert.match(explore, /When neither a plan file nor a profile name exists, run `omt profile show --json`\./);
  assert.match(explore, /Keep the returned `profile` as `<name>` for later commands\./);
  assert.match(section(plan, "### 3. "), /Otherwise run `omt plan new <slug> --title "<title>" --profile <name>`/);
  assert.match(section(plan, "### 3. "), /For a large plan, you may dispatch a `plan` task to fill that file\./);
  assert.match(section(plan, "### 3. "), /Before you dispatch a `plan` task, create any missing plan file yourself with `omt plan new <slug> --title "<title>" --profile <name>`\./);
  assert.match(section(plan, "### 3. "), /In every `plan` task, name the plan path and state that the file already exists\./);
  assert.match(section(plan, "### 3. "), /Tell the worker to edit that file and not to run `omt plan new`\./);
  assert.match(section(plan, "### 3. "), /Paste the output of `omt roles --plan <slug>` under `Roles`\./);
});

test("plan and design use the selected profile for routing and dispatch limits before a plan file exists", () => {
  const plans = [
    ["omt-plan", "<slug>"],
    ["omt-design", "<ledger plan>"],
  ] as const;
  for (const [name, planId] of plans) {
    const frame = section(readSkill(name), "### 1. ");
    assert.match(frame, /With a selected profile and no plan file for the `--plan` id:/, name);
    assert.match(frame, /Pass `--profile <name>` to every `omt brief`, `omt roles`, and `omt route` command\./, name);
    assert.ok(frame.includes(`Before each dispatch, run \`omt ledger stats --plan ${planId}\` and \`omt profile show <name> --json\`.`), name);
    assert.match(frame, /Dispatch only when the ledger's `dispatched` is below the profile's `limits\.maxTasksPerRun` and `active` is below `limits\.maxParallel`\./, name);
    assert.match(frame, /Use this check in place of `can dispatch`\./, name);
  }
});

test("plan and design dispatch steps use the step 1 check without a plan file", () => {
  const steps = [
    ["omt-plan", "### 4. ", "<slug>"],
    ["omt-design", "### 2. ", "<ledger plan>"],
  ] as const;
  for (const [name, heading, planId] of steps) {
    const dispatch = section(readSkill(name), heading);
    assert.ok(dispatch.includes(`Before each dispatch, run \`omt ledger stats --plan ${planId}\`.`), name);
    assert.match(dispatch, /When a plan file exists, dispatch only while it reports `can dispatch: yes`\./, name);
    assert.match(dispatch, /Otherwise, use the step 1 dispatch check\./, name);
  }
  const rounds = section(readSkill("omt-plan"), "### 4. ");
  assert.match(rounds, /Record the dispatch with `--task-id`, `--provider`, and `--model`, and end the turn\./);
  assert.match(rounds, /Apply the same dispatch check to the second task\./);
  assert.match(rounds, /When the check passes, dispatch the second task before you end the turn\./);
  assert.match(rounds, /When the check fails, wait for the first task to finish\./);
  assert.match(rounds, /Repeat the check before the second dispatch\./);
});

test("omt-plan asks the owner to approve the test lines and reads the profile's test policy", () => {
  const plan = readSkill("omt-plan");
  const ask = section(plan, "### 2. ");
  assert.match(ask, /Include the proposed `## Tests` lines in that message\./);
  assert.match(ask, /Ask the owner to approve the test list with the plan\./);
  assert.match(ask, /Give a reason for each proposed line outside `plan\.testLayers`\./);
  const write = section(plan, "### 3. ");
  assert.match(write, /Read the effective profile again with the step 1 command before you fill `## Tests` or build a `plan` task\./);
  assert.match(write, /Read `workflow\.plan\.testLayers` as `plan\.testLayers` and `workflow\.build\.qa` as `build\.qa`\./);
  assert.match(write, /Name the effective `plan\.testLayers` and `build\.qa` values in every `plan` task\./);
  assert.match(write, /When `build\.qa` is `off`, leave `## Tests` empty\./);
  assert.match(write, /When `build\.qa` is `planned`, fill `## Tests` top-down with the owner's approved lines\./);
  assert.match(write, /Start with e2e tests of the main user flows of each vertical slice that `verify` can also walk\./);
  assert.match(write, /Then add integration cases that e2e skips, followed by unit cases\./);
  assert.match(write, /Add other test kinds only when the owner asks\./);
  assert.match(write, /Propose only the layers in `plan\.testLayers` without an owner request\./);
  assert.match(write, /Keep a line in another layer only with its reason and the owner's approval\./);
  assert.match(write, /Use one e2e test per main flow\./);
  assert.match(write, /Keep edge cases out of the e2e lines\./);
  assert.match(write, /Write each `## Tests` line as `- <layer> <unit>: <flow or case>\. File: <path>\. Reason: <why>\.`/);
  assert.match(write, /An empty `## Tests` section means no new tests\./);
});

test("omt-plan locks shared-build verify commands with one name per resource", () => {
  const write = section(readSkill("omt-plan"), "### 3. ");
  assert.match(write, /Name each shared resource in the plan, such as a build folder, a generated project, a simulator, or a dev-server port\./);
  assert.match(write, /Write each verify command that uses shared build state as `omt lock run <resource> -- <command>`\./);
  assert.match(write, /Use the same `<resource>` for commands that share that state\./);
  assert.match(write, /Keep units parallel for shared build state alone when a lock tool exists and the command leaves no process running after it exits\./);
});

test("omt-plan serializes shared builds when neither flock nor lockf exists", () => {
  const write = section(readSkill("omt-plan"), "### 3. ");
  assert.match(write, /Check for a lock tool with `command -v flock \|\| command -v lockf`\./);
  assert.match(write, /When neither tool exists, run `omt plan limit <slug> 1` for a plan with shared build state and say why\./);
});

test("omt-plan serializes commands that leave processes running after they exit", () => {
  const write = section(readSkill("omt-plan"), "### 3. ");
  assert.match(write, /When a command leaves processes running after it exits, run that command outside `omt lock`\./);
  assert.match(write, /When a unit uses that command, run `omt plan limit <slug> 1` for the whole plan and say why in the plan\./);
  assert.equal([...write.matchAll(/omt plan limit <slug> 1/g)].length, 2);
});

test("omt-plan selects review rounds from plan.review and passes the effective test layers", () => {
  const rounds = section(readSkill("omt-plan"), "### 4. ");
  assert.match(rounds, /Run `omt profile show --plan <slug> --json` before each round\./);
  assert.match(rounds, /Before the plan file exists, use `omt profile show <name> --json` instead\./);
  assert.match(rounds, /Read `workflow\.plan\.review` as `plan\.review` and `limits\.maxReviewRounds` as `maxReviewRounds`\./);
  assert.match(rounds, /For `two-families` or `one`, run up to `maxReviewRounds` rounds \(default 3\)\./);
  assert.match(rounds, /Name the effective `plan\.testLayers` value in every `plan-review` task\./);
  assert.match(rounds, /With `plan\.review=two-families`, round 1 has two tasks, one per family:/);
  assert.match(rounds, /With `plan\.review=one`, round 1 has one task: `--unit plan --against <the plan author's provider>`\./);
  assert.match(rounds, /From round 2, both values use one task: `--unit plan --against <the plan author's provider>`\./);
  assert.match(rounds, /With `one`, use a reviewer from the other family in every round\./);
  assert.match(rounds, /If no reviewer from the other family can run, stop and tell the user\./);
  assert.match(rounds, /With `two-families` in round 1, run `omt ledger stats --plan <slug>` again after you record the first dispatch\./);
  assert.match(rounds, /Round 1: the frozen blocker list is the union of the reviewers' blocking findings, without duplicates\./);
  assert.match(rounds, /With `two-families`, round 1 approves only when both reviewers approve\./);
  assert.match(rounds, /With `one`, round 1 approves when its reviewer approves\./);
});

test("omt-plan uses owner approval without a plan-review task and keeps the handoff", () => {
  const plan = readSkill("omt-plan");
  const rounds = section(plan, "### 4. ");
  assert.match(rounds, /When `plan\.review` is `owner`, ask the owner to approve the plan and its `## Tests` list\./);
  assert.match(rounds, /Dispatch no `plan-review` task for this value\./);
  assert.match(rounds, /After the owner approves, go to step 5\./);
  assert.match(rounds, /In plan mode, write the temp plan file from item 1 before the handoff\./);
  assert.match(rounds, /Done when: a round returned `APPROVE`, the owner approved under `plan\.review=owner`, or the round count reached `maxReviewRounds` and the open blockers are in your report\./);
  assert.match(section(plan, "### 5. "), /When `omt-ulw` called this skill and step 4 has approval from the owner or a review round \(approval with notes counts\), return to its step 5 with the plan slug\./);
});

test("the design and ui personas exist, and no model reviews design artifacts (plan-design)", () => {
  const design = readSkill("omt-design");
  assert.doesNotMatch(design, /omt brief review/);
  assert.doesNotMatch(design, /omt brief oracle/);
  assert.match(design, /--unit DS<k>/);
  assert.match(section(readSkill("omt-plan"), "### 3. "), /plan an `omt-design` step before those units/);
});

test("the design check runs before any ui dispatch, also after the omt-plan hand-off (plan-design)", () => {
  const handOff = section(readSkill("omt-plan"), "### 5. ");
  assert.match(handOff, /return to its step 5 with the plan slug\. Step 5 starts with the design check/);
});

test("omt-plan estimates the task budget from the profile, ui units, and planned tests", () => {
  const text = readSkill("omt-plan");
  const ask = section(text, "### 2. ");
  assert.match(ask, /Use the effective profile from step 1 for the estimate\./);
  assert.match(ask, /Read `workflow\.build\.review` as `build\.review`\./);
  assert.match(ask, /Count 5 tasks per unit for every profile, or 4 when `build\.review` is `first-round` or `off`\./);
  assert.match(ask, /This gives 5 tasks per unit for `normal` and 4 for `prototype`\./);
  assert.match(ask, /Start with the tasks the plan already used \(`dispatched` in `omt ledger stats --plan <slug>`\)\./);
  assert.match(ask, /Add 4 for the plan-review rounds and the per-unit estimate\./);
  assert.match(ask, /Add 1 more per `ui` unit and 1 more per unit with `## Tests` lines\./);
  assert.match(ask, /Add 3 for the final gate and 5 when the plan has an `omt-design` step\./);
  assert.match(ask, /Round the sum up to a multiple of 10\./);
  assert.match(section(text, "### 3. "), /run `omt plan limit <slug> --tasks <n>`/);
});

test("omt-plan hashes the plan after every edit", () => {
  const rounds = section(readSkill("omt-plan"), "### 4. ");
  assert.match(rounds, /Make every plan edit first, `omt plan limit` included\. Then compute the hash/);
  assert.match(rounds, /After any edit to the plan, header edits included, compute the hash again before the next brief\./);
});

test("omt-plan shows the final plan as a page unless visuals.plan is off, and every plan has a summary (plan-design)", () => {
  const plan = readSkill("omt-plan");
  const handOff = section(plan, "### 5. ");
  assert.match(handOff, /Show the plan to the owner first, also when `omt-ulw` called this skill\./);
  assert.match(handOff, /Run `omt config show` and read `visuals\.plan`\. When it is `true` and you have the T3 `html_render` tool, run the `omt-show` skill with the plan slug/);
  assert.match(handOff, /Otherwise, write the `## Summary` text in full in the reply, also when `omt-show` could not show the page\./);
  assert.match(section(plan, "### 3. "), /Fill `## Summary` last, by the summary rule in \[roles\/plan\.md\]/);
});

test("omt-show builds the page with omt visual and shows it with html_render (plan-design)", () => {
  const show = readSkill("omt-show");
  assert.match(section(show, "### 2. "), /omt visual --plan <slug> --spec - --json <<'EOF'/);
  assert.match(section(show, "### 2. "), /In `plan` mode, write no file in the project: add `--out "\$TMPDIR\/omt-<slug>-page\.html"`/);
  assert.match(section(show, "### 3. "), /Call `html_render` with the exact page text as `html`, the page title as `title`, and `2000` as `height`\./);
  assert.match(section(show, "### 3. "), /When the harness has no `html_render`, or the call fails, the page file is the result\./);
});

test("omt-design reads the profile with a plan file or a ledger-only id", () => {
  const design = readSkill("omt-design");
  assert.match(design, /Dispatches a design task with the profile's variant count in a new Paper file/);
  const frame = section(design, "### 1. ");
  assert.match(frame, /When the ledger plan has a plan file, run `omt profile show --plan <ledger plan> --json`\./);
  assert.match(frame, /When the ledger plan has no plan file, use `omt profile show <name> --json` for an explicit profile name\./);
  assert.match(frame, /When neither a plan file nor a profile name exists, run `omt profile show --json`\./);
  assert.match(frame, /Keep the returned `profile` as `<name>` for later commands\./);
  assert.match(frame, /Read `limits\.maxReviewRounds` as `maxReviewRounds`\./);
  assert.match(section(design, "### 2. "), /When T3 refuses its rung, or `omt roles --plan <ledger plan>` reports `design` as `unavailable`, stop and tell the owner which target failed and why\./);
});

test("omt-design uses design.variants per screen in a new Paper file and asks for a pick per screen (plan-design)", () => {
  const design = readSkill("omt-design");
  const variants = section(design, "### 2. ");
  assert.match(variants, /Read the effective profile again with the step 1 command before each design pass\./);
  assert.match(variants, /Read `workflow\.design\.variants` as `design\.variants`\./);
  assert.match(variants, /Use `design\.variants` as the number of distinct variants of each screen in the task\./);
  assert.match(variants, /Ask for a screenshot of every variant\./);
  assert.match(variants, /The task carries the frame from step 1\./);
  assert.match(variants, /When the owner asked for another count, use that count\./);
  assert.match(section(design, "### 2. "), /make a new Paper file named after the project/);
  assert.match(section(design, "### 3. "), /Group the screenshots by screen, with one line on each variant/);
  assert.match(section(design, "### 3. "), /The owner may mix variants across screens\./);
});

test("omt-design keeps design artifacts and visual-match conditions out of verify tasks", () => {
  const handOff = section(readSkill("omt-design"), "### 6. ");
  assert.match(handOff, /The `verify` task of such a unit gets no `docs\/design\/` paths and no visual-match conditions\./);
  assert.match(handOff, /The `ui` task and the owner compare the result with the design\./);
});

test("omt-plan keeps the real-data done condition (plan-design)", () => {
  assert.match(section(readSkill("omt-plan"), "### 3. "), /its done condition includes a check on an input shaped like real data/);
});
