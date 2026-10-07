import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { writeTargetFor } from "../install/fsops.ts";
import { findProjectRoot, plansDir } from "../paths.ts";
import { findPlanHeader, parseMaxParallel, parseMaxTasks, parsePlan } from "../plan/parse.ts";
import type { PlanStatus } from "../plan/parse.ts";
import { planTemplate } from "../plan/template.ts";
import type { CliContext, CommandRun } from "../types.ts";
import { OmtError, usageError } from "../util/errors.ts";
import { parseArgs } from "../util/args.ts";
import { PLAN_SLUG_RE, checkPlanSlug } from "../util/ids.ts";
import { pathExists, readFileIfExists, writeFileAtomic } from "../util/fs.ts";
import { printJson } from "../util/output.ts";

export const summary = "Create plan files and show their progress.";

export const usage = `Usage: omt plan new <slug> [--title <text>] [--light] [--max-parallel <n>]
                    [--max-tasks <n>] [--force]
       omt plan mark <slug> <id> <done|open|blocked>
       omt plan limit <slug> [<n|none>] [--tasks <n|none>]
       omt plan status [<slug>] [--json]
       omt plan list [--json]

Subcommands:
  new <slug>        write .omt/plans/<slug>.md from the template
  mark <slug> <id>  set the checkbox of an item such as U3, D1, or F2, and
                    append a line to the log
  limit <slug> <n>  set the plan's max-parallel header key (1 to 32), or
                    remove it with none; --tasks sets or removes max-tasks
  status [<slug>]   print counts and the next open unit (default: newest plan)
  list              print one line per plan

Options:
  --title <text>    with new: the plan title (default: the slug)
  --light           with new: leave out the oracle line (F2)
  --max-parallel <n>
                    with new: cap parallel dispatch for this plan (1 to 32)
  --max-tasks <n>   with new: the task budget of this plan (1 to 500); it
                    replaces limits.maxTasksPerRun for this plan
  --tasks <n|none>  with limit: set or remove the max-tasks header key
  --force           with new: overwrite an existing plan
  --json            print JSON
  -h, --help        print this help
`;

const MARKS = { done: "x", open: " ", blocked: "~" } as const;
type MarkState = keyof typeof MARKS;

export interface PlanSummary extends PlanStatus {
  path: string;
}

function extraPositional(positionals: string[], max: number): void {
  const extra = positionals[max];
  if (extra !== undefined) throw usageError(`unexpected argument "${extra}"`);
}

async function listPlanFiles(dir: string): Promise<{ slug: string; path: string; mtimeMs: number }[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const plans = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) continue;
    const slug = name.slice(0, -3);
    if (!PLAN_SLUG_RE.test(slug)) continue;
    const path = join(dir, name);
    let info;
    try {
      info = await stat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; // a dangling symlink
      throw error;
    }
    if (info.isFile()) plans.push({ slug, path, mtimeMs: info.mtimeMs });
  }
  return plans;
}

async function loadPlan(path: string, slug: string): Promise<PlanSummary> {
  const status = parsePlan(await readPlan(path, slug));
  return { ...status, slug: status.slug ?? slug, path };
}

function maxParallelArg(value: string, flag: string): number {
  const number = parseMaxParallel(value);
  if (number === undefined) throw usageError(`${flag} must be an integer from 1 to 32, got "${value}"`);
  return number;
}

function maxTasksArg(value: string, flag: string): number {
  const number = parseMaxTasks(value);
  if (number === undefined) throw usageError(`${flag} must be an integer from 1 to 500, got "${value}"`);
  return number;
}

function setHeaderKey(header: string, key: string, value: number | undefined): string {
  const kept = header.replace(new RegExp(`\\s+${key}=[^\\s>]*`, "g"), "").replace(/\s*-->$/, "");
  return value === undefined ? `${kept} -->` : `${kept} ${key}=${value} -->`;
}

async function readPlan(path: string, slug: string): Promise<string> {
  const markdown = await readFileIfExists(path);
  if (markdown === undefined) {
    throw new OmtError("plan_not_found", `plan "${slug}" not found at ${path}`, {
      hint: `run "omt plan new ${slug}" to create it`,
    });
  }
  return markdown;
}

function nextText(status: PlanStatus): string {
  return status.next === undefined ? "none" : `${status.next.id} ${status.next.title}`;
}

function unitsText(status: PlanStatus): string {
  const units = status.counts.U;
  return `${units.done}/${units.total} done, ${units.blocked} blocked, ${units.open} open`;
}

async function planNew(
  ctx: CliContext,
  root: string,
  positionals: string[],
  options: { title: string | undefined; light: boolean; maxParallel: string | undefined; maxTasks: string | undefined; force: boolean },
) {
  const slug = positionals[1];
  if (slug === undefined) throw usageError("plan new needs a <slug>");
  extraPositional(positionals, 2);
  checkPlanSlug(slug);
  const maxParallel = options.maxParallel === undefined ? undefined : maxParallelArg(options.maxParallel, "--max-parallel");
  const maxTasks = options.maxTasks === undefined ? undefined : maxTasksArg(options.maxTasks, "--max-tasks");
  const path = join(plansDir(root), `${slug}.md`);
  if (!options.force && (await pathExists(path))) {
    throw new OmtError("plan_exists", `plan already exists: ${path}`, { hint: "pass --force to overwrite it" });
  }
  const template = planTemplate(slug, options.title ?? slug, ctx.now().toISOString(), { light: options.light, maxParallel, maxTasks });
  await writeFileAtomic(await writeTargetFor(path), template);
  ctx.stdout(`${path}\n`);
  return 0;
}

async function planMark(ctx: CliContext, root: string, positionals: string[]) {
  const [, slug, id, state] = positionals;
  if (slug === undefined || id === undefined || state === undefined) {
    throw usageError("plan mark needs <slug> <id> <done|open|blocked>");
  }
  extraPositional(positionals, 4);
  checkPlanSlug(slug);
  if (!Object.hasOwn(MARKS, state)) throw usageError(`invalid state "${state}"`, "use done, open, or blocked");
  const mark = MARKS[state as MarkState];
  const path = join(plansDir(root), `${slug}.md`);
  const markdown = await readPlan(path, slug);
  const item = /^(U|D|F)(\d+)$/.test(id) ? parsePlan(markdown).items.find((candidate) => candidate.id === id) : undefined;
  if (item === undefined) throw new OmtError("plan_item_not_found", `no item ${id} in plan "${slug}"`);
  const lines = markdown.split("\n");
  const index = item.line - 1;
  lines[index] = `- [${mark}]${(lines[index] ?? "").slice(5)}`;
  let text = lines.join("\n");
  if (!text.endsWith("\n")) text += "\n";
  text += `- ${ctx.now().toISOString()} ${id} -> ${state}\n`;
  await writeFileAtomic(await writeTargetFor(path), text);
  ctx.stdout(`marked ${id} ${state}\n`);
  return 0;
}

async function planLimit(ctx: CliContext, root: string, positionals: string[], tasks: string | undefined) {
  const [, slug, value] = positionals;
  if (slug === undefined || (value === undefined && tasks === undefined)) {
    throw usageError("plan limit needs <slug> <n|none> or --tasks <n|none>");
  }
  extraPositional(positionals, 3);
  checkPlanSlug(slug);
  const changes: { key: string; limit: number | undefined }[] = [];
  if (value !== undefined) changes.push({ key: "max-parallel", limit: value === "none" ? undefined : maxParallelArg(value, "the limit") });
  if (tasks !== undefined) changes.push({ key: "max-tasks", limit: tasks === "none" ? undefined : maxTasksArg(tasks, "--tasks") });
  const path = join(plansDir(root), `${slug}.md`);
  const markdown = await readPlan(path, slug);
  const header = findPlanHeader(markdown);
  if (header === undefined) throw new OmtError("plan_header_not_found", `plan "${slug}" has no omt-plan header comment`);
  const updated = changes.reduce((text, change) => setHeaderKey(text, change.key, change.limit), header.text);
  await writeFileAtomic(await writeTargetFor(path), markdown.slice(0, header.index) + updated + markdown.slice(header.index + header.text.length));
  for (const { key, limit } of changes) {
    ctx.stdout(limit === undefined ? `removed the ${key} limit of ${slug}\n` : `set ${key}=${limit} for ${slug}\n`);
  }
  return 0;
}

async function planStatus(ctx: CliContext, root: string, positionals: string[], json: boolean) {
  extraPositional(positionals, 2);
  const dir = plansDir(root);
  let slug = positionals[1];
  let path: string;
  if (slug === undefined) {
    const plans = await listPlanFiles(dir);
    const newest = plans.reduce<(typeof plans)[number] | undefined>(
      (best, plan) => (best === undefined || plan.mtimeMs > best.mtimeMs ? plan : best),
      undefined,
    );
    if (newest === undefined) {
      throw new OmtError("no_plans", `no plans in ${dir}`, { hint: `run "omt plan new <slug>" to create one` });
    }
    slug = newest.slug;
    path = newest.path;
  } else {
    checkPlanSlug(slug);
    path = join(dir, `${slug}.md`);
  }
  const status = await loadPlan(path, slug);
  if (json) {
    printJson(ctx.stdout, status);
    return 0;
  }
  ctx.stdout(
    [
      `plan: ${status.slug} (${path})`,
      `units: ${unitsText(status)}`,
      `done-when: ${status.counts.D.done}/${status.counts.D.total}`,
      `final: ${status.counts.F.done}/${status.counts.F.total}`,
      ...(status.maxParallel === undefined ? [] : [`max parallel: ${status.maxParallel}`]),
      ...(status.maxTasks === undefined ? [] : [`max tasks: ${status.maxTasks}`]),
      `next: ${nextText(status)}`,
      "",
    ].join("\n"),
  );
  return 0;
}

async function planList(ctx: CliContext, root: string, positionals: string[], json: boolean) {
  extraPositional(positionals, 1);
  const plans = await listPlanFiles(plansDir(root));
  const summaries: PlanSummary[] = [];
  for (const plan of plans) summaries.push(await loadPlan(plan.path, plan.slug));
  if (json) {
    printJson(ctx.stdout, summaries);
    return 0;
  }
  const width = Math.max(0, ...summaries.map((plan) => (plan.slug ?? "").length));
  for (const plan of summaries) {
    ctx.stdout(`${(plan.slug ?? "").padEnd(width)}  units ${unitsText(plan)}  next: ${nextText(plan)}\n`);
  }
  return 0;
}

export const run: CommandRun = async (ctx) => {
  const { values, positionals } = parseArgs(ctx.argv, {
    title: { type: "string" },
    light: { type: "boolean" },
    "max-parallel": { type: "string" },
    "max-tasks": { type: "string" },
    tasks: { type: "string" },
    force: { type: "boolean" },
    json: { type: "boolean" },
  });
  const root = findProjectRoot(ctx.cwd);
  const json = values.json === true;
  switch (positionals[0]) {
    case "new":
      return planNew(ctx, root, positionals, {
        title: values.title,
        light: values.light === true,
        maxParallel: values["max-parallel"],
        maxTasks: values["max-tasks"],
        force: values.force === true,
      });
    case "mark":
      return planMark(ctx, root, positionals);
    case "limit":
      return planLimit(ctx, root, positionals, values.tasks);
    case "status":
      return planStatus(ctx, root, positionals, json);
    case "list":
      return planList(ctx, root, positionals, json);
    case undefined:
      throw usageError("plan needs a subcommand: new, mark, limit, status, or list");
    default:
      throw usageError(`unknown plan subcommand "${positionals[0]}"`, "use new, mark, limit, status, or list");
  }
};
