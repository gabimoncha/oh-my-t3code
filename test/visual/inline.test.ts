import { test } from "bun:test";
import assert from "node:assert/strict";
import { escapeHtml, inlineHtml, plainText } from "../../src/visual/inline.ts";

test("escapeHtml escapes the five HTML characters", () => {
  assert.equal(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`), "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;");
});

test("inlineHtml renders code, bold, and link text, and escapes the rest", () => {
  assert.equal(inlineHtml("run `omt <x>` now"), "run <code>omt &lt;x&gt;</code> now");
  assert.equal(inlineHtml("a **bold & `code`** b"), "a <strong>bold &amp; <code>code</code></strong> b");
  assert.equal(inlineHtml("see [the docs](https://example.com/a?b=1) & more"), "see the docs &amp; more");
  assert.equal(inlineHtml("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(inlineHtml("a * b ** c ` d"), "a * b ** c ` d");
});

test("plainText removes backticks and collapses spaces", () => {
  assert.equal(plainText("Renderer and `omt  visual`\n"), "Renderer and omt visual");
});

test("inline delimiters do not rescan overlapping suffixes", () => {
  const brackets = "[".repeat(200_000);
  assert.equal(inlineHtml(brackets), brackets);
  const targets = "[x](".repeat(30_000);
  assert.equal(inlineHtml(targets), targets);
  assert.equal(inlineHtml("[a[b](url) **ok**"), "a[b <strong>ok</strong>");
});
