---
name: omt-design
description: Design pass with an Opus designer in T3 Code. Use when the user asks for designs, mockups, screens, UX, or a design pass, or when omt-plan or omt-ulw needs designs before UI units. Dispatches a design task for 2 or 3 directions with screenshots, lets the owner pick and steer, repeats until the owner approves, and writes a design spec that UI units cite.
---

# Design

You run design tasks, show their screenshots to the owner, and carry the owner's words back to the designer until the owner approves. You design nothing yourself, and you change no code. The T3 rules are in [delegation.md](../omt/references/delegation.md); T3 tools appear by base name and your harness may prefix them, for example `mcp__t3-code__delegate_task`.

The owner is the design review. No `review`, `oracle`, `plan-review`, or other model task looks at the design files or the screenshots.

## Steps

### 0. Check your mode

Call `t3_thread_configuration` with no `threadId` and read your `interactionMode` ([delegation.md](../omt/references/delegation.md#your-interaction-mode)). The `design` role edits files, so in `plan` mode ask the user to switch this thread to default mode.

Then run the [branch check](../omt/references/delegation.md#branch-check).

Done when: you run in `default` mode, or the user has the question.

### 1. Frame

Write down the goal, the users, the platform, the screens and flows, the constraints, and the existing brand (colors, type, logo, an app that already ships). Read the code and assets that already set the look. Ask the owner only what you cannot find, in one message.

Pick a slug that matches `^[a-z0-9][a-z0-9-]{0,63}$`. The design files go under `docs/design/<slug>/`, and the spec is `docs/design/<slug>.md`. The ledger plan is the plan slug when `omt-plan` or `omt-ulw` called this skill, and `design-<slug>` otherwise. Each design pass is one unit `DS<k>`.

Done when: the frame and the slug are written in your reply.

### 2. Dispatch the directions

Run `omt ledger stats --plan <ledger plan>` and dispatch only while it reports `can dispatch: yes`. Build the brief with `omt brief design --task-file - --title "design DS<k>: <slug> directions" --scope docs/design/<slug>/ --scope docs/design/<slug>.md --plan <ledger plan> --unit DS<k> --round 1 --attempt 1 --json`. The task carries the frame from step 1 and asks for 2 or 3 distinct directions, each with a screenshot of every screen.

Call `delegate_task`, record the dispatch with `--task-id`, `--provider`, and `--model` ([results.md](../omt/references/results.md#recording)), and end your turn.

A `design` dispatch never falls back to another family. When T3 refuses its rung, or `omt roles` reports `design` as `unavailable`, stop and tell the owner which target failed and why.

Done when: the design task has a ledger entry, or the owner knows why it cannot run.

### 3. Owner checkpoint

On wake, read the result and record it ([results.md](../omt/references/results.md#recording)). Check that each screenshot path in `CHANGES` exists.

Show the owner every screenshot as an image with its absolute path, for example `![Direction A, home](/abs/path/docs/design/<slug>/a-home.png)`, grouped by direction, with one line on each direction. Then ask in one message: which direction, and what to change.

Done when: the owner has the screenshots and the question.

### 4. Steer

Dispatch a new `design` task for the next round `<n+1>` of the same unit, with the owner's words verbatim in the task text and every earlier round in `--prior-file`. Then go back to step 3 with its result.

Repeat until the owner approves a direction. Stop at `maxReviewRounds` rounds and ask the owner how to go on.

Done when: the owner approved one direction, or the owner has the question at the round limit.

### 5. Write the spec

Dispatch one more `design` task in the next round. The task names the approved direction, the owner's last words verbatim, and the spec path `docs/design/<slug>.md`. It asks for the spec sections in [roles/design.md](../omt/references/roles/design.md). Record the dispatch and the result as in steps 2 and 3.

Check that the spec exists and that each screenshot path in it exists. Give the owner the spec path.

Done when: `docs/design/<slug>.md` exists, its screenshot paths exist, and the owner has the path.

### 6. Hand off

Every unit that builds or changes this UI cites `docs/design/<slug>.md` in its task and scope, and uses the `ui` role in every round. The test task of such a unit gets no `docs/design/` paths and no visual-match conditions; the `ui` task and the owner compare the result with the design. When `omt-plan` or `omt-ulw` called this skill, return to it with the spec path. Otherwise give the owner the spec path and the screenshot folder.

Done when: the caller, or the owner, has the spec path.
