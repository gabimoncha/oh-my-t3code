import { test } from "bun:test";
import assert from "node:assert/strict";
import { validateSpec } from "../../src/visual/spec.ts";
import { OmtError } from "../../src/util/errors.ts";

function problems(value: unknown): string[] {
  try {
    validateSpec(value);
  } catch (error) {
    assert.ok(error instanceof OmtError);
    assert.equal(error.exitCode, 2);
    return error.message.split("\n").slice(1).map((line) => line.trim());
  }
  assert.fail("expected validateSpec to throw");
}

test("validateSpec accepts a full spec and fills no defaults", () => {
  const { spec, warnings } = validateSpec({
    title: "Page",
    subtitle: "",
    tabs: [
      {
        title: "One",
        blocks: [
          { type: "text", text: "hello" },
          { type: "cards", cards: [{ title: "A", value: "1", text: "x", tone: "ok" }] },
          { type: "table", title: "T", columns: ["a", "b"], rows: [["1", "2"]], nowrap: [0] },
          { type: "checklist", items: [{ text: "x", state: "blocked" }, { text: "y" }] },
          { type: "callout", tone: "warn", title: "Note", text: "careful" },
          { type: "code", text: "x = 1" },
          {
            type: "flow",
            title: "F",
            nodes: [{ id: "a", label: "A", kind: "decision", tone: "done", badge: "new", row: 0, col: 1 }, { id: "b", label: "B" }],
            edges: [{ from: "a", to: "b", label: "yes", dashed: true }],
          },
        ],
      },
    ],
  });
  assert.deepEqual(warnings, []);
  assert.equal(spec.tabs[0]?.blocks.length, 7);
  assert.equal(spec.title, "Page");
});

test("validateSpec lists every problem with its JSON path", () => {
  const list = problems({
    title: "",
    tabs: [
      { blocks: [] },
      {
        title: "x",
        blocks: [
          { type: "chart" },
          { type: "cards", cards: [{ title: 3, tone: "loud" }] },
          { type: "checklist", items: [{ text: "a", state: "maybe" }] },
          {
            type: "flow",
            title: "F",
            nodes: [{ id: "a", label: "A", kind: "circle", row: -1 }, { id: "a", label: "B" }, { id: "bad id", label: "C" }],
            edges: [{ from: "a", to: "zz" }, { to: "a" }],
          },
          { text: "no type" },
        ],
      },
    ],
  });
  for (const expected of [
    "$.title: must be 1 to 200 characters, got 0",
    "$.tabs[0].blocks: must have 1 to 40 items, got 0",
    "$.tabs[0].title: is required",
    '$.tabs[1].blocks[0].type: unknown type "chart"; use text, cards, table, checklist, callout, code, flow',
    "$.tabs[1].blocks[1].cards[0].title: must be a string",
    '$.tabs[1].blocks[1].cards[0].tone: unknown tone "loud"; use info, ok, warn, bad, muted',
    '$.tabs[1].blocks[2].items[0].state: unknown state "maybe"; use done, open, blocked',
    '$.tabs[1].blocks[3].nodes[0].kind: unknown kind "circle"; use step, task, decision, start, end, stop',
    "$.tabs[1].blocks[3].nodes[0].row: must be an integer from 0 to 60",
    '$.tabs[1].blocks[3].nodes[1].id: duplicate node id "a"',
    "$.tabs[1].blocks[3].nodes[2].id: must match ^[A-Za-z0-9_-]{1,40}$",
    '$.tabs[1].blocks[3].edges[0].to: unknown node "zz"',
    "$.tabs[1].blocks[3].edges[1].from: is required",
    "$.tabs[1].blocks[4].type: is required",
  ]) {
    assert.ok(list.includes(expected), `missing: ${expected}\n${list.join("\n")}`);
  }
});

test("validateSpec reports unknown keys at every level", () => {
  const list = problems({
    extra: 1,
    tabs: [
      {
        title: "x",
        more: true,
        blocks: [
          { type: "text", text: "a", color: "red" },
          { type: "flow", title: "F", nodes: [{ id: "a", label: "A", shape: "box" }], edges: [{ from: "a", to: "a", weight: 2 }] },
        ],
      },
    ],
  });
  assert.deepEqual(list.sort(), [
    "$.extra: unknown key",
    "$.tabs[0].blocks[0].color: unknown key",
    "$.tabs[0].blocks[1].edges[0].weight: unknown key",
    "$.tabs[0].blocks[1].nodes[0].shape: unknown key",
    "$.tabs[0].more: unknown key",
  ]);
});

test("validateSpec rejects a root that is not an object and wrong types", () => {
  assert.deepEqual(problems([]), ["$: must be an object"]);
  assert.deepEqual(problems({ tabs: {} }), ["$.tabs: must be an array"]);
  assert.deepEqual(problems({ tabs: [{ title: "x", blocks: [{ type: "flow", title: "F", nodes: [{ id: "a", label: "A" }], edges: [{ from: "a", to: "a", dashed: "yes" }] }] }] }), [
    "$.tabs[0].blocks[0].edges[0].dashed: must be true or false",
  ]);
});

test("validateSpec warns about a table row with the wrong cell count", () => {
  const { warnings } = validateSpec({ tabs: [{ title: "t", blocks: [{ type: "table", columns: ["a", "b"], rows: [["1"], ["1", "2", "3"], ["1", "2"]] }] }] });
  assert.deepEqual(warnings, [
    "$.tabs[0].blocks[0].rows[0]: has 1 cells, the table has 2 columns; padded",
    "$.tabs[0].blocks[0].rows[1]: has 3 cells, the table has 2 columns; cut",
  ]);
});
