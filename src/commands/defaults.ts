import { DEFAULT_SETS, defaultSetNames, diffDefaultSets, isDefaultSet, LATEST_DEFAULT_SET } from "../config/defaultSets.ts";
import { parseJsonc, setTopLevelValue } from "../config/jsonc.ts";
import { readConfigLayers } from "../config/load.ts";
import { confirmApply } from "../install/confirm.ts";
import { writeTargetFor } from "../install/fsops.ts";
import { findProjectRoot, projectConfigPath, userConfigPath } from "../paths.ts";
import type { CliContext, CommandRun, OmtConfig } from "../types.ts";
import { checkPositionals, parseArgs } from "../util/args.ts";
import { OmtError, usageError } from "../util/errors.ts";
import { pathExists, readFileIfExists, writeFileAtomic } from "../util/fs.ts";
import { isRecord } from "../util/json.ts";
import { formatJson } from "../util/output.ts";
import { loadConfigReporting } from "./shared.ts";

export const summary = "List, compare, and pin the dated default sets.";

export const usage = `Usage: omt defaults list [--json]
       omt defaults diff [<from>] [<to>] [--json]
       omt defaults use <set|latest> [--user | --project] [--dry-run] [--yes] [--json]

Each omt release ships dated default sets, such as 2026-10. The "defaults"
key of a config file pins one set; without it, omt uses the latest set.
The project config's pin wins over the user config's.

Subcommands:
  list              print each set with the latest and selected marks
  diff              print what changes from <from> (default: the selected
                    set) to <to> (default: latest), and which config file
                    overrides each change
  use               set the "defaults" key of one config file; changes
                    nothing else in the file

Options:
  --user            with use: change the user config
  --project         with use: change the project config (default when it
                    exists, else the user config)
  --dry-run         with use: print the change and write nothing
  --yes             with use: apply the change without asking
  --json            print JSON
  -h, --help        print this help
`;

export interface ConfigTarget {
  scope: "user" | "project";
  path: string;
}

// The config file that a write goes to: the flag's scope, else the project config when it exists,
// else the user config.
export async function configTarget(ctx: CliContext, flags: { user?: boolean; project?: boolean }): Promise<ConfigTarget> {
  if (flags.user === true && flags.project === true) throw usageError("use --user or --project, not both");
  const project = projectConfigPath(findProjectRoot(ctx.cwd));
  const user = userConfigPath(ctx.env, ctx.homedir);
  if (flags.project === true) return { scope: "project", path: project };
  if (flags.user === true) return { scope: "user", path: user };
  return (await pathExists(project)) ? { scope: "project", path: project } : { scope: "user", path: user };
}

// Reads the target config file, or fails with the command that creates it.
export async function readConfigTarget(target: ConfigTarget): Promise<string> {
  const text = await readFileIfExists(target.path);
  if (text === undefined) {
    throw new OmtError("config_not_found", `${target.path} does not exist`, {
      hint: target.scope === "project" ? "run omt init" : "run omt config init",
    });
  }
  return text;
}

// Writes next to the target only when the file still holds the snapshot that next was computed
// from, so that a change saved while the prompt was open is not lost. omt does not lock config
// writes, so a change between this read and the rename can still be lost.
export async function writeConfigTarget(target: ConfigTarget, snapshot: string, next: string): Promise<void> {
  if ((await readFileIfExists(target.path)) !== snapshot) {
    throw new OmtError("config_changed", `${target.path} changed while omt waited for confirmation; nothing was written`, {
      hint: "run the command again",
    });
  }
  await writeFileAtomic(await writeTargetFor(target.path), next);
}

function setName(value: string, what: string): string {
  const name = value === "latest" ? LATEST_DEFAULT_SET : value;
  if (!isDefaultSet(name)) {
    throw usageError(`unknown default set "${value}" for ${what}`, `known sets: ${defaultSetNames().join(", ")}, or latest`);
  }
  return name;
}

async function list(ctx: CliContext, json: boolean): Promise<number> {
  const loaded = await loadConfigReporting(ctx);
  const selected = loaded.config.defaults;
  const sets = defaultSetNames().map((name) => ({ name, latest: name === LATEST_DEFAULT_SET, selected: name === selected }));
  if (json) {
    ctx.stdout(formatJson({ latest: LATEST_DEFAULT_SET, selected, source: loaded.defaultsSource, sets }));
    return 0;
  }
  for (const set of sets) {
    const marks = [...(set.latest ? ["latest"] : []), ...(set.selected ? [`selected (${loaded.defaultsSource})`] : [])];
    ctx.stdout(`${set.name}${marks.length === 0 ? "" : `  ${marks.join(", ")}`}\n`);
  }
  return 0;
}

async function diff(ctx: CliContext, args: string[], json: boolean): Promise<number> {
  const loaded = await loadConfigReporting(ctx);
  const from = setName(args[0] ?? loaded.config.defaults, "<from>");
  const to = setName(args[1] ?? "latest", "<to>");
  const layers = (await readConfigLayers(ctx))
    .filter((file) => file.present)
    .map((file) => ({ source: file.path, layer: file.layer }));
  const changes = diffDefaultSets(DEFAULT_SETS[from] as OmtConfig, DEFAULT_SETS[to] as OmtConfig, layers);
  if (json) {
    ctx.stdout(formatJson({ from, to, changes }));
    return 0;
  }
  if (changes.length === 0) {
    ctx.stdout("no changes\n");
    return 0;
  }
  for (const change of changes) {
    const by = change.overriddenBy === undefined ? "" : ` (overridden by ${change.overriddenBy})`;
    ctx.stdout(`${change.path}: ${change.from} -> ${change.to}${by}\n`);
  }
  return 0;
}

async function use(
  ctx: CliContext,
  args: string[],
  flags: { user?: boolean; project?: boolean; dryRun: boolean; yes: boolean; json: boolean },
): Promise<number> {
  if (args[0] === undefined) throw usageError("defaults use needs a set name or latest");
  const next = setName(args[0], "use");
  const target = await configTarget(ctx, flags);
  const text = await readConfigTarget(target);
  const root = parseJsonc(text, target.path);
  const old = isRecord(root) && typeof root.defaults === "string" ? root.defaults : undefined;
  const changed = old !== next;
  const write = changed && !flags.dryRun;
  if (!flags.json) {
    ctx.stdout(`${target.path}: defaults ${old ?? "none"} -> ${next}\n`);
    if (!changed) ctx.stdout("Nothing to change.\n");
    else if (flags.dryRun) ctx.stdout("Dry run: nothing was written.\n");
  }
  if (write) {
    if (!(await confirmApply(ctx, flags.yes))) return 1;
    await writeConfigTarget(target, text, setTopLevelValue(text, "defaults", next));
    if (!flags.json) ctx.stdout(`update ${target.path}\n`);
  }
  if (flags.json) ctx.stdout(formatJson({ file: target.path, from: old ?? null, to: next, changed, applied: write }));
  return 0;
}

export const run: CommandRun = async (ctx) => {
  const { values, positionals } = parseArgs(ctx.argv, {
    json: { type: "boolean" },
    user: { type: "boolean" },
    project: { type: "boolean" },
    "dry-run": { type: "boolean" },
    yes: { type: "boolean" },
  });
  const [subcommand, ...args] = positionals;
  const json = values.json === true;
  const useFlags = values.user !== undefined || values.project !== undefined || values["dry-run"] !== undefined || values.yes !== undefined;
  if (subcommand !== "use" && useFlags) throw usageError("--user, --project, --dry-run, and --yes apply only to defaults use");
  if (subcommand === "list") {
    checkPositionals(positionals, 1);
    return list(ctx, json);
  }
  if (subcommand === "diff") {
    checkPositionals(positionals, 3);
    return diff(ctx, args, json);
  }
  if (subcommand === "use") {
    checkPositionals(positionals, 2);
    return use(ctx, args, {
      user: values.user,
      project: values.project,
      dryRun: values["dry-run"] === true,
      yes: values.yes === true,
      json,
    });
  }
  throw usageError(
    subcommand === undefined ? "defaults needs a subcommand: list, diff, or use" : `unknown defaults subcommand "${subcommand}"`,
    "use list, diff, or use",
  );
};
