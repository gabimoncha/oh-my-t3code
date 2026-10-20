// The build inlines the module and, through the macro, its text, so the npm bundle and the binary need no templates/ folder.
import * as runnerModule from "../../templates/worktree-setup.mjs";
import { runnerText } from "./runnerText.ts" with { type: "macro" };

// The exports of templates/worktree-setup.mjs that templates/worktree-setup.d.mts types. The CLI uses
// the same detection code as the generated runner, so a check and a setup run agree.
export type RunnerModule = typeof runnerModule;

export interface RunnerTemplate {
  text: string;
  module: RunnerModule;
}

const template: RunnerTemplate = { text: runnerText(), module: runnerModule };

export function loadRunnerTemplate(): RunnerTemplate {
  return template;
}
