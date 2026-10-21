import type { ConfigIssue, ConfigLayer, ModelConfig, OmtConfig, ProfileConfig, RoleConfig, WorkflowLayer } from "../types.ts";
import { PRESET_PROFILE_NAMES } from "./validate.ts";

const REQUIRED_FOR_NEW_ROLE = ["description", "access", "chain"] as const;

function completeRole(partial: Partial<RoleConfig>): RoleConfig | string[] {
  const missing = REQUIRED_FOR_NEW_ROLE.filter((key) => partial[key] === undefined);
  const { description, access, chain } = partial;
  if (description === undefined || access === undefined || chain === undefined) return missing;
  const edit = access === "edit";
  return {
    description,
    access,
    result: partial.result ?? (edit ? "work" : "research"),
    t3Role: partial.t3Role ?? (edit ? "implementation" : "research"),
    interactionMode: partial.interactionMode ?? (edit ? "default" : "plan"),
    runtimeMode: partial.runtimeMode ?? "inherit",
    ...(partial.crossFamily === undefined ? {} : { crossFamily: partial.crossFamily }),
    ...(partial.fast === undefined ? {} : { fast: partial.fast }),
    chain,
  };
}

function mergeModels(base: Record<string, ModelConfig>, layer: Record<string, ModelConfig>): Record<string, ModelConfig> {
  const models = { ...base };
  for (const [name, value] of Object.entries(layer)) {
    models[name] = { ...(Object.hasOwn(models, name) ? models[name] : {}), ...value };
  }
  return models;
}

function mergeProfile(base: ProfileConfig, layer: Partial<ProfileConfig>): ProfileConfig {
  const profile = { ...base, ...layer };
  if (layer.workflow !== undefined) {
    const workflow: WorkflowLayer = { ...base.workflow };
    for (const group of Object.keys(layer.workflow) as (keyof WorkflowLayer)[]) {
      Object.assign(workflow, { [group]: { ...base.workflow?.[group], ...layer.workflow[group] } });
    }
    profile.workflow = workflow;
  }
  if (layer.limits !== undefined) profile.limits = { ...base.limits, ...layer.limits };
  if (layer.models !== undefined) profile.models = mergeModels(base.models ?? {}, layer.models);
  if (layer.roles !== undefined) {
    const roles = { ...base.roles };
    for (const [name, value] of Object.entries(layer.roles)) {
      const existing = Object.hasOwn(roles, name) ? roles[name] : undefined;
      roles[name] = value === null ? null : { ...existing, ...value };
    }
    profile.roles = roles;
  }
  return profile;
}

export function mergeLayer(
  base: OmtConfig,
  layer: ConfigLayer,
  source: string,
): { config: OmtConfig; issues: ConfigIssue[] } {
  const config = structuredClone(base);
  const issues: ConfigIssue[] = [];
  for (const [name, value] of Object.entries(structuredClone(layer.roles ?? {}))) {
    const path = `roles.${name}`;
    const existing = Object.hasOwn(config.roles, name) ? config.roles[name] : undefined;
    if (value === null) {
      if (existing === undefined) {
        issues.push({ source, path, message: `no role named "${name}" to remove`, severity: "warning" });
      }
      delete config.roles[name];
    } else if (existing !== undefined) {
      config.roles[name] = { ...existing, ...value };
    } else {
      const role = completeRole(value);
      if (Array.isArray(role)) {
        issues.push({
          source,
          path,
          message: `a new role needs description, access, and chain; missing: ${role.join(", ")}`,
          severity: "error",
        });
      } else {
        config.roles[name] = role;
      }
    }
  }
  for (const [name, value] of Object.entries(structuredClone(layer.profiles ?? {}))) {
    const path = `profiles.${name}`;
    const existing = Object.hasOwn(config.profiles, name) ? config.profiles[name] : undefined;
    if (value === null) {
      if (PRESET_PROFILE_NAMES.includes(name)) {
        issues.push({ source, path, message: `cannot remove preset profile "${name}"`, severity: "error" });
      } else {
        if (existing === undefined) {
          issues.push({ source, path, message: `no profile named "${name}" to remove`, severity: "warning" });
        }
        delete config.profiles[name];
      }
    } else if (existing !== undefined) {
      config.profiles[name] = mergeProfile(existing, value);
    } else if (value.description === undefined) {
      issues.push({ source, path, message: "a new profile needs description; missing: description", severity: "error" });
    } else {
      config.profiles[name] = { ...value, description: value.description };
    }
  }
  if (layer.profile !== undefined) config.profile = layer.profile;
  config.models = mergeModels(config.models, structuredClone(layer.models ?? {}));
  Object.assign(config.limits, layer.limits ?? {});
  Object.assign(config.visuals, layer.visuals ?? {});
  if (layer.harnesses !== undefined) config.harnesses = [...layer.harnesses];
  return { config, issues };
}
