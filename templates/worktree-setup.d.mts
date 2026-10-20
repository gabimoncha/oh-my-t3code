// Types for src/worktree/runner.ts, which imports this runner as a module.
import type { WorktreeLinker, WorktreeManager, WorktreeStore } from "../src/types.ts";

export declare const RUNNER_MARKER: string;
export declare const MINIMUM_VERSIONS: Record<"pnpm" | "bun", string>;
export declare const PNPM_WORKSPACE_CONTENT: string;
export declare function detectManager(root: string): WorktreeManager;
export declare function checkLinker(
  root: string,
  manager: string,
  options: { env: Record<string, string | undefined>; home: string },
): WorktreeLinker;
export declare function persistentGlobalStore(root: string, version?: string): WorktreeStore;
