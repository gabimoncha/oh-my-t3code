# Page spec

`omt visual --spec` reads one JSON object. Fields are optional unless marked required.

## Page

| Field | Value |
| --- | --- |
| `title` | 1 to 200 characters. Default: the plan title, or `omt`. |
| `subtitle` | 0 to 300 characters. Default: the plan slug, unit counts, and budget. |
| `tabs` | 0 to 8 tabs. Without `--plan`, at least 1. |

A tab is `{ "title": <1 to 40 characters, required>, "blocks": [<1 to 40 blocks, required>] }`. A tab with the same title as a built plan tab (`Summary`, `Units`, `Checks`) adds its blocks to the end of that tab. The other tabs follow the built tabs in spec order.

## Blocks

Each block has a required `type`.

| `type` | Fields | Use it for |
| --- | --- | --- |
| `text` | `text` (required) | Paragraphs, split on blank lines. Lines that start with `- ` make a bullet list, and `1. ` a numbered list. |
| `cards` | `cards`: 1 to 6 of `{ title (required), value, text, tone }` | Numbers and states at a glance: units, budget, verdicts. |
| `table` | `title`, `columns` (1 to 8, required), `rows` (0 to 80 arrays of strings, required), `nowrap` (column indexes) | Decisions, options, mappings. Put short code columns in `nowrap`. |
| `checklist` | `title`, `items`: `{ text (required), state }`, where `state` is `done`, `open` (default), or `blocked` | Checks and their state. |
| `callout` | `tone`, `title`, `text` (required) | One risk, one open decision, or one warning. |
| `code` | `text` (required) | A command or a config snippet. |
| `flow` | `title` (required), `description`, `nodes` (1 to 60, required), `edges` (required) | A process, a protocol, or a state machine. |

`tone` is `info`, `ok`, `warn`, `bad`, or `muted` (default).

In `text`, card `text`, table cells, checklist items, and callout `text`, `` `code` `` and `**bold**` work. A link `[text](url)` shows its text only. All other markup shows as written.

## Flows

A node is `{ "id": <letters, digits, _ or ->, "label": <required>, "sub", "kind", "tone", "badge", "row", "col" }`.

- `kind`: `step` (default), `task` (work that a child task does), `decision` (a question with labeled out-edges), `start`, `end`, or `stop` (the run waits for the owner).
- `tone`: `done`, `open`, or `blocked`, for status flows such as units.
- `badge`: a short tag at the top right, such as `new` or `changed`.
- `sub`: a second line in small mono text, for a command, a file, or a setting.

An edge is `{ "from": <id>, "to": <id>, "label", "dashed" }`. Keep a label to 24 characters, such as `yes`, `no`, or `on failure`. Use `dashed` for an optional path.

The layout places each node one row below its lowest predecessor and keeps the node order of the spec inside a row. An edge to an earlier row draws as a loop. Without `col`, each row is centered. Give a side branch, such as a fix step beside the check that sends work to it, the `row` of that check and `col` 1. Then every row stays on the grid, and the main path stays in column 0. Labels wrap to the node width, which shrinks as a row gets more nodes, and are cut after 4 lines.

## Example

A `Design` tab with one flow and one decision table:

```json
{
  "tabs": [
    {
      "title": "Design",
      "blocks": [
        {
          "type": "flow",
          "title": "How a unit gets verified",
          "description": "A worker builds the unit, a reviewer of the other family checks it, and a verify task runs the app. A failed check goes to a fix task and back to review.",
          "nodes": [
            { "id": "work", "label": "Worker builds the unit", "kind": "task", "sub": "execute" },
            { "id": "review", "label": "Review by the other family", "kind": "task" },
            { "id": "ok", "label": "Review approves?", "kind": "decision" },
            { "id": "fix", "label": "Fix task", "kind": "task", "row": 2, "col": 1 },
            { "id": "verify", "label": "verify runs the app", "kind": "task", "badge": "new", "sub": "omt brief verify" },
            { "id": "done", "label": "Unit done", "kind": "end" }
          ],
          "edges": [
            { "from": "work", "to": "review" },
            { "from": "review", "to": "ok" },
            { "from": "ok", "to": "verify", "label": "yes" },
            { "from": "ok", "to": "fix", "label": "no" },
            { "from": "fix", "to": "review" },
            { "from": "verify", "to": "done" }
          ]
        },
        {
          "type": "table",
          "title": "Owner decisions",
          "columns": ["Decision", "Answer", "By"],
          "rows": [["Who clears a stale lock", "The conductor, after it checks that the owner process is gone", "owner"]]
        }
      ]
    }
  ]
}
```
