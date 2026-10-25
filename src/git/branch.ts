import { spawnSync } from "node:child_process";
import type { CliContext } from "../types.ts";

export interface BranchState {
  repo: boolean;
  branch: string | undefined; // undefined on a detached HEAD or outside a repo
  defaultBranch: string | undefined;
}

function git(ctx: Pick<CliContext, "cwd" | "env">, args: string[]): string | undefined {
  const result = spawnSync("git", args, {
    cwd: ctx.cwd,
    env: ctx.env,
    encoding: "utf8",
    timeout: 5_000,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return undefined;
  const out = result.stdout.replace(/\r?\n$/, "");
  return out === "" ? undefined : out;
}

function branchExists(ctx: Pick<CliContext, "cwd" | "env">, name: string): boolean {
  return git(ctx, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]) !== undefined;
}

function symbolicRef(ctx: Pick<CliContext, "cwd" | "env">, ref: string, prefix: string): string | undefined {
  const full = git(ctx, ["symbolic-ref", "--quiet", ref]);
  return full?.startsWith(prefix) ? full.slice(prefix.length) : undefined;
}

// The same order as the branch check in skills/omt/references/delegation.md.
// Full refs, because `--short` gives `heads/main` when a tag `main` also exists.
export function findDefaultBranch(ctx: Pick<CliContext, "cwd" | "env">): string | undefined {
  const remote = symbolicRef(ctx, "refs/remotes/origin/HEAD", "refs/remotes/origin/");
  if (remote !== undefined) return remote;
  const init = git(ctx, ["config", "init.defaultBranch"]);
  if (init !== undefined && branchExists(ctx, init)) return init;
  return ["main", "master"].find((name) => branchExists(ctx, name));
}

export function readBranchState(ctx: Pick<CliContext, "cwd" | "env">): BranchState {
  if (git(ctx, ["rev-parse", "--git-dir"]) === undefined) return { repo: false, branch: undefined, defaultBranch: undefined };
  return {
    repo: true,
    branch: symbolicRef(ctx, "HEAD", "refs/heads/"),
    defaultBranch: findDefaultBranch(ctx),
  };
}
