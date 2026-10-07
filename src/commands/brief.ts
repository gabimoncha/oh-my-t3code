import { renderBrief, briefTitle } from "../brief/render.ts";
import type { BriefInput } from "../brief/render.ts";
import { findRoleTemplate, loadResultContract } from "../brief/templates.ts";
import { loadConfig } from "../config/load.ts";
import { requestId } from "../ledger/ledger.ts";
import { evidenceDir, findProjectRoot } from "../paths.ts";
import { resolveRole, toRouteOutput } from "../routing/resolve.ts";
import type { BriefJsonOutput, CliContext, CommandRun } from "../types.ts";
import { parseArgs } from "../util/args.ts";
import { OmtError, usageError } from "../util/errors.ts";
import { printJson } from "../util/output.ts";
import { formatIssue } from "./config.ts";
import { againstOptions, checkAgainst, findRole, readCapabilities, readInput } from "./route.ts";

export const summary = "Render a task brief for a role, or a delegate_task payload.";

export const usage = `Usage: omt brief <role> (--task <text> | --task-file <file>) [options]

Render the brief that a child agent gets for one task.

Options:
  --task <text>            the task
  --task-file <file>       read the task from a file (- for stdin)
  --context <text>         background the child needs
  --context-file <file>    read the context from a file (- for stdin)
  --scope <path>           a file or directory in scope; repeatable
  --done <text>            one done condition; repeatable
  --verify <command>       one verify command; repeatable
  --prior-file <file>      earlier rounds: findings, responses, objections
  --round <n>              review or fix round (default 1)
  --depth <n>              the child's depth (default 1)
  --max-depth <n>          override limits.maxDepth from the config (0 to 3)
  --plan <slug>            plan id for the header and the request id
  --unit <id>              unit id for the header and the request id
  --attempt <n>            attempt number for the request id (default 1)
  --title <text>           thread title for --json output
  --capabilities <file>    with --json: resolve the target against T3
  --against <value>        the provider or driver of the worker whose change the task
                           reviews, used with --json; auto reads it from the ledger and needs --plan
  --json                   print a ready delegate_task payload
  -h, --help               print this help
`;

const TITLE_MAX = 72;
export const BRIEF_MAX_CHARS = 120_000;

function positiveInt(flag: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) throw usageError(`--${flag} must be a positive integer, got "${value}"`);
  return Number(value);
}

function exclusive(textFlag: string, text: string | undefined, fileFlag: string, file: string | undefined): void {
  if (text !== undefined && file !== undefined) throw usageError(`use --${textFlag} or --${fileFlag}, not both`);
}

async function readText(
  ctx: CliContext,
  text: string | undefined,
  flag: string,
  file: string | undefined,
): Promise<string | undefined> {
  if (text !== undefined) return text;
  if (file === undefined) return undefined;
  return readInput(ctx, flag, file);
}

export const run: CommandRun = async (ctx) => {
  const { values, positionals } = parseArgs(ctx.argv, {
    task: { type: "string" },
    "task-file": { type: "string" },
    context: { type: "string" },
    "context-file": { type: "string" },
    scope: { type: "string", multiple: true },
    done: { type: "string", multiple: true },
    verify: { type: "string", multiple: true },
    "prior-file": { type: "string" },
    round: { type: "string" },
    depth: { type: "string" },
    "max-depth": { type: "string" },
    plan: { type: "string" },
    unit: { type: "string" },
    attempt: { type: "string" },
    title: { type: "string" },
    capabilities: { type: "string" },
    against: { type: "string" },
    json: { type: "boolean" },
  });
  const [name, extra] = positionals;
  if (name === undefined) throw usageError("brief needs a <role>");
  if (extra !== undefined) throw usageError(`unexpected argument "${extra}"`);
  exclusive("task", values.task, "task-file", values["task-file"]);
  exclusive("context", values.context, "context-file", values["context-file"]);
  if (values.task === undefined && values["task-file"] === undefined) {
    throw usageError("brief needs --task <text> or --task-file <file>");
  }
  const stdinFlags = [values["task-file"], values["context-file"], values["prior-file"], values.capabilities];
  if (stdinFlags.filter((file) => file === "-").length > 1) throw usageError("only one flag can read stdin (-)");
  const json = values.json === true;
  checkAgainst(values);

  const round = positiveInt("round", values.round, 1);
  const depth = positiveInt("depth", values.depth, 1);
  const attempt = positiveInt("attempt", values.attempt, 1);
  const maxDepthFlag = values["max-depth"];
  if (maxDepthFlag !== undefined && !/^[0-3]$/.test(maxDepthFlag)) {
    throw usageError(`--max-depth must be an integer from 0 to 3, got "${maxDepthFlag}"`);
  }

  const { config, issues } = await loadConfig({ cwd: ctx.cwd, env: ctx.env, homedir: ctx.homedir });
  for (const issue of issues) ctx.stderr(formatIssue(issue));
  const role = findRole(config, name);

  const limit = maxDepthFlag === undefined ? config.limits.maxDepth : Number(maxDepthFlag);
  // A worker at max depth may still hand a device check to one test child, one level deeper.
  const maxDepth = name === "test" && depth === limit + 1 ? depth : limit;
  if (depth > maxDepth) {
    throw usageError(`--depth ${depth} is greater than the max depth ${limit}`, "pass --max-depth <n> to raise the limit (0 to 3)");
  }

  const task = (await readText(ctx, values.task, "task-file", values["task-file"])) ?? "";
  if (task.trim() === "") throw usageError("the task is empty");
  const context = await readText(ctx, values.context, "context-file", values["context-file"]);
  const prior = await readText(ctx, undefined, "prior-file", values["prior-file"]);

  const input: BriefInput = {
    role: name,
    task,
    scope: values.scope ?? [],
    done: values.done ?? [],
    verify: values.verify ?? [],
    round,
    depth,
    maxDepth,
    configuredMaxDepth: config.limits.maxDepth,
    access: role.access,
    interactionMode: role.interactionMode,
  };
  if (context !== undefined) input.context = context;
  if (prior !== undefined) input.prior = prior;
  if (values.plan !== undefined) input.plan = values.plan;
  if (values.unit !== undefined) input.unit = values.unit;

  const projectRoot = findProjectRoot(ctx.cwd);
  if (role.access === "edit") input.evidenceDir = `${evidenceDir(projectRoot)}/`;

  const roots = { packageRoot: ctx.packageRoot, projectRoot, env: ctx.env, homedir: ctx.homedir };
  const persona = await findRoleTemplate(roots, name);
  const contract = await loadResultContract(ctx.packageRoot, role.result);
  const brief = renderBrief(input, persona.content, contract);
  if (brief.length > BRIEF_MAX_CHARS) {
    throw new OmtError("brief_too_long", `the brief has ${brief.length} characters; the limit is ${BRIEF_MAX_CHARS}`, {
      hint: "shorten --context or --prior-file, or point the child at files instead",
    });
  }

  if (!json) {
    ctx.stdout(brief);
    return 0;
  }

  const caps = await readCapabilities(ctx, values.capabilities);
  const resolution = resolveRole(name, role, caps, await againstOptions(ctx, config, role, values));
  for (const note of resolution.notes ?? []) ctx.stderr(`note: ${note}\n`);
  const args = resolution.delegateTask;
  if (args === undefined) {
    throw new OmtError("role_unavailable", `role ${name} is unavailable: no rung in its chain can run`, {
      hint: toRouteOutput(resolution).notes.join("\n      "),
    });
  }
  const output: BriefJsonOutput = {
    delegateTask: {
      task: brief,
      title: (values.title ?? briefTitle(name, task, values.unit, round)).slice(0, TITLE_MAX),
      target: args.target,
      role: args.role,
      interactionMode: args.interactionMode,
      runtimeMode: args.runtimeMode,
      mode: "async",
    },
    fallbacks: resolution.fallbacks,
  };
  if (values.plan !== undefined && values.unit !== undefined) {
    output.delegateTask.clientRequestId = requestId(values.plan, values.unit, name, round, attempt);
  }
  printJson(ctx.stdout, output);
  return 0;
};
