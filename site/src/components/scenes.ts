import { Draw, type Point, type Scene } from "./metro";

// The animated pictures: one for each skill. The hero shows the ulw and swarm pictures side by side.
// All share one canvas (480 x 256) with three lanes, so that they read as one set.

const W = 480;
const H = 256;
const LANES = [64, 128, 192];
const MID = 128;
const SKILL_SPEED = 3.3;
const PAUSE = 300;

// A 45-degree branch from (x, from) to a lane, then straight on to x1.
const branch = (x: number, from: number, lane: number, x1: number): Point[] =>
  lane === from
    ? [
        [x, from],
        [x1, lane],
      ]
    : [
        [x, from],
        [x + 16, from],
        [x + 16 + Math.abs(lane - from), lane],
        [x1, lane],
      ];

// The mirror of branch: from a lane back to the line at (x1, to).
const join = (x: number, lane: number, to: number, x1: number): Point[] =>
  lane === to
    ? [
        [x, lane],
        [x1, to],
      ]
    : [
        [x, lane],
        [x1 - 16 - Math.abs(lane - to), lane],
        [x1 - 16, to],
        [x1, to],
      ];

// A dashed loop over a lane, from the station at x1 back to the station at x0.
const loopBack = (x0: number, x1: number, y: number, height = 32): Point[] => [
  [x1, y],
  [x1 - height, y - height],
  [x0 + height, y - height],
  [x0, y],
];

function ulw(): Scene {
  const g = new Draw(W, H, "s", SKILL_SPEED);
  g.rail("M300 0 L300 256");
  g.station(28, MID, "goal", 0);
  g.text(28, MID + 36, "Goal", 0);
  const plan = g.line([[0, MID], [96, MID]], 0);
  g.station(96, MID, "plan", plan);
  g.text(96, MID + 36, "Plan", plan);
  const arrivals = LANES.map((lane, i) => {
    let t = g.line(branch(96, MID, lane, 200), plan + i * 100);
    g.station(200, lane, "work", t);
    t = g.line([[200, lane], [300, lane]], t);
    g.station(300, lane, "review", t);
    if (i === 0) {
      t += PAUSE;
      g.verdict(150, 22, "request changes", "closed", t);
      t = g.line(loopBack(200, 300, lane, 24), t, { dash: true }) + 150;
      t = g.line([[200, lane], [300, lane]], t, { tone: "yellow" });
    }
    t = g.line([[300, lane], [380, lane]], t);
    g.station(380, lane, "verify", t);
    return g.line(join(380, lane, MID, 460), t);
  });
  const done = Math.max(...arrivals);
  g.station(460, MID, "done", done);
  g.text(200, 228, "Delegate", plan);
  g.text(292, 228, "Review", plan, { anchor: "end" });
  g.text(380, 228, "Verify", plan);
  g.text(460, MID + 36, "Done", done);
  return g.scene();
}

function plan(): Scene {
  const g = new Draw(W, H, "s", SKILL_SPEED);
  g.rail("M300 0 L300 256");
  g.station(40, MID, "goal", 0);
  g.text(40, MID + 36, "Explore", 0);
  let t = g.line([[0, MID], [40, MID]], 0);
  t = g.line([[40, MID], [160, MID]], t + 200);
  g.station(160, MID, "plan", t);
  g.text(160, MID + 36, "Write the plan", t);
  t = g.line([[160, MID], [300, MID]], t);
  g.station(300, MID, "review", t);
  g.text(308, MID + 36, "Review", t, { anchor: "start" });
  t += PAUSE;
  g.verdict(170, 80, "request changes", "closed", t);
  t = g.line(loopBack(160, 300, MID), t, { dash: true }) + 150;
  t = g.line([[160, MID], [300, MID]], t, { tone: "yellow" }) + 150;
  g.verdict(312, 108, "approve", "open", t);
  t = g.line([[300, MID], [420, MID]], t + 200);
  g.station(420, MID, "done", t);
  g.text(420, MID + 36, ".omt/plans/", t, { style: "code", size: 14 });
  return g.scene();
}

function design(): Scene {
  const g = new Draw(W, H, "s", SKILL_SPEED);
  g.rail("M300 0 L300 256");
  g.station(40, MID, "goal", 0);
  g.text(40, MID + 36, "Frame", 0);
  const start = g.line([[0, MID], [40, MID]], 0);
  const names = ["A", "B", "C"];
  const dropped: number[] = [];
  const reviewed = LANES.map((lane, i) => {
    const first = g.items.length;
    let t = g.line(branch(40, MID, lane, 180), start + i * 120);
    g.station(180, lane, "work", t);
    g.text(180, lane - 24, names[i]!, t, { style: "code", size: 14 });
    t = g.line([[180, lane], [300, lane]], t);
    g.station(300, lane, "review", t);
    if (i !== 1) for (let index = first; index < g.items.length; index++) dropped.push(index);
    return t;
  });
  // You pick B: the lanes of A and C dim.
  const pick = Math.max(...reviewed) + PAUSE;
  for (const index of dropped) {
    const item = g.items[index]!;
    if (item.type !== "rail") item.dim = pick;
  }
  g.verdict(312, 108, "you pick B", "open", pick);
  let t = pick + 500;
  g.verdict(214, 120, "steer", "steer", t);
  t = g.line(loopBack(180, 300, MID, 24), t, { dash: true }) + 150;
  t = g.line([[180, MID], [300, MID]], t, { tone: "yellow" });
  t = g.line([[300, MID], [440, MID]], t + 150);
  g.station(440, MID, "done", t);
  g.text(440, MID + 36, "Spec", t);
  g.text(180, 228, "Variants", start);
  g.text(308, 228, "You review", start, { anchor: "start" });
  return g.scene();
}

function review(): Scene {
  const g = new Draw(W, H, "s", SKILL_SPEED);
  g.rail("M260 0 L260 256");
  g.station(40, MID, "goal", 0);
  g.text(40, MID + 36, "Target", 0);
  let t = g.line([[0, MID], [40, MID]], 0);
  t = g.line([[40, MID], [112, MID]], t + 150);
  g.station(112, MID, "plan", t);
  g.text(112, MID + 36, "Split", t);
  const split = t;
  const arrivals = LANES.map((lane, i) => {
    let at = g.line(branch(112, MID, lane, 260), split + i * 100);
    g.station(260, lane, "review", at);
    if (i === 0) g.verdict(282, 40, "finding", "closed", at + 200);
    at += PAUSE;
    return g.line(join(260, lane, MID, 372), at);
  });
  t = Math.max(...arrivals);
  g.station(372, MID, "verify", t);
  g.text(372, MID + 36, "Oracle", t);
  t = g.line([[372, MID], [448, MID]], t + 200);
  g.station(448, MID, "done", t);
  g.text(448, MID + 36, "Report", t);
  g.text(268, 228, "Reviewers", split, { anchor: "start" });
  return g.scene();
}

function research(): Scene {
  const g = new Draw(W, H, "s", SKILL_SPEED);
  g.station(40, MID, "goal", 0);
  g.text(40, MID + 36, "Question", 0);
  let t = g.line([[0, MID], [40, MID]], 0);
  t = g.line([[40, MID], [112, MID]], t + 150);
  g.station(112, MID, "plan", t);
  g.text(112, MID + 36, "Split", t);
  const split = t;
  const sources = ["repo", "docs", "web"];
  const arrivals = LANES.map((lane, i) => {
    let at = g.line(branch(112, MID, lane, 230), split + i * 140);
    g.station(230, lane, "work", at);
    g.text(230, lane - 24, sources[i]!, at, { style: "code", size: 14 });
    at += PAUSE + i * 200;
    return g.line(join(230, lane, MID, 352), at);
  });
  t = Math.max(...arrivals);
  g.station(352, MID, "verify", t);
  g.text(352, MID + 36, "Collect", t);
  t = g.line([[352, MID], [448, MID]], t + 200);
  g.station(448, MID, "done", t);
  g.text(448, MID + 36, "Answer", t);
  return g.scene();
}

function show(): Scene {
  const g = new Draw(W, H, "s", SKILL_SPEED);
  g.station(40, MID, "plan", 0);
  g.text(40, MID + 36, "Plan", 0);
  let t = g.line([[0, MID], [40, MID]], 0);
  t = g.line([[40, MID], [140, MID]], t + 150);
  g.station(140, MID, "work", t);
  g.text(140, MID + 36, "Spec", t);
  t = g.line([[140, MID], [240, MID]], t);
  g.station(240, MID, "verify", t);
  g.text(240, MID + 36, "Build", t);
  t = g.line([[240, MID], [300, MID]], t);
  // The page: its frame draws from the line, then a flowchart and a table fill it.
  const frame = "M300 128 L300 48 Q300 40 308 40 L460 40 Q468 40 468 48 L468 208 Q468 216 460 216 L308 216 Q300 216 300 208 L300 128";
  t = g.line(frame, t, { width: 4, speed: 0.6 });
  const nodes = [330, 384, 438];
  t = g.line([[330, 76], [438, 76]], t, { width: 3 });
  nodes.forEach((x, i) => g.dot(x, 76, 7, t - 300 + i * 150));
  [120, 152, 184].forEach((y, i) => {
    const at = t + 200 + i * 160;
    g.line([[324, y], [364, y]], at, { width: 8, tone: "muted", speed: 0.6 });
    g.line([[380, y], [444, y]], at + 80, { width: 8, tone: i === 0 ? "green" : "faint", speed: 0.6 });
  });
  g.text(384, 244, "A page in the T3 thread", t, { style: "note", size: 13 });
  return g.scene();
}

// The same grid as ulw, so that the two read side by side in the hero: the tracks leave the plan at
// different times and speeds, and each ends in its own pull request instead of at Done.
function swarm(): Scene {
  const g = new Draw(W, H, "s", SKILL_SPEED);
  g.rail("M300 0 L300 256");
  g.station(28, MID, "goal", 0);
  g.text(28, MID + 36, "Goal", 0);
  const plan = g.line([[0, MID], [96, MID]], 0);
  g.station(96, MID, "plan", plan);
  g.text(96, MID + 36, "Plan", plan);
  const offsets = [0, 700, 1400];
  const speeds = [1, 1.3, 1.1];
  LANES.forEach((lane, i) => {
    const speed = speeds[i]!;
    let t = g.line(branch(96, MID, lane, 200), plan + offsets[i]!, { speed });
    g.station(200, lane, "work", t);
    t = g.line([[200, lane], [300, lane]], t, { speed });
    g.station(300, lane, "review", t);
    t = g.line([[300, lane], [380, lane]], t + PAUSE, { speed });
    g.station(380, lane, "verify", t);
    t = g.line([[380, lane], [436, lane]], t, { speed });
    g.bar(436, lane, t);
    g.text(448, lane + 6, `PR ${i + 1}`, t, { anchor: "start" });
  });
  g.text(200, 228, "Delegate", plan);
  g.text(292, 228, "Review", plan, { anchor: "end" });
  g.text(380, 228, "Verify", plan);
  return g.scene();
}

function loop(): Scene {
  const g = new Draw(W, H, "s", SKILL_SPEED);
  g.station(40, MID, "goal", 0);
  g.text(40, MID + 36, "Condition", 0);
  let t = g.line([[0, MID], [40, MID]], 0);
  t = g.line([[40, MID], [160, MID]], t + 150);
  g.station(160, MID, "work", t);
  g.text(160, MID + 36, "Work", t);
  t = g.line([[160, MID], [300, MID]], t);
  g.station(300, MID, "verify", t);
  g.text(300, MID + 36, "Check", t);
  t += PAUSE;
  g.verdict(158, 80, "fails: next turn", "closed", t);
  t = g.line(loopBack(160, 300, MID), t, { dash: true }) + 150;
  t = g.line([[160, MID], [300, MID]], t, { tone: "yellow" }) + 150;
  g.verdict(312, 108, "passes", "open", t);
  t = g.line([[300, MID], [440, MID]], t + 200);
  g.station(440, MID, "done", t);
  g.text(440, MID + 36, "Stop", t);
  return g.scene();
}

function router(): Scene {
  const g = new Draw(W, H, "s", SKILL_SPEED);
  g.station(48, MID, "plan", 0);
  g.text(48, MID + 36, "omt", 0, { style: "code", size: 14 });
  let t = g.line([[0, MID], [48, MID]], 0);
  t = g.line([[48, MID], [120, MID]], t + 150);
  const names = ["ulw", "plan", "design", "review", "research", "show", "swarm", "loop"];
  names.forEach((name, i) => {
    const lane = 23 + i * 30;
    const end = g.line(branch(120, MID, lane, 300), t + i * 90, { radius: 10 });
    g.bar(300, lane, end, { length: 20 });
    g.text(316, lane + 5, `omt-${name}`, end, { style: "code", size: 14, anchor: "start" });
  });
  return g.scene();
}

export const SKILL_SCENES: Record<string, Scene> = {
  "omt-ulw": ulw(),
  "omt-plan": plan(),
  "omt-design": design(),
  "omt-review": review(),
  "omt-research": research(),
  "omt-show": show(),
  "omt-swarm": swarm(),
  "omt-loop": loop(),
  omt: router(),
};
