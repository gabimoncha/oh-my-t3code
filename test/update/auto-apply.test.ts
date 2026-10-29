import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "bun:test";
import { run } from "../../src/commands/doctor.ts";
import type { DoctorReport, UpdateCheckSeams } from "../../src/install/doctor.ts";
import { updateStatePath, userConfigPath } from "../../src/paths.ts";
import { fakeContext, tempDir, writeFile } from "../helpers.ts";

const LATEST = "0.2.1";
const START = Date.parse("2026-10-25T09:00:00.000Z");

function scenario(isTTY: boolean, argv: string[] = []) {
  const root = tempDir("omt-u7-auto-");
  let now = START;
  let fetches = 0;
  const context = () => fakeContext({ root, isTTY, argv, version: "0.2.0", now: () => new Date(now) });
  const ctx = context();
  writeFile(userConfigPath(ctx.env, ctx.homedir), '{ "update": "apply" }\n');
  const fetch: typeof globalThis.fetch = Object.assign(async () => {
    fetches += 1;
    return Response.json({ latest: LATEST });
  }, { preconnect: globalThis.fetch.preconnect });
  return { ctx, context, fetch, fetches: () => fetches, advance: (ms: number) => { now += ms; } };
}

test("U7 apply with a TTY runs once with the daily result and no second fetch", async () => {
  const s = scenario(true);
  let calls = 0;
  const runUpdate: NonNullable<UpdateCheckSeams["runUpdate"]> = async (ctx, options, seams) => {
    calls += 1;
    assert.ok(s.ctx.out().includes(`omt ${LATEST} is out`), "doctor must print its report before the update");
    assert.equal(JSON.parse(readFileSync(updateStatePath(ctx.env, ctx.homedir), "utf8")).applyAttemptedFor, LATEST);
    assert.deepEqual(options, { check: false, dryRun: false, yes: true, skillsOnly: false, project: false, json: false });
    assert.equal(seams?.latest, LATEST);
    assert.equal(seams?.fetch, s.fetch);
    return 0;
  };
  assert.equal(await run(s.ctx, { fetch: s.fetch, runUpdate }), 0);
  assert.equal(s.ctx.err(), "", "the update flow must complete all assertions without a warning");
  assert.equal(calls, 1);
  assert.equal(s.fetches(), 1);
  await run(s.context(), { fetch: s.fetch, runUpdate });
  assert.equal(calls, 1);
  assert.equal(s.fetches(), 1);
});

test("U7 apply without a TTY prints the update note and does not run the update", async () => {
  const s = scenario(false);
  let calls = 0;
  assert.equal(await run(s.ctx, { fetch: s.fetch, runUpdate: async () => { calls += 1; return 0; } }), 0);
  assert.equal(calls, 0);
  assert.equal(s.fetches(), 1);
  assert.ok(s.ctx.out().includes(`omt ${LATEST} is out; run omt update`));
});

test("U7 failed apply keeps the doctor exit code and does not retry the same version on a later day", async () => {
  const s = scenario(true);
  let calls = 0;
  const runUpdate: NonNullable<UpdateCheckSeams["runUpdate"]> = async () => { calls += 1; return 1; };
  assert.equal(await run(s.ctx, { fetch: s.fetch, runUpdate }), 0);
  assert.match(s.ctx.err(), /warning: the automatic update failed: omt update exited 1/);
  s.advance(60_000);
  assert.equal(await run(s.context(), { fetch: s.fetch, runUpdate }), 0);
  assert.equal(calls, 1);
  assert.equal(s.fetches(), 1);
  s.advance(24 * 60 * 60 * 1000);
  const next = s.context();
  assert.equal(await run(next, { fetch: s.fetch, runUpdate }), 0);
  assert.equal(calls, 1);
  assert.equal(s.fetches(), 2);
  assert.ok(next.out().includes(`omt ${LATEST} is out; run omt update`));
});

test("U7 apply with --json prints one doctor report and sends update output to stderr", async () => {
  const s = scenario(true, ["--json"]);
  let calls = 0;
  assert.equal(await run(s.ctx, {
    fetch: s.fetch,
    runUpdate: async (ctx) => {
      calls += 1;
      ctx.stdout("automatic update output\n");
      ctx.stderr("automatic update warning\n");
      return 0;
    },
  }), 0);
  const report = JSON.parse(s.ctx.out()) as DoctorReport;
  assert.deepEqual(Object.keys(report).sort(), ["checks", "defaults", "ok"]);
  assert.equal(report.ok, true);
  assert.ok(report.checks.some((check) => check.id === "update" && check.message.includes(LATEST)));
  assert.equal(calls, 1);
  assert.equal(s.fetches(), 1);
  assert.equal(s.ctx.err(), "automatic update output\nautomatic update warning\n");
});
