import { parseArgs as nodeParseArgs } from "node:util";
import type { ParseArgsConfig } from "node:util";
import { errorMessage, OmtError, usageError } from "./errors.ts";

export type ArgOptions = NonNullable<ParseArgsConfig["options"]>;

export function checkPositionals(positionals: string[], max: number): void {
  if (positionals.length > max) throw usageError(`unexpected argument "${positionals[max]}"`);
}

export function positiveInt(flag: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value)) throw usageError(`--${flag} must be a positive integer, got "${value}"`);
  return Number(value);
}

export function parseArgs<T extends ArgOptions>(args: string[], options: T, opts: { maxPositionals?: number } = {}) {
  let parsed;
  try {
    parsed = nodeParseArgs({ args, options, strict: true, allowPositionals: true });
  } catch (error) {
    throw new OmtError("usage", errorMessage(error), { exitCode: 2, hint: "run with --help to see the usage", cause: error });
  }
  if (opts.maxPositionals !== undefined) checkPositionals(parsed.positionals, opts.maxPositionals);
  return parsed;
}
