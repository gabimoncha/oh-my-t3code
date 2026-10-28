import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SKILLS_DIR, readSkill, section } from "./shared.ts";

function gitActions(): string {
  return section(readFileSync(join(SKILLS_DIR, "omt/references/delegation.md"), "utf8"), "## Git actions");
}

test("omt-ulw applies the shared Git actions rules to each commit, push, and PR", () => {
  const text = section(readSkill("omt-ulw"), "### 12. ");
  assert.match(text, /make one commit for the run, then push and open or update the PR, each by the \[Git actions\]\(\.\.\/omt\/references\/delegation\.md#git-actions\) rules/);
});

test("omt-code-review applies the shared Git actions rules to each commit and push", () => {
  const text = section(readSkill("omt-code-review"), "### PR 11. ");
  assert.match(text, /Commit and push by the \[Git actions\]\(\.\.\/omt\/references\/delegation\.md#git-actions\) rules, with `--profile <profile>`/);
});

test("omt-swarm checks each merge and links to the shared Git actions rules", () => {
  const text = section(readSkill("omt-swarm"), "### 6. Merge");
  assert.match(text, /Before each merge, run `omt git check merge --plan <slug> --json`/);
  assert.match(text, /act on its decision by the \[Git actions\]\(\.\.\/omt\/references\/delegation\.md#git-actions\) rules/);
});

test("Git actions requires omt git check before each git action", () => {
  const text = gitActions();
  assert.match(text, /Before each commit, push, PR, or merge, run `omt git check <commit\|push\|pr\|merge> --plan <slug> --json`/);
  assert.match(text, /In a run with no plan file, pass `--profile <profile>` instead of `--plan <slug>`/);
});

test("Git actions states that auto config is the owner's standing approval", () => {
  assert.match(gitActions(), /The git policy in the config \(`workflow\.git`\) is the owner's standing approval for each action that it marks `auto`/);
});

test("Git actions forbids git actions in plan mode", () => {
  assert.match(gitActions(), /In `plan` interaction mode, make no git action/);
});

test("no skill requires a separate user request for every commit", () => {
  for (const path of readdirSync(SKILLS_DIR, { recursive: true, encoding: "utf8" })) {
    if (!path.endsWith(".md")) continue;
    const text = readFileSync(join(SKILLS_DIR, path), "utf8");
    assert.doesNotMatch(text, /Commit only when the user asked for a commit/i, path);
  }
});
