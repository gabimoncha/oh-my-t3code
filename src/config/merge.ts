import type { ConfigIssue, ConfigLayer, OmtConfig, RoleConfig } from "../types.ts";

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
    chain,
  };
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
  Object.assign(config.limits, layer.limits ?? {});
  Object.assign(config.visuals, layer.visuals ?? {});
  return { config, issues };
}
