import { parseLimit } from "../config/validate.ts";

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
  profile?: string;
  maxParallel?: number;
  maxTasks?: number;
  items: PlanItem[];
  counts: Record<PlanItemKind, PlanCounts>;
  next?: PlanItem;
  complete: boolean;
}

const ITEM_RE = /^- \[( |x|X|~)\] (U|D|F)(\d+)\. (.*)$/;
const HEADER_LINE_RE = /^[ \t]*(<!--[ \t]*omt-plan v1\b[^>\n]*-->)[ \t]*\r?$/m;

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

function headerValue(header: string, key: string): string | undefined {
  return new RegExp(`\\b${key}=([^\\s>]+)`).exec(header)?.[1];
}

const ITEM_LINE_RE = /^- \[( |x|X|~)\] (U|D|F)(\d+)\. /;
const FIELD_RE = /^\s+- ([A-Za-z][A-Za-z ]*?):\s*(.*)$/;

const FENCE_RE = /^\s*(`{3,}|~{3,})(.*)$/;

// For each line, true when it is a fence line or inside a fence. A fence closes only on a line of
// the opening character, at least as long, with nothing after it (CommonMark); an unclosed fence
// runs to the end.
function fencedLines(lines: string[]): boolean[] {
  const out: boolean[] = [];
  let open: { char: string; length: number } | undefined;
  for (const line of lines) {
    const fence = FENCE_RE.exec(line);
    const marker = fence?.[1] ?? "";
    const info = fence?.[2] ?? "";
    if (open === undefined) {
      if (fence !== null && !(marker.startsWith("`") && info.includes("`"))) open = { char: marker.charAt(0), length: marker.length };
      out.push(open !== undefined);
      continue;
    }
    out.push(true);
    if (fence !== null && marker.charAt(0) === open.char && marker.length >= open.length && info.trim() === "") open = undefined;
  }
  return out;
}

function planLines(markdown: string): string[] {
  return markdown.replace(/^\uFEFF/, "").split(/\r?\n/);
}

// The plan with every fenced line blank, so examples inside fences are never items, fields, or headings.
export function blankFences(markdown: string): string {
  const lines = planLines(markdown);
  const fenced = fencedLines(lines);
  return lines.map((line, i) => (fenced[i] === true ? "" : line)).join("\n");
}

// The text of each "## " section, keyed by heading. Lines inside code fences are never headings.
export function planSectionsText(markdown: string): Map<string, string> {
  const sections = new Map<string, string[]>();
  let current: string[] | undefined;
  const lines = planLines(markdown);
  const fenced = fencedLines(lines);
  lines.forEach((line, i) => {
    if (fenced[i] !== true && line.startsWith("## ")) {
      const name = line.slice(3).trim();
      current = [];
      if (!sections.has(name)) sections.set(name, current);
      return;
    }
    if (fenced[i] !== true && line.startsWith("# ")) {
      current = undefined;
      return;
    }
    current?.push(line);
  });
  const out = new Map<string, string>();
  for (const [name, lines] of sections) out.set(name, lines.join("\n").trim());
  return out;
}

// The "  - <Field>: <value>" lines under each U item, up to the next item or heading. Takes the
// plan after blankFences.
export function unitFields(markdown: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;
  for (const line of markdown.split("\n")) {
    const item = ITEM_LINE_RE.exec(line);
    if (item !== null) {
      current = new Map();
      if (item[2] === "U") out.set(`U${item[3]}`, current);
      continue;
    }
    if (line.startsWith("#") || line.startsWith("- ")) {
      current = undefined;
      continue;
    }
    const field = FIELD_RE.exec(line);
    if (current !== undefined && field !== null) {
      const key = (field[1] ?? "").toLowerCase();
      if (!current.has(key)) current.set(key, (field[2] ?? "").trim());
    }
  }
  return out;
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
  const lines = planLines(markdown);
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
  const slug = headerValue(header, "slug");
  const profile = headerValue(header, "profile");
  const maxParallelText = headerValue(header, "max-parallel");
  const maxParallel = maxParallelText === undefined ? undefined : parseLimit(maxParallelText, "maxParallel");
  const maxTasksText = headerValue(header, "max-tasks");
  const maxTasks = maxTasksText === undefined ? undefined : parseLimit(maxTasksText, "maxTasksPerRun");
  const next = items.find((item) => item.kind === "U" && item.state === "open");
  const status: PlanStatus = {
    title,
    items,
    counts,
    complete: items.length > 0 && items.every((item) => item.state === "done"),
  };
  if (slug !== undefined) status.slug = slug;
  if (profile !== undefined) status.profile = profile;
  if (maxParallel !== undefined) status.maxParallel = maxParallel;
  if (maxTasks !== undefined) status.maxTasks = maxTasks;
  if (next !== undefined) status.next = next;
  return status;
}
