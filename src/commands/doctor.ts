import { loadConfig } from "../config/load.ts";
import { findProjectRoot, projectManifestPath } from "../paths.ts";
import { activeDefaults, reviewDefaults } from "../config/defaultsState.ts";
import { autoUpdate, formatDoctor, runDoctor } from "../install/doctor.ts";
import type { UpdateCheckSeams } from "../install/doctor.ts";
import type { CliContext } from "../types.ts";
import { parseArgs } from "../util/args.ts";
import { formatJson } from "../util/output.ts";
import { readCapabilities } from "./shared.ts";

export const summary = "Check the runtime, config, skills, links, hooks, T3, worktree setup, and roles.";

export const usage = `Usage: omt doctor [--project] [--capabilities <file>] [--yes] [--dry-run] [--json]

Run the install and config checks and print one line per check.
Exits 1 when any check fails.

Options:
  --project              check the project install of the current project
                         (shim, git exclude, and the worktree setup of the
                         current checkout instead of path and homes)
  --capabilities <file>  orchestrator_capabilities output (- for stdin);
                         also checks that every role resolves
  --yes                  accept the current defaults without a prompt
  --dry-run              show default changes without writing
  --json                 print the report and defaults review as JSON
  -h, --help             print this help
`;

export async function run(ctx: CliContext, seams: UpdateCheckSeams = {}): Promise<number> {
  const { values } = parseArgs(ctx.argv, {
    capabilities: { type: "string" },
    json: { type: "boolean" },
    project: { type: "boolean" },
    yes: { type: "boolean" },
    "dry-run": { type: "boolean" },
  }, { maxPositionals: 0 });
  const project = values.project === true;
  const json = values.json === true;
  const active = await activeDefaults(ctx);
  const defaultsScope = project || active.source === projectManifestPath(findProjectRoot(ctx.cwd)) ? "project" : "user";
  const loaded = await loadConfig(ctx);
  const defaults = loaded.issues.some((issue) => issue.severity === "error")
    ? { changed: false, applied: false, changes: [] }
    : await reviewDefaults(ctx, defaultsScope, { yes: values.yes === true, dryRun: values["dry-run"] === true, json });
  const { report, daily } = await runDoctor(ctx, await readCapabilities(ctx, values.capabilities), project ? "project" : "user", { ...seams, skipUpdate: values["dry-run"] === true });
  ctx.stdout(json ? formatJson({ ...report, defaults }) : formatDoctor(report));
  if (values["dry-run"] !== true) await autoUpdate(ctx, daily, { project, json }, seams);
  return report.ok ? 0 : 1;
}
