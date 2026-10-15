import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPage, textHtml } from "../../src/visual/page.ts";
import { validateSpec } from "../../src/visual/spec.ts";

const EVIL = "<script>alert(1)</script>";
const QUOTES = `"q" & 'a'`;

// Every text field of the spec format holds the script label.
function evilSpec() {
  return validateSpec({
    title: EVIL,
    subtitle: EVIL,
    tabs: [
      {
        title: EVIL.slice(0, 40),
        blocks: [
          { type: "text", text: `${EVIL} ${QUOTES}` },
          { type: "cards", cards: [{ title: EVIL, value: EVIL.slice(0, 24), text: EVIL, tone: "bad" }] },
          { type: "table", title: EVIL, columns: [EVIL], rows: [[EVIL]] },
          { type: "checklist", title: EVIL, items: [{ text: EVIL, state: "done" }] },
          { type: "callout", tone: "warn", title: EVIL, text: EVIL },
          { type: "code", text: EVIL },
          {
            type: "flow",
            title: EVIL,
            description: EVIL,
            nodes: [{ id: "a", label: EVIL, sub: EVIL, badge: "<b>&'\"" }, { id: "b", label: "B" }],
            edges: [{ from: "a", to: "b", label: EVIL.slice(0, 24) }],
          },
        ],
      },
      { title: "Two", blocks: [{ type: "text", text: "second" }] },
    ],
  }).spec;
}

test("renderPage escapes every text field and loads no resource", () => {
  const { html } = renderPage(evilSpec());
  assert.equal(html.match(/<script>/g)?.length, 1, "only the tab script");
  assert.ok(!html.includes("<script>alert"));
  assert.ok(!html.includes("<b>"));
  const escaped = html.match(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/g)?.length ?? 0;
  // title, h2, subtitle, card title, card text, table title, column, cell, checklist title, item,
  // callout title and text, code, flow h3, svg title, desc, node label, node sub
  assert.ok(escaped >= 18, `escaped ${escaped} times`);
  assert.ok(html.includes("&quot;q&quot; &amp; &#39;a&#39;"));
  assert.ok(html.includes("&lt;b&gt;&amp;&#39;&quot;"));
  assert.ok(!/<link|src=|@import|https?:\/\//i.test(html));
});

test("renderPage writes one document with tabs, panels, and the theme variables", () => {
  const { html } = renderPage(evilSpec());
  assert.match(html, /^<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport"/);
  assert.equal(html.match(/<style>/g)?.length, 1);
  assert.match(html, /<button role="tab" id="b1" data-tab="t1" aria-controls="t1" aria-selected="true">/);
  assert.match(html, /<button role="tab" id="b2" data-tab="t2" aria-controls="t2" aria-selected="false">Two<\/button>/);
  assert.match(html, /<section class="panel" id="t2" role="tabpanel" aria-labelledby="b2">/);
  assert.ok(!html.includes(" hidden"), "panels are hidden only by the script");
  assert.match(html, /--o-fg:var\(--foreground,#1b1f24\)/);
  assert.match(html, /@media \(prefers-color-scheme:dark\)/);
  assert.match(html, /html\{color-scheme:light dark;background:var\(--background,Canvas\)\}/);
  assert.match(html, /<div class="figwrap"><svg class="flow"/);
  assert.match(html, /<div class="legend">/);
});

test("a page with one tab has no tab bar, and a missing title is omt", () => {
  const { html } = renderPage({ tabs: [{ title: "Only", blocks: [{ type: "text", text: "x" }] }] });
  assert.ok(!html.includes('role="tab"'));
  assert.match(html, /<title>omt<\/title>/);
  assert.ok(!html.includes('class="note"'));
});

test("renderPage is deterministic", () => {
  assert.equal(renderPage(evilSpec()).html, renderPage(evilSpec()).html);
});

test("text blocks split paragraphs, bullet lists, numbered lists, and continuation lines", () => {
  assert.equal(
    textHtml("First line\nsecond **bold**.\n\n- one `a`\n  more\n* two\n\n1. x\n2. [y](https://e)\nafter"),
    "<p>First line second <strong>bold</strong>.</p>\n<ul><li>one <code>a</code> more</li><li>two</li></ul>\n<ol><li>x</li><li>y</li></ol>\n<p>after</p>",
  );
});

test("tables pad short rows and cut long rows; checklists mark the state", () => {
  const { spec, warnings } = validateSpec({
    tabs: [
      {
        title: "t",
        blocks: [
          { type: "table", columns: ["a", "b"], rows: [["1"], ["1", "2", "3"]], nowrap: [1] },
          { type: "checklist", items: [{ text: "d", state: "done" }, { text: "b", state: "blocked" }, { text: "o" }] },
        ],
      },
    ],
  });
  assert.equal(warnings.length, 2);
  const { html } = renderPage(spec);
  assert.ok(html.includes('<tr><td>1</td><td class="nw"></td></tr>'));
  assert.ok(html.includes('<tr><td>1</td><td class="nw">2</td></tr>'));
  assert.ok(html.includes('<li class="dn"><span class="sr">done: </span>d</li>'));
  assert.ok(html.includes('<li class="bl"><span class="sr">blocked: </span>b</li>'));
  assert.ok(html.includes('<li><span class="sr">open: </span>o</li>'));
});
