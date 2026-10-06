import type {
  Capabilities,
  ModelCapability,
  OmtConfig,
  OptionDescriptor,
  OptionValue,
  ProviderCapability,
  ResolvedTarget,
  RoleConfig,
  RoleResolution,
  RolesReport,
  RouteOutput,
  Rung,
  RungAttempt,
} from "../types.ts";
import { OmtError } from "../util/errors.ts";
import { mapEffort } from "./effort.ts";

const RUNTIME_RANK = ["approval-required", "auto-accept-edits", "auto", "full-access"];

class RungFailure extends Error {}

function modeCeiling(role: RoleConfig, caps: Capabilities): string | undefined {
  if (caps.interactionMode === "plan" && (role.access === "edit" || role.interactionMode === "default")) {
    return "the parent thread is in plan mode; this role needs default mode";
  }
  if (role.runtimeMode !== "inherit" && caps.runtimeMode !== undefined) {
    const parentRank = RUNTIME_RANK.indexOf(caps.runtimeMode);
    if (parentRank >= 0 && RUNTIME_RANK.indexOf(role.runtimeMode) > parentRank) {
      return `role runtime mode ${role.runtimeMode} is broader than the parent's ${caps.runtimeMode}`;
    }
  }
  return undefined;
}

function findProvider(rung: Rung, caps: Capabilities): ProviderCapability {
  if (rung.provider !== undefined) {
    const provider = caps.providers.find((p) => p.providerInstanceId === rung.provider);
    if (provider === undefined) throw new RungFailure(`provider instance ${rung.provider} is not registered in T3`);
    if (rung.driver !== undefined && provider.driverKind !== rung.driver) {
      throw new RungFailure(
        `provider instance ${rung.provider} has driver ${provider.driverKind}, not ${rung.driver}`,
      );
    }
    return provider;
  }
  if (rung.driver === undefined) throw new RungFailure("the rung names no provider or driver");
  const ofKind = caps.providers.filter((p) => p.driverKind === rung.driver);
  const inherited = ofKind.find((p) => p.providerInstanceId === caps.inheritedProviderInstanceId && p.canRunChildTask);
  const provider = inherited ?? ofKind.find((p) => p.canRunChildTask) ?? ofKind[0];
  if (provider === undefined) throw new RungFailure(`no provider instance with driver ${rung.driver}`);
  return provider;
}

function optionProblems(options: Record<string, OptionValue>, descriptors: OptionDescriptor[], model: string): string[] {
  const problems: string[] = [];
  for (const [id, value] of Object.entries(options)) {
    const descriptor = descriptors.find((d) => d.id === id);
    if (descriptor === undefined) {
      problems.push(`option ${id} is not advertised by model ${model}`);
    } else if (descriptor.type === "boolean" && typeof value !== "boolean") {
      problems.push(`option ${id} needs a boolean, got ${JSON.stringify(value)}`);
    } else if (descriptor.type === "select") {
      const choices = (descriptor.options ?? []).map((c) => c.id);
      if (typeof value !== "string" || !choices.includes(value)) {
        problems.push(`option ${id} value ${JSON.stringify(value)} is not one of: ${choices.join(", ")}`);
      }
    }
  }
  return problems;
}

function makeTarget(
  ref: { providerInstanceId: string } | { driverKind: string },
  model: string,
  options: Record<string, OptionValue>,
): ResolvedTarget {
  const target: ResolvedTarget = { ...ref, model };
  if (Object.keys(options).length > 0) target.options = options;
  return target;
}

function resolveVerified(rung: Rung, caps: Capabilities, notes: string[]): ResolvedTarget {
  const provider = findProvider(rung, caps);
  const id = provider.providerInstanceId;
  if (!provider.canRunChildTask) {
    const why = provider.constraints.length > 0 ? provider.constraints.join("; ") : "no reason given";
    throw new RungFailure(`provider ${id} cannot run child tasks: ${why}`);
  }
  let model: ModelCapability | undefined;
  if (provider.models.length > 0) {
    model = provider.models.find((m) => m.id === rung.model);
    if (model === undefined) throw new RungFailure(`model ${rung.model} is not advertised by ${id}`);
  } else {
    notes.push(`provider ${id} lists no models; T3 will check the model and its options`);
  }
  let options: Record<string, OptionValue> = {};
  if (rung.effort !== undefined) {
    const mapped = mapEffort(rung.effort, model?.options, provider.driverKind);
    options = mapped.options;
    if (mapped.note !== undefined) notes.push(mapped.note);
  }
  options = { ...options, ...rung.options };
  if (model !== undefined && model.options.length > 0) {
    const problems = optionProblems(options, model.options, model.id);
    if (problems.length > 0) throw new RungFailure(`invalid options: ${problems.join("; ")}`);
  } else if (model !== undefined && Object.keys(options).length > 0) {
    notes.push("the model advertises no options; T3 will not check them");
  }
  return makeTarget({ providerInstanceId: id }, rung.model, options);
}

function resolveUnverified(rung: Rung, notes: string[]): ResolvedTarget {
  if (rung.provider === undefined && rung.driver === undefined) {
    throw new RungFailure("the rung names no provider or driver");
  }
  let options: Record<string, OptionValue> = {};
  if (rung.effort !== undefined) {
    const mapped = mapEffort(rung.effort, undefined, rung.driver ?? rung.provider);
    options = mapped.options;
    if (mapped.note !== undefined) notes.push(mapped.note);
  }
  options = { ...options, ...rung.options };
  const ref = rung.provider !== undefined ? { providerInstanceId: rung.provider } : { driverKind: rung.driver as string };
  return makeTarget(ref, rung.model, options);
}

function attempt(index: number, rung: Rung, caps: Capabilities | undefined, ceiling: string | undefined): RungAttempt {
  const notes: string[] = [];
  if (ceiling !== undefined) return { index, rung, ok: false, reason: ceiling, notes };
  try {
    const target = caps === undefined ? resolveUnverified(rung, notes) : resolveVerified(rung, caps, notes);
    return { index, rung, ok: true, notes, target };
  } catch (error) {
    if (!(error instanceof RungFailure)) throw error;
    return { index, rung, ok: false, reason: error.message, notes };
  }
}

export function resolveRole(name: string, role: RoleConfig, caps?: Capabilities): RoleResolution {
  const ceiling = caps === undefined ? undefined : modeCeiling(role, caps);
  const attempts = role.chain.map((rung, index) => attempt(index, rung, caps, ceiling));
  const targets = attempts.flatMap((a) => (a.target === undefined ? [] : [a.target]));
  const [first, ...fallbacks] = targets;
  return {
    role: name,
    description: role.description,
    access: role.access,
    result: role.result,
    t3Role: role.t3Role,
    interactionMode: role.interactionMode,
    runtimeMode: role.runtimeMode,
    status: first === undefined ? "unavailable" : caps === undefined ? "unverified" : "resolved",
    ...(first === undefined
      ? {}
      : {
          delegateTask: {
            target: first,
            role: role.t3Role,
            interactionMode: role.interactionMode,
            runtimeMode: role.runtimeMode,
          },
        }),
    fallbacks,
    attempts,
  };
}

export function resolveAll(config: OmtConfig, caps?: Capabilities, only?: string[]): RolesReport {
  const known = Object.keys(config.roles);
  const names = only === undefined ? known : [...new Set(only)];
  const roles: Record<string, RoleResolution> = {};
  for (const name of names) {
    const role = Object.hasOwn(config.roles, name) ? config.roles[name] : undefined;
    if (role === undefined) {
      throw new OmtError("unknown_role", `unknown role ${name}; known roles: ${known.join(", ")}`);
    }
    roles[name] = resolveRole(name, role, caps);
  }
  return { version: 1, verified: caps !== undefined, roles, limits: config.limits };
}

export function toRouteOutput(resolution: RoleResolution): RouteOutput {
  const notes: string[] = [];
  for (const a of resolution.attempts) {
    for (const note of a.notes) notes.push(`rung ${a.index + 1}: ${note}`);
    if (a.reason !== undefined) notes.push(`rung ${a.index + 1}: ${a.reason}`);
  }
  return {
    role: resolution.role,
    status: resolution.status,
    description: resolution.description,
    access: resolution.access,
    result: resolution.result,
    ...(resolution.delegateTask === undefined ? {} : { delegateTask: resolution.delegateTask }),
    fallbacks: resolution.fallbacks,
    notes,
  };
}
