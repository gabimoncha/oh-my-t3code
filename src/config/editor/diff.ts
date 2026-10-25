export interface DiffLine {
  op: " " | "+" | "-";
  line: string;
}

// Above this many lines in either text, the diff is one whole replace, so that the table stays small.
export const DIFF_MAX_LINES = 5000;

function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

// A line diff from the longest common subsequence. In a changed block the removed lines come first.
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const keep = (line: string): DiffLine => ({ op: " ", line });
  const remove = (line: string): DiffLine => ({ op: "-", line });
  const add = (line: string): DiffLine => ({ op: "+", line });
  if (a.length > DIFF_MAX_LINES || b.length > DIFF_MAX_LINES) return [...a.map(remove), ...b.map(add)];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const rows = endA - start;
  const cols = endB - start;
  const width = cols + 1;
  // lcs[i * width + j] is the length of the longest common subsequence of a[start + i..endA) and b[start + j..endB).
  const lcs = new Uint16Array((rows + 1) * width);
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      lcs[i * width + j] = a[start + i] === b[start + j]
        ? (lcs[(i + 1) * width + j + 1] as number) + 1
        : Math.max(lcs[(i + 1) * width + j] as number, lcs[i * width + j + 1] as number);
    }
  }
  const out = a.slice(0, start).map(keep);
  let i = 0;
  let j = 0;
  while (i < rows || j < cols) {
    const left = a[start + i] as string;
    const right = b[start + j] as string;
    if (i < rows && j < cols && left === right) {
      out.push(keep(left));
      i++;
      j++;
    } else if (j === cols || (i < rows && (lcs[(i + 1) * width + j] as number) >= (lcs[i * width + j + 1] as number))) {
      out.push(remove(left));
      i++;
    } else {
      out.push(add(right));
      j++;
    }
  }
  return out.concat(a.slice(endA).map(keep));
}
