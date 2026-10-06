---
name: omt-plan
description: Plan before code in T3 Code. Use when the user asks for a plan, a spec, or a design before implementation, or when omt-ulw needs a reviewed plan for a HEAVY task. Explores read-only, asks only owner decisions, writes an omt plan file, and runs cross-family plan-review rounds with a frozen blocker list.
---

# Plan

You write a plan that a worker can execute without making a design decision, and you get it reviewed. You change no code in this skill. The T3 rules are in [delegation.md](../omt/references/delegation.md); T3 tools appear by base name and your harness may prefix them, for example `mcp__t3-code__delegate_task`.

## Steps

### 0. Check your mode

Call `t3_thread_configuration` with no `threadId` and read your `interactionMode` ([delegation.md](../omt/references/delegation.md#your-interaction-mode)). In `plan` mode, dispatch only `explore` and `plan-review`, write no plan file and no ledger entry, put the plan text in the review briefs instead of a path, and deliver the finished plan in your final message.

Done when: you know your mode.

### 1. Pick the slug and explore

Pick the plan slug first: `omt-ulw` passes one; otherwise choose one that matches `^[a-z0-9][a-z0-9-]{0,63}$`. Explore briefs and `omt ledger stats` use it as `--plan <slug>`.

Read the code the goal touches. For a large or unknown area, dispatch parallel read-only `explore` tasks (`--plan <slug> --unit E<k> --round 1 --attempt 1 --title "explore E<k>: <question>"`), one narrow question each, then end the turn and read the results on wake.

Done when: you can name each file and function the change touches, with a `path:line` citation.

### 2. Decide whether the intent is clear

List the decisions the plan needs. Settle each one from the code, the docs, or the request. What remains is an owner decision: a choice between valid options that changes what the user gets.

Ask the user only owner decisions. Give each one 2 to 4 options and your recommendation, and ask them all in one message.

Done when: every decision is settled from evidence or answered by the user.

### 3. Write the plan

When `.omt/plans/<slug>.md` exists, edit it. Otherwise run `omt plan new <slug> --title "<title>"`, after `omt init` when `.omt/.gitignore` is missing. Keep an existing plan: pass no `--force`. Fill every section. The persona in [roles/plan.md](../omt/references/roles/plan.md) is the standard. For a large plan, you may dispatch it to a `plan` task instead.

- `Done when` items are checks that can fail.
- Each unit has a role, a scope, a done condition, a verify command, and its dependencies.
- Units with no dependency between them have disjoint scopes.
- Paste the output of `omt roles` under `Roles`.

Done when: `omt plan status <slug>` lists every unit, and each unit has all five fields.

### 4. Review rounds

Run up to `maxReviewRounds` rounds (default 3). Each round is a fresh `plan-review` task; reuse no reviewer thread.

1. Compute the hash: `shasum -a 256 .omt/plans/<slug>.md`. In plan mode no file exists: write the exact plan text you put in the brief to `$TMPDIR/omt-<slug>-plan.md` with a quoted heredoc (`<<'EOF'`), then hash it with `shasum -a 256 < "$TMPDIR/omt-<slug>-plan.md"`.
2. Build the brief with `omt brief plan-review --task-file - --title "plan-review: <title>" --round <n> --attempt 1 --plan <slug> --unit plan --json`. The task names the plan path and its SHA-256, and asks the reviewer to confirm the hash before it reads. From round 2, pass `--prior-file` with the blocker list and your response to each blocker.
3. Run `omt ledger stats --plan <slug>`, dispatch, record the dispatch with `--task-id`, and end the turn. On wake, read the verdict and record it ([results.md](../omt/references/results.md#recording)).
4. Round 1: its blocking findings become the frozen blocker list. Write them under `Log` in the plan.
5. Round 2 and later: count a finding only when it is on the frozen list, is a regression from your fixes, or cites a requirement, a regression, or a concrete risk. Record anything else as a note.
6. Fix the plan for each counted finding, then run the next round.

`APPROVE` with notes counts as approval. Stop at `maxReviewRounds`: report the blockers still open to the user.

Done when: a round returned `APPROVE`, or the round count reached `maxReviewRounds` and the open blockers are in your report.

### 5. Hand off

When `omt-ulw` called this skill and a round returned `APPROVE` (approval with notes counts), return to its step 5 with the plan slug. When the rounds ended at `maxReviewRounds` with blockers open, stop and give the user the open blockers; start no units.

Otherwise stop and summarize for the user: the plan path, the unit count, the review result, and any decision still open. Start no units.

Done when: the user, or the `omt-ulw` run, has the plan path and the review result.
