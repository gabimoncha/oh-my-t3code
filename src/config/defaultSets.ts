import type { ConfigLayer, DefaultsChange, Effort, OmtConfig, RoleConfig, Rung } from "../types.ts";
import { isRecord } from "../util/json.ts";

export type { DefaultsChange } from "../types.ts";

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
const HAIKU = "claude-haiku-5-5";
const OPUS = "claude-opus-5-5";
const LUNA = "gpt-6-luna";
const SOL = "gpt-6.1-sol";
const ASTRA = "gpt-6-astra";

// A set never changes after a release. A change to the defaults goes into a new set with a later name.
const SET_2026_10: OmtConfig = {
  version: 1,
  defaults: "2026-10",
  profile: "normal",
  profiles: {
    normal: {
      description: "Plan, build, and review with the standard workflow.",
      workflow: {
        plan: { review: "two-families", testLayers: ["e2e"] },
        design: { variants: 3 },
        build: {
          review: "every-round",
          verify: "heavy",
          qa: "planned",
          failureProofs: "on",
          oracle: "heavy",
          checkpoint: "none",
          stallMinutes: 30,
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
      },
    },
    prototype: {
      description: "Build a prototype with fewer reviews and a check-in after each layer.",
      extends: "normal",
      workflow: {
        plan: { review: "one" },
        design: { variants: 1 },
        build: {
          review: "first-round",
          verify: "every-unit",
          failureProofs: "off",
          oracle: "off",
          checkpoint: "layer",
        },
        review: { reviewers: 1, oracle: "off", ci: "off" },
      },
      limits: { maxReviewRounds: 2 },
    },
    "pr-review": {
      description: "Review a pull request, check CI and changed flows, and propose guardrails.",
      extends: "normal",
      workflow: {
        review: { ci: "fix", verify: "changed-flows", tests: "offer", guardrails: "propose", crap: "report" },
      },
    },
  },
  models: { [SOL]: { fast: true } },
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
    verify: editRole(
      "Drive the Simulator, a device, a browser, or a computer, and run the unit's checks; return a verdict with logs and screenshots.",
      "test",
      "test",
      [rung("claudeAgent", HAIKU, "medium"), rung("claudeAgent", SONNET, "low"), rung("codex", SOL, "low")],
    ),
    qa: editRole(
      "Write the tests that the plan lists for the unit, e2e first, and make them pass.",
      "test",
      "test",
      [rung("codex", SOL, "medium"), rung("claudeAgent", SONNET, "medium")],
    ),
    guardrail: {
      ...readOnlyRole(
        "Turn review findings into deterministic checks and rule fixes, so that the next change cannot repeat them.",
        "review",
        [rung("claudeAgent", OPUS, "high"), rung("codex", ASTRA, "high")],
      ),
      result: "guardrail",
    },
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
    maxParallel: 6,
    maxTasksPerRun: 24,
    maxDepth: 1,
    maxReviewRounds: 4,
  },
  visuals: {
    plan: true,
  },
};

const SET_2026_11: OmtConfig = {
  ...SET_2026_10,
  defaults: "2026-11",
  roles: Object.fromEntries(Object.entries(SET_2026_10.roles).flatMap(([name, role]) => {
    if (name !== "plan-review") return [[name, role]];
    const grill: RoleConfig = {
      ...readOnlyRole(
        "Test a goal before it has a plan: find its edge cases, open questions, and options.",
        "review",
        [rung("codex", ASTRA, "high"), rung("claudeAgent", OPUS, "high")],
        true,
      ),
      result: "grill",
    };
    return [[name, role], ["grill", grill]];
  })),
};

export const DEFAULT_SETS: Readonly<Record<string, OmtConfig>> = {
  "2026-10": SET_2026_10,
  "2026-11": SET_2026_11,
};

export const LATEST_DEFAULT_SET = "2026-11";
export const DEFAULT_SET_NAME_RE = /^\d{4}-\d{2}(-[a-z0-9]+)?$/;

export function defaultSetNames(): string[] {
  return Object.keys(DEFAULT_SETS);
}

export function isDefaultSet(name: string): boolean {
  return DEFAULT_SET_NAME_RE.test(name) && Object.hasOwn(DEFAULT_SETS, name);
}

// The selected set, or the latest set for a name that omt does not ship.
export function defaultSet(name: string): OmtConfig {
  return (isDefaultSet(name) ? DEFAULT_SETS[name] : undefined) ?? (DEFAULT_SETS[LATEST_DEFAULT_SET] as OmtConfig);
}

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

function formatValue(segments: string[], value: unknown): string {
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

// A layer overrides a path when it sets a value at the full path, or null at an ancestor.
function overrides(layer: unknown, segments: string[]): boolean {
  let value = layer;
  for (const segment of segments) {
    if (value === null) return true;
    if (!isRecord(value) || !Object.hasOwn(value, segment)) return false;
    value = value[segment];
  }
  return value !== undefined;
}

// `overrides` come in precedence order: the user layer first, then the project layer.
export function diffDefaultSets(
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
