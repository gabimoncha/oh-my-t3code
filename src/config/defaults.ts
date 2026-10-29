import type { ConfigLayer, DefaultsChange, Effort, OmtConfig, RoleConfig, Rung } from "../types.ts";
import { isRecord } from "../util/json.ts";

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
  result: "work" | "plan" | "test" | "review",
  t3Role: "implementation" | "design" | "test" | "review",
  chain: Rung[],
  crossFamily = false,
): RoleConfig {
  return {
    description,
    access: "edit",
    result,
    t3Role,
    interactionMode: "default",
    runtimeMode: "inherit",
    crossFamily,
    chain,
  };
}

export const RETIRED_BUILD_KEYS: readonly string[] = ["verify", "checkpoint", "stallMinutes"];
export const RETIRED_LIMIT_KEYS: readonly string[] = ["maxTasksPerRun"];
export const RETIRED_ROLES: readonly string[] = ["verify", "quick", "deep"];

export const DEFAULT_CONFIG: OmtConfig = {
  version: 1,
  profile: "normal",
  profiles: {
    normal: {
      description: "Plan, build, and review with the standard workflow.",
      workflow: {
        plan: {
          review: "two-families",
          testLayers: ["e2e"],
        },
        design: {
          variants: 3,
        },
        review: {
          reviewers: "auto",
          families: "one",
          oracle: "on",
          fixLoop: "offer",
          ci: "check",
          verify: "off",
          tests: "off",
          guardrails: "off",
          crap: "off",
        },
        git: {
          branchCommits: "auto",
          pullRequests: "auto",
          defaultBranch: "ask",
          merge: "ask",
          owners: [],
          maxPrFiles: 100,
        },
        build: {
          review: "every-round",
          qa: "planned",
          failureProofs: "on",
          oracle: "heavy",
        },
      },
    },
    prototype: {
      description: "Build a prototype with fewer reviews and no failure proofs.",
      extends: "normal",
      workflow: {
        plan: {
          review: "one",
        },
        design: {
          variants: 1,
        },
        review: {
          reviewers: 1,
          oracle: "off",
          ci: "off",
        },
        build: {
          review: "first-round",
          failureProofs: "off",
          oracle: "off",
        },
      },
      limits: {
        maxReviewRounds: 2,
      },
    },
    "pr-review": {
      description: "Review a pull request, check CI and changed flows, and propose guardrails.",
      extends: "normal",
      workflow: {
        review: {
          ci: "fix",
          verify: "changed-flows",
          tests: "offer",
          guardrails: "propose",
          crap: "report",
        },
      },
    },
  },
  models: {
    "gpt-6.1-sol": {
      fast: true,
    },
  },
  roles: {
    explore: readOnlyRole(
      "Search this repository and answer one narrow question with file and line citations.",
      "research",
      [rung("codex", "gpt-6.1-terra", "low"), rung("claudeAgent", "claude-haiku-5-5", "medium")],
    ),
    research: readOnlyRole(
      "Answer a question from docs, the web, and code, with cited sources.",
      "research",
      [rung("codex", "gpt-6.1-sol", "low"), rung("claudeAgent", "claude-sonnet-5-5", "medium")],
    ),
    plan: editRole(
      "Turn a goal into a plan file whose units have a scope, a done condition, and a verify command.",
      "plan",
      "design",
      [rung("claudeAgent", "claude-opus-5-5", "medium"), rung("codex", "gpt-6-astra", "high")],
    ),
    "plan-review": readOnlyRole(
      "Check a plan for gaps, ambiguity, and steps that cannot be verified.",
      "review",
      [rung("codex", "gpt-6-astra", "medium"), rung("claudeAgent", "claude-opus-5-5", "medium")],
      true,
    ),
    grill: {
      ...readOnlyRole(
        "Test a goal before it has a plan: find its edge cases, open questions, and options.",
        "review",
        [rung("codex", "gpt-6-astra", "medium"), rung("claudeAgent", "claude-opus-5-5", "medium")],
        true,
      ),
      result: "grill",
    },
    execute: editRole(
      "Implement one planned unit inside its scope and run its verify commands.",
      "work",
      "implementation",
      [rung("claudeAgent", "claude-opus-5-5", "low"), rung("codex", "gpt-6.1-sol", "high")],
    ),
    review: editRole(
      "Review a diff against its brief, fix local findings in the changed files, and report the rest by severity. Runs on the family that did not make the change.",
      "review",
      "review",
      [rung("codex", "gpt-6-astra", "medium"), rung("claudeAgent", "claude-opus-5-5", "medium")],
      true,
    ),
    oracle: editRole(
      "Attack the finished change from the family other than the main implementer's, fix local findings, and report the rest before it counts as done.",
      "review",
      "review",
      [rung("codex", "gpt-6-astra", "medium"), rung("claudeAgent", "claude-opus-5-5", "medium")],
      true,
    ),
    qa: editRole(
      "Run the given check commands and device flows, and return each exit code with its log and screenshots. Edits nothing.",
      "test",
      "test",
      [rung("codex", "gpt-6.1-sol", "medium"), rung("claudeAgent", "claude-sonnet-5-5", "low")],
    ),
    guardrail: {
      ...readOnlyRole(
        "Turn review findings into deterministic checks and rule fixes, so that the next change cannot repeat them.",
        "review",
        [rung("claudeAgent", "claude-opus-5-5", "high"), rung("codex", "gpt-6-astra", "high")],
      ),
      result: "guardrail",
    },
    writing: editRole(
      "Write or edit documentation and other prose.",
      "work",
      "implementation",
      [rung("claudeAgent", "claude-opus-5-5", "medium"), rung("codex", "gpt-6-astra", "medium")],
    ),
    design: editRole(
      "Design screens and flows in Paper, and write a design spec that UI units cite.",
      "work",
      "design",
      [rung("claudeAgent", "claude-opus-5-5", "medium"), rung("codex", "gpt-6-astra", "high")],
    ),
    ui: editRole(
      "Implement one UI unit from its design spec or task requirements, inside its scope.",
      "work",
      "implementation",
      [rung("claudeAgent", "claude-opus-5-5", "low"), rung("codex", "gpt-6.1-sol", "high")],
    ),
  },
  limits: {
    maxParallel: 6,
    maxDepth: 1,
    maxReviewRounds: 4,
  },
};

function formatChain(chain: unknown[]): string {
  return chain.map((rung) => {
    if (!isRecord(rung)) return JSON.stringify(rung);
    const driver = typeof rung.driver === "string" ? rung.driver : rung.provider;
    const parts = [`${String(driver)}/${String(rung.model)}`];
    if (typeof rung.effort === "string") parts.push(rung.effort);
    if (rung.fast === true) parts.push("fast");
    return parts.join(" ");
  }).join(", ");
}

export function formatValue(segments: string[], value: unknown): string {
  if (value === undefined) return "none";
  if (segments.at(-1) === "chain" && Array.isArray(value)) return formatChain(value);
  return JSON.stringify(value);
}

function own(record: Record<string, unknown> | undefined, key: string): unknown {
  return record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;
}

// Model ids contain dots, so a change keeps its path as segments until it prints.
function collectChanges(from: unknown, to: unknown, segments: string[], out: { segments: string[]; from: unknown; to: unknown }[]): void {
  const a = isRecord(from) ? from : undefined;
  const b = isRecord(to) ? to : undefined;
  if ((a !== undefined || from === undefined) && (b !== undefined || to === undefined) && (a !== undefined || b !== undefined)) {
    for (const key of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
      if (segments.length === 0 && key === "defaults") continue;
      collectChanges(own(a, key), own(b, key), [...segments, key], out);
    }
    return;
  }
  if (JSON.stringify(from) !== JSON.stringify(to)) out.push({ segments, from, to });
}

// Arrays are leaves, so a model chain is one change.
export function configLeaves(value: unknown): string[][] {
  const out: string[][] = [];
  const walk = (node: unknown, segments: string[]) => {
    if (!isRecord(node)) {
      if (segments.length > 0) out.push(segments);
      return;
    }
    for (const key of Object.keys(node)) walk(node[key], [...segments, key]);
  };
  walk(value, []);
  return out;
}

// A layer overrides a path when it sets a value at the full path, or null at an ancestor.
export function overrides(layer: unknown, segments: string[]): boolean {
  let value = layer;
  for (const segment of segments) {
    if (value === null) return true;
    if (!isRecord(value) || !Object.hasOwn(value, segment)) return false;
    value = value[segment];
  }
  return value !== undefined;
}

// `overrides` come in precedence order: the user layer first, then the project layer.
export function diffDefaults(
  from: OmtConfig,
  to: OmtConfig,
  overrideLayers: { source: string; layer: ConfigLayer }[],
): DefaultsChange[] {
  const raw: { segments: string[]; from: unknown; to: unknown }[] = [];
  collectChanges(from, to, [], raw);
  return raw.map((change) => {
    const result: DefaultsChange = {
      path: change.segments.join("."),
      from: formatValue(change.segments, change.from),
      to: formatValue(change.segments, change.to),
    };
    for (const { source, layer } of overrideLayers) {
      if (overrides(layer, change.segments)) result.overriddenBy = source;
    }
    return result;
  });
}
