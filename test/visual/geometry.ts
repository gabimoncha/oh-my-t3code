import type { FlowLayout } from "../../src/visual/flow.ts";

// Two edges may run on one line only when they leave the same node or enter the same node.
export function sharedLines(layout: FlowLayout): string[] {
  const found: string[] = [];
  layout.edges.forEach((a, i) => {
    for (const b of layout.edges.slice(i + 1)) {
      if (a.from === b.from || a.to === b.to) continue;
      for (const sa of a.segments) {
        for (const sb of b.segments) {
          const vertical = sa.x1 === sa.x2 && sb.x1 === sb.x2 && sa.x1 === sb.x1;
          const horizontal = sa.y1 === sa.y2 && sb.y1 === sb.y2 && sa.y1 === sb.y1;
          if (!vertical && !horizontal) continue;
          const [a1, a2, b1, b2] = vertical ? [sa.y1, sa.y2, sb.y1, sb.y2] : [sa.x1, sa.x2, sb.x1, sb.x2];
          if (Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2)) > 0) {
            found.push(`${a.from}->${a.to} and ${b.from}->${b.to}`);
          }
        }
      }
    }
  });
  return found;
}
