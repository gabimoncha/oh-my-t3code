import type { Effort, OmtConfig, RoleConfig, Rung } from "../types.ts";

// T3 names each built-in provider instance after its driver kind. A rung that names the instance gets
// T3's re-check of a stale provider snapshot, which a driverKind-only target does not get.
function rung(driver: string, model: string, effort: Effort): Rung {
  return { provider: driver, driver, model, effort };
}

function readOnlyRole(
  description: string,
  result: "research" | "review",
  chain: Rung[],
  crossFamily = false,
): RoleConfig {
  return {
    description,
    access: "read-only",
    result,
    t3Role: result,
    interactionMode: "plan",
    runtimeMode: "inherit",
    crossFamily,
    chain,
  };
}

function editRole(
  description: string,
  result: "work" | "plan" | "test",
  t3Role: "implementation" | "design" | "test",
  chain: Rung[],
): RoleConfig {
  return {
    description,
    access: "edit",
    result,
    t3Role,
    interactionMode: "default",
    runtimeMode: "inherit",
    crossFamily: false,
    chain,
  };
}

const SONNET = "claude-sonnet-5-5";
const OPUS = "claude-opus-5-5";
const LUNA = "gpt-6-luna";
const SOL = "gpt-6.1-sol";
const ASTRA = "gpt-6-astra";

export const DEFAULT_CONFIG: OmtConfig = {
  version: 1,
  roles: {
    explore: readOnlyRole(
      "Search this repository and answer one narrow question with file and line citations.",
      "research",
      [rung("codex", LUNA, "low"), rung("claudeAgent", SONNET, "low")],
    ),
    research: readOnlyRole(
      "Answer a question from docs, the web, and code, with cited sources.",
      "research",
      [rung("codex", SOL, "low"), rung("claudeAgent", OPUS, "low")],
    ),
    plan: editRole(
      "Turn a goal into a plan file whose units have a scope, a done condition, and a verify command.",
      "plan",
      "design",
      [rung("claudeAgent", OPUS, "xhigh"), rung("codex", ASTRA, "xhigh")],
    ),
    "plan-review": readOnlyRole(
      "Check a plan for gaps, ambiguity, and steps that cannot be verified.",
      "review",
      [rung("codex", ASTRA, "high"), rung("claudeAgent", OPUS, "high")],
      true,
    ),
    execute: editRole(
      "Implement one planned unit inside its scope and run its verify commands.",
      "work",
      "implementation",
      [rung("claudeAgent", OPUS, "medium"), rung("codex", SOL, "xhigh")],
    ),
    quick: editRole(
      "Make a small, mechanical change, such as a rename, a typo, or a one-file edit.",
      "work",
      "implementation",
      [rung("codex", LUNA, "high"), rung("claudeAgent", SONNET, "low")],
    ),
    deep: editRole(
      "Solve a hard or cross-cutting problem that needs investigation before the change.",
      "work",
      "implementation",
      [rung("claudeAgent", OPUS, "max"), rung("codex", ASTRA, "xhigh")],
    ),
    review: readOnlyRole(
      "Review a diff against its brief and report findings by severity. Runs on the family that did not make the change when the worker is known.",
      "review",
      [rung("codex", ASTRA, "high"), rung("claudeAgent", OPUS, "high")],
      true,
    ),
    oracle: readOnlyRole(
      "Attack the finished change from the family other than the main implementer's before it counts as done.",
      "review",
      [rung("codex", ASTRA, "high"), rung("claudeAgent", OPUS, "high")],
      true,
    ),
    test: editRole(
      "Write and run tests and real checks, then return a verdict with evidence.",
      "test",
      "test",
      [rung("codex", SOL, "low"), rung("claudeAgent", SONNET, "low")],
    ),
    writing: editRole(
      "Write or edit documentation and other prose.",
      "work",
      "implementation",
      [rung("claudeAgent", OPUS, "high"), rung("codex", ASTRA, "medium")],
    ),
    design: editRole(
      "Design screens and flows in Paper, and write a design spec that UI units cite.",
      "work",
      "design",
      [rung("claudeAgent", OPUS, "high")],
    ),
    ui: editRole(
      "Implement one UI unit from its design spec, inside its scope.",
      "work",
      "implementation",
      [rung("claudeAgent", OPUS, "medium")],
    ),
  },
  limits: {
    maxParallel: 4,
    maxTasksPerRun: 24,
    maxDepth: 1,
    maxReviewRounds: 3,
  },
  visuals: {
    plan: true,
  },
};
