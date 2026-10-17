import { listLocks, runLocked } from "../lock/lock.ts";
import type { CommandRun } from "../types.ts";
import { parseArgs } from "../util/args.ts";
import { usageError } from "../util/errors.ts";

export const summary = "Run a command with a shared checkout lock, or list locks.";

export const usage = `Usage: omt lock run <name> [--wait <seconds>] -- <command> [args...]
       omt lock list

Subcommands:
  run <name>        hold a lock while the command runs and return its exit code
  list              print each lock file as held or free, with the holder if held

Options:
  --wait <seconds>  wait up to this many seconds for a busy lock (default 900)
  -h, --help        print this help
`;

export const run: CommandRun = async (ctx) => {
  if (ctx.argv[0] === "list") {
    parseArgs(ctx.argv.slice(1), {}, { maxPositionals: 0 });
    return listLocks(ctx);
  }
  if (ctx.argv[0] !== "run") {
    throw usageError(ctx.argv[0] === undefined ? "lock needs a subcommand: run or list" : `unknown lock subcommand "${ctx.argv[0]}"`);
  }
  const separator = ctx.argv.indexOf("--");
  if (separator === -1) throw usageError("lock run needs -- followed by a command");
  const { values, positionals } = parseArgs(ctx.argv.slice(1, separator), { wait: { type: "string" } }, { maxPositionals: 1 });
  const [name] = positionals;
  if (name === undefined || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name)) {
    throw usageError("lock name must match ^[a-z0-9][a-z0-9._-]{0,63}$");
  }
  const wait = values.wait ?? "900";
  if (!/^\d+$/.test(wait) || !Number.isSafeInteger(Number(wait))) throw usageError("--wait must be a non-negative integer");
  const command = ctx.argv.slice(separator + 1);
  if (command.length === 0 || command[0] === "") throw usageError("lock run needs -- followed by a command");
  return runLocked(ctx, name, Number(wait), command);
};
