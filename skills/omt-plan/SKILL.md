---
name: omt-plan
description: Plan before code in T3 Code. Use when the user asks for a plan, a spec, or a design before implementation, or when omt-ulw needs a reviewed plan for a HEAVY task. Explores read-only, asks only owner decisions, writes an omt plan file, and runs cross-family plan-review rounds with a frozen blocker list.
---

# Plan

You write a plan that a worker can execute without making a design decision, and you get it reviewed. You change no code in this skill. The T3 rules are in [delegation.md](../omt/references/delegation.md); T3 tools appear by base name and your harness may prefix them, for example `mcp__t3-code__delegate_task`.

## Steps

### 0. Check your mode

Call `t3_thread_configuration` with no `threadId` and read your `interactionMode` ([delegation.md](../omt/references/delegation.md#your-interaction-mode)). Also keep `modelSelection.instanceId`. It is your provider instance, and step 4 passes it to `--against`. In `plan` mode, dispatch only `explore` and `plan-review`, write no plan file and no ledger entry, put the plan text in the review briefs instead of a path, and deliver the finished plan in your final message.

Then run the [branch check](../omt/references/delegation.md#branch-check).

Done when: you know your mode and your provider instance.

### 1. Pick the slug and explore

Pick the plan slug first: `omt-ulw` passes one; otherwise choose one that matches `^[a-z0-9][a-z0-9-]{0,63}$`. Explore briefs and `omt ledger stats` use it as `--plan <slug>`.

Read the code the goal touches. For a large or unknown area, dispatch parallel read-only `explore` tasks (`--plan <slug> --unit E<k> --round 1 --attempt 1 --title "explore E<k>: <question>"`), one narrow question each, then end the turn and read the results on wake.

Done when: you can name each file and function the change touches, with a `path:line` citation.

### 2. Decide whether the intent is clear

List the decisions the plan needs. Settle each one from the code, the docs, or the request. What remains is an owner decision: a choice between valid options that changes what the user gets.

Ask the user only owner decisions. Before you ask, finish all work that does not depend on the answers: the research and a draft plan. Then ask every owner decision in one message. Give each one 2 to 4 options and your recommendation.

Done when: every decision is settled from evidence or answered by the user.

### 3. Write the plan

`omt plan status <slug>` prints the absolute plan path, also from a worktree. Steps 3 and 4 edit and hash the plan at that path. When the plan exists, edit it. Otherwise run `omt plan new <slug> --title "<title>"`, after `omt init` when `.omt/.gitignore` is missing. Keep an existing plan: pass no `--force`. Fill every section. The persona in [roles/plan.md](../omt/references/roles/plan.md) is the standard. For a large plan, you may dispatch it to a `plan` task instead.

- `Done when` items are checks that can fail.
- Each unit has a role, a scope, a done condition, a verify command, and its dependencies.
- Units with no dependency between them have disjoint scopes.
- Paste the output of `omt roles` under `Roles`.
- Under `## Research`, write each research question, its answer, and its sources.
- When units build or change UI and no spec for that UI exists under `docs/design/`, plan an `omt-design` step before those units. UI units cite the spec (`docs/design/<slug>.md`) and use the `ui` role.
- When units share build state that parallel workers would race on (one project file, one build folder, a generated file), run `omt plan limit <slug> 1` and say why in the plan.

Done when: `omt plan status <slug>` lists every unit, and each unit has all five fields.

### 4. Review rounds

Run up to `maxReviewRounds` rounds (default 3). Each round dispatches fresh `plan-review` tasks; reuse no reviewer thread.

1. Compute the hash: `shasum -a 256 <plan path>`, with the path from step 3. In plan mode no file exists: write the exact plan text you put in the brief to `$TMPDIR/omt-<slug>-plan.md` with a quoted heredoc (`<<'EOF'`), then hash it with `shasum -a 256 < "$TMPDIR/omt-<slug>-plan.md"`.
2. Build each brief with `omt brief plan-review --task-file - --title "plan-review: <title>" --round <n> --attempt 1 --plan <slug> --unit <unit> --against <provider> --json`. The task names the plan path and its SHA-256, and asks the reviewer to confirm the hash before it reads. From round 2, pass `--prior-file` with the blocker list and your response to each blocker.
   - Round 1 has two tasks, one per family: `--unit plan.claude --against codex` (an Opus reviewer) and `--unit plan.codex --against claudeAgent` (an Astra reviewer).
   - From round 2, one task: `--unit plan --against <the plan author's provider>`. You wrote the plan, so pass your provider instance from step 0. When a `plan` task wrote the plan, pass that task's provider instead.
3. Run `omt ledger stats --plan <slug>`, dispatch, record the dispatch with `--task-id`, `--provider`, and `--model`, and end the turn. On wake, read the verdict and record it ([results.md](../omt/references/results.md#recording)). In round 1, run `omt ledger stats --plan <slug>` again after you record the first dispatch. When it reports `can dispatch: yes`, dispatch the second task before you end the turn; when it reports `can dispatch: no`, dispatch the second task after the first finishes. Record and wait for both.
   - Each round-1 task runs only on its own family. Check the provider of the target before the call. When a failure code would move the task to a rung of the other family, do not fall back. Stop and tell the user which reviewer is unavailable.
4. Round 1: the frozen blocker list is the union of the blocking findings of both reviewers, without duplicates. Round 1 approves only when both reviewers approve. Write the list under `Log` in the plan.
5. Round 2 and later: count a finding only when it is on the frozen list, is a regression from your fixes, or cites a requirement, a regression, or a concrete risk. Record anything else as a note.
6. Fix the plan for each counted finding, then run the next round.

`APPROVE` with notes counts as approval. Stop at `maxReviewRounds`: report the blockers still open to the user.

Done when: a round returned `APPROVE`, or the round count reached `maxReviewRounds` and the open blockers are in your report.

### 5. Hand off

When `omt-ulw` called this skill and a round returned `APPROVE` (approval with notes counts), return to its step 5 with the plan slug. Step 5 starts with the design check, so the `omt-design` step runs before any `ui` unit is dispatched. When the rounds ended at `maxReviewRounds` with blockers open, stop and give the user the open blockers; start no units.

Otherwise stop and summarize for the user: the plan path, the unit count, the review result, and any decision still open. Start no units.

Done when: the user, or the `omt-ulw` run, has the plan path and the review result.
