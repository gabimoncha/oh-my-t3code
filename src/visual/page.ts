import { renderFlow, renderLegend } from "./flow.ts";
import { escapeHtml, inlineHtml } from "./inline.ts";
import type { Block, CalloutBlock, CardsBlock, ChecklistBlock, PageSpec, TableBlock } from "./spec.ts";

const CSS = `:root{--o-fg:var(--foreground,#1b1f24);--o-bg:var(--background,#fff);--o-mut:var(--muted-foreground,#59636e);--o-bd:var(--border,#d0d7de);
--o-acc:var(--info,#0969da);--o-ok:var(--success,#1a7f37);--o-wn:var(--warning,#9a6700);--o-wns:var(--warning-surface,#fff8c5);--o-bad:var(--destructive,#cf222e);
--o-code:var(--code-background,#f2f4f6);--o-sans:var(--font-sans,system-ui,-apple-system,"Segoe UI",sans-serif);--o-mono:var(--font-mono,ui-monospace,Menlo,monospace);
--o-r:var(--radius,8px)}
@media (prefers-color-scheme:dark){:root{--o-fg:var(--foreground,#e6edf3);--o-bg:var(--background,#0f1419);--o-mut:var(--muted-foreground,#9aa5b1);--o-bd:var(--border,#3a434d);
--o-acc:var(--info,#4493f8);--o-ok:var(--success,#3fb950);--o-wn:var(--warning,#d29922);--o-wns:var(--warning-surface,#2f2509);--o-bad:var(--destructive,#f85149);--o-code:var(--code-background,#1b222a)}}
html{color-scheme:light dark;background:var(--background,Canvas)}
body{margin:0;color:var(--o-fg);font:15px/1.55 var(--o-sans)}
.wrap{max-width:100%}
h2{font-size:19px;margin:6px 0 4px}h3{font-size:16px;margin:22px 0 6px}h4{margin:0 0 4px;font-size:14px}
p,li{margin:6px 0}code{font-family:var(--o-mono);font-size:12.5px;background:var(--o-code);padding:1px 4px;border-radius:4px;overflow-wrap:anywhere}
pre{background:var(--o-code);padding:12px 14px;border-radius:var(--o-r);overflow-x:auto;font-size:12.5px;line-height:1.45}pre code{padding:0;background:none}
.note{color:var(--o-mut);font-size:13.5px}
.tabs{display:flex;flex-wrap:wrap;gap:4px;border-bottom:1px solid var(--o-bd);margin-bottom:12px}
.tabs button{font:600 13.5px var(--o-sans);color:var(--o-mut);background:none;border:0;border-bottom:2px solid transparent;padding:8px 10px;cursor:pointer}
.tabs button[aria-selected=true]{color:var(--o-fg);border-bottom-color:var(--o-acc)}
.tabs button:focus-visible{outline:2px solid var(--o-acc);outline-offset:2px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:12px 0}
.cardx{border:1px solid var(--o-bd);border-radius:var(--o-r);padding:12px 14px 8px;border-top:3px solid var(--o-mut)}
.cardx.ok{border-top-color:var(--o-ok)}.cardx.info{border-top-color:var(--o-acc)}.cardx.warn{border-top-color:var(--o-wn)}.cardx.bad{border-top-color:var(--o-bad)}
.cardx .v{margin:0;font-size:22px;font-weight:700;font-variant-numeric:tabular-nums}.cardx .k{margin:0;color:var(--o-mut);font-size:12.5px}
.tw{overflow-x:auto;margin:8px 0}table{border-collapse:collapse;width:100%;font-size:13.5px;hyphens:none}
th,td{text-align:left;vertical-align:top;padding:6px 8px;border-bottom:1px solid var(--o-bd)}th{font-weight:600;color:var(--o-mut);font-size:12.5px}
td.nw,th.nw{white-space:nowrap}td.nw code{overflow-wrap:normal}
.figwrap{overflow-x:auto;margin:8px 0}
svg.flow{display:block;width:100%;height:auto;min-width:520px}
svg .t{font:600 12.5px var(--o-sans);fill:var(--o-fg)}
svg .m{font:10.5px var(--o-mono);fill:var(--o-mut);white-space:pre}
svg .el{font:600 11px var(--o-sans);fill:var(--o-mut);paint-order:stroke;stroke:var(--o-bg);stroke-width:4px;stroke-linejoin:round}
svg .badge{font:700 9.5px var(--o-sans);fill:var(--o-acc);letter-spacing:.04em;text-transform:uppercase}
svg .badge.done{fill:var(--o-ok)}svg .badge.blocked{fill:var(--o-bad)}
svg .ln{fill:none;stroke:var(--o-mut);stroke-width:1.4} svg .ln.dash{stroke-dasharray:5 4} svg .ah{fill:var(--o-mut)}
svg .nd{stroke:var(--o-bd);stroke-width:1.2;fill:color-mix(in oklab,var(--o-fg) 4%,var(--o-bg))}
svg .nd.task{fill:color-mix(in oklab,var(--o-acc) 7%,var(--o-bg));stroke:color-mix(in oklab,var(--o-acc) 45%,var(--o-bd))}
svg .taskbar{fill:var(--o-acc)}
svg .nd.decision{fill:color-mix(in oklab,var(--o-fg) 8%,var(--o-bg))}
svg .nd.stop{fill:var(--o-wns);stroke:var(--o-wn)}
svg .nd.start,svg .nd.end{fill:color-mix(in oklab,var(--o-fg) 12%,var(--o-bg));stroke:none}
svg .nd.done{fill:color-mix(in oklab,var(--o-ok) 10%,var(--o-bg));stroke:var(--o-ok)}
svg .nd.blocked{fill:color-mix(in oklab,var(--o-bad) 9%,var(--o-bg));stroke:var(--o-bad);stroke-dasharray:5 3}
svg .taskbar.done{fill:var(--o-ok)}svg .taskbar.blocked{fill:var(--o-bad)}
.callout{border-left:3px solid var(--o-mut);padding:6px 12px;margin:12px 0;border-radius:4px;font-size:14px;background:color-mix(in oklab,var(--o-fg) 4%,var(--o-bg))}
.callout.info{border-left-color:var(--o-acc);background:color-mix(in oklab,var(--o-acc) 6%,var(--o-bg))}
.callout.ok{border-left-color:var(--o-ok);background:color-mix(in oklab,var(--o-ok) 8%,var(--o-bg))}
.callout.warn{border-left-color:var(--o-wn);background:var(--o-wns)}
.callout.bad{border-left-color:var(--o-bad);background:color-mix(in oklab,var(--o-bad) 8%,var(--o-bg))}
.callout h4{margin-top:4px}
ul.todo{list-style:none;padding-left:0}ul.todo li{padding-left:24px;position:relative}
ul.todo li::before{content:"";position:absolute;left:2px;top:4px;width:12px;height:12px;border:1.5px solid var(--o-mut);border-radius:3px}
ul.todo li.dn{color:var(--o-mut)}ul.todo li.dn::before{background:var(--o-ok);border-color:var(--o-ok)}
ul.todo li.bl::before{background:var(--o-wns);border-color:var(--o-wn)}
ul.todo li.bl::after{content:"";position:absolute;left:5.5px;top:10.5px;width:8px;height:2px;background:var(--o-wn)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12.5px;color:var(--o-mut)}
.legend svg{vertical-align:-3px;margin-right:5px}
.legend svg .nd:not(.task):not(.stop):not(.done):not(.blocked){stroke:var(--o-mut);stroke-width:1.2}`;

const SCRIPT = `(function(){
  var btns=[].slice.call(document.querySelectorAll('.tabs button'));
  if(!btns.length)return;
  function show(id){btns.forEach(function(b){var on=b.getAttribute('data-tab')===id;b.setAttribute('aria-selected',on);document.getElementById(b.getAttribute('data-tab')).hidden=!on;});}
  btns.forEach(function(b){b.addEventListener('click',function(){show(b.getAttribute('data-tab'));});});
  show(btns[0].getAttribute('data-tab'));
})();`;

const BULLET_RE = /^[-*] /;
const NUMBER_RE = /^\d+\. /;

function paragraphHtml(paragraph: string): string {
  const out: string[] = [];
  let text: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | undefined;
  const flushText = () => {
    if (text.length > 0) out.push(`<p>${inlineHtml(text.join(" "))}</p>`);
    text = [];
  };
  const flushList = () => {
    if (list !== undefined) out.push(`<${list.tag}>${list.items.map((item) => `<li>${inlineHtml(item)}</li>`).join("")}</${list.tag}>`);
    list = undefined;
  };
  for (const line of paragraph.split("\n")) {
    const tag = BULLET_RE.test(line) ? "ul" : NUMBER_RE.test(line) ? "ol" : undefined;
    if (tag !== undefined) {
      flushText();
      if (list !== undefined && list.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push(line.replace(tag === "ul" ? BULLET_RE : NUMBER_RE, "").trim());
    } else if (list !== undefined && line.startsWith("  ") && list.items.length > 0) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      flushList();
      text.push(line.trim());
    }
  }
  flushText();
  flushList();
  return out.join("\n");
}

export function textHtml(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.replace(/^\n+|\n+$/g, ""))
    .filter((paragraph) => paragraph.trim() !== "")
    .map(paragraphHtml)
    .join("\n");
}

function cardsHtml(block: CardsBlock): string {
  const cards = block.cards.map((card) => {
    let out = `<div class="cardx ${card.tone ?? "muted"}"><h4>${escapeHtml(card.title)}</h4>`;
    if (card.value !== undefined && card.value !== "") out += `<p class="v">${escapeHtml(card.value)}</p>`;
    if (card.text !== undefined && card.text !== "") out += `<p class="k">${inlineHtml(card.text)}</p>`;
    return `${out}</div>`;
  });
  return `<div class="cards">${cards.join("")}</div>`;
}

function tableHtml(block: TableBlock): string {
  const nowrap = new Set(block.nowrap ?? []);
  const cls = (index: number) => (nowrap.has(index) ? ' class="nw"' : "");
  const head = block.columns.map((column, index) => `<th${cls(index)}>${escapeHtml(column)}</th>`).join("");
  const body = block.rows
    .map((row) => `<tr>${block.columns.map((_, index) => `<td${cls(index)}>${inlineHtml(row[index] ?? "")}</td>`).join("")}</tr>`)
    .join("\n");
  const title = block.title === undefined || block.title === "" ? "" : `<h3>${escapeHtml(block.title)}</h3>`;
  return `${title}<div class="tw"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

const STATE_CLASS = { done: ' class="dn"', blocked: ' class="bl"', open: "" } as const;

function checklistHtml(block: ChecklistBlock): string {
  const items = block.items.map((item) => {
    const state = item.state ?? "open";
    return `<li${STATE_CLASS[state]}><span class="sr">${state}: </span>${inlineHtml(item.text)}</li>`;
  });
  const title = block.title === undefined || block.title === "" ? "" : `<h3>${escapeHtml(block.title)}</h3>`;
  return `${title}<ul class="todo">${items.join("")}</ul>`;
}

function calloutHtml(block: CalloutBlock): string {
  const title = block.title === undefined || block.title === "" ? "" : `<h4>${escapeHtml(block.title)}</h4>`;
  return `<div class="callout ${block.tone ?? "muted"}">${title}${textHtml(block.text)}</div>`;
}

function blockHtml(block: Block, id: string, warnings: string[]): string {
  switch (block.type) {
    case "text":
      return textHtml(block.text);
    case "cards":
      return cardsHtml(block);
    case "table":
      return tableHtml(block);
    case "checklist":
      return checklistHtml(block);
    case "callout":
      return calloutHtml(block);
    case "code":
      return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
    case "flow": {
      const flow = renderFlow(block, id);
      warnings.push(...flow.warnings);
      return `<h3>${escapeHtml(block.title)}</h3>\n<div class="figwrap">${flow.svg}</div>\n${renderLegend(block)}`;
    }
  }
}

export function renderPage(spec: PageSpec): { html: string; warnings: string[] } {
  const warnings: string[] = [];
  const title = spec.title ?? "omt";
  const body: string[] = [`<h2>${escapeHtml(title)}</h2>`];
  if (spec.subtitle !== undefined && spec.subtitle !== "") body.push(`<p class="note">${escapeHtml(spec.subtitle)}</p>`);
  const panels = spec.tabs.map((tab, tabIndex) =>
    tab.blocks.map((block, blockIndex) => blockHtml(block, `f${tabIndex + 1}-${blockIndex + 1}`, warnings)).join("\n"),
  );
  if (spec.tabs.length > 1) {
    const buttons = spec.tabs.map(
      (tab, index) => `<button role="tab" id="b${index + 1}" data-tab="t${index + 1}" aria-controls="t${index + 1}" aria-selected="${index === 0}">${escapeHtml(tab.title)}</button>`,
    );
    body.push(`<div class="tabs" role="tablist" aria-label="Page sections">\n${buttons.join("\n")}\n</div>`);
    panels.forEach((panel, index) => {
      body.push(`<section class="panel" id="t${index + 1}" role="tabpanel" aria-labelledby="b${index + 1}">\n${panel}\n</section>`);
    });
  } else {
    for (const panel of panels) body.push(`<section class="panel">\n${panel}\n</section>`);
  }
  const html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>\n${CSS}\n</style></head><body><div class="wrap">`,
    ...body,
    `</div>\n<script>\n${SCRIPT}\n</script></body></html>\n`,
  ].join("\n");
  return { html, warnings };
}
