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

// Renders `code`, **bold**, and [text](url) as HTML; a link keeps only its text, so the page loads no URL.
export function inlineHtml(text: string, depth = 0): string {
  if (depth >= 16) return escapeHtml(text);
  const out: string[] = [];
  let last = 0;
  const next = new Map<string, number>();
  const find = (delimiter: string, from: number) => {
    const known = next.get(delimiter);
    if (known !== undefined && (known === -1 || known >= from)) return known;
    const index = text.indexOf(delimiter, from);
    next.set(delimiter, index);
    return index;
  };
  let whitespace = -1;
  for (let index = 0; index < text.length; index++) {
    let end = -1;
    let html: string | undefined;
    const newline = find("\n", index + 1);
    if (text[index] === "`") {
      end = find("`", index + 1);
      if (end > index + 1 && (newline === -1 || end < newline)) {
        html = `<code>${escapeHtml(text.slice(index + 1, end))}</code>`;
        end++;
      }
    } else if (text.startsWith("**", index)) {
      end = find("**", index + 3);
      if (end !== -1 && (newline === -1 || end < newline)) {
        html = `<strong>${inlineHtml(text.slice(index + 2, end), depth + 1)}</strong>`;
        end += 2;
      }
    } else if (text[index] === "[") {
      const labelEnd = find("]", index + 1);
      if (labelEnd > index + 1 && (newline === -1 || labelEnd < newline) && text[labelEnd + 1] === "(") {
        const from = labelEnd + 2;
        end = find(")", from);
        if (whitespace < from) {
          whitespace = from;
          while (whitespace < text.length && !/\s/.test(text[whitespace]!)) whitespace++;
        }
        if (end !== -1 && end < whitespace) {
          html = inlineHtml(text.slice(index + 1, labelEnd), depth + 1);
          end++;
        }
      }
    }
    if (html === undefined) continue;
    out.push(escapeHtml(text.slice(last, index)), html);
    last = end;
    index = end - 1;
  }
  out.push(escapeHtml(text.slice(last)));
  return out.join("");
}

// Text for SVG labels: no markup, backticks removed, whitespace collapsed.
export function plainText(text: string): string {
  return text.replace(/`/g, "").replace(/\s+/g, " ").trim();
}
