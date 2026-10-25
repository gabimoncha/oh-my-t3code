import assert from "node:assert/strict";
import { test } from "bun:test";
import { run as install } from "../../src/commands/install.ts";
import { projectConfigPath, userConfigPath } from "../../src/paths.ts";
import type { RunCommand } from "../../src/update/channel.ts";
import { runUpdate } from "../../src/update/flow.ts";
import type { UpdateOptions } from "../../src/update/flow.ts";
import { fakeContext, gitRepo, tempDir } from "../helpers.ts";

const options: UpdateOptions = {
  check: false,
  dryRun: false,
  yes: false,
  skillsOnly: false,
  project: false,
  json: false,
};

const scenarios: { name: string; answers: string[]; moved: string[]; isTTY: boolean; yes?: boolean; json?: boolean }[] = [
  { name: "TTY accepts the user pin and refuses the project pin", answers: ["yes", "no"], moved: ["user"], isTTY: true },
  { name: "TTY refuses the user pin and accepts the project pin", answers: ["no", "y"], moved: ["project"], isTTY: true },
  { name: "--yes prints hints without a defaults prompt", answers: [], moved: [], isTTY: true, yes: true },
  { name: "--json prints hints without a defaults prompt", answers: [], moved: [], isTTY: true, json: true },
  { name: "no TTY prints hints without a defaults prompt", answers: [], moved: [], isTTY: false },
];

for (const scenario of scenarios) {
  test(`defaults step: ${scenario.name}`, async () => {
    const root = tempDir("omt-defaults-step-");
    const fixture = { root, build: "binary" as const, cliPath: "/opt/omt-qa/omt" };
    const setup = fakeContext(fixture);
    gitRepo(root, setup.cwd);
    assert.equal(await install({ ...setup, argv: ["--project", "--yes"] }), 0);
    const ctx = fakeContext(fixture);
    const pins = [
      { file: userConfigPath(ctx.env, ctx.homedir), kind: "user", set: "2026-09" },
      { file: projectConfigPath(ctx.cwd), kind: "project", set: "2026-08" },
    ];
    const calls: { args: string[]; cwd: string | undefined }[] = [];
    const run: RunCommand = async (argv, opts) => {
      const index = argv.indexOf("defaults");
      assert.ok(index >= 0, `Unexpected child command: ${argv.join(" ")}`);
      const args = argv.slice(index);
      calls.push({ args, cwd: opts.cwd });
      if (args[1] === "list") return { code: 0, stdout: JSON.stringify({ latest: "2026-10", pins }) };
      if (args[1] === "diff") return { code: 0, stdout: `diff ${args[2]} to latest\n` };
      if (args[1] === "use") return { code: 0, stdout: "defaults updated\n" };
      assert.fail(`Unexpected defaults command: ${args.join(" ")}`);
    };
    const prompts: string[] = [];
    assert.equal(await runUpdate(ctx, { ...options, yes: scenario.yes ?? false, json: scenario.json ?? false }, {
      latest: ctx.version,
      run,
      isTTY: scenario.isTTY,
      prompt: async (question) => {
        prompts.push(question);
        const answer = scenario.answers[prompts.length - 1];
        assert.notEqual(answer, undefined, `Unexpected prompt: ${question}`);
        return answer!;
      },
      fetch: (() => { throw new Error("The defaults step must not use the network"); }) as unknown as typeof fetch,
    }), 0);
    assert.deepEqual(prompts, scenario.answers.length === 0 ? [] : pins.map((pin) =>
      `Move the defaults pin in ${pin.file} from ${pin.set} to 2026-10? [y/N] `));
    assert.deepEqual(calls.filter((call) => call.args[1] === "use"), scenario.moved.map((kind) => ({
      args: ["defaults", "use", "latest", "--yes", `--${kind}`],
      cwd: ctx.cwd,
    })));
    assert.deepEqual(calls.filter((call) => call.args[1] === "diff").map((call) => call.args),
      pins.map((pin) => ["defaults", "diff", pin.set, "latest"]));
    const output = scenario.json ? ctx.err() : ctx.out();
    for (const pin of pins) {
      assert.ok(output.includes(`diff ${pin.set} to latest`));
      const hint = `hint: run omt defaults use latest in ${pin.kind === "user" ? ctx.homedir : ctx.cwd} to move the pin in ${pin.file}`;
      assert.equal(output.includes(hint), !scenario.moved.includes(pin.kind));
    }
    if (scenario.json) {
      const report = JSON.parse(ctx.out()) as { defaults: unknown[] };
      assert.deepEqual(report.defaults, pins.map((pin) => ({ file: pin.file, set: pin.set, latest: "2026-10", moved: false })));
    }
  });
}
