import { formatRolesTable } from "../routing/format.ts";
import { resolveAll } from "../routing/resolve.ts";
import type { CommandRun } from "../types.ts";
import { parseArgs } from "../util/args.ts";
import { formatJson } from "../util/output.ts";
import { loadConfigReporting, readCapabilities } from "./shared.ts";

export const summary = "Resolve every role to a provider, model, and options.";

export const usage = `Usage: omt roles [--capabilities <file>] [--role <name>]... [--json]

Load the config, resolve each role chain, and print a table.

Options:
  --capabilities <file>  orchestrator_capabilities output (- for stdin)
  --role <name>          resolve only this role; repeatable
  --json                 print the roles report as JSON
  -h, --help             print this help
`;

export const run: CommandRun = async (ctx) => {
  const { values } = parseArgs(ctx.argv, {
    capabilities: { type: "string" },
    role: { type: "string", multiple: true },
    json: { type: "boolean" },
  }, { maxPositionals: 0 });
  const { config } = await loadConfigReporting(ctx);
  const caps = await readCapabilities(ctx, values.capabilities);
  const report = resolveAll(config, caps, values.role);
  ctx.stdout(values.json ? formatJson(report) : formatRolesTable(report));
  return 0;
};
