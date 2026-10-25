import { autoUpdate, formatDoctor, runDoctor } from "../install/doctor.ts";
import type { UpdateCheckSeams } from "../install/doctor.ts";
import type { CliContext } from "../types.ts";
import { parseArgs } from "../util/args.ts";
import { formatJson } from "../util/output.ts";
import { readCapabilities } from "./shared.ts";

export const summary = "Check the runtime, config, skills, links, hooks, T3, worktree setup, and roles.";

export const usage = `Usage: omt doctor [--project] [--capabilities <file>] [--json]

Run the install and config checks and print one line per check.
Exits 1 when any check fails.

Options:
  --project              check the project install of the current project
                         (shim, git exclude, and the worktree setup of the
                         current checkout instead of path and homes)
  --capabilities <file>  orchestrator_capabilities output (- for stdin);
                         also checks that every role resolves
  --json                 print { ok, checks } as JSON
  -h, --help             print this help
`;

export async function run(ctx: CliContext, seams: UpdateCheckSeams = {}): Promise<number> {
  const { values } = parseArgs(ctx.argv, {
    capabilities: { type: "string" },
    json: { type: "boolean" },
    project: { type: "boolean" },
  }, { maxPositionals: 0 });
  const project = values.project === true;
  const json = values.json === true;
  const { report, daily } = await runDoctor(ctx, await readCapabilities(ctx, values.capabilities), project ? "project" : "user", seams);
  ctx.stdout(json ? formatJson(report) : formatDoctor(report));
  await autoUpdate(ctx, daily, { project, json }, seams);
  return report.ok ? 0 : 1;
}
