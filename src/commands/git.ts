import { parseRemote, readBranchState } from "../git/branch.ts";
import type { RemoteRepo } from "../git/branch.ts";
import type { CliContext, CommandRun, GitPolicy } from "../types.ts";
import { checkPositionals, parseArgs } from "../util/args.ts";
import { OmtError, usageError } from "../util/errors.ts";
import { checkPlanSlug } from "../util/ids.ts";
import { formatJson } from "../util/output.ts";
import { loadEffectiveConfigReporting } from "./shared.ts";

export const summary = "Check whether the git policy allows a commit, push, PR, or merge.";

export const usage = `Usage: omt git check <commit|push|pr|merge> [--user <login>] [--host <host>] [--pr-author <login>] [--plan <slug>] [--profile <name>] [--json]

check reads the current branch, the default branch, and the owner of the
origin remote's fetch and push URLs, and prints the decision of the profile's workflow.git
policy for the action: auto (act with no question), ask (ask the owner
first), or off (do not act). Only the user's own repos and PRs get auto:
each origin URL is on --host and its owner is --user or is in
workflow.git.owners, each push URL names the fetch URL's repo, and the
PR author, when given, is --user.

Options:
  --user <login>       the user's GitHub login on --host
  --host <host>        the GitHub host of the login (default github.com)
  --pr-author <login>  the author of the branch's open PR
  --plan <slug>        use the plan's selected profile
  --profile <name>     override the selected profile for this command
  --json               print JSON
  -h, --help           print this help
`;

const ACTIONS = ["commit", "push", "pr", "merge"] as const;
type Action = (typeof ACTIONS)[number];

type Decision = "auto" | "ask" | "off";
type PolicyKey = Exclude<keyof GitPolicy, "owners">;

function keyFor(action: Action, branch: string | undefined, defaultBranch: string | undefined): PolicyKey | null {
  if (action === "merge") return "merge";
  if (action === "pr") return "pullRequests";
  if (branch === undefined || defaultBranch === undefined) return null;
  if (branch === defaultBranch) return "defaultBranch";
  return action === "commit" ? "branchCommits" : "pullRequests";
}

// An OmtError from config load or profile resolution means "ask", not a failed check.
async function loadConfigOrError(ctx: CliContext, profile: string | undefined, plan: string | undefined) {
  try {
    return await loadEffectiveConfigReporting(ctx, { profile, plan });
  } catch (error) {
    if (!(error instanceof OmtError)) throw error;
    ctx.stderr(`omt: ${error.message}\n`);
    return error;
  }
}

export const run: CommandRun = async (ctx) => {
  const { values, positionals } = parseArgs(ctx.argv, {
    plan: { type: "string" },
    profile: { type: "string" },
    user: { type: "string" },
    host: { type: "string" },
    "pr-author": { type: "string" },
    json: { type: "boolean" },
  });
  const [subcommand, actionArg] = positionals;
  if (subcommand !== "check") {
    throw usageError(subcommand === undefined ? "git needs a subcommand: check" : `unknown git subcommand "${subcommand}"`, "use check");
  }
  checkPositionals(positionals, 2);
  if (actionArg === undefined || !(ACTIONS as readonly string[]).includes(actionArg)) {
    const what = actionArg === undefined ? "git check needs an action" : `unknown git action "${actionArg}"`;
    throw usageError(what, `use ${ACTIONS.join(", ")}`);
  }
  const action = actionArg as Action;
  if (values.plan !== undefined) checkPlanSlug(values.plan, "--plan");

  const loaded = await loadConfigOrError(ctx, values.profile, values.plan);
  const state = readBranchState(ctx);
  const remote = state.origin === undefined ? undefined : parseRemote(state.origin);
  const pushRemotes = state.pushUrls.map(parseRemote);
  const user = values.user;
  const loginHost = values.host ?? "github.com";
  const prAuthor = values["pr-author"];
  const on = state.branch === undefined ? "" : ` on branch ${state.branch}`;
  const print = (output: { decision: Decision; key: PolicyKey | null; value: string | null; reason: string }) => {
    const full = {
      action,
      decision: output.decision,
      branch: state.branch ?? null,
      defaultBranch: state.defaultBranch ?? null,
      host: remote?.host ?? null,
      owner: remote?.owner ?? null,
      repo: remote?.repo ?? null,
      user: user ?? null,
      prAuthor: prAuthor ?? null,
      key: output.key,
      value: output.value,
      reason: output.reason,
    };
    ctx.stdout(values.json === true ? formatJson(full) : `${full.decision}: ${full.reason}\n`);
    return 0;
  };

  if (loaded instanceof OmtError) {
    return print({ decision: "ask", key: null, value: null, reason: `config error: ${loaded.message}; fix the config first` });
  }
  const { config, profile, issues } = loaded;
  const configError = [...issues, ...profile.issues].find((issue) => issue.severity === "error");
  const key = keyFor(action, state.branch, state.defaultBranch);
  const value = key === null ? null : profile.workflow.git?.[key] ?? null;
  const owners = profile.workflow.git?.owners ?? [];
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const isMine = (repo: RemoteRepo) => user !== undefined && (same(repo.owner, user) || owners.some((owner) => same(owner, repo.owner)));
  const foreignPush = pushRemotes.find((push) => push !== undefined && (!same(push.host, loginHost) || !isMine(push)));
  const otherRepoPush = remote === undefined
    ? undefined
    : pushRemotes.find((push) => push !== undefined && (!same(push.host, remote.host) || !same(push.owner, remote.owner) || !same(push.repo, remote.repo)));

  let decision: Decision;
  let reason: string;
  if (configError !== undefined) {
    const where = configError.path === "" ? configError.source : `${configError.source} ${configError.path}`;
    decision = "ask";
    reason = `config error in ${where}: ${configError.message}; fix the config first`;
  } else if (state.origin === undefined && (action === "push" || action === "pr")) {
    decision = "ask";
    reason = "no origin remote";
  } else if (state.origin !== undefined && remote === undefined) {
    decision = "ask";
    reason = "omt cannot read the owner from the origin remote URL";
  } else if (remote !== undefined && (pushRemotes.length === 0 || pushRemotes.includes(undefined))) {
    decision = "ask";
    reason = "origin has an unreadable push URL; omt cannot read its owner";
  } else if (remote !== undefined && user === undefined) {
    decision = "ask";
    reason = "pass --user <login> to check ownership";
  } else if (remote !== undefined && !same(remote.host, loginHost)) {
    decision = "ask";
    reason = `the login is for ${loginHost}, the repo is on ${remote.host}`;
  } else if (remote !== undefined && !isMine(remote)) {
    decision = "ask";
    reason = `${remote.owner}/${remote.repo} is not your repo; add the owner to workflow.git.owners to allow it`;
  } else if (foreignPush !== undefined) {
    decision = "ask";
    reason = `a push URL of origin goes to owner ${foreignPush.owner} on ${foreignPush.host}, which is not yours`;
  } else if (otherRepoPush !== undefined) {
    decision = "ask";
    reason = `a push URL of origin goes to another repo, ${otherRepoPush.owner}/${otherRepoPush.repo} on ${otherRepoPush.host}`;
  } else if (prAuthor !== undefined && (user === undefined || !same(prAuthor, user))) {
    decision = "ask";
    reason = `the PR is by ${prAuthor}`;
  } else if (key !== null && value === null) {
    decision = "ask";
    reason = `workflow.git.${key} is not set in profile "${profile.name}" with default set ${config.defaults}`;
  } else if (action === "merge") {
    decision = value as Decision;
    reason = `workflow.git.merge is "${String(value)}" in profile "${profile.name}"`;
  } else if (!state.repo) {
    decision = "ask";
    reason = "the current folder is not in a git repository";
  } else if (state.branch === undefined) {
    decision = "ask";
    reason = "HEAD is detached";
  } else if (state.defaultBranch === undefined) {
    decision = "ask";
    reason = "no default branch found";
  } else if (action === "pr" && state.branch === state.defaultBranch) {
    decision = "ask";
    reason = `${state.branch} is the default branch, and a PR cannot go from the default branch to itself`;
  } else {
    decision = value as Decision;
    reason = `workflow.git.${String(key)} is "${String(value)}" in profile "${profile.name}"${on}`;
  }

  return print({ decision, key, value, reason });
};
