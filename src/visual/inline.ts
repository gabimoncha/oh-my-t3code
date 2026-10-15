const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

const INLINE_RE = /`([^`\n]+)`|\*\*(.+?)\*\*|\[([^\]\n]+)\]\(([^)\s]*)\)/g;

// Renders `code`, **bold**, and [text](url) as HTML; a link keeps only its text, so the page loads no URL.
export function inlineHtml(text: string): string {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(INLINE_RE)) {
    const index = match.index;
    out += escapeHtml(text.slice(last, index));
    const [whole, code, bold, link] = match;
    if (code !== undefined) out += `<code>${escapeHtml(code)}</code>`;
    else if (bold !== undefined) out += `<strong>${inlineHtml(bold)}</strong>`;
    else if (link !== undefined) out += inlineHtml(link);
    last = index + whole.length;
  }
  return out + escapeHtml(text.slice(last));
}

// Text for SVG labels: no markup, backticks removed, whitespace collapsed.
export function plainText(text: string): string {
  return text.replace(/`/g, "").replace(/\s+/g, " ").trim();
}
