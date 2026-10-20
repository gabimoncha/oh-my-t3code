import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { run } from "../../src/commands/ledger.ts";
import { appendLedger, ledgerStats, readLedger, requestId } from "../../src/ledger/ledger.ts";
import type { LedgerEntry } from "../../src/types.ts";
import { omtExit, projectContext, tempDir, writeFile } from "../helpers.ts";

const TS = "2026-01-02T03:04:05.000Z";

function entry(fields: Partial<LedgerEntry>): LedgerEntry {
  return { ts: TS, role: "execute", status: "dispatched", ...fields };
}

test("appendLedger creates .omt and writes one JSON line per entry", async () => {
  const path = join(tempDir(), "project", ".omt", "ledger.jsonl");
  await appendLedger(path, entry({ taskId: "t1" }));
  await appendLedger(path, entry({ taskId: "t1", status: "completed", verdict: "DONE" }));
  const lines = readFileSync(path, "utf8").split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[2], "");
  assert.deepEqual(JSON.parse(lines[1] ?? ""), entry({ taskId: "t1", status: "completed", verdict: "DONE" }));
});

test("concurrent appends keep every entry", async () => {
  const path = join(tempDir(), ".omt", "ledger.jsonl");
  await Promise.all(Array.from({ length: 50 }, (_, i) => appendLedger(path, entry({ taskId: `t${i}` }))));
  const { entries, warnings } = await readLedger(path);
  assert.equal(entries.length, 50);
  assert.deepEqual(warnings, []);
});

test("readLedger skips malformed lines with a warning and handles a missing file", async () => {
  const dir = tempDir();
  const path = join(dir, "ledger.jsonl");
  assert.deepEqual(await readLedger(path), { entries: [], warnings: [] });
  appendFileSync(path, `${JSON.stringify(entry({}))}\nnot json\n\n{"ts":"x","role":"r","status":"bogus"}\n[1]\n`);
  const { entries, warnings } = await readLedger(path);
  assert.equal(entries.length, 1);
  assert.equal(warnings.length, 3);
  assert.match(warnings[0] ?? "", /ledger\.jsonl:2: /);
  assert.match(warnings[1] ?? "", /ledger\.jsonl:4: /);
});

test("ledgerStats counts dispatched, active, and terminal entries, optionally per plan", () => {
  const entries = [
    entry({ plan: "a", taskId: "t1" }),
    entry({ plan: "a", taskId: "t2" }),
    entry({ plan: "a", taskId: "t3" }),
    entry({ plan: "a", taskId: "t1", status: "completed" }),
    entry({ plan: "a", taskId: "t2", status: "verified" }),
    entry({ plan: "a", taskId: "t3", status: "cancelled" }),
    entry({ plan: "b", taskId: "t4" }),
    entry({ plan: "b", taskId: "t5" }),
    entry({ plan: "b", taskId: "t5", status: "failed" }),
  ];
  const limits = { maxParallel: 4, maxTasksPerRun: 24 };
  const extra = { limits, canDispatch: true };
  assert.deepEqual(ledgerStats(entries, limits), { dispatched: 5, active: 1, terminal: 4, ...extra });
  assert.deepEqual(ledgerStats(entries, limits, "a"), { plan: "a", dispatched: 3, active: 0, terminal: 3, ...extra });
  assert.deepEqual(ledgerStats(entries, limits, "b"), { plan: "b", dispatched: 2, active: 1, terminal: 1, ...extra });
  assert.deepEqual(ledgerStats([], limits, "c"), { plan: "c", dispatched: 0, active: 0, terminal: 0, ...extra });
});

test("ledgerStats sets canDispatch from both limits", () => {
  const entries = [entry({ taskId: "t1" }), entry({ taskId: "t2" }), entry({ taskId: "t1", status: "completed" })];
  assert.equal(ledgerStats(entries, { maxParallel: 2, maxTasksPerRun: 3 }).canDispatch, true);
  assert.equal(ledgerStats(entries, { maxParallel: 1, maxTasksPerRun: 3 }).canDispatch, false);
  assert.equal(ledgerStats(entries, { maxParallel: 2, maxTasksPerRun: 2 }).canDispatch, false);
});

test("requestId builds the canonical id with defaults, sanitizing, and per-part caps", () => {
  assert.equal(requestId("auth", "U3", "review"), "omt:auth:U3:review:r1:a1");
  assert.equal(requestId("auth", "U3", "review", 2, 3), "omt:auth:U3:review:r2:a3");
  assert.equal(requestId("a b/c", "U:1", "rev@iew", 1, 1), "omt:a-b-c:U-1:rev-iew:r1:a1");
  assert.equal(requestId("v1.2_x", "U-1", "r", 1, 1), "omt:v1.2_x:U-1:r:r1:a1");
  const long = requestId("p".repeat(300), "u".repeat(300), "r".repeat(300), 12, 34);
  assert.equal(long, `omt:${"p".repeat(64)}:${"u".repeat(64)}:${"r".repeat(32)}:r12:a34`);
  assert.notEqual(long, requestId("p".repeat(300), "u".repeat(300), "r".repeat(300), 12, 35));
});

test("ledger add appends an entry and prints it as JSON", async () => {
  const ctx = projectContext([
    "add",
    "--role",
    "review",
    "--status",
    "dispatched",
    "--plan",
    "auth",
    "--unit",
    "U3",
    "--round",
    "2",
    "--attempt",
    "1",
    "--task-id",
    "task-0123456789abcdef",
    "--client-request-id",
    "omt:auth:U3:review:r2:a1",
    "--provider",
    "claudeAgent",
    "--model",
    "claude-opus-5-5",
    "--note",
    "first try",
  ]);
  assert.equal(await run(ctx), 0);
  const expected = {
    ts: TS,
    role: "review",
    status: "dispatched",
    plan: "auth",
    unit: "U3",
    round: 2,
    attempt: 1,
    taskId: "task-0123456789abcdef",
    clientRequestId: "omt:auth:U3:review:r2:a1",
    provider: "claudeAgent",
    model: "claude-opus-5-5",
    note: "first try",
  };
  assert.deepEqual(JSON.parse(ctx.out()), expected);
  const { entries } = await readLedger(join(ctx.cwd, ".omt", "ledger.jsonl"));
  assert.deepEqual(entries, [expected]);
});

test("ledger add rejects bad input with exit code 2", async () => {
  const cases = [
    ["add", "--status", "dispatched"],
    ["add", "--role", "x"],
    ["add", "--role", "x", "--status", "done"],
    ["add", "--role", "x", "--status", "failed", "--round", "0"],
    ["add", "--role", "x", "--status", "failed", "--attempt", "1.5"],
    ["add", "--role", "x", "--status", "failed", "--json"],
    ["add", "--role", "x", "--status", "failed", "--bogus"],
    ["nope"],
    [],
  ];
  for (const argv of cases) {
    const ctx = projectContext(argv);
    await assert.rejects(run(ctx), omtExit(2), argv.join(" "));
  }
});

test("ledger list prints a table, filters by plan, and warns on malformed lines", async () => {
  const ctx = projectContext(["list"]);
  const path = join(ctx.cwd, ".omt", "ledger.jsonl");
  await appendLedger(path, entry({ plan: "auth", unit: "U3", role: "review", round: 2, taskId: "task-0123456789abcdef" }));
  appendFileSync(path, "{broken\n");
  await appendLedger(path, entry({ plan: "other", status: "completed", verdict: "DONE" }));

  assert.equal(await run(ctx), 0);
  const lines = ctx.out().split("\n");
  assert.match(lines[0] ?? "", /^TIME\s+PLAN\s+UNIT\s+ROLE\s+ROUND\s+STATUS\s+VERDICT\s+TASK$/);
  assert.match(lines[1] ?? "", /^03:04:05\s+auth\s+U3\s+review\s+2\s+dispatched\s+-\s+456789abcdef$/);
  assert.match(lines[2] ?? "", /^03:04:05\s+other\s+-\s+execute\s+-\s+completed\s+DONE\s+-$/);
  assert.match(ctx.err(), /warning: .*ledger\.jsonl:2: /);

  const json = ctx.at(["list", "--plan", "auth", "--json"]);
  assert.equal(await run(json), 0);
  const parsed = JSON.parse(json.out());
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].unit, "U3");
});

test("ledger stats prints LedgerStats as text and JSON", async () => {
  const ctx = projectContext(["stats"]);
  const path = join(ctx.cwd, ".omt", "ledger.jsonl");
  await appendLedger(path, entry({ plan: "auth", taskId: "t1" }));
  await appendLedger(path, entry({ plan: "auth", taskId: "t2" }));
  await appendLedger(path, entry({ plan: "auth", taskId: "t1", status: "completed" }));

  assert.equal(await run(ctx), 0);
  assert.equal(
    ctx.out(),
    "profile: normal\ndispatched: 2\nactive: 1\nterminal: 1\nmax parallel: 6\nmax tasks per run: 24\ncan dispatch: yes\n",
  );

  const json = ctx.at(["stats", "--plan", "auth", "--json"]);
  assert.equal(await run(json), 0);
  assert.deepEqual(JSON.parse(json.out()), {
    plan: "auth",
    dispatched: 2,
    active: 1,
    terminal: 1,
    limits: { maxParallel: 6, maxTasksPerRun: 24 },
    canDispatch: true,
  });
});

test("ledger stats reads the limits from the project config", async () => {
  const ctx = projectContext(["stats", "--plan", "auth"]);
  writeFile(join(ctx.cwd, ".omt", "config.jsonc"), '{ "version": 1, "limits": { "maxParallel": 1 } }\n');
  await appendLedger(join(ctx.cwd, ".omt", "ledger.jsonl"), entry({ plan: "auth", taskId: "t1" }));
  assert.equal(await run(ctx), 0);
  assert.match(ctx.out(), /^max parallel: 1$/m);
  assert.match(ctx.out(), /^can dispatch: no$/m);
});

test("ledger stats --plan uses the lower of the plan and config max parallel", async () => {
  const ctx = projectContext(["stats", "--plan", "auth"]);
  writeFile(join(ctx.cwd, ".omt", "config.jsonc"), '{ "version": 1, "limits": { "maxParallel": 4 } }\n');
  writeFile(
    join(ctx.cwd, ".omt", "plans", "auth.md"),
    "# Auth\n\n<!-- omt-plan v1 slug=auth created=2026-01-01T00:00:00.000Z max-parallel=1 -->\n",
  );
  await appendLedger(join(ctx.cwd, ".omt", "ledger.jsonl"), entry({ plan: "auth", taskId: "t1" }));
  assert.equal(await run(ctx), 0);
  assert.match(ctx.out(), /^max parallel: 1 \(plan 1, config 4\)$/m);
  assert.match(ctx.out(), /^can dispatch: no$/m);

  const json = ctx.at(["stats", "--plan", "auth", "--json"]);
  assert.equal(await run(json), 0);
  const parsed = JSON.parse(json.out());
  assert.equal(parsed.limits.maxParallel, 1);
  assert.equal(parsed.planMaxParallel, 1);
  assert.equal(parsed.canDispatch, false);

  const other = ctx.at(["stats", "--plan", "nofile", "--json"]);
  assert.equal(await run(other), 0);
  assert.deepEqual(JSON.parse(other.out()), {
    plan: "nofile",
    dispatched: 0,
    active: 0,
    terminal: 0,
    limits: { maxParallel: 4, maxTasksPerRun: 24 },
    canDispatch: true,
  });
});

test("ledger stats --plan ignores a max-parallel key quoted in the plan body", async () => {
  const ctx = projectContext(["stats", "--plan", "auth"]);
  writeFile(join(ctx.cwd, ".omt", "config.jsonc"), '{ "version": 1, "limits": { "maxParallel": 4 } }\n');
  writeFile(
    join(ctx.cwd, ".omt", "plans", "auth.md"),
    "# Auth\n\n<!-- omt-plan v1 slug=auth created=2026-01-01T00:00:00.000Z -->\n\n" +
      "- [ ] U2. Example `<!-- omt-plan v1 slug=x created=... max-parallel=1 -->`\n\n" +
      "<!-- omt-plan v1 slug=x created=2026-01-01T00:00:00.000Z max-parallel=1 -->\n",
  );
  assert.equal(await run(ctx), 0);
  assert.match(ctx.out(), /^max parallel: 4$/m);
});

test("ledger stats --plan uses the plan max-tasks also when it is above the config value", async () => {
  const ctx = projectContext(["stats", "--plan", "auth"]);
  writeFile(join(ctx.cwd, ".omt", "config.jsonc"), '{ "version": 1, "limits": { "maxTasksPerRun": 1 } }\n');
  writeFile(
    join(ctx.cwd, ".omt", "plans", "auth.md"),
    "# Auth\n\n<!-- omt-plan v1 slug=auth created=2026-01-01T00:00:00.000Z max-tasks=80 -->\n",
  );
  await appendLedger(join(ctx.cwd, ".omt", "ledger.jsonl"), entry({ plan: "auth", taskId: "t1" }));
  assert.equal(await run(ctx), 0);
  assert.match(ctx.out(), /^max tasks per run: 80 \(plan 80, config 1\)$/m);
  assert.match(ctx.out(), /^can dispatch: yes$/m);

  const json = ctx.at(["stats", "--plan", "auth", "--json"]);
  assert.equal(await run(json), 0);
  const parsed = JSON.parse(json.out());
  assert.equal(parsed.limits.maxTasksPerRun, 80);
  assert.equal(parsed.planMaxTasks, 80);
});

test("ledger add accepts any role name, such as swarm and loop", async () => {
  for (const role of ["swarm", "loop", "Not A Config Role"]) {
    const ctx = projectContext(["add", "--role", role, "--status", "dispatched", "--unit", "U1"]);
    assert.equal(await run(ctx), 0, role);
    assert.equal(JSON.parse(ctx.out()).role, role);
    const { entries } = await readLedger(join(ctx.cwd, ".omt", "ledger.jsonl"));
    assert.equal(entries[0]?.role, role);
  }
});

test("ledger request-id prints the id and requires plan, unit, and role", async () => {
  const ctx = projectContext(["request-id", "--plan", "auth", "--unit", "U3", "--role", "review", "--round", "2"]);
  assert.equal(await run(ctx), 0);
  assert.equal(ctx.out(), "omt:auth:U3:review:r2:a1\n");

  const withAttempt = projectContext(["request-id", "--plan", "a", "--unit", "U1", "--role", "r", "--attempt", "4"]);
  assert.equal(await run(withAttempt), 0);
  assert.equal(withAttempt.out(), "omt:a:U1:r:r1:a4\n");

  const missing = projectContext(["request-id", "--plan", "auth", "--role", "review"]);
  await assert.rejects(run(missing), omtExit(2));
});

test("a terminal entry without a task id closes the dispatched entry with the same plan, unit, role, round, and attempt", () => {
  const limits = { maxParallel: 4, maxTasksPerRun: 24 };
  const active = (entries: LedgerEntry[]) => ledgerStats(entries, limits).active;
  const d = entry({ plan: "p", unit: "U1", role: "execute", taskId: "t1" });
  assert.equal(active([d, entry({ plan: "p", unit: "U1", role: "execute", status: "completed" })]), 0);
  assert.equal(active([d, entry({ plan: "p", unit: "U1", role: "execute", round: 1, attempt: 1, status: "failed" })]), 0);
  assert.equal(active([entry({ plan: "p", unit: "U1", role: "execute", status: "completed" }), d]), 0, "any order");
  assert.equal(active([d, entry({ plan: "p", unit: "U1", role: "execute", attempt: 2, status: "completed" })]), 1);
  assert.equal(active([d, entry({ plan: "p", unit: "U2", role: "execute", status: "completed" })]), 1);
  assert.equal(active([d, entry({ plan: "p", unit: "U1", role: "review", status: "completed" })]), 1);
  assert.equal(active([d, entry({ plan: "p", unit: "U1", role: "execute", taskId: "t9", status: "completed" })]), 1);
});

test("a terminal entry with neither a task id nor a unit closes nothing", () => {
  const limits = { maxParallel: 4, maxTasksPerRun: 24 };
  const active = (entries: LedgerEntry[]) => ledgerStats(entries, limits).active;
  const d = entry({ plan: "p", role: "execute", taskId: "t1" });
  assert.equal(active([d, entry({ plan: "p", role: "execute", status: "completed" })]), 1);
  const withUnit = entry({ plan: "p", unit: "U1", role: "execute", taskId: "t2" });
  assert.equal(active([withUnit, entry({ plan: "p", role: "execute", status: "completed" })]), 1);
});

test("ledger add without --task-id or --unit warns that it closed nothing", async () => {
  const base = projectContext([]);
  assert.equal(await run(base.at(["add", "--plan", "demo", "--role", "execute", "--status", "dispatched", "--task-id", "t1"])), 0);
  const done = base.at(["add", "--plan", "demo", "--role", "execute", "--status", "completed"]);
  assert.equal(await run(done), 0);
  assert.equal(done.err(), "omt: no dispatched entry matches; nothing was closed\n");
});

test("interrupted, verified, and rejected are terminal and close by task id", () => {
  const limits = { maxParallel: 4, maxTasksPerRun: 24 };
  for (const status of ["interrupted", "verified", "rejected", "cancelled"] as const) {
    const stats = ledgerStats([entry({ taskId: "t1" }), entry({ taskId: "t1", status })], limits);
    assert.equal(stats.active, 0, status);
    assert.equal(stats.terminal, 1, status);
  }
});

test("ledger add --status dispatched needs --task-id or --unit", async () => {
  const ctx = projectContext(["add", "--role", "execute", "--status", "dispatched"]);
  await assert.rejects(run(ctx), omtExit(2));
  const withId = projectContext(["add", "--role", "execute", "--status", "dispatched", "--task-id", "t1"]);
  assert.equal(await run(withId), 0);
  assert.equal(withId.err(), "");
  const noId = projectContext(["add", "--role", "execute", "--status", "dispatched", "--unit", "U1"]);
  assert.equal(await run(noId), 0);
  assert.match(noId.err(), /^warning: this dispatched entry has no --task-id/);
});

test("ledger add with a terminal status that closes nothing still appends and warns", async () => {
  const ctx = projectContext(["add", "--role", "execute", "--status", "completed", "--plan", "demo", "--unit", "U1"]);
  assert.equal(await run(ctx), 0);
  assert.equal(ctx.err(), "omt: no dispatched entry matches; nothing was closed\n");
  const { entries } = await readLedger(join(ctx.cwd, ".omt", "ledger.jsonl"));
  assert.equal(entries.length, 1);
});

test("ledger add, then a terminal add without a task id, leaves no active task", async () => {
  const base = projectContext([]);
  const common = ["--plan", "demo", "--unit", "U1", "--role", "execute"];
  assert.equal(await run(base.at(["add", ...common, "--status", "dispatched", "--task-id", "t1"])), 0);
  const done = base.at(["add", ...common, "--status", "completed"]);
  assert.equal(await run(done), 0);
  assert.equal(done.err(), "");
  const stats = base.at(["stats", "--plan", "demo"]);
  assert.equal(await run(stats), 0);
  assert.match(stats.out(), /^active: 0$/m);
});

test("ledger rejects an invalid --plan or --unit with exit code 2", async () => {
  const cases = [
    ["add", "--role", "x", "--status", "failed", "--plan", "a -->"],
    ["add", "--role", "x", "--status", "failed", "--plan", "a b"],
    ["add", "--role", "x", "--status", "failed", "--unit", "U 1"],
    ["list", "--plan", "Bad"],
    ["stats", "--plan", "a/b"],
    ["request-id", "--plan", "auth", "--unit", "u".repeat(65), "--role", "r"],
  ];
  for (const argv of cases) {
    await assert.rejects(
      run(projectContext(argv)),
      omtExit(2),
      argv.join(" "),
    );
  }
});
