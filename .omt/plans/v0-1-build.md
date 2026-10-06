# Build oh-my-t3code v0.1

<!-- omt-plan v1 slug=v0-1-build created=2026-10-06T00:00:00Z -->

## Objective

Ship oh-my-t3code v0.1: a zero-dependency `omt` CLI, seven portable skills, and a role config. A T3 user can then run `omt install` and type `$omt-ulw <task>` or `ulw <task>` in any T3 thread to get a planned, role-routed, reviewed, and tested run on T3 orchestrator v2. The contract is `docs/spec.md`. The rationale is `docs/design.md`.

## Done when

- [x] D1. `pnpm check` passes (typecheck and all tests).
- [x] D2. `pnpm build` produces `dist/cli.js`, and `node dist/cli.js --help` lists 11 commands.
- [x] D3. `omt roles --capabilities <real orchestrator_capabilities file>` resolves execute, review, and test to the user's chosen models.
- [x] D4. `omt install --yes` into a temp HOME creates the skills, links, and config. A second run reports only unchanged actions. `omt uninstall --yes` removes them.
- [x] D5. A live `delegate_task` round trip with a brief from `omt brief --json` returns a result block in the role's contract format.
- [x] D6. The final review (Opus 5.5 high) approves the code and the skills.

## Roles

Subagent policy from the user for this build:

- Execution: claudeAgent/claude-opus-5-5, effort medium.
- Review: claudeAgent/claude-opus-5-5, effort high.
- Testing: claudeAgent/claude-sonnet-5-5, effort medium.

## Units

- [x] U0. Scaffold, shared types, paths, defaults, stubs
  - Role: execute
  - Scope: package.json, tsconfig*, .gitignore, LICENSE, AGENTS.md, CLAUDE.md, src/ (types, util, paths, main, cli, config/defaults, config/starter, stubs, commands stubs), test/ (helpers, cli, paths, util, defaults)
  - Done when: `pnpm typecheck` and `pnpm test` pass; the help text lists 11 commands
  - Verify: `pnpm check`
  - Depends on: none
- [x] U1. Config: JSONC, validation, merge, load, schema, `config` and `init` commands
  - Role: execute
  - Scope: src/config/ (except defaults.ts, starter.ts), scripts/build-schema.ts, schema/, src/commands/config.ts, src/commands/init.ts, test/config/
  - Done when: spec sections 5.1, 5.2, 6, 7 hold; tests cover section 16 config, JSONC, and schema items
  - Verify: `node --test "test/config/**/*.test.ts"`
  - Depends on: U0
- [x] U2. Routing: capabilities, effort mapping, role resolution, table format
  - Role: execute
  - Scope: src/routing/, test/routing/, test/fixtures/capabilities.json
  - Done when: spec section 8 holds; tests cover section 16 routing items
  - Verify: `node --test "test/routing/**/*.test.ts"`
  - Depends on: U0
- [x] U3. Skills and shared references
  - Role: writing
  - Scope: skills/
  - Done when: spec section 15 holds; every relative link resolves
  - Verify: the skills test in U5 or C1
  - Depends on: U0
- [x] U4. Install and uninstall
  - Role: execute
  - Scope: src/install/ (except doctor.ts), src/commands/install.ts, src/commands/uninstall.ts, test/install/
  - Done when: spec sections 14.1 to 14.6 hold
  - Verify: `node --test "test/install/**/*.test.ts"`
  - Depends on: U0
- [x] U5. Plans, ledger, ultrawork hook, brief rendering
  - Role: execute
  - Scope: src/plan/, src/ledger/, src/hooks/, src/brief/, src/commands/plan.ts, src/commands/ledger.ts, src/commands/hook.ts, test/plan/, test/ledger/, test/hooks/, test/brief/
  - Done when: spec sections 5.5 to 5.7, 9, 10, 12, 13 hold
  - Verify: `node --test "test/{plan,ledger,hooks,brief}/**/*.test.ts"`
  - Depends on: U0
- [x] C1. Integration: roles, route, brief, doctor commands; skills and CLI tests; README; build
  - Role: execute
  - Scope: src/commands/{roles,route,brief,doctor}.ts, src/install/doctor.ts, test/commands/, test/skills.test.ts, README.md, docs/
  - Done when: D1 and D2 hold
  - Verify: `pnpm check && pnpm build && node dist/cli.js --help`
  - Depends on: U1, U2, U3, U4, U5
- [x] R1. Code review of src/ and test/
  - Role: review
  - Depends on: C1
- [x] R2. Skills and docs review for agent use and T3 accuracy
  - Role: review
  - Depends on: C1
- [x] T1. Black-box CLI testing in a temp HOME
  - Role: test
  - Depends on: C1
- [x] T2. Live T3 checks (D3, D5)
  - Role: test
  - Depends on: C1

## Final verification

- [x] F1. The full test suite passes: `pnpm check`
- [x] F2. The review role approves the whole change after fixes.

## Log

- 2026-10-06 research done: docs/research/*.md (4 reports).
- 2026-10-06 experiment: a Claude child in plan mode returns its final message intact. Read-only roles default to plan mode.
- 2026-10-06 design.md and spec.md written. Spec review r1 and U0 dispatched.
- 2026-10-06 spec review r1 (opus 5.5 high): REQUEST_CHANGES, 26 findings. All applied to spec.md and design.md.
- 2026-10-06 experiment: a Codex child (gpt-6-luna, low) in plan mode returned its block intact, but reported LINES=23 for a 5-line file without running a tool. Claims need checks.
- 2026-10-06 U0 done and checked by the parent: typecheck passes, 32/32 tests. Parent added RouteOutput, BriefJsonOutput, LedgerEntry, LedgerStats, and nodeVersion to src/types.ts.
- 2026-10-06 dispatched U1, U2, U3, U4, U5 in parallel (opus 5.5 medium).
- 2026-10-06 U2 routing done (39 tests). Parent check: all 11 default roles resolve against the live capabilities; execute opus medium, review opus high, test sonnet medium.
- 2026-10-06 U5 plan/ledger/hook/brief done (38 tests). Parent check: plan status, request-id, and hook behave per spec.
- 2026-10-06 U1 config done (63 tests). U4 install done (35 tests; Claude hooks docs match spec 14.4). U3 skills done (11 tests).
- 2026-10-06 parent check: pnpm check passes, 218 tests. C1 integration dispatched.
- 2026-10-06 C1 done (251 tests). Parent check: pnpm check 251/251; pnpm build; node dist/cli.js --help lists 11 commands; built `omt roles --capabilities <live file>`: execute opus-5-5 medium, review opus-5-5 high, test sonnet-5-5 medium, oracle gpt-6-astra high. D1, D2, D3 verified.
- 2026-10-06 dispatched R1 (code review), R2 (skills and docs review) on opus 5.5 high; T1 (black-box CLI), T2 (live T3 round trip and mini ulw) on sonnet 5.5 medium.
- 2026-10-06 R1 code review (opus 5.5 high): REQUEST_CHANGES. P1 uninstall deletes an edited skill; P1 settings.json mode widened 0600 -> 0644; P2 ledger slots, request id truncation, tests; P3 validation and symlink edge cases.
- 2026-10-06 R2 skills review (opus 5.5 high): BLOCK. P0 test persona used git stash in a shared checkout; P1 ledger slots, budget stall, LIGHT F2, swarm monitoring, untracked files; 12 P2, 7 P3.
- 2026-10-06 T1 black-box CLI (sonnet 5.5 medium): VERIFIED, 11 scenarios, evidence .omt/evidence/t1-*.log. D4 verified.
- 2026-10-06 T2 live T3 (sonnet 5.5 medium): VERIFIED. Research round trip returned the contract with a correct answer (D5). Mini ulw: execute opus medium -> review opus high (plan mode, APPROVE) -> test sonnet medium (VERIFIED); toy tests 6/6. Friction list in .omt/evidence/t2-friction.log.
- 2026-10-06 dispatched F1 (code fixes, round 2) and F2 (skills and docs fixes, round 2) in parallel (opus 5.5 medium).
- 2026-10-06 F1 code fixes done (276 tests): edited skills kept on uninstall, file modes preserved, ledger matching by key, request id caps, id validation, plan mark, plan new --light, brief --max-depth and evidence line, hook tolerant of extra args.
- 2026-10-06 F2 skills fixes done: all 29 findings, including the P0 git stash removal. Parent check: CLI ledger warnings match the skills; results.md wording corrected; spec 15.2 updated by the parent.
- 2026-10-06 dispatched R3 (code re-review r2) and R4 (skills re-review r2) on opus 5.5 high, T3 (regression and skill command shapes) on sonnet 5.5 medium.
- 2026-10-06 T3 regression (sonnet 5.5 medium): VERIFIED. All fixed behaviors pass; all 56 omt command shapes in skills/ parse and run.
- 2026-10-06 R3 code re-review r2 (opus 5.5 high): APPROVE. All 8 round 1 findings confirmed fixed. New: 2 P2 (symlinked cwd root, symlinked plan file) and 3 notes.
- 2026-10-06 R4 skills re-review r2 (opus 5.5 high): REQUEST_CHANGES. P0 and round 1 P1s fixed. New: 1 P1 (.omt/ flagged out of scope), 9 P2, 6 P3.
- 2026-10-06 dispatched F3 (code r3) and F4 (skills r3) in parallel (opus 5.5 medium).
- 2026-10-06 F3 code r3 done (282 tests; each new test fails with its fix reverted). F4 skills r3 done (17 items). Parent removed the unsafe printf hash example in omt-plan. Parent check: pnpm check 282/282, no em dashes.
- 2026-10-06 dispatched R5 final gate review (opus 5.5 high) and T4 final regression (sonnet 5.5 medium).
- 2026-10-06 T4 final regression (sonnet 5.5 medium): VERIFIED. 282/282; build, built install/doctor/uninstall, npm pack contents, round 3 fixes, all valid skill command shapes. One unreproduced hang in a first install/doctor/uninstall chain.
- 2026-10-06 R5 final gate (opus 5.5 high): APPROVE. No P0 or P1. Parent applied its P2 and P3 text fixes (per-proof temp dir in test.md, full oracle dispatch flags, swarm heartbeat records only new finishes, README composer mention) and re-ran: pnpm check 282/282; oracle brief and proof snippet run.
