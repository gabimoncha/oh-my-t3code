---
name: omt-grill
description: Grill, stress-test, find the edge cases of, or brainstorm a vague goal before a plan, in T3 Code. Use when the user says grill or stress-test, asks for edge cases or a brainstorm, gives a goal that is too vague to plan, or wants to test an idea before a plan, or when omt-plan offers a grill. Runs rounds of two grill children, one Claude and one Codex, that do not see each other. The models decide the areas that the user does not know, the user answers the rest in one message per round, and the result is a grill file that omt-plan reads.
---

# Grill

You test a goal before it has a plan. You find its edge cases, its open questions, and the options, and you get answers from the user. You write no plan and change no code in this skill. The T3 rules are in [delegation.md](../omt/references/delegation.md); T3 tools appear by base name and your harness may prefix them, for example `mcp__t3-code__delegate_task`.

Each round runs two read-only `grill` children in parallel, one per family. Expected cost: 2 tasks per round, plus the explore tasks.

## Steps

### 0. Check your mode

Call `t3_thread_configuration` with no `threadId` and read your `interactionMode` ([delegation.md](../omt/references/delegation.md#your-interaction-mode)).

In `plan` mode:

- Dispatch only `explore` and `grill` tasks.
- Build each brief without `--save`.
- Write no grill file and no ledger entry.
- Count your active tasks yourself against the profile limits, and keep each task id.
- Read the kept task ids with `task_status` and `t3_thread_read` instead of `omt ledger list`, and write nothing.
- Deliver the grill text, in the [grill file](#grill-file) layout, in your final message.

Then run the [branch check](../omt/references/delegation.md#branch-check).

Done when: you know your mode, and the branch check is done or reported as skipped.

### 1. Frame

Use the slug that `omt-plan` passes. Otherwise pick a slug that matches `^[a-z0-9][a-z0-9-]{0,63}$`. The later plan uses the same slug, so grill tasks and plan tasks share one ledger.

Run `omt roles --role grill --json`. When it exits 1 with `unknown role grill`, the config pins a default set that has no `grill` role. Stop. Show the output of `omt defaults diff`, and offer the `omt-setup` skill to move the pin. Dispatch nothing until the role resolves.

Read the profile:

- When the plan file exists, run `omt profile show --plan <slug> --json`.
- Before the plan file exists, run `omt profile show <name> --json` for an explicit profile name, or `omt profile show --json` without one.
- Keep the returned `profile` as `<name>`. Read `limits.maxReviewRounds` as `maxReviewRounds`.

Before each dispatch, run `omt ledger stats --plan <slug>`. When the plan file exists, dispatch only while it reports `can dispatch: yes`. With no plan file:

- Pass `--profile <name>` to every `omt brief`, `omt roles`, and `omt route` command.
- Before each dispatch, run `omt ledger stats --plan <slug>` and `omt profile show <name> --json`.
- Dispatch only when the ledger's `active` is below the profile's `limits.maxParallel`.
- Use this check in place of `can dispatch`.

When `$(omt paths --grills)/<slug>.md` exists, read it and its `Log`. Only recorded answers settle an item.

- When the `Log` has a line for round `<n>` of `rounds=<n>` with the answers, the decisions and the accepted, changed, or dropped edge cases are settled. A `pending` edge case is not settled; show it again in the edge-case table of the next round. Apply the stop check of step 5, then continue with round `<n+1>` or step 6.
- When the file holds round `<n>` without recorded answers, go back to step 4. Send the same three-part message again from the file: the decisions table, the numbered questions with their options and recommendation, and the edge-case table. While no direction is chosen, the direction question is first. Then wait.

Write the goal in at most 5 lines. List the areas that the goal touches. Mark each area `user` when the user knows it and can choose, or `models` when the models decide it. Take the marks from the conversation. When the conversation does not show them, ask the user once, in one message, and end the turn.

Find the facts that the panel needs. For each narrow question, dispatch a read-only `explore` task with `omt brief explore --task-file - --title "explore GX<k>: <question>" --plan <slug> --unit GX<k> --round 1 --attempt 1 --save --json`. Record each dispatch ([results.md](../omt/references/results.md#recording)) and wait for the tasks in this turn ([delegation.md](../omt/references/delegation.md#waiting)). Then read each result, record it, and settle the child. The units are `GX<k>`, so the later plan's explore units `E<k>` get their own request ids.

Done when: the `grill` role resolves, and your reply has the goal, each area with its mark, and the facts with `path:line` citations.

### 2. Run panel round `<n>`

Write the task text. It holds the goal, the knowledge map, the facts with their citations, the user's answers verbatim, and the round rule: round 1 asks for 2 to 4 different directions, and later rounds stay inside the chosen direction. From round 2, copy the chosen direction from the `## Directions` section of the grill file into the task text.

Build two briefs:

```sh
omt brief grill --task-file - --title "grill G<n>: <title>" --plan <slug> --unit grill.claude --against codex --round <n> --attempt 1 --save --json
omt brief grill --task-file - --title "grill G<n>: <title>" --plan <slug> --unit grill.codex --against claudeAgent --round <n> --attempt 1 --save --json
```

`grill.claude` runs on Claude and `grill.codex` runs on Codex. From round 2, add `--prior-file` with the merged items, the frozen blocker list, and the user's answers.

Each round calls `delegate_task` again, with the new `--round` value. Never send a new round to an earlier child with `t3_thread_send`.

Run the dispatch check of step 1 before each call. Check that the target provider is the family that the unit names. Record each dispatch with `--task-id`, `--provider`, and `--model` ([results.md](../omt/references/results.md#recording)). After you record the first dispatch, run the dispatch check again for the second. When that check fails, wait for the first task, then check again.

Each child runs only on its own family. When a failure code would move a task to a rung of the other family, do not fall back. Tell the user which family cannot run, and ask whether to run the round with one family.

Wait for both tasks in this turn ([delegation.md](../omt/references/delegation.md#waiting)). A grill result goes to step 3 when both panel results of the round have a terminal entry or a recorded failure.

Done when: both tasks of round `<n>` have a dispatch entry, or the user has the question about a one-family round.

### 3. Merge

Read both results with `task_status`. Record each result with its `VERDICT` ([results.md](../omt/references/results.md#recording)). Settle each child ([delegation.md](../omt/references/delegation.md#releasing-children)).

Merge the `DIRECTIONS` of both children into one list, without duplicates. Give each direction its gain and its cost. While no direction is chosen:

- When the area of the direction is `user`, the first question asks for a direction. Its options are the merged directions, each with its gain and cost, and your recommendation. It is always `Blocking: yes`. It counts as a blocking item until the user chooses a direction.
- When the area of the direction is `models`, choose the direction yourself and give the reason, as for any decision. Record it in the `## Directions` section, with the dropped directions and why.

When a counted blocker shows that the chosen direction fails, reopen the choice before the next panel round. Move the chosen direction to dropped, with the blocker as its reason. Merge the replacement directions. Then apply the rules above for an open direction: the `user` question or the `models` choice. While the choice is open, the blocking direction question, the same-round resend of step 5, and the stop guard of step 5 apply again.

Remove duplicate items. Sort the rest into three groups:

1. Decisions that the models make, each with its area and reason. Give each one an id `GD<k>`.
2. Questions that only the user can answer, each with 2 to 4 options and a recommendation. Give each one an id `GQ<k>`.
3. Edge cases, each with its trigger, its effect, a proposed handling, and a test layer. Give each one an id `GE<k>`.

When the two children disagree, keep both options. In a `user` area, the disagreement becomes a question. In a `models` area, pick one option yourself and give the reason.

In round 1, freeze the blocker list: the union of the blocking edge cases and the blocking questions, as `B1`, `B2`, and on. From round 2, a blocking item counts only when one of these holds:

- It is on the frozen list and still open.
- It comes from the user's last answers.
- It names a concrete trigger and effect in a flow of the goal.

Record every other item as a note.

Done when: the directions are merged, each item is in one of the three groups or is a note, the frozen list exists, and you know how many blocking items this round counts.

### 4. Ask

Update the grill file first. Run `mkdir -p "$(omt paths --grills)"`, then write `$(omt paths --grills)/<slug>.md` in the [grill file](#grill-file) layout, with `status=open` and `rounds=<n>`. Write each decision with its area and reason. Write each new edge case with its handling, its test layer, and `State: pending`. Keep each `pending` edge case from earlier rounds. Write each open question with its options and your recommendation. Save the direction question first in `## Open questions`. In `plan` mode, keep the same text in your reply instead.

Then send one message with three parts:

1. The decisions table: id, area, decision, and reason. The user may override any decision by its id.
2. The numbered questions, each with its options and your recommendation. While no direction is chosen, the direction question is first.
3. The edge-case table: id, trigger and effect, handling, and test layer. It holds the new edge cases and every `pending` edge case from earlier rounds. The user accepts all rows at once, or accepts, changes, or drops a row by its id.

End the turn and wait for the answers.

Done when: the grill file holds round `<n>`, and the user has the message.

### 5. Check whether to stop

Record the answers in the grill file. Write the chosen direction in the `## Directions` section, with the dropped directions and why. An overridden decision gets `By: user`. Set `State: accepted` only when the user accepts that row or accepts all rows. Set `changed` or `dropped` only from the user's answer for that row. A row with no answer stays `pending`. When the user changes an edge case, write the user's handling in its `Handle:` field, and the user's test layer in its `Test:` field when the user changes it. Then set `State: changed`. An answered question becomes a decision. Add a `Log` line with the time, the round, the task ids, the frozen blockers, and the answers.

Read the profile again with the step 1 command. Stop when one of these holds:

- Round `<n>` added no counted blocking item, and a direction is chosen. While no direction is chosen, this reason does not apply.
- The round count reached `maxReviewRounds`.
- The user tells you to stop.

When no direction is chosen and no stop reason applies, do not start round `<n+1>`. Go back to step 4 in round `<n>`. Send the direction question again, with its options and your recommendation, and wait.

Otherwise go to step 2 with round `<n+1>`.

Done when: you stopped for one of the three reasons, you sent the direction question again in round `<n>`, or round `<n+1>` started with a chosen direction.

### 6. Hand off

Before you report, run the settle sweep ([delegation.md](../omt/references/delegation.md#releasing-children)), except when `omt-plan` called this skill.

Set `status=done` in the grill file header. When you stopped with no chosen direction, write `No direction chosen.` in the `## Directions` section. The reply names the grill file path, the number of decisions, edge cases, and open questions, and each open question. List each `pending` edge case with the open questions.

When `omt-plan` called this skill, return to its step 2 with the grill file path. In `plan` mode, return the grill text instead. Otherwise tell the user to say "plan it" to run `omt-plan` with the slug.

Start no plan and no unit.

Done when: the grill file has `status=done`, or in `plan` mode your final message has the grill text, and the user or `omt-plan` has the path or the text.

## Grill file

The grill file is `$(omt paths --grills)/<slug>.md`. All worktrees share it, so always get the folder from `omt paths --grills`, and never from a path relative to your working directory.

```markdown
# Grill: <title>

<!-- omt-grill v1 slug=<slug> status=open|done rounds=<n> -->

## Goal

## Knowledge map
- <area>: user | models. Source: conversation | asked.

## Directions
- <chosen direction>. Dropped: <direction> because <reason>.

## Decisions
- GD<k>. <decision>. Area: <area>. By: user | models. Why: <reason>.

## Edge cases
- GE<k>. When <trigger>, <effect>. Handle: <handling>. Test: integration | unit | none. State: pending | accepted | changed | dropped.
  A `changed` edge case holds the user's handling and test layer. A `pending` edge case has no answer yet.

## Open questions
- GQ1. Which direction? Options: <direction>, gain <gain>, cost <cost>; <direction>, gain <gain>, cost <cost>. Recommend: <direction>, because <reason>. Blocking: yes.
- GQ<k>. <question>. Options: <a>; <b>. Recommend: <option>, because <reason>. Blocking: yes | no.

## Log
- <timestamp> round <n>: <task ids>; frozen blockers <B list>; user answers.
```
