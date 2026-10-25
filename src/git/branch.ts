import { spawnSync } from "node:child_process";
import type { CliContext } from "../types.ts";

export interface BranchState {
  repo: boolean;
  branch: string | undefined; // undefined on a detached HEAD or outside a repo
  defaultBranch: string | undefined;
  origin: string | undefined; // the fetch URL of the origin remote
  pushUrls: string[]; // the push URLs of origin, after insteadOf and pushInsteadOf rewrites
}

export interface RemoteRepo {
  host: string;
  owner: string;
  repo: string;
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
  if (git(ctx, ["rev-parse", "--git-dir"]) === undefined) {
    return { repo: false, branch: undefined, defaultBranch: undefined, origin: undefined, pushUrls: [] };
  }
  const origin = git(ctx, ["remote", "get-url", "origin"]);
  return {
    repo: true,
    branch: symbolicRef(ctx, "HEAD", "refs/heads/"),
    defaultBranch: findDefaultBranch(ctx),
    origin,
    pushUrls: origin === undefined ? [] : git(ctx, ["remote", "get-url", "--push", "--all", "origin"])?.split(/\r?\n/) ?? [],
  };
}

const OWNER = "([A-Za-z0-9][A-Za-z0-9-]{0,38})";
const REPO = "([A-Za-z0-9._-]+?)(?:\\.git)?";
const REMOTE_FORMS = [
  new RegExp(`^git@([^/:@\\s]+):${OWNER}/${REPO}$`),
  new RegExp(`^ssh://git@([^/@\\s]+)/${OWNER}/${REPO}$`),
  new RegExp(`^https://([^/@\\s]+)/${OWNER}/${REPO}$`),
];

// `git@<host>:<owner>/<repo>`, `ssh://git@<host>/<owner>/<repo>`, or `https://<host>/<owner>/<repo>`,
// each with an optional `.git`. Any other form gives undefined, so the owner is unknown.
export function parseRemote(url: string): RemoteRepo | undefined {
  for (const form of REMOTE_FORMS) {
    const match = form.exec(url);
    if (match?.[1] !== undefined && match[2] !== undefined && match[3] !== undefined) {
      return { host: match[1], owner: match[2], repo: match[3] };
    }
  }
  return undefined;
}
