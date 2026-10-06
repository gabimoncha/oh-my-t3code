import { findProjectRoot, projectConfigPath, userConfigPath } from "../paths.ts";
import type { ConfigIssue, ConfigSource, LoadedConfig, OmtConfig } from "../types.ts";
import { OmtError } from "../util/errors.ts";
import { readFileIfExists } from "../util/fs.ts";
import { DEFAULT_CONFIG } from "./defaults.ts";
import { parseJsonc } from "./jsonc.ts";
import { mergeLayer } from "./merge.ts";
import { validateLayer } from "./validate.ts";

export async function loadConfig(opts: {
  cwd: string;
  env: Record<string, string | undefined>;
  homedir: string;
}): Promise<LoadedConfig> {
  const files: { kind: "user" | "project"; path: string }[] = [
    { kind: "user", path: userConfigPath(opts.env, opts.homedir) },
    { kind: "project", path: projectConfigPath(findProjectRoot(opts.cwd)) },
  ];
  let config: OmtConfig = structuredClone(DEFAULT_CONFIG);
  const sources: ConfigSource[] = [{ kind: "defaults", present: true }];
  const issues: ConfigIssue[] = [];
  for (const file of files) {
    const text = await readFileIfExists(file.path);
    sources.push({ kind: file.kind, path: file.path, present: text !== undefined });
    if (text === undefined) continue;
    let value: unknown;
    try {
      value = parseJsonc(text, file.path);
    } catch (error) {
      if (!(error instanceof OmtError) || error.code !== "jsonc_parse") throw error;
      const message = error.message.startsWith(`${file.path}:`) ? error.message.slice(file.path.length + 1) : error.message;
      issues.push({ source: file.path, path: "", message, severity: "error" });
      continue;
    }
    const validated = validateLayer(value, file.path);
    issues.push(...validated.issues);
    const merged = mergeLayer(config, validated.layer, file.path);
    issues.push(...merged.issues);
    config = merged.config;
  }
  return { config, sources, issues };
}
