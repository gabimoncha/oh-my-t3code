import { test } from "bun:test";
import assert from "node:assert/strict";
import { readSkill, section } from "./shared.ts";

test("omt-grill reads the current thread mode", () => {
  const mode = section(readSkill("omt-grill"), "### 0. ");
  assert.match(mode, /Call `t3_thread_configuration` with no `threadId`/);
  assert.match(mode, /read your `interactionMode`/);
  assert.doesNotMatch(mode, /orchestrator_capabilities/);
});

test("omt-grill links to the shared branch check", () => {
  const mode = section(readSkill("omt-grill"), "### 0. ");
  assert.match(mode, /run the \[branch check\]\(\.\.\/omt\/references\/delegation\.md#branch-check\)/);
});

test("omt-grill stops for a missing grill role and offers omt-setup", () => {
  const frame = section(readSkill("omt-grill"), "### 1. ");
  assert.match(frame, /Run `omt roles --role grill --json`/);
  assert.match(frame, /When it exits 1 with `unknown role grill`[^\n]*Stop\./);
  assert.match(frame, /Show the output of `omt defaults diff`/);
  assert.match(frame, /offer the `omt-setup` skill/);
  assert.match(frame, /Dispatch nothing until the role resolves/);
});

test("omt-grill routes each panel unit to its own family", () => {
  const panel = section(readSkill("omt-grill"), "### 2. ");
  assert.match(panel, /omt brief grill[^\n]*--unit grill\.claude --against codex --round <n>/);
  assert.match(panel, /omt brief grill[^\n]*--unit grill\.codex --against claudeAgent --round <n>/);
  assert.match(panel, /`grill\.claude` runs on Claude and `grill\.codex` runs on Codex/);
  assert.match(panel, /other family, do not fall back/);
});

test("omt-grill starts fresh delegate tasks for each round", () => {
  const panel = section(readSkill("omt-grill"), "### 2. ");
  assert.match(panel, /Each round calls `delegate_task` again, with the new `--round` value/);
  assert.match(panel, /Never send a new round to an earlier child with `t3_thread_send`/);
});

test("omt-grill uses GX units for explore tasks", () => {
  const frame = section(readSkill("omt-grill"), "### 1. ");
  assert.match(frame, /read-only `explore` task with `omt brief explore[^\n]*--unit GX<k> --round 1/);
  assert.match(frame, /The units are `GX<k>`[^\n]*explore units `E<k>` get their own request ids/);
});

test("omt-grill stops at no new blockers, the profile round limit, or user stop", () => {
  const text = readSkill("omt-grill");
  assert.match(section(text, "### 1. "), /Read `limits\.maxReviewRounds` as `maxReviewRounds`/);
  const stop = section(text, "### 5. ");
  assert.match(stop, /Read the profile again/);
  assert.match(stop, /Stop when one of these holds/);
  assert.match(stop, /Round `<n>` added no counted blocking item/);
  assert.match(stop, /The round count reached `maxReviewRounds`/);
  assert.match(stop, /The user tells you to stop/);
  assert.match(stop, /Otherwise go to step 2 with round `<n\+1>`/);
  assert.match(stop, /While no direction is chosen, this reason does not apply/);
  assert.match(stop, /When no direction is chosen and no stop reason applies, do not start round `<n\+1>`\. Go back to step 4 in round `<n>`\. Send the direction question again, with its options and your recommendation, and wait\./);
  assert.match(stop, /When the user changes an edge case, write the user's handling in its `Handle:` field, and the user's test layer in its `Test:` field when the user changes it\. Then set `State: changed`\./);
  assert.match(section(text, "### 3. "), /It is always `Blocking: yes`\. It counts as a blocking item until the user chooses a direction/);
  assert.match(stop, /Set `State: accepted` only when the user accepts that row or accepts all rows\. Set `changed` or `dropped` only from the user's answer for that row\. A row with no answer stays `pending`\./);
  assert.match(section(text, "### 4. "), /Write each new edge case with its handling, its test layer, and `State: pending`\./);
  assert.match(section(text, "### 4. "), /It holds the new edge cases and every `pending` edge case from earlier rounds\./);
  assert.match(section(text, "### 1. "), /A `pending` edge case is not settled; show it again in the edge-case table of the next round\./);
  assert.match(section(text, "### 6. "), /List each `pending` edge case with the open questions\./);
  assert.match(text, /State: pending \| accepted \| changed \| dropped\./);
  const merge = section(text, "### 3. ");
  assert.match(merge, /When a counted blocker shows that the chosen direction fails, reopen the choice before the next panel round\. Move the chosen direction to dropped, with the blocker as its reason\. Merge the replacement directions\./);
  assert.match(merge, /the blocking direction question, the same-round resend of step 5, and the stop guard of step 5 apply again/);
});

test("omt-grill gets the grill file path from omt paths", () => {
  const text = readSkill("omt-grill");
  assert.match(section(text, "### 1. "), /When `\$\(omt paths --grills\)\/<slug>\.md` exists, read it/);
  assert.match(section(text, "### 1. "), /without recorded answers, go back to step 4\. Send the same three-part message again from the file: the decisions table[^\n]*the edge-case table\. While no direction is chosen, the direction question is first/);
  const ask = section(text, "### 4. ");
  assert.match(ask, /mkdir -p "\$\(omt paths --grills\)"/);
  assert.match(ask, /then write `\$\(omt paths --grills\)\/<slug>\.md`/);
});

test("omt-grill writes nothing in plan mode and returns the grill text", () => {
  const text = readSkill("omt-grill");
  const mode = section(text, "### 0. ");
  assert.match(mode, /In `plan` mode:/);
  assert.match(mode, /Dispatch only `explore` and `grill` tasks/);
  assert.match(mode, /Build each brief without `--save`/);
  assert.match(mode, /Write no grill file and no ledger entry/);
  assert.match(mode, /Read the kept task ids with `task_status`[^\n]*write nothing/);
  assert.doesNotMatch(text, /heartbeat|stalled-tasks|On wake/);
  assert.match(mode, /Deliver the grill text[^\n]*in your final message/);
  assert.match(section(text, "### 4. "), /In `plan` mode, keep the same text in your reply instead/);
  assert.match(section(text, "### 6. "), /In `plan` mode, return the grill text instead/);
});
