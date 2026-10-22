import { profileIssues } from "../profile/resolve.ts";
import { findProjectRoot, projectConfigPath, userConfigPath } from "../paths.ts";
import type { ConfigIssue, ConfigLayer, ConfigSource, LoadedConfig, OmtConfig, ProfileConfig } from "../types.ts";
import { OmtError } from "../util/errors.ts";
import { readFileIfExists } from "../util/fs.ts";
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
  for (const file of files) {
    const text = await readFileIfExists(file.path);
    const entry: ConfigFileLayer = { ...file, present: text !== undefined, layer: {}, issues: [] };
    layers.push(entry);
    if (text === undefined) continue;
    let value: unknown;
    try {
      value = parseJsonc(text, file.path);
    } catch (error) {
      if (!(error instanceof OmtError) || error.code !== "jsonc_parse") throw error;
      const message = error.message.startsWith(`${file.path}:`) ? error.message.slice(file.path.length + 1) : error.message;
      entry.issues.push({ source: file.path, path: "", message, severity: "error" });
      continue;
    }
    const validated = validateLayer(value, file.path);
    entry.layer = validated.layer;
    entry.issues.push(...validated.issues);
  }
  return layers;
}

export async function loadConfig(opts: {
  cwd: string;
  env: Record<string, string | undefined>;
  homedir: string;
}): Promise<LoadedConfig> {
  const layers = await readConfigLayers(opts);
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
  return { config, sources, issues, defaultsSource };
}
