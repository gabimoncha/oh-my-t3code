import { formatDoctor, runDoctor } from "../install/doctor.ts";
import type { CommandRun } from "../types.ts";
import { parseArgs } from "../util/args.ts";
import { usageError } from "../util/errors.ts";
import { printJson } from "../util/output.ts";
import { readCapabilities } from "./route.ts";

export const summary = "Check the Node version, config, skills, links, hooks, T3, and roles.";

export const usage = `Usage: omt doctor [--capabilities <file>] [--json]

Run the install and config checks and print one line per check.
Exits 1 when any check fails.

Options:
  --capabilities <file>  orchestrator_capabilities output (- for stdin);
                         also checks that every role resolves
  --json                 print { ok, checks } as JSON
  -h, --help             print this help
`;

export const run: CommandRun = async (ctx) => {
  const { values, positionals } = parseArgs(ctx.argv, {
    capabilities: { type: "string" },
    json: { type: "boolean" },
  });
  if (positionals.length > 0) throw usageError(`unexpected argument "${positionals[0]}"`);
  const report = await runDoctor(ctx, await readCapabilities(ctx, values.capabilities));
  if (values.json === true) {
    printJson(ctx.stdout, report);
  } else {
    ctx.stdout(formatDoctor(report));
  }
  return report.ok ? 0 : 1;
};
