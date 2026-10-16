import assert from "node:assert/strict";
import { segmentCrossesBox } from "../../src/visual/flow.ts";
import type { FlowLayout } from "../../src/visual/flow.ts";

export function assertClean(name: string, layout: FlowLayout): void {
  for (const edge of layout.edges) {
    assert.ok(edge.segments.length > 0, `${name}: edge ${edge.from} -> ${edge.to} has no segments`);
    for (const segment of edge.segments) {
      assert.ok(segment.x1 === segment.x2 || segment.y1 === segment.y2, `${name}: edge ${edge.from} -> ${edge.to} has a diagonal segment`);
      for (const node of layout.nodes) {
        if (node.id === edge.from || node.id === edge.to) continue;
        assert.ok(
          !segmentCrossesBox(segment, node, 4),
          `${name}: edge ${edge.from} -> ${edge.to} (${edge.route}) crosses node ${node.id}: ${JSON.stringify(segment)}`,
        );
      }
    }
  }
}

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
