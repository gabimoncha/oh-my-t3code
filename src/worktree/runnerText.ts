import { readFileSync } from "node:fs";

// A Bun macro: src/worktree/runner.ts imports it `with { type: "macro" }`, so Bun runs it when it
// transpiles or bundles runner.ts and inlines the returned text. The bundle and the binary then hold
// the runner's bytes and read no templates/ folder at run time.
export function runnerText(): string {
  return readFileSync(new URL("../../templates/worktree-setup.mjs", import.meta.url), "utf8");
}
