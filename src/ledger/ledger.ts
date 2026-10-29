import { dirname } from "node:path";
import type { LedgerEntry, LedgerStats, LedgerStatus, Limits } from "../types.ts";
import { openStateFile, readFileIfExists } from "../util/fs.ts";

export const LEDGER_STATUSES: readonly LedgerStatus[] = [
  "dispatched",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "verified",
  "rejected",
];

const TERMINAL: ReadonlySet<LedgerStatus> = new Set<LedgerStatus>([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "verified",
  "rejected",
]);

export function isTerminal(status: LedgerStatus): boolean {
  return TERMINAL.has(status);
}

// A terminal entry closes a dispatched one by task id, or, when it has no task id, by plan, unit, role, round, and attempt.
// Without a task id or a unit on both entries, nothing identifies the dispatch, so the entry closes nothing.
export function closes(terminal: LedgerEntry, dispatched: LedgerEntry): boolean {
  if (!TERMINAL.has(terminal.status) || dispatched.status !== "dispatched") return false;
  if (terminal.taskId !== undefined) return terminal.taskId === dispatched.taskId;
  if (terminal.unit === undefined || dispatched.unit === undefined) return false;
  return (
    terminal.plan === dispatched.plan &&
    terminal.unit === dispatched.unit &&
    terminal.role === dispatched.role &&
    (terminal.round ?? 1) === (dispatched.round ?? 1) &&
    (terminal.attempt ?? 1) === (dispatched.attempt ?? 1)
  );
}

export interface LedgerRead {
  entries: LedgerEntry[];
  warnings: string[];
}

export function isLedgerStatus(value: unknown): value is LedgerStatus {
  return typeof value === "string" && (LEDGER_STATUSES as readonly string[]).includes(value);
}

export async function appendLedger(path: string, entry: LedgerEntry): Promise<void> {
  const file = await openStateFile(dirname(dirname(path)), path);
  try {
    await file.appendFile(`${JSON.stringify(entry)}\n`);
  } finally {
    await file.close();
  }
}

function isEntry(value: unknown): value is LedgerEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.ts !== "string" || typeof record.role !== "string" || !isLedgerStatus(record.status)) return false;
  for (const key of ["plan", "unit", "taskId", "clientRequestId", "model", "verdict", "note"]) {
    if (record[key] !== undefined && typeof record[key] !== "string") return false;
  }
  for (const key of ["round", "attempt"]) {
    const number = record[key];
    if (number !== undefined && (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1)) return false;
  }
  return true;
}

export async function readLedger(path: string): Promise<LedgerRead> {
  const text = await readFileIfExists(path);
  const result: LedgerRead = { entries: [], warnings: [] };
  if (text === undefined) return result;
  text.split("\n").forEach((line, index) => {
    if (line.trim() === "") return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      value = undefined;
    }
    if (isEntry(value)) {
      result.entries.push(value);
    } else {
      result.warnings.push(`${path}:${index + 1}: skipped a malformed ledger line`);
    }
  });
  return result;
}

export function ledgerStats(
  entries: LedgerEntry[],
  limits: Pick<Limits, "maxParallel">,
  plan?: string,
): LedgerStats {
  const selected = plan === undefined ? entries : entries.filter((entry) => entry.plan === plan);
  const dispatchedEntries = selected.filter((entry) => entry.status === "dispatched");
  const terminalEntries = selected.filter((entry) => TERMINAL.has(entry.status));
  const dispatched = dispatchedEntries.length;
  const terminal = terminalEntries.length;
  const taskIds = new Set<string>();
  const identities = new Set<string>();
  const identity = (entry: LedgerEntry) => JSON.stringify([entry.plan, entry.unit, entry.role, entry.round ?? 1, entry.attempt ?? 1]);
  for (const entry of terminalEntries) {
    if (entry.taskId !== undefined) taskIds.add(entry.taskId);
    else if (entry.unit !== undefined) identities.add(identity(entry));
  }
  const active = dispatchedEntries.filter((entry) =>
    !(entry.taskId !== undefined && taskIds.has(entry.taskId)) &&
    !(entry.unit !== undefined && identities.has(identity(entry))),
  ).length;
  const stats: LedgerStats = {
    dispatched,
    active,
    terminal,
    limits: { maxParallel: limits.maxParallel },
    canDispatch: active < limits.maxParallel,
  };
  return plan === undefined ? stats : { plan, ...stats };
}

function sanitize(part: string, max: number): string {
  return part.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, max);
}

// Each part is capped so the round and attempt suffix always survives.
export function requestId(plan: string, unit: string, role: string, round = 1, attempt = 1): string {
  return ["omt", sanitize(plan, 64), sanitize(unit, 64), sanitize(role, 32), `r${round}`, `a${attempt}`].join(":");
}
