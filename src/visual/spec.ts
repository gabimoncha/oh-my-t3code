import { OmtError } from "../util/errors.ts";
import { isRecord } from "../util/json.ts";

const TONES = ["info", "ok", "warn", "bad", "muted"] as const;
const NODE_KINDS = ["step", "task", "decision", "start", "end", "stop"] as const;
const NODE_TONES = ["done", "open", "blocked"] as const;
const ITEM_STATES = ["done", "open", "blocked"] as const;
const BLOCK_TYPES = ["text", "cards", "table", "checklist", "callout", "code", "flow"] as const;

export type Tone = (typeof TONES)[number];
export type NodeKind = (typeof NODE_KINDS)[number];
export type NodeTone = (typeof NODE_TONES)[number];
export type ItemState = (typeof ITEM_STATES)[number];

export interface TextBlock {
  type: "text";
  text: string;
}

export interface Card {
  title: string;
  value?: string;
  text?: string;
  tone?: Tone;
}

export interface CardsBlock {
  type: "cards";
  cards: Card[];
}

export interface TableBlock {
  type: "table";
  title?: string;
  columns: string[];
  rows: string[][];
  nowrap?: number[];
}

export interface ChecklistItem {
  text: string;
  state?: ItemState;
}

export interface ChecklistBlock {
  type: "checklist";
  title?: string;
  items: ChecklistItem[];
}

export interface CalloutBlock {
  type: "callout";
  tone?: Tone;
  title?: string;
  text: string;
}

export interface CodeBlock {
  type: "code";
  text: string;
}

export interface FlowNode {
  id: string;
  label: string;
  sub?: string;
  kind?: NodeKind;
  tone?: NodeTone;
  badge?: string;
  row?: number;
  col?: number;
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
}

export interface FlowBlock {
  type: "flow";
  title: string;
  description?: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export type Block = TextBlock | CardsBlock | TableBlock | ChecklistBlock | CalloutBlock | CodeBlock | FlowBlock;

export interface TabSpec {
  title: string;
  blocks: Block[];
}

export interface PageSpec {
  title?: string;
  subtitle?: string;
  tabs: TabSpec[];
}

const NODE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
type Obj = Record<string, unknown>;

class Checker {
  readonly problems: string[] = [];
  readonly warnings: string[] = [];

  problem(path: string, message: string): void {
    this.problems.push(`${path}: ${message}`);
  }

  object(value: unknown, path: string, keys: readonly string[]): Obj | undefined {
    if (!isRecord(value)) {
      this.problem(path, "must be an object");
      return undefined;
    }
    const obj = value as Obj;
    for (const key of Object.keys(obj)) {
      if (!keys.includes(key)) this.problem(`${path}.${key}`, "unknown key");
    }
    return obj;
  }

  string(obj: Obj, key: string, path: string, min: number, max: number, required = false): string | undefined {
    const value = obj[key];
    const at = `${path}.${key}`;
    if (value === undefined) {
      if (required) this.problem(at, "is required");
      return undefined;
    }
    if (typeof value !== "string") {
      this.problem(at, "must be a string");
      return undefined;
    }
    if (value.length < min || value.length > max) {
      this.problem(at, `must be ${min} to ${max} characters, got ${value.length}`);
      return undefined;
    }
    return value;
  }

  integer(obj: Obj, key: string, path: string, min: number, max: number): number | undefined {
    const value = obj[key];
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
      this.problem(`${path}.${key}`, `must be an integer from ${min} to ${max}`);
      return undefined;
    }
    return value;
  }

  boolean(obj: Obj, key: string, path: string): boolean | undefined {
    const value = obj[key];
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") {
      this.problem(`${path}.${key}`, "must be true or false");
      return undefined;
    }
    return value;
  }

  oneOf<T extends string>(obj: Obj, key: string, path: string, allowed: readonly T[], what: string): T | undefined {
    const value = obj[key];
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
      this.problem(`${path}.${key}`, `unknown ${what} ${JSON.stringify(value)}; use ${allowed.join(", ")}`);
      return undefined;
    }
    return value as T;
  }

  array(obj: Obj, key: string, path: string, min: number, max: number, required = false): unknown[] | undefined {
    const value = obj[key];
    const at = `${path}.${key}`;
    if (value === undefined) {
      if (required) this.problem(at, "is required");
      return undefined;
    }
    if (!Array.isArray(value)) {
      this.problem(at, "must be an array");
      return undefined;
    }
    if (value.length < min || value.length > max) {
      this.problem(at, `must have ${min} to ${max} items, got ${value.length}`);
      return undefined;
    }
    return value;
  }
}

function assign<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}

function textLike(type: "text" | "code"): (c: Checker, obj: Obj, path: string) => TextBlock | CodeBlock {
  return (c, obj, path) => ({ type, text: c.string(obj, "text", path, 1, 8000, true) ?? "" });
}

function checkCards(c: Checker, obj: Obj, path: string): CardsBlock {
  const cards: Card[] = [];
  (c.array(obj, "cards", path, 1, 6, true) ?? []).forEach((value, index) => {
    const at = `${path}.cards[${index}]`;
    const card = c.object(value, at, ["title", "value", "text", "tone"]);
    if (card === undefined) return;
    const out: Card = { title: c.string(card, "title", at, 1, 60, true) ?? "" };
    assign(out, "value", c.string(card, "value", at, 0, 24));
    assign(out, "text", c.string(card, "text", at, 0, 300));
    assign(out, "tone", c.oneOf(card, "tone", at, TONES, "tone"));
    cards.push(out);
  });
  return { type: "cards", cards };
}

function checkTable(c: Checker, obj: Obj, path: string): TableBlock {
  const columns: string[] = [];
  (c.array(obj, "columns", path, 1, 8, true) ?? []).forEach((value, index) => {
    if (typeof value === "string" && value.length <= 120) columns.push(value);
    else c.problem(`${path}.columns[${index}]`, "must be a string of 0 to 120 characters");
  });
  const rows: string[][] = [];
  (c.array(obj, "rows", path, 0, 80, true) ?? []).forEach((value, index) => {
    const at = `${path}.rows[${index}]`;
    if (!Array.isArray(value)) {
      c.problem(at, "must be an array of strings");
      return;
    }
    const cells: string[] = [];
    value.forEach((cell, cellIndex) => {
      if (typeof cell === "string" && cell.length <= 2000) cells.push(cell);
      else c.problem(`${at}[${cellIndex}]`, "must be a string of 0 to 2000 characters");
    });
    if (columns.length > 0 && cells.length !== columns.length) {
      const fix = cells.length < columns.length ? "padded" : "cut";
      c.warnings.push(`${at}: has ${cells.length} cells, the table has ${columns.length} columns; ${fix}`);
    }
    rows.push(cells);
  });
  const out: TableBlock = { type: "table", columns, rows };
  assign(out, "title", c.string(obj, "title", path, 0, 120));
  const nowrap = c.array(obj, "nowrap", path, 0, 8);
  if (nowrap !== undefined) {
    out.nowrap = [];
    nowrap.forEach((value, index) => {
      if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < Math.max(columns.length, 1)) out.nowrap?.push(value);
      else c.problem(`${path}.nowrap[${index}]`, `must be a column index from 0 to ${Math.max(columns.length, 1) - 1}`);
    });
  }
  return out;
}

function checkChecklist(c: Checker, obj: Obj, path: string): ChecklistBlock {
  const items: ChecklistItem[] = [];
  (c.array(obj, "items", path, 1, 80, true) ?? []).forEach((value, index) => {
    const at = `${path}.items[${index}]`;
    const item = c.object(value, at, ["text", "state"]);
    if (item === undefined) return;
    const out: ChecklistItem = { text: c.string(item, "text", at, 1, 2000, true) ?? "" };
    assign(out, "state", c.oneOf(item, "state", at, ITEM_STATES, "state"));
    items.push(out);
  });
  const out: ChecklistBlock = { type: "checklist", items };
  assign(out, "title", c.string(obj, "title", path, 0, 120));
  return out;
}

function checkCallout(c: Checker, obj: Obj, path: string): CalloutBlock {
  const out: CalloutBlock = { type: "callout", text: c.string(obj, "text", path, 1, 2000, true) ?? "" };
  assign(out, "tone", c.oneOf(obj, "tone", path, TONES, "tone"));
  assign(out, "title", c.string(obj, "title", path, 0, 120));
  return out;
}

function checkFlow(c: Checker, obj: Obj, path: string): FlowBlock {
  const nodes: FlowNode[] = [];
  const ids = new Set<string>();
  (c.array(obj, "nodes", path, 1, 60, true) ?? []).forEach((value, index) => {
    const at = `${path}.nodes[${index}]`;
    const node = c.object(value, at, ["id", "label", "sub", "kind", "tone", "badge", "row", "col"]);
    if (node === undefined) return;
    const id = node.id;
    if (id === undefined) c.problem(`${at}.id`, "is required");
    else if (typeof id !== "string" || !NODE_ID_RE.test(id)) c.problem(`${at}.id`, "must match ^[A-Za-z0-9_-]{1,40}$");
    else if (ids.has(id)) c.problem(`${at}.id`, `duplicate node id "${id}"`);
    else ids.add(id);
    const out: FlowNode = { id: typeof id === "string" ? id : "", label: c.string(node, "label", at, 1, 120, true) ?? "" };
    assign(out, "sub", c.string(node, "sub", at, 0, 160));
    assign(out, "kind", c.oneOf(node, "kind", at, NODE_KINDS, "kind"));
    assign(out, "tone", c.oneOf(node, "tone", at, NODE_TONES, "tone"));
    assign(out, "badge", c.string(node, "badge", at, 0, 16));
    assign(out, "row", c.integer(node, "row", at, 0, 60));
    assign(out, "col", c.integer(node, "col", at, 0, 7));
    nodes.push(out);
  });
  const edges: FlowEdge[] = [];
  (c.array(obj, "edges", path, 0, 120, true) ?? []).forEach((value, index) => {
    const at = `${path}.edges[${index}]`;
    const edge = c.object(value, at, ["from", "to", "label", "dashed"]);
    if (edge === undefined) return;
    const ends: string[] = [];
    for (const key of ["from", "to"]) {
      const end = edge[key];
      if (end === undefined) c.problem(`${at}.${key}`, "is required");
      else if (typeof end !== "string") c.problem(`${at}.${key}`, "must be a string");
      else if (!ids.has(end)) c.problem(`${at}.${key}`, `unknown node "${end}"`);
      ends.push(typeof end === "string" ? end : "");
    }
    const out: FlowEdge = { from: ends[0] ?? "", to: ends[1] ?? "" };
    assign(out, "label", c.string(edge, "label", at, 0, 24));
    assign(out, "dashed", c.boolean(edge, "dashed", at));
    edges.push(out);
  });
  const out: FlowBlock = { type: "flow", title: c.string(obj, "title", path, 1, 120, true) ?? "", nodes, edges };
  assign(out, "description", c.string(obj, "description", path, 0, 600));
  return out;
}

const BLOCKS: Record<Block["type"], { keys: readonly string[]; check: (c: Checker, obj: Obj, path: string) => Block }> = {
  text: { keys: ["text"], check: textLike("text") },
  cards: { keys: ["cards"], check: checkCards },
  table: { keys: ["title", "columns", "rows", "nowrap"], check: checkTable },
  checklist: { keys: ["title", "items"], check: checkChecklist },
  callout: { keys: ["tone", "title", "text"], check: checkCallout },
  code: { keys: ["text"], check: textLike("code") },
  flow: { keys: ["title", "description", "nodes", "edges"], check: checkFlow },
};

function checkBlock(c: Checker, value: unknown, path: string): Block | undefined {
  if (!isRecord(value)) {
    c.problem(path, "must be an object");
    return undefined;
  }
  const type = (value as Obj).type;
  if (type === undefined) {
    c.problem(`${path}.type`, "is required");
    return undefined;
  }
  if (typeof type !== "string" || !(BLOCK_TYPES as readonly string[]).includes(type)) {
    c.problem(`${path}.type`, `unknown type ${JSON.stringify(type)}; use ${BLOCK_TYPES.join(", ")}`);
    return undefined;
  }
  const kind = type as Block["type"];
  const obj = c.object(value, path, ["type", ...BLOCKS[kind].keys]) as Obj;
  return BLOCKS[kind].check(c, obj, path);
}

export function validateSpec(value: unknown): { spec: PageSpec; warnings: string[] } {
  const c = new Checker();
  const spec: PageSpec = { tabs: [] };
  const root = c.object(value, "$", ["title", "subtitle", "tabs"]);
  if (root !== undefined) {
    assign(spec, "title", c.string(root, "title", "$", 1, 200));
    assign(spec, "subtitle", c.string(root, "subtitle", "$", 0, 300));
    (c.array(root, "tabs", "$", 0, 8) ?? []).forEach((tabValue, index) => {
      const at = `$.tabs[${index}]`;
      const tab = c.object(tabValue, at, ["title", "blocks"]);
      if (tab === undefined) return;
      const blocks: Block[] = [];
      (c.array(tab, "blocks", at, 1, 40, true) ?? []).forEach((blockValue, blockIndex) => {
        const block = checkBlock(c, blockValue, `${at}.blocks[${blockIndex}]`);
        if (block !== undefined) blocks.push(block);
      });
      spec.tabs.push({ title: c.string(tab, "title", at, 1, 40, true) ?? "", blocks });
    });
  }
  if (c.problems.length > 0) {
    throw new OmtError("invalid_spec", `invalid page spec:\n${c.problems.map((problem) => `  ${problem}`).join("\n")}`, {
      exitCode: 2,
      hint: "fix every listed field; the paths are JSON paths into the spec",
    });
  }
  return { spec, warnings: c.warnings };
}
