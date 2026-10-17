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

When the plan file exists, run `omt profile show --plan <slug> --json`. Before the plan file exists, use `omt profile show <name> --json` for an explicit profile name. When neither a plan file nor a profile name exists, run `omt profile show --json`. Keep the returned `profile` as `<name>` for later commands.

With a selected profile and no plan file for the `--plan` id:

- Pass `--profile <name>` to every `omt brief`, `omt roles`, and `omt route` command.
- Before each dispatch, run `omt ledger stats --plan <slug>` and `omt profile show <name> --json`.
- Dispatch only when the ledger's `dispatched` is below the profile's `limits.maxTasksPerRun` and `active` is below `limits.maxParallel`.
- Use this check in place of `can dispatch`.

Read the code the goal touches. For a large or unknown area, dispatch parallel read-only `explore` tasks (`--plan <slug> --unit E<k> --round 1 --attempt 1 --title "explore E<k>: <question>"`), one narrow question each, then end the turn. On wake, read the results and record them ([results.md](../omt/references/results.md#recording)).

Done when: you can name each file and function the change touches, with a `path:line` citation.

### 2. Decide whether the intent is clear

List the decisions the plan needs. Settle each one from the code, the docs, or the request. What remains is an owner decision: a choice between valid options that changes what the user gets.

Ask the user only owner decisions. Before you ask, finish all work that does not depend on the answers: the research and a draft plan. Then ask every owner decision in one message. Give each one 2 to 4 options and your recommendation.

Include the proposed `## Tests` lines in that message. Ask the owner to approve the test list with the plan. Give a reason for each proposed line outside `plan.testLayers`.

For a HEAVY plan, the owner decisions include the task budget. Use the effective profile from step 1 for the estimate. Read `workflow.build.review` as `build.review`. Count 5 tasks per unit for every profile, or 4 when `build.review` is `first-round` or `off`. This gives 5 tasks per unit for `normal` and 4 for `prototype`. Start with the tasks the plan already used (`dispatched` in `omt ledger stats --plan <slug>`). Add 4 for the plan-review rounds and the per-unit estimate. Add 1 more per `ui` unit and 1 more per unit with `## Tests` lines. Add 3 for the final gate and 5 when the plan has an `omt-design` step. Round the sum up to a multiple of 10.

Done when: every decision is settled from evidence or answered by the user.

### 3. Write the plan

`omt plan status <slug>` prints the absolute plan path, also from a worktree. Steps 3 and 4 edit and hash the plan at that path. When the plan exists, edit it. Otherwise run `omt plan new <slug> --title "<title>" --profile <name>`, after `omt init` when `.omt/.gitignore` is missing. Keep an existing plan: pass no `--force`. Fill every section. The persona in [roles/plan.md](../omt/references/roles/plan.md) is the standard. For a large plan, you may dispatch a `plan` task to fill that file. Before you dispatch a `plan` task, create any missing plan file yourself with `omt plan new <slug> --title "<title>" --profile <name>`. In every `plan` task, name the plan path and state that the file already exists. Tell the worker to edit that file and not to run `omt plan new`. On wake, read its result and record it ([results.md](../omt/references/results.md#recording)).

Read the effective profile again with the step 1 command before you fill `## Tests` or build a `plan` task. Read `workflow.plan.testLayers` as `plan.testLayers` and `workflow.build.qa` as `build.qa`. Name the effective `plan.testLayers` and `build.qa` values in every `plan` task.

- `Done when` items are checks that can fail.
- Fill `## Summary` last, by the summary rule in [roles/plan.md](../omt/references/roles/plan.md), and update it after each review fix. A plan that has no `## Summary` gets one between the header line and `## Objective`.
- When a unit reads outside data, such as recordings, files, or API responses, its done condition includes a check on an input shaped like real data: one captured from a real source, or with the properties real data has, such as offsets, gaps, and sizes. A seeded or ideal sample alone hides real-data defects.
- Each unit has a role, a scope, a done condition, a verify command, and its dependencies.
- Units with no dependency between them have disjoint scopes.
- Paste the output of `omt roles --plan <slug>` under `Roles`.
- Under `## Research`, write each research question, its answer, and its sources.
- When `build.qa` is `off`, leave `## Tests` empty. When `build.qa` is `planned`, fill `## Tests` top-down with the owner's approved lines.
- Start with e2e tests of the main user flows of each vertical slice that `verify` can also walk. Then add integration cases that e2e skips, followed by unit cases. Add other test kinds only when the owner asks.
- Propose only the layers in `plan.testLayers` without an owner request. Keep a line in another layer only with its reason and the owner's approval.
- Use one e2e test per main flow. Keep edge cases out of the e2e lines.
- Write each `## Tests` line as `- <layer> <unit>: <flow or case>. File: <path>. Reason: <why>.` An empty `## Tests` section means no new tests.
- When units build or change UI and no spec for that UI exists under `docs/design/`, plan an `omt-design` step before those units. UI units cite the spec (`docs/design/<slug>.md`) and use the `ui` role.
- Name each shared resource in the plan, such as a build folder, a generated project, a simulator, or a dev-server port. Write each verify command that uses shared build state as `omt lock run <resource> -- <command>`. Use the same `<resource>` for commands that share that state.
- Check for a lock tool with `command -v flock || command -v lockf`. When neither tool exists, run `omt plan limit <slug> 1` for a plan with shared build state and say why.
- When a command leaves processes running after it exits, run that command outside `omt lock`. When a unit uses that command, run `omt plan limit <slug> 1` for the whole plan and say why in the plan.
- Keep units parallel for shared build state alone when a lock tool exists and the command leaves no process running after it exits.
- For a HEAVY plan, run `omt plan limit <slug> --tasks <n>` with the task budget from step 2. In plan mode, give the budget in your final message instead.

Done when: `omt plan status <slug>` lists every unit, and each unit has all five fields.

### 4. Review rounds

Run `omt profile show --plan <slug> --json` before each round. Before the plan file exists, use `omt profile show <name> --json` instead. Read `workflow.plan.review` as `plan.review` and `limits.maxReviewRounds` as `maxReviewRounds`.

When `plan.review` is `owner`, ask the owner to approve the plan and its `## Tests` list. Dispatch no `plan-review` task for this value. After the owner approves, go to step 5. In plan mode, write the temp plan file from item 1 before the handoff.

For `two-families` or `one`, run up to `maxReviewRounds` rounds (default 3). Each round dispatches fresh `plan-review` tasks; reuse no reviewer thread.

1. Make every plan edit first, `omt plan limit` included. Then compute the hash: `shasum -a 256 <plan path>`, with the path from step 3. In plan mode no file exists: write the exact plan text you put in the brief to `$TMPDIR/omt-<slug>-plan.md` with a quoted heredoc (`<<'EOF'`), then hash it with `shasum -a 256 < "$TMPDIR/omt-<slug>-plan.md"`.
2. Build each brief with `omt brief plan-review --task-file - --title "plan-review: <title>" --round <n> --attempt 1 --plan <slug> --unit <unit> --against <provider> --json`. The task names the plan path and its SHA-256, and asks the reviewer to confirm the hash before it reads. From round 2, pass `--prior-file` with the blocker list and your response to each blocker.
   - Name the effective `plan.testLayers` value in every `plan-review` task.
   - With `plan.review=two-families`, round 1 has two tasks, one per family: `--unit plan.claude --against codex` (an Opus reviewer) and `--unit plan.codex --against claudeAgent` (an Astra reviewer).
   - With `plan.review=one`, round 1 has one task: `--unit plan --against <the plan author's provider>`.
   - From round 2, both values use one task: `--unit plan --against <the plan author's provider>`. You wrote the plan, so pass your provider instance from step 0. When a `plan` task wrote the plan, pass that task's provider instead.
   - With `one`, use a reviewer from the other family in every round. If no reviewer from the other family can run, stop and tell the user.
3. Before each dispatch, run `omt ledger stats --plan <slug>`. When a plan file exists, dispatch only while it reports `can dispatch: yes`. Otherwise, use the step 1 dispatch check. Record the dispatch with `--task-id`, `--provider`, and `--model`, and end the turn. On wake, read the verdict and record it ([results.md](../omt/references/results.md#recording)). With `two-families` in round 1, run `omt ledger stats --plan <slug>` again after you record the first dispatch. Apply the same dispatch check to the second task. When the check passes, dispatch the second task before you end the turn. When the check fails, wait for the first task to finish. Repeat the check before the second dispatch. Record and wait for both.
   - Each round-1 task runs only on its own family. Check the provider of the target before the call. When a failure code would move the task to a rung of the other family, do not fall back. Stop and tell the user which reviewer is unavailable.
4. Round 1: the frozen blocker list is the union of the reviewers' blocking findings, without duplicates. With `two-families`, round 1 approves only when both reviewers approve. With `one`, round 1 approves when its reviewer approves. Write the list under `Log` in the plan.
5. Round 2 and later: count a finding only when it is on the frozen list, is a regression from your fixes, or cites a requirement, a regression, or a concrete risk. Record anything else as a note.
6. Fix the plan for each counted finding, then run the next round.

After any edit to the plan, header edits included, compute the hash again before the next brief.

`APPROVE` with notes counts as approval. Stop at `maxReviewRounds`: report the blockers still open to the user.

Done when: a round returned `APPROVE`, the owner approved under `plan.review=owner`, or the round count reached `maxReviewRounds` and the open blockers are in your report.

### 5. Hand off

Before you report, run the settle sweep ([delegation.md](../omt/references/delegation.md#releasing-children)).

Show the plan to the owner first, also when `omt-ulw` called this skill. Run `omt config show` and read `visuals.plan`. When it is `true` and you have the T3 `html_render` tool, run the `omt-show` skill with the plan slug (in `plan` mode, with the temp plan file of step 4). When the page is in the thread, it holds the summary, so the reply leaves the summary out. Otherwise, write the `## Summary` text in full in the reply, also when `omt-show` could not show the page. Either way, the reply gives the plan path, the review result, and each decision still open.

When `omt-ulw` called this skill and step 4 has approval from the owner or a review round (approval with notes counts), return to its step 5 with the plan slug. Step 5 starts with the design check, so the `omt-design` step runs before any `ui` unit is dispatched. When the rounds ended at `maxReviewRounds` with blockers open, stop and give the user the open blockers; start no units.

Otherwise stop. Start no units.

Done when: the owner has the summary, on the page or in the reply, and the user, or the `omt-ulw` run, has the plan path and the review result.
