import { loadConfig } from "../config/load.ts";
import { formatRolesTable } from "../routing/format.ts";
import { resolveAll } from "../routing/resolve.ts";
import type { CommandRun } from "../types.ts";
import { parseArgs } from "../util/args.ts";
import { usageError } from "../util/errors.ts";
import { printJson } from "../util/output.ts";
import { formatIssue } from "./config.ts";
import { readCapabilities } from "./route.ts";

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
  const { values, positionals } = parseArgs(ctx.argv, {
    capabilities: { type: "string" },
    role: { type: "string", multiple: true },
    json: { type: "boolean" },
  });
  if (positionals.length > 0) throw usageError(`unexpected argument "${positionals[0]}"`);
  const { config, issues } = await loadConfig({ cwd: ctx.cwd, env: ctx.env, homedir: ctx.homedir });
  for (const issue of issues) ctx.stderr(formatIssue(issue));
  const caps = await readCapabilities(ctx, values.capabilities);
  const report = resolveAll(config, caps, values.role);
  if (values.json === true) {
    printJson(ctx.stdout, report);
  } else {
    ctx.stdout(formatRolesTable(report));
  }
  return 0;
};
