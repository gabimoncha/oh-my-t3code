---
name: omt-design
description: Design pass with an Opus designer in T3 Code. Use when the user asks for designs, mockups, screens, UX, or a design pass, or when omt-plan or omt-ulw needs designs before UI units. Dispatches a design task with the profile's variant count in a new Paper file, shows the screenshots by screen, lets the owner pick one variant per screen and steer, repeats until the owner approves, and writes a design spec that UI units cite.
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

When the ledger plan has a plan file, run `omt profile show --plan <ledger plan> --json`. When the ledger plan has no plan file, use `omt profile show <name> --json` for an explicit profile name. When neither a plan file nor a profile name exists, run `omt profile show --json`. Keep the returned `profile` as `<name>` for later commands. Read `limits.maxReviewRounds` as `maxReviewRounds`.

With a selected profile and no plan file for the `--plan` id:

- Pass `--profile <name>` to every `omt brief`, `omt roles`, and `omt route` command.
- Before each dispatch, run `omt ledger stats --plan <ledger plan>` and `omt profile show <name> --json`.
- Dispatch only when the ledger's `dispatched` is below the profile's `limits.maxTasksPerRun` and `active` is below `limits.maxParallel`.
- Use this check in place of `can dispatch`.

Done when: the frame and the slug are written in your reply.

### 2. Dispatch the variants

Read the effective profile again with the step 1 command before each design pass. Read `workflow.design.variants` as `design.variants`. Use `design.variants` as the number of distinct variants of each screen in the task. Ask for a screenshot of every variant.

Before each dispatch, run `omt ledger stats --plan <ledger plan>`. When a plan file exists, dispatch only while it reports `can dispatch: yes`. Otherwise, use the step 1 dispatch check. Build the brief with `omt brief design --task-file - --title "design DS<k>: <slug> variants" --scope docs/design/<slug>/ --scope docs/design/<slug>.md --plan <ledger plan> --unit DS<k> --round 1 --attempt 1 --json`. The task carries the frame from step 1. When the owner asked for another count, use that count. The task asks the designer to make a new Paper file named after the project, not to reuse an open file.

Call `delegate_task`, record the dispatch with `--task-id`, `--provider`, and `--model` ([results.md](../omt/references/results.md#recording)), and end your turn.

A `design` dispatch never falls back to another family. When T3 refuses its rung, or `omt roles --plan <ledger plan>` reports `design` as `unavailable`, stop and tell the owner which target failed and why.

Done when: the design task has a ledger entry, or the owner knows why it cannot run.

### 3. Owner checkpoint

On wake, read the result and record it ([results.md](../omt/references/results.md#recording)). Check that each screenshot path in `CHANGES` exists.

Show the owner every screenshot as an image with its absolute path, for example `![Home, variant A](/abs/path/docs/design/<slug>/home-a.png)`. Group the screenshots by screen, with one line on each variant. Then ask in one message: which variant for each screen, and what to change. The owner may mix variants across screens.

Done when: the owner has the screenshots and the question.

### 4. Steer

Dispatch a new `design` task for the next round `<n+1>` of the same unit, with the owner's words verbatim in the task text and every earlier round in `--prior-file`. The task names the Paper file from the first result. Then go back to step 3 with its result.

Repeat until the owner approves one variant for each screen. Stop at `maxReviewRounds` rounds and ask the owner how to go on.

Done when: the owner approved one variant for each screen, or the owner has the question at the round limit.

### 5. Write the spec

Dispatch one more `design` task in the next round. The task names the Paper file from the first result, the approved variant of each screen, the owner's last words verbatim, and the spec path `docs/design/<slug>.md`. It asks for the spec sections in [roles/design.md](../omt/references/roles/design.md). Record the dispatch and the result as in steps 2 and 3.

Check that the spec exists and that each screenshot path in it exists. Give the owner the spec path.

Done when: `docs/design/<slug>.md` exists, its screenshot paths exist, and the owner has the path.

### 6. Hand off

Before you report, run the settle sweep ([delegation.md](../omt/references/delegation.md#releasing-children)).

Every unit that builds or changes this UI cites `docs/design/<slug>.md` in its task and scope, and uses the `ui` role in every round. The `verify` task of such a unit gets no `docs/design/` paths and no visual-match conditions. The `ui` task and the owner compare the result with the design. When `omt-plan` or `omt-ulw` called this skill, return to it with the spec path. Otherwise give the owner the spec path and the screenshot folder.

Done when: the caller, or the owner, has the spec path.
