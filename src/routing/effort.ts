import { EFFORT_LADDER } from "../types.ts";
import type { Effort, OptionDescriptor, OptionValue } from "../types.ts";

export interface EffortMapping {
  options: Record<string, OptionValue>;
  note?: string;
}

const EFFORT_OPTION_IDS = ["effort", "reasoningEffort", "reasoning_effort", "reasoning", "variant", "thinking"];

interface DriverRule {
  optionId: string;
  map: (effort: Effort) => Effort;
}

function lowFloor(effort: Effort): Effort {
  return effort === "off" || effort === "minimal" ? "low" : effort;
}

const DRIVER_RULES: Record<string, DriverRule> = {
  claudeAgent: { optionId: "effort", map: lowFloor },
  codex: { optionId: "reasoningEffort", map: lowFloor },
  grok: { optionId: "reasoningEffort", map: (effort) => effort },
  pi: { optionId: "thinking", map: (effort) => effort },
  opencode: { optionId: "variant", map: (effort) => (effort === "max" ? "xhigh" : lowFloor(effort)) },
};

function rank(id: string): number {
  return EFFORT_LADDER.indexOf(id as Effort);
}

function mappedNote(requested: Effort, used: string, optionId: string): string {
  return `effort ${requested} mapped to ${used} for option ${optionId}`;
}

function ladderChoices(descriptor: OptionDescriptor): string[] {
  if (descriptor.type !== "select") return [];
  return (descriptor.options ?? []).map((choice) => choice.id).filter((id) => rank(id) >= 0);
}

function fromDescriptors(effort: Effort, descriptors: OptionDescriptor[]): EffortMapping {
  for (const optionId of EFFORT_OPTION_IDS) {
    const descriptor = descriptors.find((d) => d.id === optionId);
    if (descriptor === undefined) continue;
    const choices = ladderChoices(descriptor);
    if (choices.length === 0) continue;
    if (choices.includes(effort)) return { options: { [optionId]: effort } };
    const wanted = rank(effort);
    const below = choices.filter((id) => rank(id) < wanted).sort((a, b) => rank(b) - rank(a));
    const above = choices.filter((id) => rank(id) > wanted).sort((a, b) => rank(a) - rank(b));
    const used = (below[0] ?? above[0]) as string;
    return { options: { [optionId]: used }, note: mappedNote(effort, used, optionId) };
  }
  return { options: {}, note: `effort ${effort} not applied: the model advertises no effort option` };
}

export function mapEffort(
  effort: Effort,
  descriptors: OptionDescriptor[] | undefined,
  driverKind: string | undefined,
): EffortMapping {
  if (descriptors !== undefined) return fromDescriptors(effort, descriptors);
  const rule = driverKind !== undefined && Object.hasOwn(DRIVER_RULES, driverKind) ? DRIVER_RULES[driverKind] : undefined;
  if (rule === undefined) {
    return { options: {}, note: `effort ${effort} not applied: unknown option for driver ${driverKind ?? "(none)"}` };
  }
  const used = rule.map(effort);
  const mapping: EffortMapping = { options: { [rule.optionId]: used } };
  if (used !== effort) mapping.note = mappedNote(effort, used, rule.optionId);
  return mapping;
}
