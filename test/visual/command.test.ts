import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { main } from "../../src/main.ts";
import { fakeContext, spawnOmt, tempDir } from "../helpers.ts";
import { WORKFLOW_PROFILES_PLAN } from "./fixtures.ts";

const SPEC = { title: "Spec page", tabs: [{ title: "Design", blocks: [{ type: "text", text: "Hello <world>" }] }] };

function project(t: TestContext, stdin = "") {
  const root = tempDir(t);
  const ctx = fakeContext({ root, stdin });
  mkdirSync(join(ctx.cwd, ".omt", "plans"), { recursive: true });
  writeFileSync(join(ctx.cwd, ".omt", "plans", "wp.md"), WORKFLOW_PROFILES_PLAN);
  return ctx;
}

test("visual --plan --json writes the default path and prints path, bytes, title, tabs, and warnings", async (t) => {
  const ctx = project(t);
  writeFileSync(join(ctx.cwd, "spec.json"), JSON.stringify(SPEC));
  const code = await main(["visual", "--plan", "wp", "--spec", "spec.json", "--json"], ctx);
  assert.equal(code, 0, ctx.err());
  const out = JSON.parse(ctx.out()) as { path: string; bytes: number; title: string; tabs: string[]; warnings: string[] };
  assert.equal(out.path, join(ctx.cwd, ".omt", "evidence", "visuals", "wp.html"));
  const html = readFileSync(out.path, "utf8");
  assert.equal(out.bytes, Buffer.byteLength(html));
  assert.equal(out.title, "Spec page");
  assert.deepEqual(out.tabs, ["Summary", "Units", "Checks", "Design"]);
  assert.deepEqual(out.warnings, [], "the plan flowchart shortens long unit titles instead of cutting them");
  assert.match(html, />U2 Config: profiles,/);
  assert.match(html, /…<\/text>/);
  assert.ok(html.includes("Hello &lt;world&gt;"));
  assert.equal(ctx.err(), "", "--json puts warnings in the JSON only");
});

test("visual --spec - --out - prints the page from stdin", async (t) => {
  const ctx = project(t, JSON.stringify(SPEC));
  const code = await main(["visual", "--spec", "-", "--out", "-"], ctx);
  assert.equal(code, 0, ctx.err());
  assert.match(ctx.out(), /^<!doctype html>/);
  assert.ok(ctx.out().includes("<title>Spec page</title>"));
  assert.ok(!existsSync(join(ctx.cwd, ".omt", "evidence")));
});

test("visual --spec without --plan names the page by the sha256 of its HTML", async (t) => {
  const ctx = project(t, JSON.stringify(SPEC));
  assert.equal(await main(["visual", "--spec", "-"], ctx), 0, ctx.err());
  const path = ctx.out().trim();
  assert.match(path, /\.omt\/evidence\/visuals\/page-[0-9a-f]{12}\.html$/);
  const again = project(t, JSON.stringify(SPEC));
  assert.equal(await main(["visual", "--spec", "-"], again), 0);
  assert.equal(readFileSync(path, "utf8"), readFileSync(again.out().trim(), "utf8"), "byte-identical on each run");
});

test("visual --out writes the given path and prints warnings to stderr", async (t) => {
  const ctx = project(t);
  const plan = "# P\n\n## Objective\n\nGoal.\n\n## Units\n\n- [ ] U1. A\n  - Depends on: U9\n";
  writeFileSync(join(ctx.cwd, ".omt", "plans", "p.md"), plan);
  assert.equal(await main(["visual", "--plan", "p", "--out", "out/p.html"], ctx), 0);
  assert.equal(ctx.out(), `${join(ctx.cwd, "out", "p.html")}\n`);
  assert.ok(existsSync(join(ctx.cwd, "out", "p.html")));
  assert.equal(ctx.err(), "warning: U1 depends on U9, which is not a unit of the plan\nwarning: plan has no ## Summary; showing ## Objective\n");
});

test("visual --plan takes a plan file path and names the page after its header slug", async (t) => {
  const ctx = project(t);
  const file = join(ctx.cwd, "drafts", "draft-plan.md");
  mkdirSync(join(ctx.cwd, "drafts"), { recursive: true });
  writeFileSync(file, WORKFLOW_PROFILES_PLAN.replace(/slug=[^\s>]+/, "slug=from-header"));
  const code = await main(["visual", "--plan", "drafts/draft-plan.md", "--json"], ctx);
  assert.equal(code, 0, ctx.err());
  const out = JSON.parse(ctx.out()) as { path: string; tabs: string[] };
  assert.equal(out.path, join(ctx.cwd, ".omt", "evidence", "visuals", "from-header.html"));
  assert.deepEqual(out.tabs, ["Summary", "Units", "Checks"]);

  const missing = project(t);
  assert.equal(await main(["visual", "--plan", "nowhere.md"], missing), 1);
  assert.match(missing.err(), /plan "nowhere\.md" not found at .*nowhere\.md/);
});

test("visual usage errors exit 2", async (t) => {
  const cases: [string[], RegExp][] = [
    [["visual"], /visual needs --plan <slug\|file\.md> or --spec <file\|->/],
    [["visual", "--spec", "-", "--json", "--out", "-"], /--json and --out - cannot be used together/],
    [["visual", "--plan", "Bad Slug"], /invalid plan slug/],
    [["visual", "extra"], /unexpected argument "extra"/],
    [["visual", "--colour"], /Unknown option/],
  ];
  for (const [argv, message] of cases) {
    const ctx = project(t, JSON.stringify(SPEC));
    assert.equal(await main(argv, ctx), 2, argv.join(" "));
    assert.match(ctx.err(), message);
  }
});

test("an invalid spec exits 2 and lists every problem; a spec with no tab needs --plan", async (t) => {
  const bad = project(t, JSON.stringify({ tabs: [{ title: "", blocks: [{ type: "nope" }] }], color: 1 }));
  assert.equal(await main(["visual", "--spec", "-"], bad), 2);
  assert.match(bad.err(), /invalid page spec:\n {2}\$\.color: unknown key\n {2}\$\.tabs\[0\]\.blocks\[0\]\.type: unknown type "nope"/);
  assert.match(bad.err(), /\$\.tabs\[0\]\.title: must be 1 to 40 characters, got 0/);
  const notJson = project(t, "{ nope");
  assert.equal(await main(["visual", "--spec", "-"], notJson), 2);
  assert.match(notJson.err(), /\$: not JSON/);
  const empty = project(t, "{}");
  assert.equal(await main(["visual", "--spec", "-"], empty), 2);
  assert.match(empty.err(), /\$\.tabs: needs at least 1 tab without --plan/);
  const missing = project(t);
  assert.equal(await main(["visual", "--plan", "nothing"], missing), 1);
  assert.match(missing.err(), /plan "nothing" not found/);
});

test("omt visual runs as a child process with a temp HOME", (t) => {
  const root = tempDir(t);
  const cwd = join(root, "project");
  mkdirSync(join(cwd, ".omt", "plans"), { recursive: true });
  writeFileSync(join(cwd, ".omt", "plans", "wp.md"), WORKFLOW_PROFILES_PLAN);
  const result = spawnOmt(["visual", "--plan", "wp", "--out", "-"], { root, cwd });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /<h2>Workflow profiles fixture<\/h2>/);
  assert.equal(result.stderr, "");
});

test("visual --spec with a missing file exits 1", async (t) => {
  const ctx = project(t);
  assert.equal(await main(["visual", "--spec", "nope.json"], ctx), 1);
  assert.match(ctx.err(), /spec file not found: .*nope\.json/);
});

test("a plan file with no header slug names the page after the file, else plan", async (t) => {
  const plan = "# P\n\n## Summary\n\nx\n\n## Units\n\n- [ ] U1. A\n";
  const ctx = project(t);
  writeFileSync(join(ctx.cwd, "my-draft.md"), plan);
  assert.equal(await main(["visual", "--plan", "my-draft.md", "--json"], ctx), 0, ctx.err());
  assert.equal((JSON.parse(ctx.out()) as { path: string }).path, join(ctx.cwd, ".omt", "evidence", "visuals", "my-draft.html"));

  const other = project(t);
  writeFileSync(join(other.cwd, "My Draft.md"), plan);
  assert.equal(await main(["visual", "--plan", "My Draft.md", "--json"], other), 0, other.err());
  assert.equal((JSON.parse(other.out()) as { path: string }).path, join(other.cwd, ".omt", "evidence", "visuals", "plan.html"));
});

test("visual --out - prints the page to stdout and each warning to stderr", async (t) => {
  const ctx = project(t);
  writeFileSync(join(ctx.cwd, ".omt", "plans", "p.md"), "# P\n\n## Objective\n\nGoal.\n\n## Units\n\n- [ ] U1. A\n  - Depends on: U1\n");
  assert.equal(await main(["visual", "--plan", "p", "--out", "-"], ctx), 0);
  assert.match(ctx.out(), /^<!doctype html>/);
  assert.equal(ctx.err(), "warning: U1 depends on itself\nwarning: plan has no ## Summary; showing ## Objective\n");
});
