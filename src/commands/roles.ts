import { formatRolesTable } from "../routing/format.ts";
import { resolveAll } from "../routing/resolve.ts";
import type { CommandRun } from "../types.ts";
import { parseArgs } from "../util/args.ts";
import { formatJson } from "../util/output.ts";
import { loadEffectiveConfigReporting, readCapabilities } from "./shared.ts";

export const summary = "Resolve every role to a provider, model, and options.";

export const usage = `Usage: omt roles [--capabilities <file>] [--role <name>]... [--plan <slug>] [--profile <name>] [--json]

Load the config, resolve each role chain, and print a table.

Options:
  --capabilities <file>  orchestrator_capabilities output (- for stdin)
  --role <name>          resolve only this role; repeatable
  --plan <slug>          use the plan's selected profile
  --profile <name>       override the selected profile
  --json                 print the roles report as JSON
  -h, --help             print this help
`;

export const run: CommandRun = async (ctx) => {
  const { values } = parseArgs(ctx.argv, {
    capabilities: { type: "string" },
    role: { type: "string", multiple: true },
    plan: { type: "string" },
    profile: { type: "string" },
    json: { type: "boolean" },
  }, { maxPositionals: 0 });
  const { config } = await loadEffectiveConfigReporting(ctx, { plan: values.plan, profile: values.profile, allowMissingPlan: true });
  const caps = await readCapabilities(ctx, values.capabilities);
  const report = resolveAll(config, caps, values.role);
  ctx.stdout(values.json ? formatJson(report) : formatRolesTable(report));
  return 0;
};
