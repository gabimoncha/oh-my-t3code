import type {
  Capabilities,
  ModelCapability,
  ModelConfig,
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
import { crossFamilyOrder, rungFamily, workerFamily } from "./family.ts";

export interface ResolveOptions {
  models?: Record<string, ModelConfig>;
  against?: string; // provider instance id or driver kind of the worker whose change the task reviews
  notes?: string[]; // role-level notes to put before the notes that resolveRole adds
  drivers?: Map<string, string>; // provider instance id to driver kind (configuredDrivers), for the worker and for every rung
}

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

function providerOfDriver(driver: string, caps: Capabilities): ProviderCapability | undefined {
  const ofKind = caps.providers.filter((p) => p.driverKind === driver);
  const inherited = ofKind.find((p) => p.providerInstanceId === caps.inheritedProviderInstanceId && p.canRunChildTask);
  return inherited ?? ofKind.find((p) => p.canRunChildTask) ?? ofKind[0];
}

function findProvider(rung: Rung, caps: Capabilities, notes: string[]): ProviderCapability {
  if (rung.provider !== undefined) {
    const provider = caps.providers.find((p) => p.providerInstanceId === rung.provider);
    if (provider !== undefined) {
      if (rung.driver !== undefined && provider.driverKind !== rung.driver) {
        throw new RungFailure(
          `provider instance ${rung.provider} has driver ${provider.driverKind}, not ${rung.driver}`,
        );
      }
      return provider;
    }
    const missing = `provider instance ${rung.provider} is not registered in T3`;
    if (rung.driver === undefined) throw new RungFailure(missing);
    // The default rungs name the built-in instance ids. A T3 whose instances have other ids still runs them by driver.
    const byDriver = providerOfDriver(rung.driver, caps);
    if (byDriver === undefined) throw new RungFailure(`${missing}; no provider instance with driver ${rung.driver}`);
    notes.push(
      `provider instance ${rung.provider} is not registered; using instance ${byDriver.providerInstanceId} of driver ${rung.driver}`,
    );
    return byDriver;
  }
  if (rung.driver === undefined) throw new RungFailure("the rung names no provider or driver");
  const provider = providerOfDriver(rung.driver, caps);
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

function rungOptions(
  rung: Rung,
  fast: boolean,
  descriptors: OptionDescriptor[] | undefined,
  driver: string | undefined,
  provider: string,
  notes: string[],
  verified = false,
): Record<string, OptionValue> {
  const options: Record<string, OptionValue> = {};
  if (rung.effort !== undefined) {
    const mapped = mapEffort(rung.effort, descriptors, driver);
    Object.assign(options, mapped.options);
    if (mapped.note !== undefined) notes.push(mapped.note);
  }
  if (fast) Object.assign(options, fastOptions(rung.model, descriptors ?? (verified ? [] : undefined), driver, provider, notes));
  return { ...options, ...rung.options };
}

function fastOptions(
  model: string,
  descriptors: OptionDescriptor[] | undefined,
  driver: string | undefined,
  provider: string,
  notes: string[],
): Record<string, OptionValue> {
  if (descriptors !== undefined) {
    if (descriptors.some((d) => d.id === "serviceTier" && d.type === "select" && d.options?.some((c) => c.id === "priority"))) {
      return { serviceTier: "priority" };
    }
    if (descriptors.some((d) => d.id === "fastMode" && d.type === "boolean")) return { fastMode: true };
  } else {
    if (driver === "codex") return { serviceTier: "priority" };
    if (driver === "claudeAgent" && model.startsWith("claude-opus")) return { fastMode: true };
  }
  notes.push(`fast mode is not offered by ${provider}/${model}`);
  return {};
}

function resolveVerified(rung: Rung, fast: boolean, caps: Capabilities, notes: string[]): ResolvedTarget {
  const provider = findProvider(rung, caps, notes);
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
  const options = rungOptions(rung, fast, model?.options, provider.driverKind, id, notes, true);
  if (model !== undefined && model.options.length > 0) {
    const problems = optionProblems(options, model.options, model.id);
    if (problems.length > 0) throw new RungFailure(`invalid options: ${problems.join("; ")}`);
  } else if (model !== undefined && Object.keys(options).length > 0) {
    notes.push("the model advertises no options; T3 will not check them");
  }
  return makeTarget({ providerInstanceId: id }, rung.model, options);
}

function resolveUnverified(rung: Rung, fast: boolean, notes: string[]): ResolvedTarget {
  if (rung.provider === undefined && rung.driver === undefined) {
    throw new RungFailure("the rung names no provider or driver");
  }
  const options = rungOptions(rung, fast, undefined, rung.driver ?? rung.provider, rung.provider ?? rung.driver as string, notes);
  const ref = rung.provider !== undefined ? { providerInstanceId: rung.provider } : { driverKind: rung.driver as string };
  return makeTarget(ref, rung.model, options);
}

function attempt(index: number, rung: Rung, fast: boolean, caps: Capabilities | undefined, ceiling: string | undefined): RungAttempt {
  const notes: string[] = [];
  if (ceiling !== undefined) return { index, rung, ok: false, reason: ceiling, notes };
  try {
    const target = caps === undefined ? resolveUnverified(rung, fast, notes) : resolveVerified(rung, fast, caps, notes);
    return { index, rung, ok: true, notes, target };
  } catch (error) {
    if (!(error instanceof RungFailure)) throw error;
    return { index, rung, ok: false, reason: error.message, notes };
  }
}

export function resolveRole(
  name: string,
  role: RoleConfig,
  caps?: Capabilities,
  options: ResolveOptions = {},
): RoleResolution {
  const notes = [...(options.notes ?? [])];
  const { drivers } = options;
  let order = role.chain.map((_, index) => index);
  let family: string | undefined;
  if (options.against !== undefined) {
    if (role.crossFamily === true) {
      const worker = workerFamily(options.against, caps, drivers);
      if (role.chain.some((rung) => rungFamily(rung, caps, drivers) === worker)) {
        family = worker;
        order = crossFamilyOrder(role.chain, family, caps, drivers);
        const moved = order.some((index, position) => index !== position);
        notes.push(
          moved
            ? `cross-family: worker family ${family}; other families first`
            : `cross-family: worker family ${family}; the configured order applies`,
        );
      } else {
        notes.push(
          `cross-family: no rung is in family ${worker}; check that --against names a driver or a configured provider, or pass --capabilities`,
        );
      }
    } else {
      notes.push(`role ${name} is not cross-family; --against has no effect`);
    }
  }
  const ceiling = caps === undefined ? undefined : modeCeiling(role, caps);
  const attempts = order.map((index) => {
    const rung = role.chain[index] as Rung;
    const model = options.models !== undefined && Object.hasOwn(options.models, rung.model) ? options.models[rung.model] : undefined;
    return attempt(index, rung, rung.fast ?? role.fast ?? model?.fast ?? false, caps, ceiling);
  });
  const chosen = attempts.find((a) => a.ok);
  if (family !== undefined && chosen !== undefined && rungFamily(chosen.rung, caps, drivers) === family) {
    notes.push(`cross-family: no rung outside family ${family} is available; the same family reviews`);
  }
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
    crossFamily: role.crossFamily === true,
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
    ...(notes.length === 0 ? {} : { notes }),
  };
}

export function findRole(config: OmtConfig, name: string): RoleConfig {
  const role = Object.hasOwn(config.roles, name) ? config.roles[name] : undefined;
  if (role === undefined) {
    throw new OmtError("unknown_role", `unknown role ${name}; known roles: ${Object.keys(config.roles).join(", ")}`);
  }
  return role;
}

export function resolveAll(config: OmtConfig, caps?: Capabilities, only?: string[]): RolesReport {
  const known = Object.keys(config.roles);
  const names = only === undefined ? known : [...new Set(only)];
  const roles: Record<string, RoleResolution> = {};
  for (const name of names) {
    const role = findRole(config, name);
    roles[name] = resolveRole(name, role, caps, { models: config.models });
  }
  return { version: 1, verified: caps !== undefined, roles, limits: config.limits };
}

export function toRouteOutput(resolution: RoleResolution): RouteOutput {
  const notes: string[] = [...(resolution.notes ?? [])];
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
