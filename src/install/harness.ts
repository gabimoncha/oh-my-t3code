import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { t3SettingsPath } from "../paths.ts";
import { DEFAULT_CONFIG } from "../config/defaults.ts";
import type { Capabilities, HarnessReport, HarnessStatus, RoleConfig, T3DriverStatus } from "../types.ts";
import { readFileIfExists } from "../util/fs.ts";
import { isRecord } from "../util/json.ts";

// The drivers that the default roles use, in the order that `recommended` lists them.
export const DEFAULT_HARNESSES: readonly string[] = ["claudeAgent", "codex"];

const EXECUTABLES: Readonly<Record<string, string>> = { claudeAgent: "claude", codex: "codex" };

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false;
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findExecutable(name: string, env: Record<string, string | undefined>): Promise<string | null> {
  const names = process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`, name] : [name];
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    for (const file of names) {
      const path = join(dir, file);
      if (await isExecutableFile(path)) return path;
    }
  }
  return null;
}

function instanceEnabled(instance: Record<string, unknown>): boolean {
  const config = isRecord(instance.config) ? instance.config : {};
  if (instance.enabled === false || config.enabled === false) return false;
  // T3 starts codex and claudeAgent enabled, so an instance without a flag is enabled.
  return true;
}

// T3's status of each default driver, from the providerInstances map of its settings file.
export function t3DriverStatus(text: string | undefined): Record<string, T3DriverStatus> {
  const unknown = Object.fromEntries(DEFAULT_HARNESSES.map((driver) => [driver, "unknown" as const]));
  if (text === undefined) return unknown;
  let settings: unknown;
  try {
    settings = JSON.parse(text);
  } catch {
    return unknown;
  }
  if (!isRecord(settings)) return unknown;
  const map = isRecord(settings.providerInstances) ? settings.providerInstances : {};
  const instances = Object.entries(map).flatMap(([id, value]) =>
    isRecord(value) && typeof value.driver === "string" ? [{ id, driver: value.driver, value }] : [],
  );
  const status: Record<string, T3DriverStatus> = {};
  for (const driver of DEFAULT_HARNESSES) {
    const implicit = !instances.some((instance) => instance.id === driver);
    const enabled = implicit || instances.some((instance) => instance.driver === driver && instanceEnabled(instance.value));
    status[driver] = enabled ? "enabled" : "disabled";
  }
  return status;
}

function fromCapabilities(driver: string, caps: Capabilities): HarnessStatus {
  const providers = caps.providers.filter((provider) => provider.driverKind === driver);
  const runnable = providers.filter((provider) => provider.canRunChildTask);
  const t3 = providers.length > 0 ? "enabled" : "unknown";
  if (runnable.length > 0) {
    const ids = runnable.map((provider) => provider.providerInstanceId).join(", ");
    return { driver, detected: true, t3, executable: null, reason: `T3 provider ${ids} can run child tasks` };
  }
  if (providers.length === 0) {
    return { driver, detected: false, t3, executable: null, reason: `no T3 provider with driver ${driver}` };
  }
  const why = providers.map((provider) => {
    const constraints = provider.constraints.length > 0 ? provider.constraints.join("; ") : "no reason given";
    return `${provider.providerInstanceId}: ${constraints}`;
  });
  return { driver, detected: false, t3, executable: null, reason: `cannot run child tasks (${why.join("; ")})` };
}

// Detects the harnesses that can run omt's child tasks. Capabilities, when given, decide alone.
export async function detectHarnesses(opts: {
  env: Record<string, string | undefined>;
  homedir: string;
  capabilities?: Capabilities | undefined;
}): Promise<HarnessReport> {
  const { capabilities } = opts;
  let harnesses: HarnessStatus[];
  if (capabilities !== undefined) {
    harnesses = DEFAULT_HARNESSES.map((driver) => fromCapabilities(driver, capabilities));
  } else {
    let text: string | undefined;
    try {
      text = await readFileIfExists(t3SettingsPath(opts.env, opts.homedir));
    } catch {
      text = undefined;
    }
    const t3 = t3DriverStatus(text);
    harnesses = [];
    for (const driver of DEFAULT_HARNESSES) {
      const name = EXECUTABLES[driver] as string;
      const status = t3[driver] ?? "unknown";
      const executable = await findExecutable(name, opts.env);
      const detected = status !== "disabled" && executable !== null;
      const reason = `T3 ${status}, ${executable ?? `${name} not on PATH`}`;
      harnesses.push({ driver, detected, t3: status, executable, reason });
    }
  }
  const recommended = harnesses.filter((harness) => harness.detected).map((harness) => harness.driver);
  return { source: capabilities === undefined ? "local" : "capabilities", harnesses, recommended };
}

// Whether every default driver is detected, so that no harnesses key is needed.
export function allDetected(report: HarnessReport): boolean {
  return report.recommended.length === DEFAULT_HARNESSES.length;
}

// The effect of a harnesses value on the default roles, one line each.
export function harnessEffects(harnesses: readonly string[], roles: Record<string, RoleConfig> = DEFAULT_CONFIG.roles): string[] {
  const effects: string[] = [];
  const unavailable = ["design", "ui"].filter((name) => {
    const role = roles[name];
    return role !== undefined && !role.chain.some((entry) => harnesses.includes(entry.driver ?? entry.provider ?? ""));
  });
  if (unavailable.length > 0) effects.push(`${unavailable.join(" and ")}: unavailable with the detected harnesses`);
  if (DEFAULT_HARNESSES.filter((driver) => harnesses.includes(driver)).length === 1) {
    effects.push("cross-family review: the same family reviews");
  }
  return effects;
}

export function formatHarnessLine(harness: HarnessStatus): string {
  return `${harness.driver.padEnd(11)}  ${harness.detected ? "detected" : "not detected"}  ${harness.reason}\n`;
}

export function formatHarnessValue(value: readonly string[] | undefined): string {
  return value === undefined ? "none" : JSON.stringify(value);
}
