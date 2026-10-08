import { loadConfig } from "../config/load.ts";
import { join } from "node:path";
import { findProjectRoot, ledgerPath, plansDir } from "../paths.ts";
import {
  appendLedger,
  closes,
  isLedgerStatus,
  isTerminal,
  LEDGER_STATUSES,
  ledgerStats,
  readLedger,
  requestId,
} from "../ledger/ledger.ts";
import { parsePlan } from "../plan/parse.ts";
import type { CliContext, CommandRun, LedgerEntry, LedgerStats } from "../types.ts";
import { usageError } from "../util/errors.ts";
import { formatIssue } from "./config.ts";
import { parseArgs } from "../util/args.ts";
import { checkPlanSlug, checkUnitId } from "../util/ids.ts";
import { readFileIfExists } from "../util/fs.ts";
import { printJson, renderTable } from "../util/output.ts";

export const summary = "Record and list delegation events in .omt/ledger.jsonl.";

export const usage = `Usage: omt ledger add --role <role> --status <status> [options]
       omt ledger list [--plan <slug>] [--json]
       omt ledger stats [--plan <slug>] [--json]
       omt ledger request-id --plan <slug> --unit <id> --role <role> [--round <n>] [--attempt <n>]

Subcommands:
  add               append one entry to .omt/ledger.jsonl
  list              print the entries
  stats             print dispatched, active, and terminal counts, the limits,
                    and whether another task can be dispatched; with --plan,
                    a max-parallel limit in the plan header lowers max parallel,
                    and a max-tasks key replaces max tasks per run
  request-id        print the canonical clientRequestId

Options for add:
  --role <role>               role name, any string (required)
  --status <status>           dispatched, completed, failed, cancelled,
                              interrupted, verified, or rejected (required)
  --plan <slug>               plan id
  --unit <id>                 unit id; dispatched needs --unit or --task-id
  --round <n>                 round number
  --attempt <n>               attempt number within the round
  --task-id <id>              T3 task id
  --client-request-id <id>    clientRequestId used for the dispatch
  --provider <id>             provider instance id
  --model <id>                model id
  --verdict <text>            result verdict
  --note <text>               free-form note

Other options:
  --plan <slug>     with list and stats: only entries for this plan
  --json            with list and stats: print JSON
  -h, --help        print this help
`;

const OPTIONS = {
  role: { type: "string" },
  status: { type: "string" },
  plan: { type: "string" },
  unit: { type: "string" },
  round: { type: "string" },
  attempt: { type: "string" },
  "task-id": { type: "string" },
  "client-request-id": { type: "string" },
  provider: { type: "string" },
  model: { type: "string" },
  verdict: { type: "string" },
  note: { type: "string" },
  json: { type: "boolean" },
} as const;

type Values = ReturnType<typeof parseArgs<typeof OPTIONS>>["values"];

function positiveInt(flag: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value)) throw usageError(`--${flag} must be a positive integer, got "${value}"`);
  return Number(value);
}

function required(flag: string, value: string | undefined, subcommand: string): string {
  if (value === undefined || value === "") throw usageError(`ledger ${subcommand} needs --${flag}`);
  return value;
}

function onlyFlags(subcommand: string, values: Values, allowed: readonly string[]): void {
  for (const key of Object.keys(values)) {
    if (!allowed.includes(key)) throw usageError(`--${key} does not apply to ledger ${subcommand}`);
  }
}

async function add(ctx: CliContext, root: string, values: Values) {
  onlyFlags("add", values, Object.keys(OPTIONS).filter((key) => key !== "json"));
  const role = required("role", values.role, "add");
  const status = required("status", values.status, "add");
  if (!isLedgerStatus(status)) {
    throw usageError(`invalid --status "${status}"`, `use one of: ${LEDGER_STATUSES.join(", ")}`);
  }
  if (status === "dispatched" && values["task-id"] === undefined && values.unit === undefined) {
    throw usageError("ledger add --status dispatched needs --task-id or --unit");
  }
  if (status === "dispatched" && values["task-id"] === undefined) {
    ctx.stderr("warning: this dispatched entry has no --task-id; the stall check and result matching need it\n");
  }
  const optional: Partial<LedgerEntry> = {
    plan: values.plan,
    unit: values.unit,
    round: positiveInt("round", values.round),
    attempt: positiveInt("attempt", values.attempt),
    taskId: values["task-id"],
    clientRequestId: values["client-request-id"],
    provider: values.provider,
    model: values.model,
    verdict: values.verdict,
    note: values.note,
  };
  const entry: LedgerEntry = { ts: ctx.now().toISOString(), role, status };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined) (entry as unknown as Record<string, unknown>)[key] = value;
  }
  const path = ledgerPath(root);
  const closesOne = isTerminal(status) ? (await readLedger(path)).entries.some((other) => closes(entry, other)) : true;
  await appendLedger(path, entry);
  printJson(ctx.stdout, entry);
  if (!closesOne) ctx.stderr("omt: no dispatched entry matches; nothing was closed\n");
  return 0;
}

async function load(ctx: CliContext, root: string, plan: string | undefined): Promise<LedgerEntry[]> {
  const { entries, warnings } = await readLedger(ledgerPath(root));
  for (const warning of warnings) ctx.stderr(`warning: ${warning}\n`);
  return plan === undefined ? entries : entries.filter((entry) => entry.plan === plan);
}

async function list(ctx: CliContext, root: string, values: Values) {
  onlyFlags("list", values, ["plan", "json"]);
  const entries = await load(ctx, root, values.plan);
  if (values.json === true) {
    printJson(ctx.stdout, entries);
    return 0;
  }
  const rows = entries.map((entry) => [
    entry.ts.slice(11, 19),
    entry.plan ?? "-",
    entry.unit ?? "-",
    entry.role,
    entry.round === undefined ? "-" : String(entry.round),
    entry.status,
    entry.verdict ?? "-",
    entry.taskId === undefined ? "-" : entry.taskId.slice(-12),
  ]);
  ctx.stdout(renderTable(["TIME", "PLAN", "UNIT", "ROLE", "ROUND", "STATUS", "VERDICT", "TASK"], rows));
  return 0;
}

async function stats(ctx: CliContext, root: string, values: Values) {
  onlyFlags("stats", values, ["plan", "json"]);
  const { config, issues } = await loadConfig({ cwd: ctx.cwd, env: ctx.env, homedir: ctx.homedir });
  for (const issue of issues) ctx.stderr(formatIssue(issue));
  const markdown = values.plan === undefined ? undefined : await readFileIfExists(join(plansDir(root), `${values.plan}.md`));
  const plan = markdown === undefined ? undefined : parsePlan(markdown);
  const planMaxParallel = plan?.maxParallel;
  const planMaxTasks = plan?.maxTasks;
  const limits = {
    maxParallel: Math.min(config.limits.maxParallel, planMaxParallel ?? config.limits.maxParallel),
    maxTasksPerRun: planMaxTasks ?? config.limits.maxTasksPerRun,
  };
  const stats = ledgerStats(await load(ctx, root, values.plan), limits, values.plan);
  const result: LedgerStats = { ...stats };
  if (planMaxParallel !== undefined) result.planMaxParallel = planMaxParallel;
  if (planMaxTasks !== undefined) result.planMaxTasks = planMaxTasks;
  if (values.json === true) {
    printJson(ctx.stdout, result);
    return 0;
  }
  const lines = [
    ...(result.plan === undefined ? [] : [`plan: ${result.plan}`]),
    `dispatched: ${result.dispatched}`,
    `active: ${result.active}`,
    `terminal: ${result.terminal}`,
    planMaxParallel === undefined
      ? `max parallel: ${result.limits.maxParallel}`
      : `max parallel: ${result.limits.maxParallel} (plan ${planMaxParallel}, config ${config.limits.maxParallel})`,
    planMaxTasks === undefined
      ? `max tasks per run: ${result.limits.maxTasksPerRun}`
      : `max tasks per run: ${result.limits.maxTasksPerRun} (plan ${planMaxTasks}, config ${config.limits.maxTasksPerRun})`,
    `can dispatch: ${result.canDispatch ? "yes" : "no"}`,
  ];
  ctx.stdout(lines.map((line) => `${line}\n`).join(""));
  return 0;
}

function printRequestId(ctx: CliContext, values: Values) {
  onlyFlags("request-id", values, ["plan", "unit", "role", "round", "attempt"]);
  const id = requestId(
    required("plan", values.plan, "request-id"),
    required("unit", values.unit, "request-id"),
    required("role", values.role, "request-id"),
    positiveInt("round", values.round),
    positiveInt("attempt", values.attempt),
  );
  ctx.stdout(`${id}\n`);
  return 0;
}

export const run: CommandRun = async (ctx) => {
  const { values, positionals } = parseArgs(ctx.argv, OPTIONS);
  const [subcommand, extra] = positionals;
  if (extra !== undefined) throw usageError(`unexpected argument "${extra}"`);
  if (values.plan !== undefined) checkPlanSlug(values.plan, "--plan");
  if (values.unit !== undefined) checkUnitId(values.unit);
  const root = findProjectRoot(ctx.cwd);
  switch (subcommand) {
    case "add":
      return add(ctx, root, values);
    case "list":
      return list(ctx, root, values);
    case "stats":
      return stats(ctx, root, values);
    case "request-id":
      return printRequestId(ctx, values);
    case undefined:
      throw usageError("ledger needs a subcommand: add, list, stats, or request-id");
    default:
      throw usageError(`unknown ledger subcommand "${subcommand}"`, "use add, list, stats, or request-id");
  }
};
