import { DEFAULT_CONFIG } from "../config/defaults.ts";
import { loadConfig } from "../config/load.ts";
import { USER_STARTER_CONFIG } from "../config/starter.ts";
import { findProjectRoot, projectConfigPath, userConfigPath } from "../paths.ts";
import type { CliContext, CommandRun, ConfigIssue } from "../types.ts";
import { parseArgs } from "../util/args.ts";
import { OmtError, usageError } from "../util/errors.ts";
import { writeTargetFor } from "../install/fsops.ts";
import { pathExists, writeFileAtomic } from "../util/fs.ts";
import { printJson } from "../util/output.ts";

export const summary = "Show, locate, validate, or create the omt config.";

export const usage = `Usage: omt config [show | path | validate | init] [--json] [--defaults] [--force]

Subcommands:
  show              print the effective config as JSON (default)
  path              print the user and project config paths
  validate          print config issues; exit 1 on any error
  init              write the starter user config

Options:
  --json            print validate results as JSON
  --defaults        with show: print the built-in defaults
  --force           with init: overwrite an existing file
  -h, --help        print this help
`;

const SUBCOMMANDS = ["show", "path", "validate", "init"];

export function formatIssue(issue: ConfigIssue): string {
  const where = issue.path === "" ? issue.source : `${issue.source} ${issue.path}`;
  return `${issue.severity} ${where}: ${issue.message}\n`;
}

function loadFor(ctx: CliContext) {
  return loadConfig({ cwd: ctx.cwd, env: ctx.env, homedir: ctx.homedir });
}

async function show(ctx: CliContext, defaults: boolean): Promise<number> {
  if (defaults) {
    printJson(ctx.stdout, DEFAULT_CONFIG);
    return 0;
  }
  const loaded = await loadFor(ctx);
  for (const issue of loaded.issues) ctx.stderr(formatIssue(issue));
  printJson(ctx.stdout, loaded.config);
  return 0;
}

async function path(ctx: CliContext): Promise<number> {
  const user = userConfigPath(ctx.env, ctx.homedir);
  const project = projectConfigPath(findProjectRoot(ctx.cwd));
  const state = async (file: string) => ((await pathExists(file)) ? "present" : "absent");
  ctx.stdout(`user: ${user} (${await state(user)})\n`);
  ctx.stdout(`project: ${project} (${await state(project)})\n`);
  return 0;
}

async function validate(ctx: CliContext, json: boolean): Promise<number> {
  const { issues } = await loadFor(ctx);
  const ok = !issues.some((issue) => issue.severity === "error");
  if (json) {
    printJson(ctx.stdout, { ok, issues });
  } else if (issues.length === 0) {
    ctx.stdout("config ok\n");
  } else {
    for (const issue of issues) ctx.stdout(formatIssue(issue));
  }
  return ok ? 0 : 1;
}

async function init(ctx: CliContext, force: boolean): Promise<number> {
  const target = userConfigPath(ctx.env, ctx.homedir);
  const exists = await pathExists(target);
  if (exists && !force) {
    throw new OmtError("exists", `${target} already exists`, { hint: "use --force to overwrite it" });
  }
  await writeFileAtomic(await writeTargetFor(target), USER_STARTER_CONFIG);
  ctx.stdout(`${exists ? "overwrite" : "create"} ${target}\n`);
  return 0;
}

export const run: CommandRun = async (ctx) => {
  const { values, positionals } = parseArgs(ctx.argv, {
    json: { type: "boolean" },
    defaults: { type: "boolean" },
    force: { type: "boolean" },
  });
  if (positionals.length > 1) throw usageError(`unexpected argument "${positionals[1]}"`);
  const sub = positionals[0] ?? "show";
  if (!SUBCOMMANDS.includes(sub)) {
    throw usageError(`unknown subcommand "${sub}"`, `use one of: ${SUBCOMMANDS.join(", ")}`);
  }
  if (sub === "path") return path(ctx);
  if (sub === "validate") return validate(ctx, values.json === true);
  if (sub === "init") return init(ctx, values.force === true);
  return show(ctx, values.defaults === true);
};
