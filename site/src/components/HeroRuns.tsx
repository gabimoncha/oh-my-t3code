import { type AnimationEvent, type CSSProperties, useState } from "react";
import { useInView } from "./inView";
import { Metro } from "./metro";
import { SKILL_SCENES } from "./scenes";

// After a run ends, its panel holds the last frame for this long before the next panel plays.
const HOLD = 1200;

type Run = "ulw" | "swarm";
type Phase = Run | "done";

const RUNS: { id: Run; skill: string; label: string; goal: string; note: string }[] = [
  {
    id: "ulw",
    skill: "omt-ulw",
    label: "One goal, one change",
    goal: "ulw add OAuth to the API",
    note: "Three units. Codex reviews Claude's work, and Claude reviews Codex's work. A review that requests changes sends the unit back for a fix, and the second pass shows in yellow.",
  },
  {
    id: "swarm",
    skill: "omt-swarm",
    label: "One pull request per track",
    goal: "omt-swarm split the API",
    note: "Three independent tracks. Each runs in its own T3 worktree thread, at its own speed, and ends in its own pull request. The tracks never merge.",
  },
];

// The hero is split in two: ulw on the left, swarm on the right. The ulw run plays first while the
// swarm panel shows its last frame, dimmed; then the swarm run plays. Both then stay on their last
// frame. Out of view, the runs pause.
export function HeroRuns() {
  const host = useInView<HTMLElement>();
  const [phase, setPhase] = useState<Phase>("ulw");
  const [round, setRound] = useState(0);

  function onClockEnd(event: AnimationEvent) {
    if (event.animationName !== "clock") return;
    setPhase(phase === "ulw" ? "swarm" : "done");
  }

  return (
    <section className="hero-runs wrap anim" ref={host} aria-label="Two example runs">
      {RUNS.map((run) => {
        const scene = SKILL_SCENES[run.skill]!;
        const waiting = run.id === "swarm" && phase === "ulw";
        return (
          <figure key={run.id} className="hero-run" data-state={phase === run.id ? "playing" : waiting ? "waiting" : "done"}>
            <figcaption className="hero-run-head">
              <code>{run.skill}</code>
              <span>{run.label}</span>
              {phase === run.id ? (
                <span
                  className="m-clock"
                  style={{ "--total-m": `${scene.end + HOLD}ms` } as CSSProperties}
                  onAnimationEnd={onClockEnd}
                />
              ) : null}
            </figcaption>
            <div key={waiting ? "waiting" : round} className={waiting ? "hero-art still" : "hero-art"}>
              <Metro scene={scene} />
            </div>
            <p className="hero-run-goal">
              <span className="meta">Example: </span>
              <code>{run.goal}</code>
            </p>
            <p className="hero-run-note">{run.note}</p>
          </figure>
        );
      })}
      {phase === "done" ? (
        <button
          type="button"
          className="hero-replay quiet-link"
          onClick={() => {
            setRound(round + 1);
            setPhase("ulw");
          }}
        >
          Play again
        </button>
      ) : null}
    </section>
  );
}
