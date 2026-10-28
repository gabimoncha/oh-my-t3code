import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SKILLS_DIR, readSkill, section } from "./shared.ts";

const swarm = (): string => readSkill("omt-swarm");

test("omt-swarm takes a plan file and stops without one", () => {
  const text = section(swarm(), "### 1. Read the plan");
  assert.match(text, /When no plan exists, tell the user to run `omt-plan` first, or `omt-grill` and then `omt-plan`\. Then stop\./);
  assert.match(swarm(), /Swarm asks no question batches and runs no plan review\./);
});

test("omt-swarm splits the plan into tracks with disjoint scopes and does not build", () => {
  const text = section(swarm(), "### 2. Split");
  assert.match(text, /Two tracks share no file\./);
  assert.match(text, /omt plan new <slug>-<track> --light/);
  assert.match(swarm(), /You do not build\./);
});

test("omt-swarm approves and commits the design before the split, and tracks only cite it", () => {
  const split = section(swarm(), "### 2. Split");
  assert.match(split, /Run the `omt-ulw` step 6 design check in the main thread before the split\./);
  assert.match(split, /If `omt-design` is required, run it and get the owner's approval\./);
  assert.match(split, /Commit the approved design spec .* before you record `<base>`, so the spec is in `<base>`\./);
  assert.match(split, /Tracks only cite the approved spec\. A track does not run `omt-design`\./);
  const launch = section(swarm(), "### 3. Launch");
  assert.match(launch, /Cite the approved design spec in `<base>`\. Do not run `omt-design`\. The main thread completed the step 6 design check before the split\./);
});

test("omt-swarm launches each track with t3_thread_launch to run omt-ulw steps 7 to 12 with no push and no PR", () => {
  const text = section(swarm(), "### 3. Launch");
  assert.match(text, /t3_thread_launch/);
  assert.match(text, /"type": "worktree", "baseRef": "<base>", "branch": "omt\/<slug>\/<track>"/);
  assert.match(text, /Then run steps 7 to 12 of the `omt-ulw` skill for the units of plan `<slug>-<track>` only\./);
  assert.match(text, /Do not push\. Do not open a PR\. The main thread owns the PR\./);
  assert.match(text, /--role swarm --round 1 --attempt 1 --status dispatched --note <threadId>/);
});

test("omt-swarm waits for tracks with t3_thread_wait and has no heartbeat", () => {
  const text = section(swarm(), "### 4. Wait");
  assert.match(text, /`t3_thread_wait` with `threadId`, `untilDelegatedWorkSettled: true`/);
  assert.doesNotMatch(swarm(), /schedule_task.*(?:interval|everyMs)|update_scheduled_task|delete_scheduled_task|heartbeat for plan/);
  assert.doesNotMatch(swarm(), /watch_pull_request|list_thread_pull_requests/);
});

test("omt-swarm reviews all track diffs before the merge and commits fixes on track branches", () => {
  const review = section(swarm(), "### 5. Review before the merge");
  assert.match(review, /Dispatch one `review` child over all track diffs\. It runs on the family that is not yours\./);
  assert.match(review, /git diff <base>\.\.\.omt\/<slug>\/<track>/);
  assert.match(review, /--against <your family>/);
  assert.match(review, /Leave the fixes uncommitted\./);
  const fix = section(swarm(), "### 6. Read the fix diff and fix");
  assert.match(fix, /git -C <track worktree> diff/);
  assert.match(fix, /Commit the accepted fixes on the track branch/);
  assert.match(fix, /send the finding to that track with `t3_thread_send`/);
});

test("omt-swarm merges the track branches and sends deep conflicts back with t3_thread_send", () => {
  const text = section(swarm(), "### 7. Merge");
  assert.match(text, /git merge --no-ff omt\/<slug>\/<track>/);
  assert.match(text, /When a conflict needs deep knowledge of one track's code/);
  assert.match(text, /t3_thread_send/);
});

test("omt-swarm runs one QA child on the merged code with at most 2 re-runs", () => {
  assert.match(section(swarm(), "### 8. QA"), /Dispatch one `qa` child on the merged code\./);
  assert.match(section(swarm(), "### 9. Fix failed checks"), /Run at most 2 QA re-runs\./);
});

test("omt-swarm opens the PR by the Git actions rules and reports each track", () => {
  const text = section(swarm(), "### 10. Finish");
  assert.match(text, /push and open or update the PR, each by the \[Git actions\]\(\.\.\/omt\/references\/delegation\.md#git-actions\) rules/);
  assert.match(text, /\(\.\.\/omt\/references\/delegation\.md#pull-requests\)/);
  assert.match(text, /Each track: its units, its branch, its commit, and its result/);
});

test("omt-swarm has a Done when line for each step and no em dash", () => {
  const text = swarm();
  const steps = text.split("\n### ").slice(1);
  assert.ok(steps.length >= 11);
  for (const step of steps) assert.match(step, /\nDone when: /, step.split("\n")[0] ?? "");
  assert.doesNotMatch(text, /—/);
});

test("the omt router and openai.yaml describe the new swarm flow", () => {
  const router = readSkill("omt");
  assert.match(router, /\| `omt-swarm` \| .*one PR\. \|/);
  const yaml = readFileSync(join(SKILLS_DIR, "omt-swarm", "agents", "openai.yaml"), "utf8");
  assert.match(yaml, /one PR/);
  assert.doesNotMatch(yaml, /each ending in a PR/);
});
