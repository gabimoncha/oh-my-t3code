export function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function renderTable(headers: string[], rows: string[][]): string {
  const cellText = (cell: string) => cell.length > 120 ? `${cell.slice(0, 119)}…` : cell;
  const widths = headers.map((header) => cellText(header).length);
  for (const row of rows) {
    for (let column = 0; column < widths.length; column++) {
      widths[column] = Math.max(widths[column] ?? 0, Math.min(120, (row[column] ?? "").length));
    }
  }
  const line = (cells: string[]) =>
    widths
      .map((width, column) => {
        const cell = cellText(cells[column] ?? "");
        return column === widths.length - 1 ? cell : cell.padEnd(width);
      })
      .join("  ")
      .trimEnd();
  const lines = [`${line(headers)}\n`];
  let size = lines[0]!.length;
  for (const row of rows) {
    const rendered = `${line(row)}\n`;
    if (size + rendered.length > 1_000_000) {
      lines.push("… table truncated; use --json for full values\n");
      break;
    }
    lines.push(rendered);
    size += rendered.length;
  }
  return lines.join("");
}
