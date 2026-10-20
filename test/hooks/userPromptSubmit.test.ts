import { test } from "bun:test";
import assert from "node:assert/strict";
import { run } from "../../src/commands/hook.ts";
import { detectUltrawork, runUserPromptSubmitHook, ultraworkContext } from "../../src/hooks/userPromptSubmit.ts";
import { fakeContext, omtExit, spawnOmt, tempDir } from "../helpers.ts";

const MATCHES: string[] = [
  "ulw add a flag",
  "please ultrawork this",
  "ULTRAWORK: fix the bug",
  "Ulw.",
  "do it (ulw)",
  "fix it, ulw!",
  "line one\nulw",
  "`code` then ulw",
  "\"quoted\" ulw",
  "no ulw here, but ultrawork this",
  "know ulw",
  "cannot\nulw",
  "not now. ulw",
  "do not touch the build script, ulw",
  "ulw, don't forget tests",
  "no problem, ulw add a flag",
  "not one two three ulw",
  "no\u00a0ulw",
  "no\nulw",
  "ulw explain this <task-notification> tag",
];

const MISSES: string[] = [
  "add a flag",
  "```\nulw\n```",
  "~~~sh\nultrawork\n~~~\nplain text",
  "run `ulw` later",
  "run ``ulw`` later",
  "the word \"ulw\" means ultra",
  "> ulw\nquoted line only",
  "  > ultrawork",
  "ulwx",
  "xulw",
  "$ulw",
  "ulw$",
  "/ulw",
  "ulw/x",
  "ulw-mode",
  "pre-ulw",
  "ulw_x",
  "ulw2",
  "ultraworking",
  "<!-- omt-brief v1 role=execute round=1 depth=1/1 -->\nulw",
  "text before <!-- omt-brief v1 --> ultrawork",
  "Act as the implementation sub-agent. ulw",
  "/omt-ulw add a flag",
  "do not use ultrawork",
  "don't ulw this",
  "don’t ulw this",
  "dont ulw",
  "no ulw here",
  "without ultrawork",
  "never use ulw",
  "Don't run the ulw loop",
  "NOT ULTRAWORK",
  "not one two ulw",
  "no ulw ulw",
  "<task-notification>\n<task-id>w43cdy93b</task-id>\n<status>completed</status>\n<summary>Workflow done</summary>\n<result>The hook armed on 'ulw add a flag'. Then ulw ran.</result>\n</task-notification>",
  "  \n<task-notification>\n<status>completed</status>\n<result>Quoted 'ulw add a flag' and a bare ulw.</result>\n</task-notification>",
  "\n<task-notification><result>ulw</result></task-notification>",
];

test("detectUltrawork matches the bare words", () => {
  for (const prompt of MATCHES) assert.equal(detectUltrawork(prompt), true, JSON.stringify(prompt));
});

test("detectUltrawork ignores code, quotes, blockquotes, word parts, negations, child briefs, and task notifications", () => {
  for (const prompt of MISSES) assert.equal(detectUltrawork(prompt), false, JSON.stringify(prompt));
});

test("detectUltrawork checks a 200,000-character negated prompt in under 1,000 ms", () => {
  const prompt = "no ulw ".repeat(Math.ceil(200_000 / 7));
  assert.ok(prompt.length >= 200_000);
  const started = performance.now();
  assert.equal(detectUltrawork(prompt), false);
  assert.ok(performance.now() - started < 1000);
});

test("an unclosed fence hides the rest of the prompt", () => {
  assert.equal(detectUltrawork("ok\n```\nulw"), false);
  assert.equal(detectUltrawork("```\nx\n```\nulw"), true);
});

test("ultraworkContext points at omt-ulw step 1, the full loop, and evidence, within 1000 characters", () => {
  const text = ultraworkContext();
  assert.ok(text.length <= 1000);
  assert.match(text, /ultrawork is on/);
  assert.match(text, /omt-ulw/);
  assert.match(text, /step 1/);
  assert.match(text, /evidence/);
  assert.match(text, /full loop even for a small task/);
  assert.match(text, /edit no code/);
});

test("the hook prints one JSON line on a match", async () => {
  const ctx = fakeContext({ root: tempDir(), stdin: JSON.stringify({ prompt: "ulw add a flag", session_id: "s" }) });
  assert.equal(await runUserPromptSubmitHook(ctx), 0);
  const out = ctx.out();
  assert.ok(out.endsWith("\n"));
  assert.equal(out.trimEnd().split("\n").length, 1);
  assert.deepEqual(JSON.parse(out), {
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: ultraworkContext() },
  });
  assert.equal(ctx.err(), "");
});

test("the hook prints nothing and exits 0 on no match, empty input, or bad input", async () => {
  const root = tempDir();
  for (const stdin of ["", "  \n", "not json", "null", "[]", "42", "{}", '{"prompt":3}', '{"prompt":"add a flag"}']) {
    const ctx = fakeContext({ root, stdin });
    assert.equal(await runUserPromptSubmitHook(ctx), 0, stdin);
    assert.equal(ctx.out(), "", stdin);
  }
  const failing = fakeContext({
    root,
    readStdin: async () => {
      throw new Error("stdin closed");
    },
  });
  assert.equal(await runUserPromptSubmitHook(failing), 0);
  assert.equal(failing.out(), "");
});

test("hook rejects a missing or unknown hook name with exit code 2", async () => {
  const root = tempDir();
  for (const argv of [[], ["pre-tool-use"], ["--bogus"]]) {
    const ctx = fakeContext({ root, argv });
    await assert.rejects(run(ctx), omtExit(2));
  }
});

test("hook user-prompt-submit ignores extra arguments and exits 0", async () => {
  const root = tempDir();
  for (const argv of [["user-prompt-submit", "--bogus"], ["user-prompt-submit", "extra", "-x"]]) {
    const ctx = fakeContext({ root, argv, stdin: JSON.stringify({ prompt: "ulw fix it" }) });
    assert.equal(await run(ctx), 0, argv.join(" "));
    assert.match(ctx.out(), /omt-ulw/);
  }
});

test("omt hook user-prompt-submit works as a child process", () => {
  const root = tempDir();
  const spawn = (input: string) => spawnOmt(["hook", "user-prompt-submit"], { root, input });
  const hit = spawn('{"prompt":"ulw add a flag"}');
  assert.equal(hit.code, 0);
  assert.equal(JSON.parse(hit.stdout).hookSpecificOutput.hookEventName, "UserPromptSubmit");
  const miss = spawn("not json");
  assert.equal(miss.code, 0);
  assert.equal(miss.stdout, "");
  assert.equal(miss.stderr, "");
});
