import { loadConfig } from "../config/load.ts";
import { PROVIDER_PATTERN } from "../config/validate.ts";
import { readLedger } from "../ledger/ledger.ts";
import { findProjectRoot, ledgerPath } from "../paths.ts";
import { parseCapabilities } from "../routing/capabilities.ts";
import { configuredDrivers, pickWorker } from "../routing/family.ts";
import { resolveRole, toRouteOutput } from "../routing/resolve.ts";
import type { ResolveOptions } from "../routing/resolve.ts";
import type { Capabilities, CliContext, CommandRun, OmtConfig, RoleConfig } from "../types.ts";
import { parseArgs } from "../util/args.ts";
import { OmtError, usageError } from "../util/errors.ts";
import { readFileIfExists } from "../util/fs.ts";
import { checkPlanSlug, checkUnitId } from "../util/ids.ts";
import { printJson } from "../util/output.ts";
import { formatIssue } from "./config.ts";

export const summary = "Print delegate_task arguments for one role.";

export const usage = `Usage: omt route <role> [--capabilities <file>] [--against <provider|driver|auto>] [--plan <slug>] [--unit <id>]

Resolve one role and print JSON that maps onto delegate_task arguments.
Exits 1 when the role is unknown or unavailable.

Options:
  --capabilities <file>  orchestrator_capabilities output (- for stdin)
  --against <value>      the provider or driver of the worker whose change the task reviews;
                         auto reads the worker from .omt/ledger.jsonl and needs --plan
  --plan <slug>          plan for --against auto
  --unit <id>            unit for --against auto
  -h, --help             print this help
`;

const AGAINST_RE = new RegExp(PROVIDER_PATTERN);

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

export interface AgainstFlags {
  against?: string | undefined;
  plan?: string | undefined;
  unit?: string | undefined;
}

// Usage checks for --against; run them before any work.
export function checkAgainst(flags: AgainstFlags): void {
  if (flags.plan !== undefined) checkPlanSlug(flags.plan, "--plan");
  if (flags.unit !== undefined) checkUnitId(flags.unit);
  if (flags.against === undefined) return;
  if (!AGAINST_RE.test(flags.against)) {
    throw usageError(`invalid --against "${flags.against}"`, "name a provider instance id, a driver kind, or auto");
  }
  if (flags.against === "auto" && flags.plan === undefined) {
    throw usageError("--against auto needs --plan <slug>", "the worker comes from the plan's ledger entries");
  }
}

export function findRole(config: OmtConfig, name: string): RoleConfig {
  const role = Object.hasOwn(config.roles, name) ? config.roles[name] : undefined;
  if (role === undefined) {
    throw new OmtError("unknown_role", `unknown role ${name}; known roles: ${Object.keys(config.roles).join(", ")}`);
  }
  return role;
}

// Turns --against into resolve options. Only auto on a cross-family role reads the ledger.
export async function againstOptions(
  ctx: CliContext,
  config: OmtConfig,
  role: RoleConfig,
  flags: AgainstFlags,
): Promise<ResolveOptions> {
  const { against, plan, unit } = flags;
  if (against === undefined) return {};
  const drivers = configuredDrivers(config.roles);
  if (against !== "auto" || role.crossFamily !== true || plan === undefined) return { against, drivers };
  const { entries, warnings } = await readLedger(ledgerPath(findProjectRoot(ctx.cwd)));
  for (const warning of warnings) ctx.stderr(`warning: ${warning}\n`);
  const pick = pickWorker(entries, config.roles, plan, unit, (warning) => ctx.stderr(`warning: ${warning}\n`));
  if (pick === undefined) {
    return { notes: [`--against auto: no worker dispatch with a provider in plan ${plan}; the configured order applies`] };
  }
  const from =
    pick.from === "unit" ? `the last work dispatch of unit ${unit ?? ""}` : `the provider of most units in plan ${plan}`;
  return { against: pick.provider, drivers, notes: [`--against auto: worker ${pick.provider} from ${from}`] };
}

export const run: CommandRun = async (ctx) => {
  const { values, positionals } = parseArgs(ctx.argv, {
    capabilities: { type: "string" },
    against: { type: "string" },
    plan: { type: "string" },
    unit: { type: "string" },
  });
  const [name, extra] = positionals;
  if (name === undefined) throw usageError("route needs a <role>");
  if (extra !== undefined) throw usageError(`unexpected argument "${extra}"`);
  checkAgainst(values);
  const { config, issues } = await loadConfig({ cwd: ctx.cwd, env: ctx.env, homedir: ctx.homedir });
  for (const issue of issues) ctx.stderr(formatIssue(issue));
  const role = findRole(config, name);
  const caps = await readCapabilities(ctx, values.capabilities);
  const resolution = resolveRole(name, role, caps, await againstOptions(ctx, config, role, values));
  const output = toRouteOutput(resolution);
  printJson(ctx.stdout, output);
  return output.status === "unavailable" ? 1 : 0;
};
