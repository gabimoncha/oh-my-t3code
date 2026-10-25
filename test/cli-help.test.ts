import { test } from "bun:test";
import assert from "node:assert/strict";
import { COMMANDS } from "../src/main.ts";
import { observeParseArgs } from "../src/util/args.ts";
import { OmtError } from "../src/util/errors.ts";
import { fakeContext, tempDir } from "./helpers.ts";

function usageProbes(name: string, usage: string): string[][] {
  const probes: string[][] = [[]];
  let subcommands = false;
  for (const line of usage.split("\n")) {
    if (line === "Subcommands:") {
      subcommands = true;
      continue;
    }
    if (/^\S/.test(line)) subcommands = false;
    const synopsis = line.match(/^\s*(?:Usage:\s*)?omt\s+(\S+)\s*(.*)$/);
    const text = synopsis?.[1] === name
      ? synopsis[2]
      : subcommands ? line.match(/^ {2}(\S.*?)(?: {2,}|$)/)?.[1] : undefined;
    if (text === undefined) continue;
    const args: string[] = [];
    for (const token of text.replace(/<[^>]+>/g, "probe").split(/\s+/)) {
      const word = token.replace(/[\[\]()]/g, "");
      if (word.startsWith("-") || word === "options" || word.includes("...")) break;
      if (word !== "" && word !== "|") args.push(word);
    }
    if (text.includes(" -- ")) args.push("--", "true");
    probes.push(args);
  }
  return probes;
}

test("every command usage names each flag accepted by its parsers", async () => {
  for (const [name, command] of Object.entries(COMMANDS)) {
    if (name === "hook") continue;
    const flags = new Set<string>();
    let reachedParser = false;
    for (const argv of usageProbes(name, command.usage)) {
      const sentinel = new Error("parser observed");
      const ctx = fakeContext({ root: tempDir(), argv });
      observeParseArgs((options) => {
        reachedParser = true;
        for (const flag of Object.keys(options)) flags.add(flag);
        throw sentinel;
      });
      try {
        await command.run(ctx);
      } catch (error) {
        if (error !== sentinel && !(error instanceof OmtError && error.exitCode === 2)) throw error;
      } finally {
        observeParseArgs(undefined);
      }
    }
    assert.ok(reachedParser, `${name}: no usage probe reached a parser`);
    for (const flag of flags) {
      const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.match(command.usage, new RegExp(`--${escaped}(?=[ \\]\\|,)=]|$)`, "m"), `${name}: usage does not name --${flag}`);
    }
  }
});
