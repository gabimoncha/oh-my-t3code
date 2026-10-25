import { profileIssues } from "../profile/resolve.ts";
import { findProjectRoot, projectConfigPath, userConfigPath } from "../paths.ts";
import type { ConfigIssue, ConfigLayer, ConfigSource, LoadedConfig, OmtConfig, ProfileConfig } from "../types.ts";
import { OmtError } from "../util/errors.ts";
import { readFileIfExists } from "../util/fs.ts";
import { isRecord } from "../util/json.ts";
import { defaultSet, LATEST_DEFAULT_SET } from "./defaultSets.ts";
import { parseJsonc } from "./jsonc.ts";
import { mergeLayer } from "./merge.ts";
import { validateLayer, validateMergedProfiles } from "./validate.ts";

export interface ConfigFileLayer {
  kind: "user" | "project";
  path: string;
  present: boolean;
  layer: ConfigLayer; // empty when the file is absent or does not parse
  issues: ConfigIssue[]; // parse and validation issues
}

// Parses and validates one config file; `text` is undefined when the file is absent.
export function layerFromText(kind: "user" | "project", path: string, text: string | undefined): ConfigFileLayer {
  const entry: ConfigFileLayer = { kind, path, present: text !== undefined, layer: {}, issues: [] };
  if (text === undefined) return entry;
  let value: unknown;
  try {
    value = parseJsonc(text, path);
  } catch (error) {
    if (!(error instanceof OmtError) || error.code !== "jsonc_parse") throw error;
    const message = error.message.startsWith(`${path}:`) ? error.message.slice(path.length + 1) : error.message;
    entry.issues.push({ source: path, path: "", message, severity: "error" });
    return entry;
  }
  const validated = validateLayer(value, path);
  entry.layer = validated.layer;
  entry.issues.push(...validated.issues);
  if (kind === "project" && isRecord(value) && Object.hasOwn(value, "update")) {
    delete entry.layer.update;
    const message = `update is read only from the user config; remove it from ${path}`;
    entry.issues = entry.issues.filter((issue) => issue.path !== "update");
    entry.issues.push({ source: path, path: "update", message, severity: "warning" });
  }
  return entry;
}

// Reads, parses, and validates the user and the project config files, in that order.
export async function readConfigLayers(opts: {
  cwd: string;
  env: Record<string, string | undefined>;
  homedir: string;
}): Promise<ConfigFileLayer[]> {
  const files: { kind: "user" | "project"; path: string }[] = [
    { kind: "user", path: userConfigPath(opts.env, opts.homedir) },
    { kind: "project", path: projectConfigPath(findProjectRoot(opts.cwd)) },
  ];
  const layers: ConfigFileLayer[] = [];
  for (const file of files) layers.push(layerFromText(file.kind, file.path, await readFileIfExists(file.path)));
  return layers;
}

// The config after one merge step: the cloned default set first, then each present file layer.
export interface MergeStep {
  kind: "defaults" | "user" | "project";
  path?: string;
  layer: ConfigLayer;
  config: OmtConfig;
}

export async function loadConfig(opts: {
  cwd: string;
  env: Record<string, string | undefined>;
  homedir: string;
}): Promise<LoadedConfig> {
  const { steps: _steps, ...loaded } = mergeConfigLayers(await readConfigLayers(opts));
  return loaded;
}

export function mergeConfigLayers(layers: ConfigFileLayer[]): LoadedConfig & { steps: MergeStep[] } {
  // The project layer's set wins over the user layer's, before any layer merges.
  let defaultsSource = "latest";
  let selected = LATEST_DEFAULT_SET;
  for (const { path, layer } of layers) {
    if (layer.defaults === undefined) continue;
    selected = layer.defaults;
    defaultsSource = path;
  }
  let config: OmtConfig = structuredClone(defaultSet(selected));
  config.defaults = selected;
  const steps: MergeStep[] = [{ kind: "defaults", layer: {}, config }];
  const sources: ConfigSource[] = [{ kind: "defaults", present: true }];
  const issues: ConfigIssue[] = [];
  const profileSources = new Map<string, string>();
  // New profiles that mergeLayer drops because they lack a description, one entry per layer.
  const dropped: { name: string; profile: Partial<ProfileConfig>; source: string }[] = [];
  let selectionSource = "defaults";
  for (const file of layers) {
    sources.push({ kind: file.kind, path: file.path, present: file.present });
    issues.push(...file.issues);
    if (!file.present) continue;
    const layer = file.layer;
    for (const [name, profile] of Object.entries(layer.profiles ?? {})) {
      if (profile !== null && profile.description === undefined && !Object.hasOwn(config.profiles, name)) {
        dropped.push({ name, profile: structuredClone(profile), source: file.path });
      }
    }
    const merged = mergeLayer(config, layer, file.path);
    issues.push(...merged.issues);
    config = merged.config;
    steps.push({ kind: file.kind, path: file.path, layer, config });
    if (layer.profile !== undefined) selectionSource = file.path;
    for (const name of Object.keys(layer.profiles ?? {})) {
      if (Object.hasOwn(config.profiles, name)) profileSources.set(name, file.path);
      else profileSources.delete(name);
    }
  }
  issues.push(...validateMergedProfiles(config, profileSources, selectionSource));
  issues.push(...profileIssues(config, profileSources));
  // Check a dropped profile on a copy, so that its parent and role errors are reported too.
  for (const { name, profile, source } of dropped) {
    const copy = structuredClone(config);
    copy.profiles[name] = { ...profile, description: "" };
    const sources = new Map(profileSources).set(name, source);
    const chainIssues = validateMergedProfiles(copy, sources, selectionSource);
    issues.push(...chainIssues.filter((issue) => issue.path === `profiles.${name}.extends`));
    issues.push(...profileIssues(copy, sources, [name]));
  }
  return { config, sources, issues, defaultsSource, steps };
}
