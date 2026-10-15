import { parsePlan } from "../plan/parse.ts";
import type { PlanItem } from "../plan/parse.ts";
import { assignRows, labelCharsPerLine, wrapWords } from "./flow.ts";
import { plainText } from "./inline.ts";
import type { Block, FlowBlock, FlowEdge, FlowNode, PageSpec, TabSpec } from "./spec.ts";

export interface PlanPage {
  title: string;
  subtitle: string;
  tabs: TabSpec[];
  warnings: string[];
}

const ITEM_LINE_RE = /^- \[( |x|X|~)\] (U|D|F)(\d+)\. /;
const FIELD_RE = /^\s+- ([A-Za-z][A-Za-z ]*?):\s*(.*)$/;

const FENCE_RE = /^\s*(`{3,}|~{3,})(.*)$/;

// For each line, true when it is a fence line or inside a fence. A fence closes only on a line of
// the opening character, at least as long, with nothing after it (CommonMark); an unclosed fence
// runs to the end.
export function fencedLines(lines: string[]): boolean[] {
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
function unitFields(markdown: string): Map<string, Map<string, string>> {
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

function findCycle(ids: string[], deps: Map<string, string[]>): string[] | undefined {
  const state = new Map<string, number>();
  const stack: string[] = [];
  const visit = (id: string): string[] | undefined => {
    state.set(id, 1);
    stack.push(id);
    for (const dep of deps.get(id) ?? []) {
      if (state.get(dep) === 1) return [...stack.slice(stack.indexOf(dep)), dep];
      if (state.get(dep) === undefined) {
        const found = visit(dep);
        if (found !== undefined) return found;
      }
    }
    stack.pop();
    state.set(id, 2);
    return undefined;
  };
  for (const id of ids) {
    if (state.get(id) !== undefined) continue;
    const found = visit(id);
    if (found !== undefined) return found;
  }
  return undefined;
}

// Edges dep -> unit, without the ones that a longer dependency path already implies.
export function reduceDependencies(ids: string[], deps: Map<string, string[]>): FlowEdge[] {
  const reach = new Map<string, Set<string>>();
  const ancestors = (id: string): Set<string> => {
    const known = reach.get(id);
    if (known !== undefined) return known;
    const seen = new Set<string>();
    reach.set(id, seen);
    const queue = [...(deps.get(id) ?? [])];
    while (queue.length > 0) {
      const next = queue.shift() as string;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(...(deps.get(next) ?? []));
    }
    return seen;
  };
  const edges: FlowEdge[] = [];
  for (const id of ids) {
    const direct = deps.get(id) ?? [];
    for (const dep of direct) {
      const implied = direct.some((other) => other !== dep && other !== id && ancestors(other).has(dep) && !ancestors(dep).has(other));
      if (!implied) edges.push({ from: dep, to: id });
    }
  }
  return edges;
}

const LABEL_LINES = 3;

function fitLabel(label: string, chars: number, lines: number): string {
  if (wrapWords(label, chars).length <= lines) return label;
  const words = label.split(" ").filter((word) => word !== "");
  while (words.length > 1 && wrapWords(`${words.join(" ")}…`, chars).length > lines) words.pop();
  return `${words.join(" ")}…`;
}

function itemText(item: PlanItem): string {
  return `${item.id}. ${item.title}`;
}

export function planSections(markdown: string, slug: string): PlanPage {
  const warnings: string[] = [];
  const unfenced = blankFences(markdown);
  const status = parsePlan(unfenced);
  const sections = planSectionsText(markdown);
  const fields = unitFields(unfenced);
  const units = status.items.filter((item) => item.kind === "U");
  const unitIds = new Set(units.map((unit) => unit.id));
  const ids = units.map((unit) => unit.id);

  const deps = new Map<string, string[]>();
  for (const unit of units) {
    const text = fields.get(unit.id)?.get("depends on") ?? "";
    const list: string[] = [];
    for (const match of text.matchAll(/\bU\d+\b/g)) {
      const token = match[0];
      if (!unitIds.has(token)) warnings.push(`${unit.id} depends on ${token}, which is not a unit of the plan`);
      else if (token !== unit.id && !list.includes(token)) list.push(token);
      else if (token === unit.id) warnings.push(`${unit.id} depends on itself`);
    }
    deps.set(unit.id, list);
  }
  const cycle = findCycle(ids, deps);
  if (cycle !== undefined) warnings.push(`the unit dependencies form a cycle: ${[...cycle].reverse().join(" -> ")}`);

  const nodes: FlowNode[] = units.map((unit) => {
    const node: FlowNode = { id: unit.id, label: `${unit.id} ${unit.title}`, kind: "task", tone: unit.state };
    const role = fields.get(unit.id)?.get("role");
    if (role !== undefined && role !== "") node.sub = role;
    return node;
  });
  const flow: FlowBlock = {
    type: "flow",
    title: "Units by dependency layer",
    description: "Each row is one dependency layer. Arrows show direct dependencies; implied ones are left out.",
    nodes,
    edges: reduceDependencies(ids, deps),
  };
  const rows = nodes.length === 0 ? [] : assignRows(flow).rows;
  const layers = rows.length === 0 ? 0 : Math.max(...rows) + 1;
  // The table holds the full titles, so a long title is shortened to fit the node instead of being cut with a warning.
  const widest = Math.max(1, ...Array.from({ length: layers }, (_, row) => rows.filter((r) => r === row).length));
  const chars = labelCharsPerLine(widest, "task");
  for (const node of nodes) node.label = fitLabel(plainText(node.label), chars, LABEL_LINES);

  const n = units.length;
  const done = status.counts.U.done;
  const doneWhen = status.items.filter((item) => item.kind === "D");
  const finals = status.items.filter((item) => item.kind === "F");
  let subtitle = `plan ${slug} · ${n} units in ${layers} layers · ${done}/${n} done`;
  if (status.maxTasks !== undefined) subtitle += ` · budget ${status.maxTasks} tasks`;

  let summary = sections.get("Summary") ?? "";
  if (summary === "") {
    warnings.push("plan has no ## Summary; showing ## Objective");
    summary = sections.get("Objective") ?? "";
  }
  const summaryBlocks: Block[] = [];
  if (summary !== "") summaryBlocks.push({ type: "text", text: summary });
  const cards = [
    { title: "Units", value: String(n), text: `${layers} dependency layers`, tone: "info" as const },
    { title: "Done", value: `${done}/${n}`, text: `${status.counts.U.blocked} blocked`, tone: "ok" as const },
    { title: "Checks", value: String(doneWhen.length + finals.length), text: `${doneWhen.length} done-when, ${finals.length} final`, tone: "muted" as const },
  ];
  if (status.maxTasks !== undefined) cards.push({ title: "Budget", value: String(status.maxTasks), text: "tasks", tone: "muted" as const });
  summaryBlocks.push({ type: "cards", cards });

  const unitBlocks: Block[] = [];
  if (n > 0) {
    unitBlocks.push(flow);
    unitBlocks.push({
      type: "table",
      columns: ["Unit", "Title", "Role", "Depends on", "State"],
      rows: units.map((unit) => {
        const unitField = fields.get(unit.id);
        return [unit.id, unit.title, unitField?.get("role") ?? "", unitField?.get("depends on") ?? "", unit.state];
      }),
      nowrap: [0],
    });
  } else {
    unitBlocks.push({ type: "text", text: "The plan has no units." });
  }

  const checkBlocks: Block[] = [];
  if (doneWhen.length > 0) checkBlocks.push({ type: "checklist", title: "Done when", items: doneWhen.map((item) => ({ text: itemText(item), state: item.state })) });
  if (finals.length > 0) checkBlocks.push({ type: "checklist", title: "Final verification", items: finals.map((item) => ({ text: itemText(item), state: item.state })) });
  if (checkBlocks.length === 0) checkBlocks.push({ type: "text", text: "The plan has no checks." });

  return {
    title: status.title === "" ? slug : status.title,
    subtitle,
    tabs: [
      { title: "Summary", blocks: summaryBlocks },
      { title: "Units", blocks: unitBlocks },
      { title: "Checks", blocks: checkBlocks },
    ],
    warnings,
  };
}

// The spec's title and subtitle win; a spec tab with the title of a built tab adds its blocks to that tab.
export function mergeSpec(base: { title: string; subtitle: string; tabs: TabSpec[] }, spec: PageSpec): PageSpec {
  const tabs = base.tabs.map((tab) => ({ title: tab.title, blocks: [...tab.blocks] }));
  for (const tab of spec.tabs) {
    const same = tabs.find((existing) => existing.title === tab.title);
    if (same !== undefined) same.blocks.push(...tab.blocks);
    else tabs.push({ title: tab.title, blocks: [...tab.blocks] });
  }
  return { title: spec.title ?? base.title, subtitle: spec.subtitle ?? base.subtitle, tabs };
}
