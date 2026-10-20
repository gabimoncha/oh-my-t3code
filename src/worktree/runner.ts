import { pathToFileURL } from "node:url";
import { runnerTemplatePath } from "../paths.ts";
import type { WorktreeLinker, WorktreeManager, WorktreeStore } from "../types.ts";
import { OmtError } from "../util/errors.ts";
import { readFileIfExists } from "../util/fs.ts";

// The exports of templates/worktree-setup.mjs. The CLI uses the same detection code as the
// generated runner, so a check and a setup run agree.
export interface RunnerModule {
  RUNNER_MARKER: string;
  MINIMUM_VERSIONS: Record<"pnpm" | "bun", string>;
  detectManager(root: string): WorktreeManager;
  checkLinker(root: string, manager: string, options: { env: Record<string, string | undefined>; home: string }): WorktreeLinker;
  PNPM_WORKSPACE_CONTENT: string;
  persistentGlobalStore(root: string, version?: string): WorktreeStore;
}

export interface RunnerTemplate {
  path: string;
  text: string;
  module: RunnerModule;
}

export async function loadRunnerTemplate(packageRoot: string): Promise<RunnerTemplate> {
  const path = runnerTemplatePath(packageRoot);
  const text = await readFileIfExists(path);
  if (text === undefined) {
    throw new OmtError("worktree_template", `the bundled setup runner is missing: ${path}`, { hint: "reinstall oh-my-t3code" });
  }
  const module = (await import(pathToFileURL(path).href)) as RunnerModule;
  return { path, text, module };
}
