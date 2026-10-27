import { escapeHtml, plainText } from "./inline.ts";
import type { FlowBlock, NodeKind, NodeTone } from "./spec.ts";

export interface Point {
  x: number;
  y: number;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutNode extends Box {
  id: string;
  kind: NodeKind;
  tone?: NodeTone;
  badge?: string;
  row: number;
  col: number;
  cx: number;
  cy: number;
  lines: string[];
  subLines: string[];
}

export interface EdgeLabel {
  text: string;
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
}

export interface LayoutEdge {
  index: number;
  from: string;
  to: string;
  back: boolean;
  route: string;
  dashed: boolean;
  points: Point[];
  segments: Segment[];
  label?: EdgeLabel;
}

export interface FlowLayout {
  width: number;
  height: number;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  warnings: string[];
}

const BASE_WIDTH = 720;
const MARGIN = 28;
const WIDE_COLUMN = 150;
const NODE_INSET = 28;
const TOP_GAP = 12;
const BOTTOM_GAP = 14;
const MIN_GAP = 32;
const LANE_STEP = 8;
const SIDE_STEP = 16;
const SIDE_MARGIN = 14;
const GROW = 4;
const MAX_LINES = 4;

function columnWidthOf(widest: number): number {
  return widest <= 4 ? (BASE_WIDTH - 2 * MARGIN) / widest : WIDE_COLUMN;
}

interface IndexedEdge {
  index: number;
  s: number;
  t: number;
}

function indexEdges(block: FlowBlock): IndexedEdge[] {
  const ids = new Map(block.nodes.map((node, index) => [node.id, index]));
  const out: IndexedEdge[] = [];
  block.edges.forEach((edge, index) => {
    const s = ids.get(edge.from);
    const t = ids.get(edge.to);
    if (s !== undefined && t !== undefined) out.push({ index, s, t });
  });
  return out;
}

function findBackEdges(count: number, edges: IndexedEdge[]): Set<number> {
  const outgoing: IndexedEdge[][] = Array.from({ length: count }, () => []);
  for (const edge of edges) outgoing[edge.s]?.push(edge);
  const state = new Array<number>(count).fill(0);
  const back = new Set<number>();
  const visit = (node: number): void => {
    state[node] = 1;
    for (const edge of outgoing[node] ?? []) {
      if (state[edge.t] === 1) back.add(edge.index);
      else if (state[edge.t] === 0) visit(edge.t);
    }
    state[node] = 2;
  };
  for (let node = 0; node < count; node += 1) if (state[node] === 0) visit(node);
  return back;
}

// Layout steps 1 and 2: back edges by DFS in input order, then rows by the longest forward path.
export function assignRows(block: FlowBlock): { rows: number[]; back: Set<number> } {
  const edges = indexEdges(block);
  const back = findBackEdges(block.nodes.length, edges);
  const preds: number[][] = block.nodes.map(() => []);
  for (const edge of edges) if (!back.has(edge.index)) preds[edge.t]?.push(edge.s);
  const rows = new Array<number | undefined>(block.nodes.length).fill(undefined);
  const rowOf = (node: number): number => {
    const known = rows[node];
    if (known !== undefined) return known;
    const explicit = block.nodes[node]?.row;
    const list = preds[node] ?? [];
    const row = explicit ?? (list.length === 0 ? 0 : 1 + Math.max(...list.map(rowOf)));
    rows[node] = row;
    return row;
  };
  return { rows: block.nodes.map((_, node) => rowOf(node)), back };
}

// The characters per label line of a node in a grid whose widest row has `widest` nodes.
export function labelCharsPerLine(widest: number, kind: NodeKind): number {
  const columnWidth = columnWidthOf(widest);
  const pad = kind === "decision" ? 34 : 22;
  return Math.max(1, Math.floor((columnWidth - NODE_INSET - pad) / 7.1));
}

// The length of the first piece of a word longer than `chars`: after the last "/" that fits, else
// after the last "-", "_", or "." that fits, else `chars`.
function breakAt(word: string, chars: number): number {
  const head = word.slice(0, chars);
  const slash = head.lastIndexOf("/");
  if (slash > 0) return slash + 1;
  const mark = Math.max(head.lastIndexOf("-"), head.lastIndexOf("_"), head.lastIndexOf("."));
  return mark > 0 ? mark + 1 : chars;
}

export function wrapWords(text: string, chars: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    if (word === "") continue;
    if (current !== "" && current.length + 1 + word.length <= chars) {
      current += ` ${word}`;
      continue;
    }
    if (current !== "") lines.push(current);
    let rest = word;
    while (rest.length > chars) {
      const cut = breakAt(rest, chars);
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    current = rest;
  }
  if (current !== "") lines.push(current);
  return lines;
}

interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  right: number;
  bottom: number;
}

interface Geometry {
  boxes: Placed[];
  lane: (gap: number, edge: number) => number;
  side: (side: "left" | "right", edge: number) => number;
}

interface Candidate {
  name: string;
  gaps: number[];
  side?: "left" | "right";
  build: (g: Geometry) => Point[];
}

function segmentsOf(points: Point[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    if (a.x !== b.x || a.y !== b.y) out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
  return out;
}

// True when the segment enters the open interior of the box grown by `grow`.
export function segmentCrossesBox(segment: Segment, box: Box, grow: number): boolean {
  const left = box.x - grow;
  const right = box.x + box.w + grow;
  const top = box.y - grow;
  const bottom = box.y + box.h + grow;
  const minX = Math.min(segment.x1, segment.x2);
  const maxX = Math.max(segment.x1, segment.x2);
  const minY = Math.min(segment.y1, segment.y2);
  const maxY = Math.max(segment.y1, segment.y2);
  if (minY === maxY) return minY > top && minY < bottom && Math.max(minX, left) < Math.min(maxX, right);
  if (minX === maxX) return minX > left && minX < right && Math.max(minY, top) < Math.min(maxY, bottom);
  return Math.max(minX, left) < Math.min(maxX, right) && Math.max(minY, top) < Math.min(maxY, bottom);
}

function routeValid(points: Point[], s: number, t: number, boxes: Placed[]): boolean {
  for (const segment of segmentsOf(points)) {
    for (let node = 0; node < boxes.length; node += 1) {
      const box = boxes[node] as Placed;
      if (segmentCrossesBox(segment, box, node === s || node === t ? 0 : GROW)) return false;
    }
  }
  return true;
}

function candidatesFor(edge: IndexedEdge, rows: number[], place: number[], hasRightNeighbor: (node: number) => boolean, nearSide: (node: number) => "left" | "right"): Candidate[] {
  const { s, t, index: e } = edge;
  const rs = rows[s] as number;
  const rt = rows[t] as number;
  const box = (g: Geometry, node: number) => g.boxes[node] as Placed;
  const out: Candidate[] = [];
  const route = (name: string, gaps: number[], draw: (a: Placed, b: Placed, g: Geometry) => Point[], side?: "left" | "right"): Candidate => ({
    name,
    gaps,
    side,
    build: (g) => draw(box(g, s), box(g, t), g),
  });
  const exit = (a: Placed): Point => ({ x: a.cx, y: a.bottom });
  const entry = (b: Placed): Point => ({ x: b.cx, y: b.y - 1 });
  const via = (gap: number, endY: (b: Placed) => number) => (a: Placed, b: Placed, g: Geometry): Point[] => {
    const lane = g.lane(gap, e);
    return [exit(a), { x: a.cx, y: lane }, { x: b.cx, y: lane }, { x: b.cx, y: endY(b) }];
  };
  const toRightLane = (a: Placed, g: Geometry): Point[] => {
    const x = g.side("right", e);
    if (s !== t && !hasRightNeighbor(s)) return [{ x: a.right, y: a.cy }, { x, y: a.cy }];
    const lane = g.lane(rs, e);
    return [exit(a), { x: a.cx, y: lane }, { x, y: lane }];
  };
  const fromRightLane = (b: Placed, g: Geometry): Point[] => {
    const x = g.side("right", e);
    if (!hasRightNeighbor(t)) return [{ x, y: b.cy }, { x: b.right + 1, y: b.cy }];
    const lane = g.lane(rt - 1, e);
    return [{ x, y: lane }, { x: b.cx, y: lane }, entry(b)];
  };
  const rightLane = (): Candidate => {
    const gaps: number[] = [];
    if (s === t || hasRightNeighbor(s)) gaps.push(rs);
    if (hasRightNeighbor(t)) gaps.push(rt - 1);
    return route("right-lane", gaps, (a, b, g) => [...toRightLane(a, g), ...fromRightLane(b, g)], "right");
  };
  if (s === t) return [rightLane()];
  const sameX = Math.abs((place[s] as number) - (place[t] as number)) < 1e-6;
  if (rt > rs) {
    if (sameX) {
      out.push(route("straight", [], (a, b) => [exit(a), { x: a.cx, y: b.y - 1 }]));
    } else {
      out.push(route("below-source", [rs], via(rs, (b) => b.y - 1)));
      if (rt - 1 !== rs) out.push(route("above-target", [rt - 1], via(rt - 1, (b) => b.y - 1)));
    }
    if (rt - rs >= 2) {
      const side = nearSide(s);
      out.push(route(`${side}-lane`, [rs, rt - 1], (a, b, g) => {
        const x = g.side(side, e);
        const down = g.lane(rs, e);
        const up = g.lane(rt - 1, e);
        return [exit(a), { x: a.cx, y: down }, { x, y: down }, { x, y: up }, { x: b.cx, y: up }, entry(b)];
      }, side));
    }
    return out;
  }
  if (rt === rs) {
    out.push(route("across", [], (a, b) =>
      b.cx > a.cx ? [{ x: a.right, y: a.cy }, { x: b.x - 1, y: a.cy }] : [{ x: a.x, y: a.cy }, { x: b.right + 1, y: a.cy }],
    ));
    out.push(route("under", [rs], via(rs, (b) => b.bottom + 1)));
    return out;
  }
  out.push(route("up-then-across", [], (a, b) =>
    [{ x: a.cx, y: a.y }, { x: a.cx, y: b.cy }, { x: b.cx < a.cx ? b.right + 1 : b.x - 1, y: b.cy }],
  ));
  out.push(route("across-then-up", [], (a, b) =>
    [{ x: b.cx > a.cx ? a.right : a.x, y: a.cy }, { x: b.cx, y: a.cy }, { x: b.cx, y: b.bottom + 1 }],
  ));
  out.push(rightLane());
  return out;
}

interface TakenSegment {
  segment: Segment;
  s: number;
  t: number;
}

// Two edges may share a line only when they leave the same node or enter the same node in the same
// direction. Horizontal runs in a row gap are skipped: each gets its own lane later.
function sharesLine(segments: Segment[], edge: IndexedEdge, taken: TakenSegment[], laneYs: Set<number>): boolean {
  for (const segment of segments) {
    const vertical = segment.x1 === segment.x2;
    if (!vertical && laneYs.has(segment.y1)) continue;
    const [a1, a2] = vertical ? [segment.y1, segment.y2] : [segment.x1, segment.x2];
    for (const other of taken) {
      const o = other.segment;
      if (vertical ? o.x1 !== o.x2 || o.x1 !== segment.x1 : o.y1 !== o.y2 || o.y1 !== segment.y1) continue;
      const [b1, b2] = vertical ? [o.y1, o.y2] : [o.x1, o.x2];
      const overlap = Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2));
      if (overlap <= 0) continue;
      if (b2 > b1 === a2 > a1 && (other.s === edge.s || other.t === edge.t)) continue;
      return true;
    }
  }
  return false;
}

interface LaneEnds {
  above: Set<number>;
  below: Set<number>;
}

// The x of each vertical segment that meets the edge's horizontal run at `laneY`, split by side.
function laneEnds(points: Point[], laneY: number): LaneEnds {
  const ends: LaneEnds = { above: new Set(), below: new Set() };
  points.forEach((point, i) => {
    if (point.y !== laneY) return;
    for (const other of [points[i - 1], points[i + 1]]) {
      if (other === undefined || other.x !== point.x || other.y === laneY) continue;
      (other.y < laneY ? ends.above : ends.below).add(point.x);
    }
  });
  return ends;
}

// Lanes go in edge input order, except that an edge whose line comes down at x takes a lane above
// an edge whose line drops into a node at the same x; otherwise the two lines overlap and read as one.
function orderLanes(list: number[], ends: Map<number, LaneEnds>): number[] {
  const left = new Set(list);
  const out: number[] = [];
  const aboveAt = new Map<number, number[]>();
  for (const edge of list) {
    for (const x of ends.get(edge)?.above ?? []) {
      const edges = aboveAt.get(x) ?? [];
      edges.push(edge);
      aboveAt.set(x, edges);
    }
  }
  const waiting = new Map<number, number>();
  const dependents = new Map<number, number[]>();
  for (const edge of list) {
    const before = new Set<number>();
    for (const x of ends.get(edge)?.below ?? []) {
      for (const other of aboveAt.get(x) ?? []) if (other !== edge) before.add(other);
    }
    waiting.set(edge, before.size);
    for (const other of before) {
      const edges = dependents.get(other) ?? [];
      edges.push(edge);
      dependents.set(other, edges);
    }
  }
  while (left.size > 0) {
    const next = list.find((edge) => left.has(edge) && waiting.get(edge) === 0) ?? left.values().next().value!;
    out.push(next);
    left.delete(next);
    for (const edge of dependents.get(next) ?? []) waiting.set(edge, waiting.get(edge)! - 1);
  }
  return out;
}

function cutLines(lines: string[], what: string, warnings: string[]): string[] {
  if (lines.length <= MAX_LINES) return lines;
  warnings.push(`${what} is longer than ${MAX_LINES} lines; cut`);
  const kept = lines.slice(0, MAX_LINES);
  kept[MAX_LINES - 1] = `${kept[MAX_LINES - 1] ?? ""}…`;
  return kept;
}

interface LabelBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function labelBox(label: EdgeLabel): LabelBox {
  const width = label.text.length * 6.6;
  const left = label.anchor === "start" ? label.x : label.anchor === "end" ? label.x - width : label.x - width / 2;
  return { left, right: left + width, top: label.y - 9, bottom: label.y + 3 };
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

const LABEL_RUN_STEP = 24;
const LABEL_STEP = 12;

// Places along each segment of the path: centered above and below a horizontal run, from its middle
// toward each end; beside a vertical run on both sides, in 12 px steps from its start. A first
// vertical stub that turns into a horizontal run may be shared with other edges, so it is skipped.
function segmentOptions(text: string, points: Point[]): EdgeLabel[] {
  const options: EdgeLabel[] = [];
  const segments = segmentsOf(points);
  const [first, second] = segments;
  const sharedStub = first !== undefined && second !== undefined && first.x1 === first.x2 && second.y1 === second.y2;
  for (const segment of sharedStub ? segments.slice(1) : segments) {
    if (segment.y1 === segment.y2) {
      const lo = Math.min(segment.x1, segment.x2);
      const hi = Math.max(segment.x1, segment.x2);
      const mid = (lo + hi) / 2;
      const xs = [mid];
      for (let d = LABEL_RUN_STEP; mid - d >= lo; d += LABEL_RUN_STEP) xs.push(mid - d, mid + d);
      for (const x of xs) {
        options.push({ text, x, y: segment.y1 - 5, anchor: "middle" });
        options.push({ text, x, y: segment.y1 + 13, anchor: "middle" });
      }
    } else if (segment.x1 === segment.x2) {
      const down = segment.y2 >= segment.y1;
      const length = Math.abs(segment.y2 - segment.y1);
      for (let d = 0; d <= length; d += LABEL_STEP) {
        const y = down ? segment.y1 + 13 + d : segment.y1 - 5 - d;
        options.push({ text, x: segment.x1 + 6, y, anchor: "start" });
        options.push({ text, x: segment.x1 - 6, y, anchor: "end" });
      }
    }
  }
  return options;
}

interface Canvas {
  width: number;
  height: number;
}

function inside(box: LabelBox, canvas: Canvas): boolean {
  return box.left >= 0 && box.top >= 0 && box.right <= canvas.width && box.bottom <= canvas.height;
}

// The first free place inside the canvas, else the first free place that fits after the canvas grows
// right or down, else the first place inside the canvas with `free: false`.
function placeLabel(text: string, points: Point[], taken: LabelBox[], nodes: LabelBox[], canvas: Canvas): { label: EdgeLabel; free: boolean } {
  const options = [...labelOptions(text, points), ...segmentOptions(text, points)];
  const isFree = (option: EdgeLabel) => {
    const box = labelBox(option);
    return ![...taken, ...nodes].some((other) => overlaps(other, box));
  };
  const growable = (option: EdgeLabel) => labelBox(option).left >= 0 && labelBox(option).top >= 0;
  const settle = (label: EdgeLabel, free: boolean) => {
    const box = labelBox(label);
    canvas.width = Math.max(canvas.width, box.right);
    canvas.height = Math.max(canvas.height, box.bottom);
    taken.push(box);
    return { label, free };
  };
  const inCanvas = options.filter((option) => inside(labelBox(option), canvas));
  const free = inCanvas.find(isFree) ?? options.find((option) => growable(option) && isFree(option));
  if (free !== undefined) return settle(free, true);
  const first = inCanvas[0] ?? options.find(growable);
  if (first !== undefined) return settle(first, false);
  const fallback = options[0] as EdgeLabel;
  const box = labelBox(fallback);
  return settle({ ...fallback, x: fallback.x + Math.max(0, -box.left), y: fallback.y + Math.max(0, -box.top) }, false);
}

// The places of spec rule 7, in order: they come before the places along the rest of the path.
function labelOptions(text: string, points: Point[]): EdgeLabel[] {
  const p0 = points[0] as Point;
  const p1 = points[1] ?? p0;
  const p2 = points[2];
  const vertical = p0.x === p1.x;
  const options: EdgeLabel[] = [];
  if (vertical && p2 !== undefined && p2.y === p1.y && p2.x !== p1.x) {
    // Edges that leave a node at one point share the first stub, so the label goes on the edge's own horizontal run.
    const x = (p1.x + p2.x) / 2;
    for (let shift = 0; shift < 3; shift += 1) {
      options.push({ text, x, y: p1.y - 5 - 12 * shift, anchor: "middle" });
      options.push({ text, x, y: p1.y + 13 + 12 * shift, anchor: "middle" });
    }
  } else if (vertical) {
    const y = p1.y >= p0.y ? p0.y + 13 : p0.y - 5;
    const step = p1.y >= p0.y ? 12 : -12;
    for (let shift = 0; shift < 3; shift += 1) {
      options.push({ text, x: p0.x + 6, y: y + step * shift, anchor: "start" });
      options.push({ text, x: p0.x - 6, y: y + step * shift, anchor: "end" });
    }
  } else {
    for (let shift = 0; shift < 3; shift += 1) options.push({ text, x: (p0.x + p1.x) / 2, y: p0.y - 5 - 12 * shift, anchor: "middle" });
  }
  return options;
}

export function layoutFlow(block: FlowBlock): FlowLayout {
  const warnings: string[] = [];
  const name = `flow "${block.title}"`;
  const count = block.nodes.length;
  const edges = indexEdges(block);
  const { rows, back } = assignRows(block);

  const cols = new Array<number>(count).fill(0);
  const taken = new Map<number, Set<number>>();
  const claim = (row: number, start: number): number => {
    let set = taken.get(row);
    if (set === undefined) {
      set = new Set();
      taken.set(row, set);
    }
    let col = start;
    while (set.has(col)) col += 1;
    set.add(col);
    return col;
  };
  block.nodes.forEach((node, i) => {
    if (node.col === undefined) return;
    const row = rows[i] as number;
    const col = claim(row, node.col);
    if (col !== node.col) warnings.push(`${name}: node "${node.id}" moved from column ${node.col} to ${col}, because its cell is taken`);
    cols[i] = col;
  });
  block.nodes.forEach((node, i) => {
    if (node.col !== undefined) return;
    cols[i] = claim(rows[i] as number, 0);
  });
  const widest = Math.max(1, ...cols.map((col) => col + 1));
  // A flow with a pinned column keeps every row on the grid, so its main column stays straight.
  const pinned = block.nodes.some((node) => node.col !== undefined);
  const place = cols.map((col, i) => (pinned ? col : col + (widest - (taken.get(rows[i] as number)?.size ?? 1)) / 2));

  const columnWidth = columnWidthOf(widest);
  const baseWidth = widest <= 4 ? BASE_WIDTH : 2 * MARGIN + WIDE_COLUMN * widest;
  const width = columnWidth - NODE_INSET;
  const nodes: LayoutNode[] = block.nodes.map((node, i) => {
    const kind = node.kind ?? "step";
    const label = plainText(node.label);
    const sub = plainText(node.sub ?? "");
    const lines = cutLines(wrapWords(label, labelCharsPerLine(widest, kind)), `${name}: the label of node "${node.id}"`, warnings);
    const subLines = sub === "" ? [] : cutLines(wrapWords(sub, Math.max(1, Math.floor((width - 22) / 6.3))), `${name}: the sub of node "${node.id}"`, warnings);
    const textLines = lines.length === 0 ? [""] : lines;
    const h = 12 + 17 * textLines.length + (subLines.length > 0 ? 4 + 14 * subLines.length : 0) + 8 + (kind === "decision" ? 6 : 0);
    const x = MARGIN + (place[i] as number) * columnWidth + NODE_INSET / 2;
    const out: LayoutNode = { id: node.id, kind, row: rows[i] as number, col: place[i] as number, x, y: 0, w: width, h, cx: x + width / 2, cy: 0, lines: textLines, subLines };
    if (node.tone !== undefined) out.tone = node.tone;
    if (node.badge !== undefined && node.badge !== "") out.badge = plainText(node.badge);
    return out;
  });

  const lastRow = Math.max(0, ...rows);
  const rowHeight = Array.from({ length: lastRow + 1 }, (_, row) => Math.max(0, ...nodes.filter((node) => node.row === row).map((node) => node.h)));
  const hasRightNeighbor = (node: number): boolean => nodes.some((other, j) => j !== node && other.row === nodes[node]?.row && other.col > (nodes[node]?.col ?? 0));
  const areaLeft = Math.min(...nodes.map((node) => node.x));
  const areaRight = Math.max(...nodes.map((node) => node.x + node.w));
  const nearSide = (node: number): "left" | "right" => ((nodes[node]?.cx ?? 0) - areaLeft < areaRight - (nodes[node]?.cx ?? 0) ? "left" : "right");

  // gap g lies below row g; gap -1 is above row 0.
  const geometry = (gapHeight: (gap: number) => number, lane: Geometry["lane"], side: Geometry["side"], shiftX: number) => {
    const rowTop: number[] = [];
    let y = gapHeight(-1);
    for (let row = 0; row <= lastRow; row += 1) {
      rowTop.push(y);
      y += (rowHeight[row] ?? 0) + gapHeight(row);
    }
    const boxes: Placed[] = nodes.map((node) => {
      const top = (rowTop[node.row] ?? 0) + ((rowHeight[node.row] ?? 0) - node.h) / 2;
      const x = node.x + shiftX;
      return { x, y: top, w: node.w, h: node.h, cx: x + node.w / 2, cy: top + node.h / 2, right: x + node.w, bottom: top + node.h };
    });
    const gapTop = (gap: number) => (gap < 0 ? 0 : (rowTop[gap] ?? 0) + (rowHeight[gap] ?? 0));
    return { boxes, height: y, gapTop, geometry: { boxes, lane: (gap: number, edge: number) => lane(gap, edge) + gapTop(gap), side } };
  };

  const provisional = geometry(
    () => MIN_GAP,
    () => MIN_GAP / 2,
    (side, edge) => (side === "right" ? areaRight + SIDE_STEP * (edge + 1) : areaLeft - SIDE_STEP * (edge + 1)),
    0,
  );
  const chosen = new Map<number, { pick: Candidate; draft: Point[] }>();
  const routed: TakenSegment[] = [];
  const laneYs = new Set(Array.from({ length: lastRow + 2 }, (_, i) => provisional.gapTop(i - 1) + MIN_GAP / 2));
  // Forward edges have fewer routes than back edges, so they choose first.
  for (const edge of [...edges.filter((e) => !back.has(e.index)), ...edges.filter((e) => back.has(e.index))]) {
    const candidates = candidatesFor(edge, rows, place, hasRightNeighbor, nearSide);
    const drafts = candidates.map((candidate) => ({ candidate, points: candidate.build(provisional.geometry) }));
    const valid = drafts.filter(({ points }) => routeValid(points, edge.s, edge.t, provisional.boxes));
    const selected = valid.find(({ points }) => !sharesLine(segmentsOf(points), edge, routed, laneYs)) ?? valid[0] ?? drafts[drafts.length - 1];
    if (selected === undefined) continue;
    const { candidate: pick, points: draft } = selected;
    chosen.set(edge.index, { pick, draft });
    for (const segment of segmentsOf(draft)) {
      routed.push({ segment, s: edge.s, t: edge.t });
    }
  }

  const laneSlots = new Map<number, number[]>();
  const sideSlots: Record<"left" | "right", number[]> = { left: [], right: [] };
  for (const edge of edges) {
    const pick = chosen.get(edge.index)?.pick;
    if (pick === undefined) continue;
    for (const gap of new Set(pick.gaps)) {
      const list = laneSlots.get(gap) ?? [];
      list.push(edge.index);
      laneSlots.set(gap, list);
    }
    if (pick.side !== undefined) sideSlots[pick.side].push(edge.index);
  }
  for (const [gap, list] of laneSlots) {
    const laneY = provisional.gapTop(gap) + MIN_GAP / 2;
    const ends = new Map(list.map((index) => [index, laneEnds(chosen.get(index)?.draft ?? [], laneY)]));
    laneSlots.set(gap, orderLanes(list, ends));
  }
  const lanesIn = (gap: number) => laneSlots.get(gap)?.length ?? 0;
  const gapHeight = (gap: number): number => {
    const used = lanesIn(gap);
    if (used === 0 && gap < 0) return TOP_GAP;
    if (used === 0 && gap >= lastRow) return BOTTOM_GAP;
    return Math.max(MIN_GAP, 14 + LANE_STEP * used);
  };
  const shiftX = sideSlots.left.length > 0 ? Math.max(0, SIDE_STEP * sideSlots.left.length + SIDE_MARGIN - areaLeft) : 0;
  const final = geometry(
    gapHeight,
    (gap, edge) => {
      const list = laneSlots.get(gap) ?? [];
      const slot = Math.max(0, list.indexOf(edge));
      return (gapHeight(gap) - LANE_STEP * (list.length - 1)) / 2 + LANE_STEP * slot;
    },
    (side, edge) => {
      const slot = Math.max(0, sideSlots[side].indexOf(edge)) + 1;
      return side === "right" ? areaRight + shiftX + SIDE_STEP * slot : areaLeft + shiftX - SIDE_STEP * slot;
    },
    shiftX,
  );
  const canvas: Canvas = {
    width: Math.max(baseWidth + shiftX, sideSlots.right.length > 0 ? areaRight + shiftX + SIDE_STEP * sideSlots.right.length + SIDE_MARGIN : 0),
    height: final.height,
  };

  const labels: LabelBox[] = [];
  const nodeBoxes: LabelBox[] = final.boxes.map((box) => ({ left: box.x, right: box.right, top: box.y, bottom: box.bottom }));
  const outEdges: LayoutEdge[] = [];
  for (const edge of edges) {
    const pick = chosen.get(edge.index)?.pick;
    const spec = block.edges[edge.index];
    if (pick === undefined || spec === undefined) continue;
    const points = pick.build(final.geometry);
    if (!routeValid(points, edge.s, edge.t, final.boxes)) warnings.push(`${name}: edge ${spec.from} -> ${spec.to} crosses a node`);
    const out: LayoutEdge = {
      index: edge.index,
      from: spec.from,
      to: spec.to,
      back: back.has(edge.index),
      route: pick.name,
      dashed: spec.dashed === true,
      points,
      segments: segmentsOf(points),
    };
    if (spec.label !== undefined && spec.label !== "") {
      const placed = placeLabel(spec.label, points, labels, nodeBoxes, canvas);
      out.label = placed.label;
      if (!placed.free) warnings.push(`${name}: the label "${spec.label}" of edge ${spec.from} -> ${spec.to} overlaps another label or a node`);
    }
    outEdges.push(out);
  }
  nodes.forEach((node, i) => {
    const box = final.boxes[i] as Placed;
    node.x = box.x;
    node.y = box.y;
    node.cx = box.cx;
    node.cy = box.cy;
  });
  return { width: canvas.width, height: canvas.height, nodes, edges: outEdges, warnings };
}

function fmt(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function pathData(points: Point[]): string {
  const first = points[0];
  if (first === undefined) return "";
  let d = `M${fmt(first.x)},${fmt(first.y)}`;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    if (a.x === b.x && a.y === b.y) continue;
    if (a.x === b.x) d += ` V${fmt(b.y)}`;
    else if (a.y === b.y) d += ` H${fmt(b.x)}`;
    else d += ` L${fmt(b.x)},${fmt(b.y)}`;
  }
  return d;
}

function toned(base: string, tone: NodeTone | undefined): string {
  return tone === undefined ? base : `${base} ${tone}`;
}

function shapeSvg(kind: NodeKind, tone: NodeTone | undefined, box: Box): string {
  const { x, y, w, h } = box;
  const cls = toned(`nd ${kind}`, tone);
  let out: string;
  if (kind === "decision") {
    const s = Math.min(14, w / 4);
    const points = [
      [x + s, y],
      [x + w - s, y],
      [x + w, y + h / 2],
      [x + w - s, y + h],
      [x + s, y + h],
      [x, y + h / 2],
    ]
      .map(([px, py]) => `${fmt(px ?? 0)},${fmt(py ?? 0)}`)
      .join(" ");
    out = `<polygon class="${cls}" points="${points}"/>`;
  } else {
    const rx = kind === "start" || kind === "end" ? h / 2 : Math.min(7, h / 5);
    out = `<rect class="${cls}" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="${fmt(rx)}"/>`;
  }
  if (kind === "task") {
    out += `<rect class="${toned("taskbar", tone)}" x="${fmt(x)}" y="${fmt(y)}" width="5" height="${fmt(h)}" rx="2"/>`;
  }
  return out;
}

function nodeSvg(node: LayoutNode): string {
  let out = shapeSvg(node.kind, node.tone, node);
  let ty = node.y + 24 + (node.kind === "decision" ? 3 : 0);
  for (const line of node.lines) {
    out += `<text class="t" x="${fmt(node.cx)}" y="${fmt(ty)}" text-anchor="middle">${escapeHtml(line)}</text>`;
    ty += 17;
  }
  ty += 2;
  for (const line of node.subLines) {
    out += `<text class="m" x="${fmt(node.cx)}" y="${fmt(ty)}" text-anchor="middle">${escapeHtml(line)}</text>`;
    ty += 14;
  }
  if (node.badge !== undefined) {
    const cls = toned("badge", node.tone);
    out += `<text class="${cls}" x="${fmt(node.x + node.w - 6)}" y="${fmt(node.y - 4)}" text-anchor="end">${escapeHtml(node.badge)}</text>`;
  }
  return out;
}

export function renderFlow(block: FlowBlock, id: string): { svg: string; warnings: string[] } {
  const layout = layoutFlow(block);
  const w = fmt(layout.width);
  const h = fmt(layout.height);
  const parts = [
    `<svg class="flow" role="img" aria-labelledby="${id}-t ${id}-d" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="max-width:${w}px">`,
    `<title id="${id}-t">${escapeHtml(block.title)}</title><desc id="${id}-d">${escapeHtml(block.description ?? block.title)}</desc>`,
    `<defs><marker id="ah-${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0,0 L10,5 L0,10 z"/></marker></defs>`,
  ];
  for (const edge of layout.edges) {
    parts.push(`<path class="${edge.dashed ? "ln dash" : "ln"}" d="${pathData(edge.points)}" marker-end="url(#ah-${id})"/>`);
  }
  for (const node of layout.nodes) parts.push(nodeSvg(node));
  for (const edge of layout.edges) {
    const label = edge.label;
    if (label === undefined) continue;
    parts.push(`<text class="el" x="${fmt(label.x)}" y="${fmt(label.y)}" text-anchor="${label.anchor}">${escapeHtml(label.text)}</text>`);
  }
  parts.push("</svg>");
  return { svg: parts.join("\n"), warnings: layout.warnings };
}

const KIND_NAMES: Readonly<Record<NodeKind, string>> = {
  start: "start",
  step: "step",
  task: "child task",
  decision: "decision",
  stop: "waits for you",
  end: "end",
};

const TONE_NAMES: Readonly<Record<NodeTone, string>> = { done: "done", open: "open", blocked: "blocked" };

export function renderLegend(block: FlowBlock): string {
  const kinds = new Set(block.nodes.map((node) => node.kind ?? "step"));
  const toneKinds = new Map<NodeTone, NodeKind>();
  for (const node of block.nodes) {
    if (node.tone !== undefined && !toneKinds.has(node.tone)) toneKinds.set(node.tone, node.kind ?? "step");
  }
  const swatch = (kind: NodeKind, tone: NodeTone | undefined) =>
    `<svg width="26" height="16" viewBox="0 0 26 16" aria-hidden="true">${shapeSvg(kind, tone, { x: 1, y: 1, w: 24, h: 14 })}</svg>`;
  const items: string[] = [];
  for (const kind of Object.keys(KIND_NAMES) as NodeKind[]) {
    if (kinds.has(kind)) items.push(`<span>${swatch(kind, undefined)}${KIND_NAMES[kind]}</span>`);
  }
  for (const tone of Object.keys(TONE_NAMES) as NodeTone[]) {
    const kind = toneKinds.get(tone);
    if (kind !== undefined) items.push(`<span>${swatch(kind, tone)}${TONE_NAMES[tone]}</span>`);
  }
  return `<div class="legend">${items.join("")}</div>`;
}
