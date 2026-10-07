import { LIMIT_RANGES } from "../config/validate.ts";

export type PlanItemKind = "U" | "D" | "F";
export type PlanItemState = "open" | "done" | "blocked";

export interface PlanItem {
  kind: PlanItemKind;
  id: string;
  title: string;
  state: PlanItemState;
  line: number;
}

export interface PlanCounts {
  open: number;
  done: number;
  blocked: number;
  total: number;
}

export interface PlanStatus {
  title: string;
  slug?: string;
  maxParallel?: number;
  maxTasks?: number;
  items: PlanItem[];
  counts: Record<PlanItemKind, PlanCounts>;
  next?: PlanItem;
  complete: boolean;
}

const ITEM_RE = /^- \[( |x|X|~)\] (U|D|F)(\d+)\. (.*)$/;
const HEADER_LINE_RE = /^[ \t]*(<!--[ \t]*omt-plan v1\b[^>\n]*-->)[ \t]*\r?$/m;
const SLUG_RE = /\bslug=([^\s>]+)/;
const MAX_PARALLEL_RE = /\bmax-parallel=([^\s>]+)/;
const MAX_TASKS_RE = /\bmax-tasks=([^\s>]+)/;

export interface PlanHeader {
  text: string;
  index: number;
}

// The header is the first line that is only an omt-plan comment, so an example header quoted later in the body does not count.
export function findPlanHeader(markdown: string): PlanHeader | undefined {
  const match = HEADER_LINE_RE.exec(markdown);
  const text = match?.[1];
  if (match === null || text === undefined) return undefined;
  return { text, index: match.index + match[0].indexOf(text) };
}

export function parseMaxParallel(value: string): number | undefined {
  if (!/^[1-9]\d*$/.test(value)) return undefined;
  const [min, max] = LIMIT_RANGES.maxParallel;
  const number = Number(value);
  return number >= min && number <= max ? number : undefined;
}

export function parseMaxTasks(value: string): number | undefined {
  if (!/^[1-9]\d*$/.test(value)) return undefined;
  const [min, max] = LIMIT_RANGES.maxTasksPerRun;
  const number = Number(value);
  return number >= min && number <= max ? number : undefined;
}

function stateOf(mark: string): PlanItemState {
  if (mark === " ") return "open";
  if (mark === "~") return "blocked";
  return "done";
}

function emptyCounts(): PlanCounts {
  return { open: 0, done: 0, blocked: 0, total: 0 };
}

export function parsePlan(markdown: string): PlanStatus {
  const lines = markdown.replace(/^﻿/, "").split(/\r?\n/);
  let title = "";
  const items: PlanItem[] = [];
  const counts: Record<PlanItemKind, PlanCounts> = { U: emptyCounts(), D: emptyCounts(), F: emptyCounts() };
  lines.forEach((text, index) => {
    if (title === "" && text.startsWith("# ")) title = text.slice(2).trim();
    const match = ITEM_RE.exec(text);
    if (match === null) return;
    const [, mark = " ", kind = "U", number = "", rest = ""] = match;
    const item: PlanItem = {
      kind: kind as PlanItemKind,
      id: `${kind}${number}`,
      title: rest.trim(),
      state: stateOf(mark),
      line: index + 1,
    };
    items.push(item);
    const bucket = counts[item.kind];
    bucket[item.state] += 1;
    bucket.total += 1;
  });
  const header = findPlanHeader(markdown)?.text ?? "";
  const slug = SLUG_RE.exec(header)?.[1];
  const maxParallelText = MAX_PARALLEL_RE.exec(header)?.[1];
  const maxParallel = maxParallelText === undefined ? undefined : parseMaxParallel(maxParallelText);
  const maxTasksText = MAX_TASKS_RE.exec(header)?.[1];
  const maxTasks = maxTasksText === undefined ? undefined : parseMaxTasks(maxTasksText);
  const next = items.find((item) => item.kind === "U" && item.state === "open");
  const status: PlanStatus = {
    title,
    items,
    counts,
    complete: items.length > 0 && items.every((item) => item.state === "done"),
  };
  if (slug !== undefined) status.slug = slug;
  if (maxParallel !== undefined) status.maxParallel = maxParallel;
  if (maxTasks !== undefined) status.maxTasks = maxTasks;
  if (next !== undefined) status.next = next;
  return status;
}
