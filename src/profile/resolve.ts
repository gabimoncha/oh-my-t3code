import { DEFAULT_CONFIG } from "../config/defaults.ts";
import { mergeLayer } from "../config/merge.ts";
import { PROFILE_CHAIN_MAX } from "../config/validate.ts";
import type { ConfigIssue, LoadedConfig, OmtConfig, ProfileConfig, Workflow } from "../types.ts";
import { OmtError, usageError } from "../util/errors.ts";

export type ProfileSource = "argument" | "plan" | "config" | "default";

export interface ResolvedProfile {
  name: string;
  source: ProfileSource;
  workflow: Workflow;
  limits: OmtConfig["limits"];
  roles: OmtConfig["roles"];
  models: OmtConfig["models"];
  issues: ConfigIssue[];
}

export interface EffectiveConfigOptions {
  profile?: string | undefined;
  planProfile?: string | undefined;
}

function profileChain(config: OmtConfig, name: string): { name: string; profile: ProfileConfig }[] {
  const chain: { name: string; profile: ProfileConfig }[] = [];
  let current: string | undefined = name;
  while (current !== undefined) {
    const names = [...chain.map((entry) => entry.name), current];
    const text = names.join(" -> ");
    if (chain.some((entry) => entry.name === current)) {
      throw new OmtError("profile_cycle", `profile cycle: ${text}`);
    }
    const profile: ProfileConfig | undefined = Object.hasOwn(config.profiles, current) ? config.profiles[current] : undefined;
    if (profile === undefined) {
      throw usageError(`unknown profile "${current}" in chain: ${text}`, `known profiles: ${Object.keys(config.profiles).join(", ")}`);
    }
    if (names.length > PROFILE_CHAIN_MAX) {
      throw new OmtError("profile_depth", `profile chain exceeds ${PROFILE_CHAIN_MAX} profiles: ${text}`);
    }
    chain.push({ name: current, profile });
    current = profile.extends ?? (current === "normal" ? undefined : "normal");
  }
  return chain.reverse();
}

export function resolveProfile(config: OmtConfig, name: string): ResolvedProfile {
  const chain = profileChain(config, name);
  // Keep the workflow in a temporary profile so mergeLayer also merges its groups and keys.
  let applied: OmtConfig = { ...config, profiles: { normal: structuredClone(DEFAULT_CONFIG.profiles.normal!) } };
  const issues: ConfigIssue[] = [];
  for (const entry of chain) {
    const { roles, limits, models, workflow } = entry.profile;
    const merged = mergeLayer(applied, {
      roles,
      limits,
      models,
      ...(workflow === undefined ? {} : { profiles: { normal: { workflow } } }),
    }, `profile "${entry.name}"`);
    applied = merged.config;
    issues.push(...merged.issues);
  }
  return {
    name,
    source: "argument",
    workflow: applied.profiles.normal!.workflow as Workflow,
    limits: applied.limits,
    roles: applied.roles,
    models: applied.models,
    issues,
  };
}

export function effectiveConfig(loaded: LoadedConfig, options: EffectiveConfigOptions = {}): LoadedConfig & { profile: ResolvedProfile } {
  const name = options.profile ?? options.planProfile ?? loaded.config.profile;
  const profile = resolveProfile(loaded.config, name);
  profile.source = options.profile !== undefined ? "argument"
    : options.planProfile !== undefined ? "plan"
    : loaded.config.profile !== DEFAULT_CONFIG.profile ? "config" : "default";
  return {
    ...loaded,
    config: { ...loaded.config, profile: name, limits: profile.limits, roles: profile.roles, models: profile.models },
    profile,
    issues: [...loaded.issues, ...profile.issues],
  };
}
