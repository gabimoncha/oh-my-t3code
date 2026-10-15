---
name: omt-show
description: Show a plan, a flow, or a status to the owner as a page in the T3 thread, with flowcharts, tables, and status cards. Use when omt-plan hands off a plan, or when the user asks to see a plan, a flowchart, a diagram, or a status table.
---

# Show

You show the owner a page in the T3 thread. `omt visual` builds the page with a fixed layout, and T3 `html_render` shows it. You pick what goes on the page. T3 draws no flowcharts in chat, so this page is how the owner sees the shape of a plan. T3 tools appear by base name and your harness may prefix them, for example `mcp__t3-code__html_render`.

## Steps

### 1. Write the spec

The page spec is JSON: a title, a subtitle, and tabs of blocks. The format and an example are in [page-spec.md](references/page-spec.md).

For a plan, `omt visual --plan` builds the `Summary`, `Units`, and `Checks` tabs from the plan file. Your spec adds one tab, `Design`, with only what explains the plan's design:

- A `flow` block for each process, protocol, or state machine that the plan adds or changes, up to 3. Draw the flow as it runs after the plan. Give each step that the plan adds the badge `new`, and each step that it changes the badge `changed`.
- A `table` of the owner decisions: the decision, the answer or your recommendation, and who decided.
- A `callout` with tone `warn` for the main risk, and one with tone `info` for each decision still open.

When the design has nothing to add, write no spec and leave out `--spec` in step 2.

For any other page, write every tab: 1 to 4 tabs, with a `cards` block first when the status has numbers.

Use the plain words of a plan summary. Keep a label to 60 characters, and put a command or a file name in the node's `sub`.

Done when: each block of your spec says something that the built tabs do not.

### 2. Build the page

Pipe the spec to the CLI with a quoted heredoc:

```sh
omt visual --plan <slug> --spec - --json <<'EOF'
<spec>
EOF
```

Leave out `--plan` for a page that is not a plan. When the caller gives a plan file instead of a slug, such as the temp plan of omt-plan in `plan` mode, pass that path to `--plan`. In `plan` mode, write no file in the project: add `--out "$TMPDIR/omt-<slug>-page.html"`.

The JSON has `path`, `bytes`, `tabs`, and `warnings`. For each warning that names a block of your spec (a cut label, a moved node, a table row with the wrong cell count), fix the spec and build again. Exit code 2 lists each spec error with its JSON path.

Done when: the build exits 0, and no warning names a block of your spec.

### 3. Show the page

Read the page at `path` in full. Call `html_render` with the exact page text as `html`, the page title as `title`, and `2000` as `height`. T3 fits the frame to the page. `omt visual` already checks the layout, so `html_preview` is not needed.

When the harness has no `html_render`, or the call fails, the page file is the result. Give its path in the reply, and say that the page is not in the thread. When omt-plan called this skill, tell it that the page is not in the thread, so that its reply holds the summary.

Done when: `html_render` returned without an error, or the reply names the page path.

### 4. Reply

The owner sees the page above your reply. The reply adds only what the page does not say. When omt-plan called this skill, return to its step 5, which writes the reply. Otherwise name what the owner should look at first and what needs an answer.

Done when: the reply holds nothing that the page already shows.
