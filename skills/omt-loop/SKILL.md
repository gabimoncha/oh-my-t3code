---
name: omt-loop
description: Keep omt work going across turns until a condition holds, with native /goal or a scheduled heartbeat.
disable-model-invocation: true
---

# Loop

You keep a plan moving across turns until a condition command reports done. The T3 rules are in [delegation.md](../omt/references/delegation.md); T3 tools appear by base name and your harness may prefix them, for example `mcp__t3-code__schedule_task`.

## Steps

### 1. Set the condition

Agree with the user on a plan, a condition command, and a cap:

- The plan: an existing `.omt/plans/<slug>.md`, or one you write with `omt-plan`.
- The condition command exits 0 when the work is done, 1 when work remains, and 2 when the check itself fails. Use this one unless the user gives another:

  ```sh
  omt plan status <slug> --json | node -e 'let s; try { s = JSON.parse(require("fs").readFileSync(0, "utf8")); } catch { process.exit(2); } process.exit(s.complete === true ? 0 : s.complete === false ? 1 : 2)'
  ```

- The cap: at most 20 ticks unless the user sets another number.

Done when: the condition command runs once and exits 0 or 1.

### 2. Pick the mechanism

On a Claude or Codex thread, ask the user to type `/goal <objective>`, with the objective naming the plan, the condition command, the cap, and this skill. No MCP tool sets or reads a goal, so you cannot set it yourself. `/goal clear` removes it. Each goal continuation turn counts as one tick: run step 3 once per turn. Under a goal your turn keeps running, so follow the no-wake waiting rules in [delegation.md](../omt/references/delegation.md#waiting).

On other providers, or when the user prefers a heartbeat, call `schedule_task` with a structured `schedule` object (never JSON text) and leave `bindToCurrentThread` at its default, so each firing is queued into this thread:

```json
{ "type": "interval", "everyMs": 600000 }
```

`everyMs` is at least 60,000. A wall-clock schedule is `{ "type": "fixed_time", "timeOfDay": "09:00", "weekdays": [1, 2, 3, 4, 5] }`. The tick prompt must work without this skill in context. Fill in every placeholder:

```text
omt-loop tick for plan <slug>, cap <N> ticks.
1. Count ticks: the entries with role "loop" in `omt ledger list --plan <slug> --json`. At <N> or more, go to 5.
2. Run the condition: <condition command>. Exit 0: go to 5. Exit 2 or any other code: the check is broken; go to 5 and report it.
3. Read every finished task with task_status and record it, then follow the omt-ulw steps for plan <slug>: dispatch what is ready, run the final gate when every unit is done. If no unit is open or active and the plan is not complete, go to 5 and report the blocked units. If `omt ledger stats --plan <slug>` reports `can dispatch: no` and `active: 0`, the budget is spent: go to 5 and report the limit it names.
4. Record the tick: `omt ledger add --plan <slug> --role loop --status completed --note "tick <n>: exit <code>, <action>"`. End the turn.
5. Stop: record the tick as in 4. Call list_scheduled_tasks, delete the schedule whose prompt starts with "omt-loop tick for plan <slug>" with delete_scheduled_task, and report the ticks used, the condition result, what finished, and what remains.
```

Record the schedule id in the plan's log.

Done when: the user confirms the goal is set, or `schedule_task` returned an id and you reported its cadence and next run time.

### 3. On each tick

1. Count the ticks so far: the entries with role `loop` in `omt ledger list --plan <slug> --json`. At the cap, record the tick (item 4) and go to the Stop section.
2. Run the condition command. Exit 0: record the tick (item 4) and go to the Stop section. Exit 1: continue. Exit 2 or any other code: the check is broken; record the tick (item 4), go to the Stop section, and report it.
3. Read finished tasks first and record them, then continue with the `omt-ulw` steps: dispatch what is ready, and run its final gate when every unit is done. Run `omt plan status <slug>` and `omt ledger stats --plan <slug>`. When no `next` unit is shown, `active` is 0, and the plan is not complete because units are blocked, record the tick (item 4), go to the Stop section, and report the blocked units. When `omt ledger stats` reports `can dispatch: no` and `active: 0`, the budget is spent and no task will finish to free it: record the tick (item 4), go to the Stop section, and report the limit it names.
4. Record the tick: `omt ledger add --plan <slug> --role loop --status completed --note "tick <n>: exit <code>, <action>"`. It closes no dispatch, so its warning is expected.

Done when: the tick has a ledger entry, and the dispatched work for this tick is recorded.

### 4. Stop

Delete the schedule with `delete_scheduled_task`, or ask the user to type `/goal clear`. Then report: the ticks used, the condition result, what finished, what remains, and each blocked unit with its reason. `list_scheduled_tasks` confirms the schedule is gone.

Done when: no schedule for this loop remains, and the user has the report.

## Managing the schedule

`list_scheduled_tasks` lists schedules, `update_scheduled_task` changes the cadence or prompt, and `run_scheduled_task_now` fires a tick at once.
