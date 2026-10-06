import { EFFORT_LADDER, RESULT_KINDS } from "../types.ts";
import type { ConfigIssue, ConfigLayer, Effort, Limits, OptionValue, RoleConfig, Rung } from "../types.ts";

export const ROOT_KEYS: readonly string[] = ["$schema", "version", "roles", "limits"];
export const ROLE_KEYS: readonly string[] = [
  "description",
  "access",
  "result",
  "t3Role",
  "interactionMode",
  "runtimeMode",
  "chain",
];
export const RUNG_KEYS: readonly string[] = ["provider", "driver", "model", "effort", "options"];
export const LIMIT_KEYS: readonly string[] = ["maxParallel", "maxTasksPerRun", "maxDepth", "maxReviewRounds"];

export const ACCESS_VALUES: readonly string[] = ["read-only", "edit"];
export const RESULT_VALUES: readonly string[] = RESULT_KINDS;
export const T3_ROLE_VALUES: readonly string[] = ["implementation", "research", "review", "design", "test", "general"];
export const INTERACTION_MODE_VALUES: readonly string[] = ["inherit", "default", "plan"];
export const RUNTIME_MODE_VALUES: readonly string[] = [
  "inherit",
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
];

export const ROLE_NAME_PATTERN = "^[a-z][a-z0-9-]{0,31}$";
export const PROVIDER_PATTERN = "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$";
export const DESCRIPTION_MAX = 300;
export const MODEL_MAX = 200;
export const CHAIN_MIN = 1;
export const CHAIN_MAX = 10;
export const LIMIT_RANGES: Readonly<Record<keyof Limits, readonly [number, number]>> = {
  maxParallel: [1, 32],
  maxTasksPerRun: [1, 500],
  maxDepth: [0, 3],
  maxReviewRounds: [1, 10],
};

const ROLE_NAME_RE = new RegExp(ROLE_NAME_PATTERN);
const PROVIDER_RE = new RegExp(PROVIDER_PATTERN);

const ENUM_KEYS: Readonly<Record<string, readonly string[]>> = {
  access: ACCESS_VALUES,
  result: RESULT_VALUES,
  t3Role: T3_ROLE_VALUES,
  interactionMode: INTERACTION_MODE_VALUES,
  runtimeMode: RUNTIME_MODE_VALUES,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "object") return "an object";
  return String(value);
}

function oneOf(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(", ");
}

class Collector {
  readonly issues: ConfigIssue[] = [];
  readonly source: string;

  constructor(source: string) {
    this.source = source;
  }

  error(path: string, message: string): void {
    this.issues.push({ source: this.source, path, message, severity: "error" });
  }
}

function validateRung(value: unknown, path: string, out: Collector): Rung | undefined {
  if (!isObject(value)) {
    out.error(path, `a rung must be an object, got ${describe(value)}`);
    return undefined;
  }
  const before = out.issues.length;
  const rung: Partial<Rung> = {};
  for (const [key, item] of Object.entries(value)) {
    const keyPath = `${path}.${key}`;
    if (!RUNG_KEYS.includes(key)) {
      out.error(keyPath, `unknown rung key "${key}"; allowed keys: ${RUNG_KEYS.join(", ")}`);
    } else if (key === "provider" || key === "driver") {
      if (typeof item === "string" && PROVIDER_RE.test(item)) rung[key] = item;
      else out.error(keyPath, `must be a string that matches ${PROVIDER_PATTERN}, got ${describe(item)}`);
    } else if (key === "model") {
      if (typeof item === "string" && item.length > 0 && item.length <= MODEL_MAX) rung.model = item;
      else out.error(keyPath, `must be a non-empty string of at most ${MODEL_MAX} characters`);
    } else if (key === "effort") {
      if (typeof item === "string" && (EFFORT_LADDER as readonly string[]).includes(item)) rung.effort = item as Effort;
      else out.error(keyPath, `must be one of ${oneOf(EFFORT_LADDER)}, got ${describe(item)}`);
    } else if (key === "options") {
      if (!isObject(item)) {
        out.error(keyPath, `must be an object, got ${describe(item)}`);
        continue;
      }
      const options: Record<string, OptionValue> = {};
      for (const [id, option] of Object.entries(item)) {
        if (typeof option === "string" || typeof option === "boolean") options[id] = option;
        else out.error(`${keyPath}.${id}`, `an option value must be a string or a boolean, got ${describe(option)}`);
      }
      rung.options = options;
    }
  }
  if (!("model" in value)) out.error(`${path}.model`, "a rung needs a model");
  if (!("provider" in value) && !("driver" in value)) out.error(path, "a rung needs a provider or a driver");
  return out.issues.length === before ? (rung as Rung) : undefined;
}

function validateRole(value: unknown, path: string, out: Collector): Partial<RoleConfig> | null | undefined {
  if (value === null) return null;
  if (!isObject(value)) {
    out.error(path, `a role must be an object or null, got ${describe(value)}`);
    return undefined;
  }
  const before = out.issues.length;
  const role: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const keyPath = `${path}.${key}`;
    const allowed = ENUM_KEYS[key];
    if (!ROLE_KEYS.includes(key)) {
      out.error(keyPath, `unknown role key "${key}"; allowed keys: ${ROLE_KEYS.join(", ")}`);
    } else if (allowed !== undefined) {
      if (typeof item === "string" && allowed.includes(item)) role[key] = item;
      else out.error(keyPath, `must be one of ${oneOf(allowed)}, got ${describe(item)}`);
    } else if (key === "description") {
      if (typeof item === "string" && item.length > 0 && item.length <= DESCRIPTION_MAX) role[key] = item;
      else out.error(keyPath, `must be a non-empty string of at most ${DESCRIPTION_MAX} characters`);
    } else if (key === "chain") {
      if (!Array.isArray(item) || item.length < CHAIN_MIN || item.length > CHAIN_MAX) {
        out.error(keyPath, `must be an array of ${CHAIN_MIN} to ${CHAIN_MAX} rungs`);
        continue;
      }
      role[key] = item.map((rung, index) => validateRung(rung, `${keyPath}[${index}]`, out));
    }
  }
  return out.issues.length === before ? (role as Partial<RoleConfig>) : undefined;
}

function validateLimits(value: unknown, out: Collector): Partial<Limits> | undefined {
  if (!isObject(value)) {
    out.error("limits", `must be an object, got ${describe(value)}`);
    return undefined;
  }
  const limits: Partial<Limits> = {};
  for (const [key, item] of Object.entries(value)) {
    const path = `limits.${key}`;
    if (!LIMIT_KEYS.includes(key)) {
      out.error(path, `unknown limit "${key}"; allowed keys: ${LIMIT_KEYS.join(", ")}`);
      continue;
    }
    const [min, max] = LIMIT_RANGES[key as keyof Limits];
    if (typeof item === "number" && Number.isInteger(item) && item >= min && item <= max) {
      limits[key as keyof Limits] = item;
    } else {
      out.error(path, `must be an integer from ${min} to ${max}, got ${describe(item)}`);
    }
  }
  return limits;
}

export function validateLayer(value: unknown, source: string): { layer: ConfigLayer; issues: ConfigIssue[] } {
  const out = new Collector(source);
  const layer: ConfigLayer = {};
  if (!isObject(value)) {
    out.error("", `the config must be an object, got ${describe(value)}`);
    return { layer, issues: out.issues };
  }
  for (const [key, item] of Object.entries(value)) {
    if (!ROOT_KEYS.includes(key)) {
      out.error(key, `unknown key "${key}"; allowed keys: ${ROOT_KEYS.join(", ")}`);
    } else if (key === "$schema") {
      if (typeof item !== "string") out.error(key, `must be a string, got ${describe(item)}`);
    } else if (key === "version") {
      if (item === 1) layer.version = 1;
      else out.error(key, `must be 1, got ${describe(item)}`);
    } else if (key === "roles") {
      if (!isObject(item)) {
        out.error(key, `must be an object, got ${describe(item)}`);
        continue;
      }
      const roles: Record<string, Partial<RoleConfig> | null> = {};
      for (const [name, roleValue] of Object.entries(item)) {
        const path = `roles.${name}`;
        if (!ROLE_NAME_RE.test(name)) {
          out.error(path, `role name "${name}" must match ${ROLE_NAME_PATTERN}`);
          continue;
        }
        const role = validateRole(roleValue, path, out);
        if (role !== undefined) roles[name] = role;
      }
      layer.roles = roles;
    } else if (key === "limits") {
      const limits = validateLimits(item, out);
      if (limits !== undefined) layer.limits = limits;
    }
  }
  return { layer, issues: out.issues };
}
