import { lstatSync, mkdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../../src/commands/plan.ts";
import { parsePlan } from "../../src/plan/parse.ts";
import { planTemplate } from "../../src/plan/template.ts";
import { OmtError } from "../../src/util/errors.ts";
import { fakeContext, tempDir } from "../helpers.ts";

const SAMPLE = `# Auth refactor

<!-- omt-plan v1 slug=auth-refactor created=2026-01-01T00:00:00.000Z -->

## Done when

- [x] D1. Tests pass
- [ ] D2. Login works

## Units

- [x] U1. Add the model
  - Role: execute
- [X] U2. Add the store
- [~] U3. Wire the provider
- [ ] U4. Add the token refresh endpoint
- [ ] U5. Remove the old client
  - [ ] U9. nested items are not units
-  [ ] U6. bad spacing is ignored

## Final verification

- [ ] F1. Full suite passes
- [x] F2. Oracle approves
`;

test("planTemplate fills the title, slug, and timestamp", () => {
  const text = planTemplate("auth", "Auth work", "2026-01-02T03:04:05.000Z");
  assert.match(text, /^# Auth work\n\n<!-- omt-plan v1 slug=auth created=2026-01-02T03:04:05\.000Z -->\n/);
  for (const heading of ["Objective", "Done when", "Roles", "Units", "Final verification", "Log"]) {
    assert.match(text, new RegExp(`^## ${heading}$`, "m"));
  }
  assert.match(text, /^- 2026-01-02T03:04:05\.000Z plan created$/m);
  const status = parsePlan(text);
  assert.equal(status.title, "Auth work");
  assert.equal(status.slug, "auth");
  assert.deepEqual(
    status.items.map((item) => item.id),
    ["D1", "U1", "F1", "F2"],
  );
  assert.equal(status.next?.id, "U1");
  assert.equal(status.complete, false);
});

test("parsePlan reads every checkbox state with ids and 1-based lines", () => {
  const status = parsePlan(SAMPLE);
  assert.equal(status.title, "Auth refactor");
  assert.equal(status.slug, "auth-refactor");
  const byId = Object.fromEntries(status.items.map((item) => [item.id, item]));
  assert.equal(byId.U1?.state, "done");
  assert.equal(byId.U2?.state, "done");
  assert.equal(byId.U3?.state, "blocked");
  assert.equal(byId.U4?.state, "open");
  assert.equal(byId.U4?.title, "Add the token refresh endpoint");
  assert.equal(byId.U4?.kind, "U");
  assert.equal(byId.U1?.line, 12);
  assert.equal(byId.U9, undefined);
  assert.equal(byId.U6, undefined);
});

test("parsePlan counts items per kind and finds the next open unit", () => {
  const status = parsePlan(SAMPLE);
  assert.deepEqual(status.counts, {
    U: { open: 2, done: 2, blocked: 1, total: 5 },
    D: { open: 1, done: 1, blocked: 0, total: 2 },
    F: { open: 1, done: 1, blocked: 0, total: 2 },
  });
  assert.equal(status.next?.id, "U4");
  assert.equal(status.complete, false);
});

test("parsePlan sets complete only when every U, D, and F item is done", () => {
  const units = "# P\n\n- [x] U1. a\n- [x] U2. b\n- [x] D1. c\n";
  assert.equal(parsePlan(`${units}- [x] F1. d\n`).complete, true);
  assert.equal(parsePlan(`${units}- [x] F1. d\n`).next, undefined);
  assert.equal(parsePlan(`${units}- [ ] F1. d\n`).complete, false);
  assert.equal(parsePlan(`${units}- [~] F1. d\n`).complete, false);
  const blockedOnly = parsePlan("# P\n\n- [~] U1. a\n");
  assert.equal(blockedOnly.next, undefined);
  assert.equal(blockedOnly.complete, false);
});

function projectContext(t: Parameters<typeof tempDir>[0], argv: string[]) {
  const root = tempDir(t);
  const ctx = fakeContext({ root, argv });
  mkdirSync(join(ctx.cwd, ".git"));
  return ctx;
}

test("plan new writes the template and refuses to overwrite without --force", async (t) => {
  const ctx = projectContext(t, ["new", "auth", "--title", "Auth work"]);
  assert.equal(await run(ctx), 0);
  const path = join(ctx.cwd, ".omt", "plans", "auth.md");
  assert.equal(ctx.out(), `${path}\n`);
  assert.equal(readFileSync(path, "utf8"), planTemplate("auth", "Auth work", "2026-01-02T03:04:05.000Z"));

  await assert.rejects(run(ctx), (error: unknown) => error instanceof OmtError && error.exitCode === 1);
  writeFileSync(path, "changed");
  assert.equal(await run({ ...ctx, argv: ["new", "auth", "--force"] }), 0);
  assert.match(readFileSync(path, "utf8"), /^# auth\n/);
});

test("plan new rejects an invalid slug with exit code 2", async (t) => {
  for (const slug of ["Auth", "-a", "a_b", "a".repeat(65)]) {
    const ctx = projectContext(t, ["new", slug]);
    await assert.rejects(run(ctx), (error: unknown) => error instanceof OmtError && error.exitCode === 2);
  }
});

test("plan status prints counts and the next unit, defaulting to the newest plan", async (t) => {
  const ctx = projectContext(t, ["status"]);
  const dir = join(ctx.cwd, ".omt", "plans");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "auth-refactor.md"), SAMPLE);
  writeFileSync(join(dir, "older.md"), "# Older\n\n- [ ] U1. x\n");
  utimesSync(join(dir, "older.md"), new Date("2020-01-01"), new Date("2020-01-01"));

  assert.equal(await run(ctx), 0);
  assert.equal(
    ctx.out(),
    [
      `plan: auth-refactor (${join(".omt", "plans", "auth-refactor.md")})`,
      "units: 2/5 done, 1 blocked, 2 open",
      "done-when: 1/2",
      "final: 1/2",
      "next: U4 Add the token refresh endpoint",
      "",
    ].join("\n"),
  );

  const json = fakeContext({ homedir: ctx.homedir, cwd: ctx.cwd, argv: ["status", "older", "--json"] });
  assert.equal(await run(json), 0);
  const parsed = JSON.parse(json.out());
  assert.equal(parsed.title, "Older");
  assert.equal(parsed.next.id, "U1");
  assert.deepEqual(parsed.counts.U, { open: 1, done: 0, blocked: 0, total: 1 });
});

test("plan status fails when there is no plan or the slug is missing", async (t) => {
  const ctx = projectContext(t, ["status"]);
  await assert.rejects(run(ctx), (error: unknown) => error instanceof OmtError && error.exitCode === 1);
  await assert.rejects(
    run({ ...ctx, argv: ["status", "nope"] }),
    (error: unknown) => error instanceof OmtError && error.exitCode === 1,
  );
});

test("plan list prints one line per plan and --json prints an array", async (t) => {
  const ctx = projectContext(t, ["list"]);
  const dir = join(ctx.cwd, ".omt", "plans");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "auth-refactor.md"), SAMPLE);
  writeFileSync(join(dir, "b.md"), "# B\n\n- [x] U1. x\n");
  writeFileSync(join(dir, "notes.txt"), "ignored");

  assert.equal(await run(ctx), 0);
  assert.equal(
    ctx.out(),
    [
      "auth-refactor  units 2/5 done, 1 blocked, 2 open  next: U4 Add the token refresh endpoint",
      "b              units 1/1 done, 0 blocked, 0 open  next: none",
      "",
    ].join("\n"),
  );

  const json = fakeContext({ homedir: ctx.homedir, cwd: ctx.cwd, argv: ["list", "--json"] });
  assert.equal(await run(json), 0);
  const parsed = JSON.parse(json.out());
  assert.deepEqual(
    parsed.map((plan: { slug: string }) => plan.slug),
    ["auth-refactor", "b"],
  );
  assert.equal(parsed[1].complete, true);
});

test("plan rejects a missing or unknown subcommand with exit code 2", async (t) => {
  for (const argv of [[], ["nope"]]) {
    const ctx = projectContext(t, argv);
    await assert.rejects(run(ctx), (error: unknown) => error instanceof OmtError && error.exitCode === 2);
  }
});

test("plan new --light leaves out the oracle line", async (t) => {
  const ctx = projectContext(t, ["new", "demo", "--light"]);
  assert.equal(await run(ctx), 0);
  const text = readFileSync(join(ctx.cwd, ".omt", "plans", "demo.md"), "utf8");
  assert.match(text, /^- \[ \] F1\. /m);
  assert.doesNotMatch(text, /F2\./);
  assert.match(planTemplate("x", "x", "t"), /^- \[ \] F2\. /m);
});

test("plan mark rewrites the checkbox and appends a log line", async (t) => {
  const ctx = projectContext(t, ["new", "demo"]);
  assert.equal(await run(ctx), 0);
  const path = join(ctx.cwd, ".omt", "plans", "demo.md");
  const at = (argv: string[]) => fakeContext({ homedir: ctx.homedir, cwd: ctx.cwd, argv });

  const done = at(["mark", "demo", "U1", "done"]);
  assert.equal(await run(done), 0);
  assert.equal(done.out(), "marked U1 done\n");
  assert.equal(await run(at(["mark", "demo", "F2", "blocked"])), 0);
  assert.equal(await run(at(["mark", "demo", "D1", "done"])), 0);
  assert.equal(await run(at(["mark", "demo", "D1", "open"])), 0);

  const text = readFileSync(path, "utf8");
  assert.match(text, /^- \[x\] U1\. <title>$/m);
  assert.match(text, /^- \[~\] F2\. /m);
  assert.match(text, /^- \[ \] D1\. /m);
  assert.ok(
    text.endsWith(
      "- 2026-01-02T03:04:05.000Z U1 -> done\n- 2026-01-02T03:04:05.000Z F2 -> blocked\n" +
        "- 2026-01-02T03:04:05.000Z D1 -> done\n- 2026-01-02T03:04:05.000Z D1 -> open\n",
    ),
    text,
  );
  const status = parsePlan(text);
  assert.equal(status.counts.U.done, 1);
  assert.equal(status.counts.F.blocked, 1);
});

test("plan mark exits 1 for a missing plan or id and 2 for a bad state", async (t) => {
  const ctx = projectContext(t, ["new", "demo"]);
  assert.equal(await run(ctx), 0);
  const at = (argv: string[]) => fakeContext({ homedir: ctx.homedir, cwd: ctx.cwd, argv });
  const exitCode = (code: number) => (error: unknown) => error instanceof OmtError && error.exitCode === code;
  await assert.rejects(run(at(["mark", "nope", "U1", "done"])), exitCode(1));
  await assert.rejects(run(at(["mark", "demo", "U7", "done"])), exitCode(1));
  await assert.rejects(run(at(["mark", "demo", "X1", "done"])), exitCode(1));
  await assert.rejects(run(at(["mark", "demo", "U1", "finished"])), exitCode(2));
  await assert.rejects(run(at(["mark", "demo", "U1"])), exitCode(2));
});

test("plan list and status skip a dangling plan symlink", async (t) => {
  const ctx = projectContext(t, ["new", "demo"]);
  assert.equal(await run(ctx), 0);
  symlinkSync(join(ctx.cwd, "missing.md"), join(ctx.cwd, ".omt", "plans", "gone.md"));
  const list = fakeContext({ homedir: ctx.homedir, cwd: ctx.cwd, argv: ["list"] });
  assert.equal(await run(list), 0);
  assert.match(list.out(), /^demo /);
  const status = fakeContext({ homedir: ctx.homedir, cwd: ctx.cwd, argv: ["status"] });
  assert.equal(await run(status), 0);
  assert.match(status.out(), /^plan: demo /);
});

test("plan mark and plan new --force write through a symlinked plan file", async (t) => {
  const ctx = projectContext(t, []);
  const real = join(ctx.cwd, "shared", "real.md");
  const link = join(ctx.cwd, ".omt", "plans", "linked.md");
  mkdirSync(join(ctx.cwd, "shared"));
  mkdirSync(join(ctx.cwd, ".omt", "plans"), { recursive: true });
  writeFileSync(real, planTemplate("linked", "Linked", "2026-01-01T00:00:00.000Z"));
  symlinkSync(join("..", "..", "shared", "real.md"), link);
  const at = (argv: string[]) => fakeContext({ homedir: ctx.homedir, cwd: ctx.cwd, argv });

  assert.equal(await run(at(["mark", "linked", "U1", "done"])), 0);
  assert.ok(lstatSync(link).isSymbolicLink());
  assert.match(readFileSync(real, "utf8"), /^- \[x\] U1\. /m);

  assert.equal(await run(at(["new", "linked", "--force", "--title", "Rewritten"])), 0);
  assert.ok(lstatSync(link).isSymbolicLink());
  assert.match(readFileSync(real, "utf8"), /^# Rewritten$/m);
});
