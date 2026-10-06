import type { Effort, OmtConfig, RoleConfig, Rung } from "../types.ts";

function rung(driver: string, model: string, effort: Effort): Rung {
  return { driver, model, effort };
}

function readOnlyRole(description: string, result: "research" | "review", chain: Rung[]): RoleConfig {
  return {
    description,
    access: "read-only",
    result,
    t3Role: result,
    interactionMode: "plan",
    runtimeMode: "inherit",
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
      [rung("claudeAgent", SONNET, "low"), rung("codex", LUNA, "low")],
    ),
    research: readOnlyRole(
      "Answer a question from docs, the web, and code, with cited sources.",
      "research",
      [rung("claudeAgent", SONNET, "medium"), rung("codex", SOL, "medium")],
    ),
    plan: editRole(
      "Turn a goal into a plan file whose units have a scope, a done condition, and a verify command.",
      "plan",
      "design",
      [rung("claudeAgent", OPUS, "high"), rung("codex", ASTRA, "high")],
    ),
    "plan-review": readOnlyRole(
      "Check a plan for gaps, ambiguity, and steps that cannot be verified.",
      "review",
      [rung("codex", ASTRA, "high"), rung("claudeAgent", OPUS, "high")],
    ),
    execute: editRole(
      "Implement one planned unit inside its scope and run its verify commands.",
      "work",
      "implementation",
      [rung("claudeAgent", OPUS, "medium"), rung("codex", SOL, "medium")],
    ),
    quick: editRole(
      "Make a small, mechanical change, such as a rename, a typo, or a one-file edit.",
      "work",
      "implementation",
      [rung("claudeAgent", SONNET, "low"), rung("codex", LUNA, "low")],
    ),
    deep: editRole(
      "Solve a hard or cross-cutting problem that needs investigation before the change.",
      "work",
      "implementation",
      [rung("claudeAgent", OPUS, "xhigh"), rung("codex", ASTRA, "xhigh")],
    ),
    review: readOnlyRole(
      "Review a diff against its brief and report findings by severity.",
      "review",
      [rung("claudeAgent", OPUS, "high"), rung("codex", ASTRA, "high")],
    ),
    oracle: readOnlyRole(
      "Attack finished work from another model family before it counts as done.",
      "review",
      [rung("codex", ASTRA, "high"), rung("claudeAgent", OPUS, "high")],
    ),
    test: editRole(
      "Write and run tests and real checks, then return a verdict with evidence.",
      "test",
      "test",
      [rung("claudeAgent", SONNET, "medium"), rung("codex", SOL, "medium")],
    ),
    writing: editRole(
      "Write or edit documentation and other prose.",
      "work",
      "implementation",
      [rung("claudeAgent", OPUS, "medium"), rung("codex", SOL, "medium")],
    ),
  },
  limits: {
    maxParallel: 4,
    maxTasksPerRun: 24,
    maxDepth: 1,
    maxReviewRounds: 3,
  },
};
