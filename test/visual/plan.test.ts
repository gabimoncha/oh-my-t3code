import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutFlow, segmentCrossesBox } from "../../src/visual/flow.ts";
import { mergeSpec, planSections, reduceDependencies } from "../../src/visual/plan.ts";
import type { Block, FlowBlock } from "../../src/visual/spec.ts";
import { WORKFLOW_PROFILES_PLAN } from "./fixtures.ts";
import { sharedLines } from "./geometry.ts";

function flowOf(blocks: Block[] | undefined): FlowBlock {
  const flow = blocks?.find((block) => block.type === "flow");
  assert.ok(flow?.type === "flow");
  return flow;
}

test("the workflow-profiles plan has 6 layers and the reduced dependency edges", () => {
  const page = planSections(WORKFLOW_PROFILES_PLAN, "wp-fixture");
  assert.deepEqual(page.warnings, []);
  assert.equal(page.title, "Workflow profiles fixture");
  assert.equal(page.subtitle, "plan wp-fixture · 10 units in 6 layers · 0/10 done · budget 70 tasks");
  assert.deepEqual(page.tabs.map((tab) => tab.title), ["Summary", "Units", "Checks"]);
  const flow = flowOf(page.tabs[1]?.blocks);
  assert.equal(flow.title, "Units by dependency layer");
  const layout = layoutFlow(flow);
  const rows = new Map<number, string[]>();
  for (const node of layout.nodes) rows.set(node.row, [...(rows.get(node.row) ?? []), node.id]);
  assert.deepEqual([...rows.entries()].sort(([a], [b]) => a - b).map(([, ids]) => ids), [["U1"], ["U2"], ["U3", "U6"], ["U4", "U5"], ["U7", "U8", "U10"], ["U9"]]);
  assert.deepEqual(
    flow.edges.map((edge) => `${edge.from}->${edge.to}`),
    ["U1->U2", "U2->U3", "U3->U4", "U3->U5", "U2->U6", "U4->U7", "U5->U7", "U6->U7", "U5->U8", "U6->U8", "U7->U9", "U8->U9", "U10->U9", "U4->U10", "U5->U10", "U6->U10"],
  );
  for (const edge of layout.edges) {
    for (const segment of edge.segments) {
      for (const node of layout.nodes) {
        if (node.id !== edge.from && node.id !== edge.to) assert.ok(!segmentCrossesBox(segment, node, 4), `${edge.from}->${edge.to} crosses ${node.id}`);
      }
    }
  }
  assert.deepEqual(sharedLines(layout), [], "U3 -> U5 and the edges out of U6 meet U5 and U6 at the same x");
  const u1 = flow.nodes[0];
  assert.deepEqual(u1, { id: "U1", label: "U1 Split the skills test file by owner", kind: "task", tone: "open", sub: "quick" });
});

test("the summary tab holds the summary text and the cards; the checks tab holds both checklists", () => {
  const page = planSections(WORKFLOW_PROFILES_PLAN, "wp-fixture");
  const [text, cards] = page.tabs[0]?.blocks ?? [];
  assert.deepEqual(text, { type: "text", text: "Profiles change the steps of a run.\n\n- Three presets: normal, prototype, pr-review.\n- A lock for shared builds." });
  assert.ok(cards?.type === "cards");
  assert.deepEqual(
    cards.cards.map((card) => [card.title, card.value, card.text]),
    [
      ["Units", "10", "6 dependency layers"],
      ["Done", "0/10", "0 blocked"],
      ["Checks", "3", "2 done-when, 1 final"],
      ["Budget", "70", "tasks"],
    ],
  );
  const table = page.tabs[1]?.blocks[1];
  assert.ok(table?.type === "table");
  assert.deepEqual(table.columns, ["Unit", "Title", "Role", "Depends on", "State"]);
  assert.deepEqual(table.rows[6], ["U7", "Conductor skills: profile switches, verify and qa steps, check-ins, and dispatch", "writing", "U1, U3, U4, U5, U6", "open"]);
  const checks = page.tabs[2]?.blocks ?? [];
  assert.deepEqual(
    checks.map((block) => (block.type === "checklist" ? [block.title, block.items] : [])),
    [
      ["Done when", [{ text: "D1. Profiles resolve", state: "done" }, { text: "D2. The lock works", state: "blocked" }]],
      ["Final verification", [{ text: "F1. The full suite passes: `pnpm check`", state: "open" }]],
    ],
  );
});

test("non-unit dependency tokens stay in the table, and a U<n> that names no unit warns", () => {
  const plan = `# Mira

<!-- omt-plan v1 slug=mira created=2026-01-01T00:00:00.000Z -->

## Objective

Ship Mira.

## Units

- [x] U1. Model
  - Role: execute
  - Depends on: DS1 (approved design spec)
- [~] U2. Store
  - Depends on: U1, C1, U0
- [ ] U3. View
  - Depends on: U2 and U1

## Final verification

- [ ] F1. Done
`;
  const page = planSections(plan, "mira");
  assert.deepEqual(page.warnings, ["U2 depends on U0, which is not a unit of the plan", "plan has no ## Summary; showing ## Objective"]);
  assert.deepEqual(page.tabs[0]?.blocks[0], { type: "text", text: "Ship Mira." });
  const flow = flowOf(page.tabs[1]?.blocks);
  assert.deepEqual(flow.edges, [{ from: "U1", to: "U2" }, { from: "U2", to: "U3" }]);
  assert.deepEqual(flow.nodes.map((node) => node.tone), ["done", "blocked", "open"]);
  const table = page.tabs[1]?.blocks[1];
  assert.ok(table?.type === "table");
  assert.deepEqual(table.rows.map((row) => row[3]), ["DS1 (approved design spec)", "U1, C1, U0", "U2 and U1"]);
  assert.equal(page.subtitle, "plan mira · 3 units in 3 layers · 1/3 done");
  assert.equal(page.tabs[0]?.blocks[1]?.type === "cards" ? page.tabs[0].blocks[1].cards.length : 0, 3);
});

test("a dependency cycle gives a warning, and the page still builds", () => {
  const plan = "# C\n\n## Summary\n\nx\n\n## Units\n\n- [ ] U1. A\n  - Depends on: U2\n- [ ] U2. B\n  - Depends on: U1\n";
  const page = planSections(plan, "c");
  assert.ok(page.warnings.some((warning) => warning.startsWith("the unit dependencies form a cycle")));
  const layout = layoutFlow(flowOf(page.tabs[1]?.blocks));
  assert.equal(layout.edges.filter((edge) => edge.back).length, 1);
});

test("reduceDependencies drops implied edges", () => {
  const deps = new Map([
    ["A", []],
    ["B", ["A"]],
    ["C", ["A", "B"]],
    ["D", ["A", "B", "C"]],
  ]);
  assert.deepEqual(reduceDependencies(["A", "B", "C", "D"], deps), [{ from: "A", to: "B" }, { from: "B", to: "C" }, { from: "C", to: "D" }]);
});

test("mergeSpec appends spec tabs and adds blocks to a built tab of the same title", () => {
  const base = planSections(WORKFLOW_PROFILES_PLAN, "wp-fixture");
  const merged = mergeSpec(base, {
    tabs: [
      { title: "Design", blocks: [{ type: "text", text: "d" }] },
      { title: "Summary", blocks: [{ type: "code", text: "x" }] },
    ],
  });
  assert.equal(merged.title, base.title);
  assert.equal(merged.subtitle, base.subtitle);
  assert.deepEqual(merged.tabs.map((tab) => tab.title), ["Summary", "Units", "Checks", "Design"]);
  assert.deepEqual(merged.tabs[0]?.blocks.at(-1), { type: "code", text: "x" });
  assert.equal(base.tabs[0]?.blocks.length, 2);
  assert.equal(mergeSpec(base, { title: "Own", subtitle: "", tabs: [] }).title, "Own");
});

test("a fence closes only on the same character with at least the opening length", () => {
  const plan = [
    "# P",
    "",
    "## Objective",
    "",
    "Obj.",
    "",
    "## Design",
    "",
    "````md",
    "Example:",
    "```",
    "## Summary",
    "",
    "fake",
    "```",
    "~~~",
    "````",
    "",
    "## Units",
    "",
    "- [ ] U1. A",
    "",
  ].join("\n");
  const page = planSections(plan, "p");
  assert.deepEqual(page.warnings, ["plan has no ## Summary; showing ## Objective"]);
  assert.deepEqual(page.tabs[0]?.blocks[0], { type: "text", text: "Obj." });
  assert.deepEqual(flowOf(page.tabs[1]?.blocks).nodes.map((node) => node.id), ["U1"]);
});

test("checkbox examples inside fences are not units or checks", () => {
  const plan = [
    "# P",
    "",
    "## Summary",
    "",
    "S.",
    "",
    "~~~~md",
    "- [ ] U99. Example unit",
    "  - Depends on: U1",
    "- [ ] D99. Example check",
    "~~~~",
    "",
    "## Units",
    "",
    "- [ ] U1. A",
    "",
    "## Done when",
    "",
    "- [ ] D1. Real",
    "",
  ].join("\n");
  const page = planSections(plan, "p");
  assert.deepEqual(page.warnings, []);
  assert.deepEqual(flowOf(page.tabs[1]?.blocks).nodes.map((node) => node.id), ["U1"]);
  const checks = page.tabs[2]?.blocks[0];
  assert.ok(checks?.type === "checklist");
  assert.deepEqual(checks.items, [{ text: "D1. Real", state: "open" }]);
  assert.equal(page.subtitle, "plan p · 1 units in 1 layers · 0/1 done");
  assert.match(page.tabs[0]?.blocks[0]?.type === "text" ? page.tabs[0].blocks[0].text : "", /U99\. Example unit/, "the summary keeps the fenced text");
});

test("a column-0 fence inside a unit does not end the unit's fields", () => {
  const plan = "# P\n\n## Summary\n\nS\n\n## Units\n\n- [ ] U1. A\n  - Depends on: none\n- [ ] U2. B\n  - Verify:\n```sh\n# run the build\nmake\n```\n  - Depends on: U1\n";
  const page = planSections(plan, "p");
  assert.deepEqual(flowOf(page.tabs[1]?.blocks).edges, [{ from: "U1", to: "U2" }]);
  assert.deepEqual(page.warnings, []);
});

test("a unit that depends on itself warns, and the edge is dropped", () => {
  const page = planSections("# P\n\n## Summary\n\nx\n\n## Units\n\n- [ ] U1. A\n- [ ] U2. B\n  - Depends on: U1, U2\n", "p");
  assert.deepEqual(page.warnings, ["U2 depends on itself"]);
  assert.deepEqual(flowOf(page.tabs[1]?.blocks).edges, [{ from: "U1", to: "U2" }]);
});

test("a CRLF plan gives the same page as the LF plan", () => {
  const crlf = planSections(WORKFLOW_PROFILES_PLAN.replace(/\n/g, "\r\n"), "wp-fixture");
  assert.deepEqual(crlf, planSections(WORKFLOW_PROFILES_PLAN, "wp-fixture"));
});
