export function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const line = (cells: string[]) =>
    widths
      .map((width, column) => {
        const cell = cells[column] ?? "";
        return column === widths.length - 1 ? cell : cell.padEnd(width);
      })
      .join("  ")
      .trimEnd();
  return [line(headers), ...rows.map(line)].map((text) => `${text}\n`).join("");
}
