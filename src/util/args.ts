import { parseArgs as nodeParseArgs } from "node:util";
import type { ParseArgsConfig } from "node:util";
import { OmtError } from "./errors.ts";

export type ArgOptions = NonNullable<ParseArgsConfig["options"]>;

export function parseArgs<T extends ArgOptions>(args: string[], options: T) {
  try {
    return nodeParseArgs({ args, options, strict: true, allowPositionals: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new OmtError("usage", message, { exitCode: 2, hint: "run with --help to see the usage", cause: error });
  }
}
