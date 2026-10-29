import { effectiveConfig, profileSteps } from "../profile/resolve.ts";
import type { ProfileSource } from "../profile/resolve.ts";
import type { LoadedConfig, OmtConfig } from "../types.ts";
import { isRecord } from "../util/json.ts";
import { configLeaves } from "./defaults.ts";
import { mergeConfigLayers } from "./load.ts";
import type { ConfigFileLayer, MergeStep } from "./load.ts";

export type ExplainSource =
  | { kind: "defaults" }
  | { kind: "user" | "project"; path: string }
  | { kind: "profile"; profile: string; declaredIn: ExplainSource };

export interface ExplainEntry {
  path: string[];
  value: unknown;
  source: ExplainSource;
  overridden: { source: ExplainSource; value: unknown }[]; // lower layers that also set the path, highest first
}

export interface ExplainReport {
  defaults: { source: string };
  profile: { name: string; source: ProfileSource };
  root: ExplainEntry[];
  effective: ExplainEntry[];
  removed: { path: string[]; source: ExplainSource }[];
}

type Touch = "set" | "create" | "remove";

// One merge step in the path space of the entries that it explains. The first step is the base.
interface Step {
  config: unknown;
  layer: unknown;
  source: (path: string[], touch: Touch | undefined) => ExplainSource;
}

function valueAt(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

// A layer creates or removes a role or a profile as a whole.
function holder(path: string[]): string[] | undefined {
  return (path[0] === "roles" || path[0] === "profiles") && path.length >= 2 ? path.slice(0, 2) : undefined;
}

function touch(steps: Step[], index: number, path: string[]): Touch | undefined {
  const step = steps[index]!;
  const before = steps[index - 1]!;
  if (valueAt(step.layer, path) !== undefined && valueAt(step.config, path) !== undefined) return "set";
  const hold = holder(path);
  if (hold === undefined) return undefined;
  const had = valueAt(before.config, hold) !== undefined;
  const has = valueAt(step.config, hold) !== undefined;
  if (!had && has) return valueAt(step.config, path) === undefined ? undefined : "create";
  if (had && !has) return "remove";
  return undefined;
}

function explainPath(steps: Step[], path: string[]): ExplainEntry {
  let winner = 0;
  let won: Touch | undefined;
  for (let index = 1; index < steps.length; index++) {
    const kind = touch(steps, index, path);
    if (kind === "set" || kind === "create") {
      winner = index;
      won = kind;
    }
  }
  const overridden: ExplainEntry["overridden"] = [];
  for (let index = winner - 1; index >= 1; index--) {
    const kind = touch(steps, index, path);
    if (kind === undefined) continue;
    const step = steps[index]!;
    overridden.push({ source: step.source(path, kind), value: kind === "remove" ? null : valueAt(step.config, path) });
  }
  const base = steps[0]!;
  const baseValue = valueAt(base.config, path);
  if (winner !== 0 && baseValue !== undefined) overridden.push({ source: base.source(path, undefined), value: baseValue });
  return {
    path,
    value: valueAt(steps.at(-1)!.config, path),
    source: steps[winner]!.source(path, won),
    overridden,
  };
}

function fileSource(step: MergeStep): ExplainSource {
  return step.kind === "defaults" || step.path === undefined ? { kind: "defaults" } : { kind: step.kind, path: step.path };
}

function removedObjects(steps: MergeStep[]): ExplainReport["removed"] {
  const final = steps.at(-1)!.config;
  const removed: ExplainReport["removed"] = [];
  for (const group of ["roles", "profiles"] as const) {
    const names = new Set(steps.flatMap((step) => Object.keys(step.config[group])));
    for (const name of names) {
      if (Object.hasOwn(final[group], name)) continue;
      const remover = steps.findLast((step) => valueAt(step.layer, [group, name]) === null);
      if (remover !== undefined) removed.push({ path: [group, name], source: fileSource(remover) });
    }
  }
  return removed;
}

function effectiveView(config: OmtConfig) {
  return { roles: config.roles, limits: config.limits, models: config.models, workflow: config.profiles.normal?.workflow };
}

export function explainConfig(
  layers: ConfigFileLayer[],
  loaded: LoadedConfig & { steps?: MergeStep[] },
  profile?: string,
): ExplainReport {
  const defaults: ExplainSource = { kind: "defaults" };
  const mergeSteps = loaded.steps ?? mergeConfigLayers(layers, { config: loaded.defaults, source: loaded.defaultsSource }).steps;
  const rootSteps: Step[] = mergeSteps.map((step) => {
    const source = fileSource(step);
    return { config: step.config, layer: step.layer, source: () => source };
  });
  const root = configLeaves(loaded.config).map((path) => explainPath(rootSteps, path));
  const rootSources = new Map(root.map((entry) => [JSON.stringify(entry.path), entry.source]));
  const rootSource = (path: string[]): ExplainSource => rootSources.get(JSON.stringify(path)) ?? defaults;

  const { profile: resolved } = effectiveConfig(loaded, { profile });
  const chain = profileSteps(loaded.config, resolved.name);
  const effectiveSteps: Step[] = [{
    config: { ...effectiveView(loaded.config), workflow: loaded.defaults.profiles.normal?.workflow },
    layer: undefined,
    source: (path) => (path[0] === "workflow" ? defaults : rootSource(path)),
  }];
  for (const step of chain) {
    const declared = loaded.config.profiles[step.name]!;
    effectiveSteps.push({
      config: effectiveView(step.config),
      layer: { roles: declared.roles, limits: declared.limits, models: declared.models, workflow: declared.workflow },
      source: (path, kind) => {
        // Fields that mergeLayer fills in for a new role derive from its access.
        const field = kind === "create" ? [...path.slice(0, 2), "access"] : kind === "remove" ? path.slice(0, 2) : path;
        return { kind: "profile", profile: step.name, declaredIn: rootSource(["profiles", step.name, ...field]) };
      },
    });
  }
  const effective = configLeaves(effectiveSteps.at(-1)!.config).map((path) => explainPath(effectiveSteps, path));

  return {
    defaults: { source: loaded.defaultsSource },
    profile: { name: resolved.name, source: resolved.source },
    root,
    effective,
    removed: removedObjects(mergeSteps),
  };
}

export function sourceLabel(source: ExplainSource): string {
  if (source.kind === "defaults") return "defaults";
  if (source.kind === "profile") return `profile ${source.profile} (${sourceLabel(source.declaredIn)})`;
  return source.kind;
}
