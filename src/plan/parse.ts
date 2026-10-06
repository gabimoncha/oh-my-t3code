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
  items: PlanItem[];
  counts: Record<PlanItemKind, PlanCounts>;
  next?: PlanItem;
  complete: boolean;
}

const ITEM_RE = /^- \[( |x|X|~)\] (U|D|F)(\d+)\. (.*)$/;
const HEADER_RE = /<!--\s*omt-plan v1\b[^>]*?\bslug=([^\s>]+)/;

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
  const slug = HEADER_RE.exec(markdown)?.[1];
  const next = items.find((item) => item.kind === "U" && item.state === "open");
  const status: PlanStatus = {
    title,
    items,
    counts,
    complete: items.length > 0 && items.every((item) => item.state === "done"),
  };
  if (slug !== undefined) status.slug = slug;
  if (next !== undefined) status.next = next;
  return status;
}
