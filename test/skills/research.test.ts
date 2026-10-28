import { test } from "bun:test";
import assert from "node:assert/strict";
import { readSkill, section } from "./shared.ts";

test("omt-research answers a narrow question in the main thread with citations and no child", () => {
  const text = readSkill("omt-research");
  const size = section(text, "### 1. ");
  assert.match(size, /Narrow: one area of this repository, or one doc or source\. Answer it yourself in step 2 with no child\./);
  const narrow = section(text, "### 2. ");
  assert.match(narrow, /Cite each fact with its `path:line` or URL\./);
  assert.doesNotMatch(narrow, /delegate_task|omt brief/);
});

test("omt-research sends a broad question to 2 to 4 parallel read-only children awaited in the turn", () => {
  const text = readSkill("omt-research");
  assert.match(section(text, "### 1. "), /Broad: many areas of the code or many sources\. Split it into 2 to 4 sub-questions/);
  const dispatch = section(text, "### 3. ");
  assert.match(dispatch, /omt brief <role> --task-file - --title "<role> Q<k>: <short question>" --plan research-<slug> --unit Q<k> --round 1 --attempt 1 --json/);
  assert.match(dispatch, /Dispatch each child with `mode: "async"`\./);
  assert.match(dispatch, /Then wait for every child in this turn: call `t3_thread_wait` with `threadId` and `runId` for each, then `task_status`/);
  assert.doesNotMatch(text, /2 to 6|heartbeat|schedule_task/);
});

test("omt-research merges the answers and checks each claim before the cited answer", () => {
  const text = readSkill("omt-research");
  const merge = section(text, "### 4. ");
  assert.match(merge, /Merge the answers into one list of claims, without duplicates\./);
  assert.match(merge, /Check each claim before you use it: open the cited file at its line, or the cited URL, and confirm that it says what the claim says\./);
  assert.match(merge, /Drop a claim that its source does not support, or move it to the UNKNOWN list\./);
  const answer = section(text, "### 5. ");
  assert.match(answer, /Before you report, run the settle sweep/);
  assert.match(answer, /An UNKNOWN list: what nobody found, and what was searched\./);
});
