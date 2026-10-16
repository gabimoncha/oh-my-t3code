export class OmtError extends Error {
  readonly code: string;
  readonly hint: string | undefined;
  readonly exitCode: number;

  constructor(code: string, message: string, options?: { hint?: string; exitCode?: number; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "OmtError";
    this.code = code;
    this.hint = options?.hint;
    this.exitCode = options?.exitCode ?? 1;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function usageError(message: string, hint?: string): OmtError {
  return new OmtError("usage", message, { exitCode: 2, ...(hint === undefined ? {} : { hint }) });
}
