---
name: omt-swarm
description: Run independent tracks in separate T3 worktree threads, each ending in a pull request.
disable-model-invocation: true
---

# Swarm

You split work into independent tracks and launch each as a top-level T3 thread in its own git worktree. Each track runs `omt-ulw` and ends in a pull request. Invoking this skill is the explicit user request that T3 requires before `t3_thread_launch`. The launch rules are in [delegation.md](../omt/references/delegation.md#top-level-threads); T3 tools appear by base name and your harness may prefix them, for example `mcp__t3-code__t3_thread_launch`.

## Steps

### 1. Check the modes

Call `orchestrator_capabilities`. `t3_thread_launch` requires that this thread runs in `full-access` runtime mode and `default` interaction mode.

Done when: both modes match. Otherwise tell the user which mode to change and stop.

### 2. Split into tracks

Run `omt plan new <slug> --light` (after `omt init` when `.omt/.gitignore` is missing) and write one unit per track. Launch at most `maxParallel` tracks (`omt config show`); put the rest in a later wave. Tracks share no files: two tracks that touch the same file become one track, or a stack where the later track builds on the earlier one.

- Independent tracks: each branches from the same base.
- Stacked tracks: each branches from the previous track's branch.

Run `git status --porcelain`. When it lists changes, tell the user that uncommitted edits stay in this checkout and do not reach the tracks, and ask them to commit what the tracks need before you launch.

Done when: each track has a kebab-case name, a scope, done conditions, a base ref, and a branch name `omt/<slug>/<track>`, and no two independent tracks share a file.

### 3. Launch

For each track, call `t3_thread_launch` with:

```json
{
  "title": "<slug>: <track>",
  "workspaceStrategy": { "type": "worktree", "baseRef": "<base>", "branch": "omt/<slug>/<track>", "startFromOrigin": false },
  "message": "<launch message>"
}
```

For a stacked track, `baseRef` is the previous track's branch and `startFromOrigin` is `false`, so the track starts from the local commits. Use `startFromOrigin: true` only to start from a freshly fetched remote base.

The launch message is a plain task, not an `omt brief`. It says:

1. Set `limits.maxParallel` to <k> in `.omt/config.jsonc` of this worktree (run `omt init` first when the file is missing), and leave that file out of your commits. Pick `<k>` so that the tracks together stay near this thread's `maxParallel`, for example 2.
2. Run the `omt-ulw` skill for this objective: <objective, scope, done conditions>. Give absolute paths when a scope is outside this worktree.
3. Commit each verified unit on branch `omt/<slug>/<track>`.
4. Push the branch and open a PR against `<base>`.
5. Report the PR URL as the last line of the final message.

After each call, record the thread id under the track's unit in the plan and with `omt ledger add --plan <slug> --unit <track> --role swarm --round 1 --attempt 1 --status dispatched --note <threadId>`. If a launch fails or its response is lost, call `t3_thread_list` and look for the thread before you launch again: the tool has no retry key.

Done when: every track has exactly one thread id in the plan and the ledger.

### 4. Monitor

Top-level threads never wake this thread, and `t3_thread_wait` returns at once on a thread that is idle. So after the launches, call `schedule_task` with `schedule` `{ "type": "interval", "everyMs": 600000 }` and the default `bindToCurrentThread`, so each firing is queued into this thread. The prompt must work without this skill in context. Fill in every placeholder:

```text
omt-swarm heartbeat for plan <slug>. Run at most <maxParallel> tracks at once.
Launched tracks: <unit id> <track>=<threadId>, ...
Waiting tracks, in launch order: <unit id> <track>: <the full t3_thread_launch arguments from step 3, as JSON>, ...
1. For each launched track, call t3_thread_read (view messages) and list_thread_pull_requests with its threadId. Do this on every run: a merged PR may settle its track thread and end that thread's watches.
2. For each PR not yet linked here, call link_pull_request and watch_pull_request with its URL, and record it in the plan's log.
3. Act only on a track that newly finished: one with no `completed` or `failed` swarm entry yet in `omt ledger list --plan <slug>`. For such a track that finished with a PR, run `omt plan mark <slug> <unit id> done` and `omt ledger add --plan <slug> --unit <track> --role swarm --round 1 --attempt 1 --status completed --note <PR URL>`. For a track that stopped on a question or a blocker, run `omt plan mark <slug> <unit id> blocked`, record `--status failed` with the blocker as the note, and pass the blocker to the user.
4. A launched track is running until it has a PR or a blocker. While a waiting track is left and fewer than <maxParallel> tracks are running, launch the first waiting track with t3_thread_launch and its arguments, run `omt ledger add --plan <slug> --unit <track> --role swarm --round 1 --attempt 1 --status dispatched --note <threadId>`, and record the thread id in the plan. If a launch fails or its response is lost, call t3_thread_list and look for the thread before you launch again.
5. When you launched a track, call list_scheduled_tasks, find this heartbeat (its prompt starts with "omt-swarm heartbeat for plan <slug>"), and call update_scheduled_task with this prompt, the track moved from the waiting list to the launched list with its threadId.
6. Report each track's state in one line.
7. When no waiting track is left and every launched track has a PR or a blocker, delete this heartbeat with delete_scheduled_task.
```

Report the schedule's cadence and next run time, then end your turn. Answer a track's question with `t3_thread_send` only when the user has given you the answer. The heartbeat launches the later waves.

Done when: every track has reported a PR URL, or a blocker that you have passed to the user, and the heartbeat is deleted.

### 5. Link and watch

The heartbeat links and watches each PR, and re-checks `list_thread_pull_requests` on every run, because a merged PR may settle its track thread and end that thread's watches. Check with `list_thread_pull_requests` (no `threadId`) that every PR is linked to this thread, and link any that is missing with `link_pull_request`, then `watch_pull_request`. T3 wakes this thread on a failed check, passing required checks, a new comment or review, or a conflict, and stops watching on merge or close. On each wake, read the PR state and send the track thread the failure or comment to fix.

Done when: every PR is linked and watched.

### 6. Merge

Merge independent PRs in any order once their checks pass and the user approves. Merge a stack bottom-up: merge the first PR, then retarget or rebase the next onto the base, and wait for its checks before merging it.

Done when: every PR is merged or closed, and each track's unit is marked with `omt plan mark <slug> <unit id> done` or `blocked`, with the reason in the plan's log.
