import { loadConfig } from "../config/load.ts";
import { parseCapabilities } from "../routing/capabilities.ts";
import { resolveAll, toRouteOutput } from "../routing/resolve.ts";
import type { Capabilities, CliContext, CommandRun } from "../types.ts";
import { parseArgs } from "../util/args.ts";
import { OmtError, usageError } from "../util/errors.ts";
import { readFileIfExists } from "../util/fs.ts";
import { printJson } from "../util/output.ts";
import { formatIssue } from "./config.ts";

export const summary = "Print delegate_task arguments for one role.";

export const usage = `Usage: omt route <role> [--capabilities <file>]

Resolve one role and print JSON that maps onto delegate_task arguments.
Exits 1 when the role is unknown or unavailable.

Options:
  --capabilities <file>  orchestrator_capabilities output (- for stdin)
  -h, --help             print this help
`;

// Reads a text input flag: "-" means stdin.
export async function readInput(ctx: CliContext, flag: string, file: string): Promise<string> {
  if (file === "-") return ctx.readStdin();
  const text = await readFileIfExists(file);
  if (text === undefined) throw new OmtError("file_not_found", `--${flag}: file not found: ${file}`);
  return text;
}

export async function readCapabilities(ctx: CliContext, file: string | undefined): Promise<Capabilities | undefined> {
  if (file === undefined) return undefined;
  return parseCapabilities(await readInput(ctx, "capabilities", file));
}

export const run: CommandRun = async (ctx) => {
  const { values, positionals } = parseArgs(ctx.argv, {
    capabilities: { type: "string" },
  });
  const [name, extra] = positionals;
  if (name === undefined) throw usageError("route needs a <role>");
  if (extra !== undefined) throw usageError(`unexpected argument "${extra}"`);
  const { config, issues } = await loadConfig({ cwd: ctx.cwd, env: ctx.env, homedir: ctx.homedir });
  for (const issue of issues) ctx.stderr(formatIssue(issue));
  const caps = await readCapabilities(ctx, values.capabilities);
  const resolution = resolveAll(config, caps, [name]).roles[name];
  if (resolution === undefined) throw new OmtError("unknown_role", `unknown role ${name}`);
  const output = toRouteOutput(resolution);
  printJson(ctx.stdout, output);
  return output.status === "unavailable" ? 1 : 0;
};
