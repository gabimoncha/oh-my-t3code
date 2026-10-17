# Briefs

A brief is the whole world of a child task. The child sees nothing else. Write one brief per task.

## Layout

`omt brief` renders this layout. Without the CLI, write it by hand in the same order. Leave out an empty section, except `Role`, `Task`, `Constraints`, and `Final message`.

```text
<!-- omt-brief v1 role=<role> round=<n> depth=<d>/<max>[ plan=<slug>][ unit=<id>] -->

# Role: <role>

<persona: the content of roles/<role>.md>

# Task

<task text>

# Context

<background the child needs>

# Scope

- `<path>`

# Constraints

- <access line>
- <delegation line>
- <evidence line, edit roles only>
- <plan-mode line, read-only roles only>
- CLI: Run omt as <command>.
- Tests: <role's test policy; qa ends with failureProofs: on or failureProofs: off>
- You do not see the parent conversation. This brief is your full context. If you need something that is missing, say so in your final message.
- Other agents may edit other files in this repository at the same time. Leave changes outside your scope alone. Do not commit, push, or create branches.
- Processes: <process limits and session cleanup>
- Shared files: <private-copy rule for failure proofs>
- Shared builds: <lock and retry rule>
- Devices: <device rule, except for verify>

# Done when

- <condition>

# Verify

- `<command>`

# Prior rounds

<findings, responses, unresolved objections>

# Final message

End your work with the block below as your final message. Keep it under 60 lines and put nothing after it.

<the content of results/<kind>.md>
```

For edit roles, `omt brief` also gives the absolute path of the evidence directory, so the child saves evidence in the shared evidence directory (`omt paths --evidence`) even when it runs in another checkout. Give that path by hand when you write a brief without the CLI.

The first line marks the text as a brief. The omt ultrawork hook skips any prompt that holds it, so a brief that mentions ultrawork does not start a nested run.

Constraint lines, word for word:

- Read-only access: `Access: read-only. Change no files. Run only commands that leave the repository unchanged.`
- Edit access with a scope: `Access: edit. Change only the files in Scope. If the task needs a change outside Scope, stop and report it under OPEN.`
- Edit access without a scope: `Access: edit. Change only what the task needs.`
- At maximum depth for `verify` or a read-only role: `Delegation: you are at depth <d> of <max>. Do all work yourself. Start no subagents and no delegated tasks.`
- At maximum depth for another edit role: ``Delegation: you are at depth <d> of <max>. Do all work yourself. Start no subagents and no delegated tasks, except `verify` tasks for device checks (see Devices).`` With a plan or an explicit profile, append `For device checks, pass <selection> to omt brief.`
- Below maximum depth, with a plan or an explicit profile: `Delegation: you are at depth <d> of <max>. You may delegate with the T3 delegate_task tool. For each child, pass <selection> --depth <d+1>[ --max-depth <max>] to omt brief.` Here `<selection>` contains `--plan <slug>` when set and `--profile <name>` when explicit. Keep both flags when both were given. Include `--max-depth <max>` only when the max differs from the effective config.
- Below maximum depth, without a plan or an explicit profile: `Delegation: you are at depth <d> of <max>. You may delegate with the T3 delegate_task tool. Give each child depth <d+1> in its brief.`
- Plan mode: `Mode: you run in plan mode. Stay in it. Do not call ExitPlanMode and do not write a proposed plan. Put the result block in your final assistant message.`

Every brief has `CLI:`, `Tests:`, and `Shared builds:` lines. The `CLI:` line names `<project root>/.omt/bin/omt` when it exists, else `omt`. The `Tests:` line gives the role's test policy. For `qa`, it ends with `failureProofs: on` or `failureProofs: off` from `build.failureProofs`. The `Shared builds:` line requires the task's exact lock command. Retry a failed build or test only when the file is outside your scope and outside the task's named code under test. The file is the one where the error occurs, such as a file with a compile or load error, also when a test in your scope loads it. Wait 60 seconds and run the command once more. When it fails there again, report the command, the outside-scope file, and the message as another unit's state. For a failure in your scope or the named code under test, follow your result block. For `test` results, return `VERDICT: NOT VERIFIED` for that failure. When `omt lock run` exits 75, report the command, the lock name, and its message. Leave the lock to the conductor. For both reports: in `work` results, keep the `STATUS` that your own work earns and put the report under `OPEN`. For `test` results, including `verify` and `qa`, return `VERDICT: INCONCLUSIVE` and put the report under `FAILURES`. For other results, put the report under `NOTES`, or before the result block when it has no `NOTES`.

Workers write no new test file or case. A worker updates an existing test only when its change breaks the test and reports that update under `NOTES`. Give `qa` only the unit's approved `## Tests` lines. Give `verify` the checks and main flows without new tests. Read [delegation.md](delegation.md#verification-and-devices) for device routing and [delegation.md](delegation.md#shared-builds) for lock handling.

## Writing the task text

The task text carries four things. A brief that lacks one gets a guess in its place.

1. **Deliverable**: the exact artifact or answer. "Add a `refreshToken()` method to `src/auth/session.ts` that ..." beats "improve token handling".
2. **Scope**: the files the child may change, or must read. For parallel units, scopes are disjoint. Relative paths resolve against the child's checkout, which is yours for a delegated child. When the child works in another checkout, or must touch files outside your checkout, give absolute paths.
3. **Verify**: commands that can fail and that prove the done conditions. Prefer the project's own test command, narrowed to the unit.
4. **Stop condition**: when to stop and report instead of push on. For example: "If the fix needs a schema change, stop with STATUS: ESCALATE."

Put background in `Context`, not in `Task`: the relevant decisions, file paths with line numbers, error output, and what was already tried. Point at files instead of pasting them. For a review of uncommitted work, give the scope paths; workers do not commit, so there are no refs to diff. For committed work, give git refs (`git diff <base>...<head> -- <paths>`). Paste a diff only when it is short. The task text has a limit of 120,000 characters ([delegation.md](delegation.md)).

For round 2 and later, `Prior rounds` holds every earlier finding, the response to each, and each objection still open. A fresh child cannot see earlier rounds any other way.

## Example

Command:

```sh
printf '%s\n' "Add retry with exponential backoff to fetchJson in src/http/client.ts." \
  "Retry only on network errors and HTTP 502, 503, 504. Three attempts, delays 200 ms and 400 ms." \
  "If a caller depends on the first failure being thrown at once, stop with STATUS: ESCALATE." \
| omt brief execute --task-file - \
  --context "Callers: src/sync/pull.ts:41 and src/sync/push.ts:58. Tests use node:test with a fake fetch in test/http/fakeFetch.ts." \
  --scope src/http/client.ts --scope test/http/client.test.ts \
  --done "fetchJson retries on 502, 503, 504, and network errors, at most 3 attempts" \
  --done "fetchJson does not retry on 4xx" \
  --verify "node --test test/http/client.test.ts" \
  --verify "pnpm typecheck" \
  --title "execute U2: retry in fetchJson" \
  --plan http-retry --unit U2 --round 1 --attempt 1 --save --json
```

Saved brief (abridged):

```text
<!-- omt-brief v1 role=execute round=1 depth=1/1 plan=http-retry unit=U2 -->

# Role: execute

You implement one planned unit. ...

# Task

Add retry with exponential backoff to fetchJson in src/http/client.ts.
Retry only on network errors and HTTP 502, 503, 504. Three attempts, delays 200 ms and 400 ms.
If a caller depends on the first failure being thrown at once, stop with STATUS: ESCALATE.

# Context

Callers: src/sync/pull.ts:41 and src/sync/push.ts:58. Tests use node:test with a fake fetch in test/http/fakeFetch.ts.

# Scope

- `src/http/client.ts`
- `test/http/client.test.ts`

# Constraints

- Access: edit. Change only the files in Scope. If the task needs a change outside Scope, stop and report it under OPEN.
- Delegation: you are at depth 1 of 1. Do all work yourself. Start no subagents and no delegated tasks, except `verify` tasks for device checks (see Devices). For device checks, pass --plan http-retry to omt brief.
- CLI: Run omt as omt.
- Tests: write no new test file and no new test case, and do not prove that tests can fail. Update an existing test only when your change breaks it, and say so under NOTES.
- You do not see the parent conversation. ...
- Other agents may edit other files in this repository at the same time. ...
- Processes: ...
- Shared files: ...
- Shared builds: run a command that the task wraps in `omt lock run` exactly as written. ...
- Devices: ...

# Done when

- fetchJson retries on 502, 503, 504, and network errors, at most 3 attempts
- fetchJson does not retry on 4xx

# Verify

- `node --test test/http/client.test.ts`
- `pnpm typecheck`

# Final message

End your work with the block below as your final message. Keep it under 60 lines and put nothing after it.

STATUS: DONE | BLOCKED | ESCALATE
...
```

With `--save --json`, the full brief is in `<evidence>/briefs/omt:http-retry:U2:execute:r1:a1.md`. The JSON output has a short `delegateTask.task` that names that file, plus `clientRequestId` `omt:http-retry:U2:execute:r1:a1`. Run its `ledger.dispatched` line with the returned task id in place of `<taskId>`.
