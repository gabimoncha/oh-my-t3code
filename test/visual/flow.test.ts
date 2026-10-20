import { test } from "bun:test";
import assert from "node:assert/strict";
import { assignRows, layoutFlow, renderFlow, renderLegend, segmentCrossesBox, wrapWords } from "../../src/visual/flow.ts";
import type { EdgeLabel, FlowLayout, LayoutEdge } from "../../src/visual/flow.ts";
import { assertClean, sharedLines } from "./geometry.ts";
import type { FlowBlock, FlowEdge, FlowNode } from "../../src/visual/spec.ts";

function flow(nodes: FlowNode[], edges: [string, string, string?][]): FlowBlock {
  return {
    type: "flow",
    title: "test",
    nodes,
    edges: edges.map(([from, to, label]): FlowEdge => (label === undefined ? { from, to } : { from, to, label })),
  };
}

const n = (id: string, extra: Partial<FlowNode> = {}): FlowNode => ({ id, label: `Node ${id}`, ...extra });

// A skip edge a -> c whose straight line would cross b.
const SKIP = flow([n("a"), n("b"), n("c")], [["a", "b"], ["b", "c"], ["a", "c"]]);

// Fan-out, fan-in, long forward edges past other nodes, back edges, a same-row edge, and a self loop.
const BUSY = flow(
  [n("start", { kind: "start" }), n("x"), n("y"), n("z"), n("q", { kind: "decision" }), n("p"), n("r"), n("end", { kind: "end" })],
  [
    ["start", "x"],
    ["start", "y"],
    ["start", "z"],
    ["x", "q"],
    ["y", "q"],
    ["z", "p"],
    ["q", "r", "yes"],
    ["q", "p", "no"],
    ["p", "r"],
    ["r", "end"],
    ["start", "end"],
    ["r", "x", "again"],
    ["end", "start"],
    ["x", "y"],
    ["p", "p"],
  ],
);

// The normal-profile chart of the 2026-10-15 report, without rows or columns.
const NORMAL = flow(
  [
    n("start", { kind: "start" }),
    n("frame"),
    n("explore", { kind: "task" }),
    n("plan", { kind: "task" }),
    n("papp", { kind: "decision" }),
    n("pfix"),
    n("owner", { kind: "stop" }),
    n("design", { kind: "task" }),
    n("disp", { kind: "task" }),
    n("check"),
    n("review", { kind: "task" }),
    n("rok", { kind: "decision" }),
    n("fix", { kind: "task" }),
    n("verify", { kind: "task" }),
    n("vok", { kind: "decision" }),
    n("qa", { kind: "task" }),
    n("more", { kind: "decision" }),
    n("final", { kind: "task" }),
    n("end", { kind: "end" }),
  ],
  [
    ["start", "frame"],
    ["frame", "explore"],
    ["explore", "plan"],
    ["plan", "papp"],
    ["owner", "design"],
    ["design", "disp"],
    ["disp", "check"],
    ["check", "review"],
    ["review", "rok"],
    ["verify", "vok"],
    ["qa", "more"],
    ["final", "end"],
    ["papp", "owner", "yes"],
    ["papp", "pfix", "no"],
    ["pfix", "plan"],
    ["rok", "verify", "yes"],
    ["rok", "fix", "no"],
    ["fix", "review"],
    ["vok", "qa", "yes"],
    ["vok", "fix", "no"],
    ["more", "disp", "yes"],
    ["more", "final", "no"],
  ],
);

// Explicit rows and columns, including a moved node and a row above its predecessor.
const PINNED = flow(
  [n("a", { row: 0, col: 0 }), n("b", { row: 0, col: 2 }), n("c", { row: 2, col: 1 }), n("d", { row: 1, col: 1 }), n("e", { row: 1 }), n("f", { row: 3, col: 0 })],
  [
    ["a", "c"],
    ["b", "c"],
    ["c", "d"],
    ["d", "a"],
    ["e", "f"],
    ["f", "b"],
    ["a", "b"],
  ],
);

const WIDE = flow(
  ["r", "a", "b", "c", "d", "e", "f"].map((id) => n(id)),
  [
    ["r", "a"],
    ["r", "b"],
    ["r", "c"],
    ["r", "d"],
    ["r", "e"],
    ["r", "f"],
    ["f", "a"],
    ["a", "f"],
  ],
);

// A check loop whose back edge has a long label on the right lane.
const LOOP = flow(
  [n("a", { label: "Write the code" }), n("b", { label: "Run the tests" }), n("c", { label: "Tests pass?", kind: "decision" }), n("d", { label: "Done", kind: "end" })],
  [["a", "b"], ["b", "c"], ["c", "d", "yes"], ["c", "a", "no, fix and run again"]],
);

// A decision with three labeled edges to the three nodes of the next row.
const FAN = flow(
  [n("q", { label: "Which result?", kind: "decision" }), n("x", { label: "Retry" }), n("y", { label: "Ask the owner" }), n("z", { label: "Done" })],
  [["q", "x", "transient failure"], ["q", "y", "blocked on owner"], ["q", "z", "approved"]],
);

// A long label on a short edge between two nodes of row 0.
const ACROSS = flow([n("a", { row: 0, col: 0 }), n("b", { row: 0, col: 1 })], [["a", "b", "on verification failure"]]);

const DUPLICATES = flow([n("a"), n("b")], Array.from({ length: 8 }, (_, i): [string, string, string] => ["a", "b", `condition ${i}`]));

const FIXTURES: [string, FlowBlock][] = [
  ["skip", SKIP],
  ["busy", BUSY],
  ["normal", NORMAL],
  ["pinned", PINNED],
  ["wide", WIDE],
  ["loop", LOOP],
  ["fan", FAN],
  ["across", ACROSS],
  ["duplicates", DUPLICATES],
];

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function labelRect(label: EdgeLabel): Rect {
  const width = label.text.length * 6.6;
  const left = label.anchor === "start" ? label.x : label.anchor === "end" ? label.x - width : label.x - width / 2;
  return { left, right: left + width, top: label.y - 9, bottom: label.y + 3 };
}

function hits(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

const overlapWarning = (title: string, edge: LayoutEdge) => `flow "${title}": the label "${edge.label?.text}" of edge ${edge.from} -> ${edge.to} overlaps another label or a node`;

// Every label box lies inside the canvas, and a label that overlaps another label or a node is named in a warning.
function assertLabels(name: string, title: string, layout: FlowLayout): void {
  const labeled = layout.edges.filter((edge) => edge.label !== undefined);
  for (const edge of labeled) {
    const box = labelRect(edge.label as EdgeLabel);
    assert.ok(box.left >= 0 && box.top >= 0 && box.right <= layout.width && box.bottom <= layout.height, `${name}: label "${edge.label?.text}" leaves the canvas: ${JSON.stringify(box)}`);
    const overNode = layout.nodes.some((node) => hits(box, { left: node.x, right: node.x + node.w, top: node.y, bottom: node.y + node.h }));
    const overLabel = labeled.some((other) => other !== edge && hits(box, labelRect(other.label as EdgeLabel)));
    if (overNode || overLabel) {
      const warned = (e: LayoutEdge) => layout.warnings.includes(overlapWarning(title, e));
      const partners = labeled.filter((other) => other !== edge && hits(box, labelRect(other.label as EdgeLabel)));
      assert.ok(warned(edge) || (!overNode && partners.every(warned)), `${name}: label "${edge.label?.text}" overlaps without a warning`);
    }
  }
}

test("edges that do not share a node never run on one line", () => {
  // In PINNED every route of a -> b meets another edge, so the first valid route stays.
  for (const [name, block] of FIXTURES) {
    if (name !== "pinned") assert.deepEqual(sharedLines(layoutFlow(block)), [], name);
  }
});

test("no edge segment crosses a node other than its two ends, in every fixture flow", () => {
  for (const [name, block] of FIXTURES) {
    const layout = layoutFlow(block);
    assert.equal(layout.edges.length, block.edges.length, name);
    assertClean(name, layout);
    assert.ok(!layout.warnings.some((warning) => warning.includes("crosses")), name);
  }
});

test("every label box is inside the canvas and overlaps no other label or node, or a warning names it, in every fixture flow", () => {
  for (const [name, block] of FIXTURES) assertLabels(name, block.title, layoutFlow(block));
});

test("a skip edge whose straight line would cross a node takes a side lane", () => {
  const layout = layoutFlow(SKIP);
  const skip = layout.edges.find((edge) => edge.from === "a" && edge.to === "c");
  assert.ok(skip);
  assert.match(skip.route, /lane/);
  const b = layout.nodes.find((node) => node.id === "b");
  assert.ok(b);
  const straight = { x1: b.cx, y1: 0, x2: b.cx, y2: layout.height };
  assert.ok(segmentCrossesBox(straight, b, 4), "the naive straight route would cross b");
  assert.ok(skip.points.some((point) => point.x > b.x + b.w || point.x < b.x), "the side lane runs outside b");
});

test("back edges come from the DFS stack, and rows are the longest forward path", () => {
  const block = flow([n("a"), n("b"), n("c"), n("d")], [["a", "b"], ["b", "c"], ["c", "a"], ["a", "c"], ["c", "d"], ["d", "b"]]);
  const { rows, back } = assignRows(block);
  assert.deepEqual([...back].sort(), [2, 5]);
  assert.deepEqual(rows, [0, 1, 2, 3]);
  const layout = layoutFlow(block);
  assert.deepEqual(
    layout.edges.filter((edge) => edge.back).map((edge) => `${edge.from}->${edge.to}`),
    ["c->a", "d->b"],
  );
  assertClean("cycle", layout);
});

test("a node with row keeps it", () => {
  const { rows } = assignRows(flow([n("a"), n("b", { row: 5 }), n("c")], [["a", "b"], ["b", "c"]]));
  assert.deepEqual(rows, [0, 5, 6]);
});

test("columns: explicit cells first, a taken cell moves with a warning, and a pinned flow keeps every row on the grid", () => {
  const layout = layoutFlow(flow([n("a", { col: 0 }), n("b", { col: 0 }), n("c"), n("d"), n("e")], [["a", "c"], ["c", "d"], ["c", "e"]]));
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  assert.equal(byId.get("a")?.col, 0);
  assert.equal(byId.get("b")?.col, 1);
  assert.equal(byId.get("c")?.col, 0, "a flow with a pinned column centers no row");
  assert.equal(byId.get("d")?.col, 0);
  assert.equal(byId.get("e")?.col, 1);
  assert.ok(layout.warnings.some((warning) => warning.includes('node "b" moved from column 0 to 1')));
  assert.equal(layout.width, 720);
  assert.equal(byId.get("a")?.w, 332 - 28);
});

test("a flow with no pinned column centers each row under the widest row", () => {
  const layout = layoutFlow(flow([n("a"), n("b"), n("c"), n("d")], [["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"]]));
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  assert.equal(byId.get("a")?.col, 0.5);
  assert.equal(byId.get("b")?.col, 0);
  assert.equal(byId.get("c")?.col, 1);
  assert.equal(byId.get("d")?.col, 0.5);
});

test("labels of edges that share a stub sit on each edge's own horizontal run", () => {
  const layout = layoutFlow(
    flow([n("q", { kind: "decision" }), n("left"), n("right")], [["q", "left", "yes"], ["q", "right", "no"]]),
  );
  const q = layout.nodes.find((node) => node.id === "q");
  const yes = layout.edges.find((edge) => edge.label?.text === "yes");
  const no = layout.edges.find((edge) => edge.label?.text === "no");
  assert.ok(q !== undefined && yes?.label !== undefined && no?.label !== undefined);
  assert.ok(yes.label.x < q.cx, "the label of the edge to the left node is left of the stub");
  assert.ok(no.label.x > q.cx, "the label of the edge to the right node is right of the stub");
});

test("wide grids use 150 px columns", () => {
  const layout = layoutFlow(WIDE);
  assert.equal(layout.nodes[1]?.w, 122);
  assert.equal(layout.nodes.filter((node) => node.row === 1).length, 5);
  assert.ok(layout.width >= 2 * 28 + 150 * 5);
});

test("node height follows the wrap rule, and long labels are cut at 4 lines with a warning", () => {
  const short = layoutFlow(flow([n("a"), n("b", { sub: "one two", kind: "decision" })], [["a", "b"]]));
  assert.equal(short.nodes[0]?.h, 12 + 17 + 8);
  assert.equal(short.nodes[1]?.h, 12 + 17 + 4 + 14 + 8 + 6);
  const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
  const wrapped = layoutFlow(flow([n("a", { label: words.slice(0, 120) })], []));
  assert.equal(wrapped.nodes[0]?.lines.length, 2);
  const narrow = layoutFlow({ ...WIDE, nodes: WIDE.nodes.map((node) => ({ ...node, label: words.slice(0, 120) })) });
  assert.equal(narrow.nodes[0]?.lines.length, 4);
  assert.ok(narrow.nodes[0]?.lines[3]?.endsWith("…"));
  assert.ok(narrow.warnings.some((warning) => warning.includes('the label of node "r" is longer than 4 lines; cut')));
});

test("edge labels sit at the start of the path", () => {
  const layout = layoutFlow(flow([n("a"), n("b")], [["a", "b", "go"]]));
  const edge = layout.edges[0];
  assert.ok(edge?.label);
  const start = edge.points[0];
  assert.ok(start);
  assert.deepEqual(edge.label, { text: "go", x: start.x + 6, y: start.y + 13, anchor: "start" });
  const across = layoutFlow(flow([n("a", { row: 0, col: 0 }), n("b", { row: 0, col: 1 })], [["a", "b", "next"]]));
  const label = across.edges[0]?.label;
  const [p0, p1] = across.edges[0]?.points ?? [];
  assert.ok(label && p0 && p1);
  assert.deepEqual(label, { text: "next", x: (p0.x + p1.x) / 2, y: p0.y - 5, anchor: "middle" });
});

test("renderFlow is deterministic, rounds to one decimal, and escapes every text", () => {
  const evil = "<script>alert(1)</script>";
  const block: FlowBlock = {
    type: "flow",
    title: `T ${evil}`,
    description: `D ${evil}`,
    nodes: [
      { id: "a", label: evil, sub: evil, badge: "<b>&'\"" },
      { id: "b", label: "B", kind: "task", tone: "done" },
      { id: "c", label: "C", kind: "decision", tone: "blocked" },
    ],
    edges: [
      { from: "a", to: "b", label: evil.slice(0, 24) },
      { from: "a", to: "c", dashed: true },
    ],
  };
  const first = renderFlow(block, "f1");
  const second = renderFlow(block, "f1");
  assert.equal(first.svg, second.svg);
  assert.ok(!first.svg.includes("<script"));
  assert.ok(!first.svg.includes("<b>"));
  assert.ok(first.svg.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(first.svg.includes("&lt;b&gt;&amp;&#39;&quot;"));
  assert.ok(!/\d\.\d\d/.test(first.svg), "numbers have at most one decimal");
  assert.match(first.svg, /<svg class="flow" role="img" aria-labelledby="f1-t f1-d"/);
  assert.match(first.svg, /class="nd task done"/);
  assert.match(first.svg, /class="taskbar done"/);
  assert.match(first.svg, /<polygon class="nd decision blocked"/);
  assert.match(first.svg, /class="ln dash"/);
  assert.match(first.svg, /class="badge"/);
  const legend = renderLegend(block);
  for (const name of ["step", "child task", "decision", "done", "blocked"]) assert.ok(legend.includes(`</svg>${name}</span>`), name);
  assert.ok(!legend.includes("start</span>"));
});

test("a long label on a short edge in row 0 stays inside the canvas, with a warning when it overlaps a node", () => {
  const layout = layoutFlow(ACROSS);
  const label = layout.edges[0]?.label;
  assert.ok(label);
  const box = labelRect(label);
  assert.ok(box.top >= 0 && box.left >= 0 && box.right <= layout.width, JSON.stringify(box));
  const overNode = layout.nodes.some((node) => hits(box, { left: node.x, right: node.x + node.w, top: node.y, bottom: node.y + node.h }));
  assert.equal(layout.warnings.includes('flow "test": the label "on verification failure" of edge a -> b overlaps another label or a node'), overNode);
});

test("the label of a back edge on the right lane stays inside the 720 px canvas and moves off the nodes", () => {
  const layout = layoutFlow(LOOP);
  const back = layout.edges.find((edge) => edge.from === "c" && edge.to === "a");
  assert.ok(back?.label);
  assert.equal(back.route, "right-lane");
  assert.equal(layout.width, 720);
  const box = labelRect(back.label);
  assert.ok(box.right <= 720 && box.left >= 0, JSON.stringify(box));
  for (const node of layout.nodes) assert.ok(!hits(box, { left: node.x, right: node.x + node.w, top: node.y, bottom: node.y + node.h }), node.id);
  assert.deepEqual(layout.warnings, []);
});

test("a label past the right edge grows the canvas when no place inside is free", () => {
  const edges: [string, string, string?][] = [["a", "b"], ...[0, 1, 2].map((i): [string, string, string] => ["b", "a", `back edge number ${i}`])];
  const layout = layoutFlow(flow([n("a"), n("b")], edges));
  const lanes = Math.max(...layout.edges.flatMap((edge) => edge.points.map((point) => point.x)));
  assert.equal(lanes, 678 + 3 * 16, "three right lanes");
  assert.ok(layout.width > lanes + 14, `the canvas grew past the lanes: ${layout.width}`);
  assert.equal(layout.width, Math.max(...layout.edges.flatMap((edge) => (edge.label === undefined ? [] : [labelRect(edge.label).right]))));
  assert.deepEqual(layout.warnings, []);
  assertLabels("grow", "test", layout);
});

test("labels move away from a node and from another label", () => {
  const layout = layoutFlow(FAN);
  const byText = (text: string) => layout.edges.find((edge) => edge.label?.text === text);
  const q = layout.nodes.find((node) => node.id === "q");
  const transient = byText("transient failure");
  const owner = byText("blocked on owner");
  const approved = byText("approved");
  assert.ok(q && transient?.label && owner?.label && approved?.label);
  const [t1, t2] = transient.points;
  assert.ok(t1 && t2);
  const first = labelRect({ text: "transient failure", x: transient.points[2] ? (t2.x + (transient.points[2] as { x: number }).x) / 2 : 0, y: t2.y - 5, anchor: "middle" });
  assert.ok(hits(first, { left: q.x, right: q.x + q.w, top: q.y, bottom: q.y + q.h }), "the first place overlaps q");
  assert.ok(!hits(labelRect(transient.label), { left: q.x, right: q.x + q.w, top: q.y, bottom: q.y + q.h }), "the label moved off q");
  const [a1, a2, a3] = approved.points;
  assert.ok(a1 && a2 && a3);
  const firstApproved = labelRect({ text: "approved", x: (a2.x + a3.x) / 2, y: a2.y - 5, anchor: "middle" });
  assert.ok(hits(firstApproved, labelRect(owner.label)), "the first place overlaps the other label");
  assert.ok(!hits(labelRect(approved.label), labelRect(owner.label)), "the label moved off the other label");
  assert.equal(approved.label.y, a2.y - 5, "the label stays on its own horizontal run");
  assert.deepEqual(layout.warnings, []);
});

test("eight labeled edges between the same two nodes overlap no other label without a warning", () => {
  const layout = layoutFlow(DUPLICATES);
  assert.equal(layout.edges.filter((edge) => edge.label !== undefined).length, 8);
  assertLabels("duplicates", "test", layout);
  const boxes = layout.edges.map((edge) => labelRect(edge.label as EdgeLabel));
  const stacked = boxes.filter((box, i) => boxes.some((other, j) => j !== i && hits(box, other)));
  assert.ok(stacked.length === 0 || layout.warnings.some((warning) => warning.includes("overlaps another label")));
});

test("label placement is deterministic", () => {
  for (const [name, block] of FIXTURES) assert.deepEqual(layoutFlow(block), layoutFlow(structuredClone(block)), name);
});

test("a self-loop leaves the bottom, runs through the right lane, and comes back into the node", () => {
  const layout = layoutFlow(flow([n("a"), n("b")], [["a", "b"], ["b", "b"]]));
  const loop = layout.edges.find((edge) => edge.from === "b" && edge.to === "b");
  const b = layout.nodes.find((node) => node.id === "b");
  assert.ok(loop && b);
  assert.equal(loop.route, "right-lane");
  assert.deepEqual(loop.points[0], { x: b.cx, y: b.y + b.h });
  const lane = Math.max(...loop.points.map((point) => point.x));
  assert.ok(lane > b.x + b.w, "the lane is right of the node");
  assert.ok(lane < layout.width, "the canvas holds the lane");
  const last = loop.points.at(-1);
  assert.deepEqual(last, { x: b.x + b.w + 1, y: b.cy });
});

test("a word longer than the line breaks after a slash, else after - _ or ., else at the width", () => {
  assert.deepEqual(wrapWords("skills/omt-plan/SKILL.md", 15), ["skills/", "omt-plan/", "SKILL.md"]);
  assert.deepEqual(wrapWords("Edit plan-review_notes.md now", 10), ["Edit", "plan-", "review_", "notes.md", "now"]);
  assert.deepEqual(wrapWords("abcdefghijklmnopqrstuvwxy", 10), ["abcdefghij", "klmnopqrst", "uvwxy"]);
  assert.deepEqual(wrapWords("a b", 10), ["a b"]);
  const nodes = [n("r"), ...Array.from({ length: 5 }, (_, i) => n(`n${i}`, { label: "Edit the skill", sub: "skills/omt-plan/SKILL.md" }))];
  const layout = layoutFlow(flow(nodes, nodes.slice(1).map((node): [string, string] => ["r", node.id])));
  const node = layout.nodes[1];
  assert.ok(node);
  assert.equal(node.w, 122);
  assert.deepEqual(node.subLines, ["skills/", "omt-plan/", "SKILL.md"]);
  for (const line of node.subLines) assert.ok(line.length * 6.3 <= node.w - 22, line);
  const label = layoutFlow(flow(nodes.map((each) => ({ ...each, label: "skills/omt/references/roles/plan-review.md" })), []));
  for (const line of label.nodes[0]?.lines ?? []) assert.ok(line.length * 7.1 <= 122 - 22, line);
});

test("a tone swatch in the legend uses the kind of the first node with that tone", () => {
  const legend = renderLegend(flow([n("a", { kind: "task", tone: "open" }), n("b", { tone: "done" }), n("c", { kind: "task", tone: "done" })], []));
  assert.match(legend, /<rect class="nd task open"[^>]*\/><rect class="taskbar open"[^>]*\/><\/svg>open<\/span>/);
  assert.match(legend, /<rect class="nd step done"[^>]*\/><\/svg>done<\/span>/);
});
