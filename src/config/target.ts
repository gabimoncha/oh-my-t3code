import { findProjectRoot, projectConfigPath, userConfigPath } from "../paths.ts";
import type { CliContext } from "../types.ts";
import { OmtError, usageError } from "../util/errors.ts";
import { pathExists, readFileIfExists, writeFileAtomic } from "../util/fs.ts";
import { writeTargetFor } from "../install/fsops.ts";

export interface ConfigTarget {
  scope: "user" | "project";
  path: string;
}

// The config file that a write goes to: the flag's scope, else the project config when it exists,
// else the user config.
export async function configTarget(ctx: CliContext, flags: { user?: boolean; project?: boolean }): Promise<ConfigTarget> {
  if (flags.user === true && flags.project === true) throw usageError("use --user or --project, not both");
  const project = projectConfigPath(findProjectRoot(ctx.cwd));
  const user = userConfigPath(ctx.env, ctx.homedir);
  if (flags.project === true) return { scope: "project", path: project };
  if (flags.user === true) return { scope: "user", path: user };
  return (await pathExists(project)) ? { scope: "project", path: project } : { scope: "user", path: user };
}

// Reads the target config file, or fails with the command that creates it.
export async function readConfigTarget(target: ConfigTarget): Promise<string> {
  const text = await readFileIfExists(target.path);
  if (text === undefined) {
    throw new OmtError("config_not_found", `${target.path} does not exist`, {
      hint: target.scope === "project" ? "run omt init" : "run omt config init",
    });
  }
  return text;
}

// Writes next to the target only when the file still holds the snapshot that next was computed
// from, so that a change saved while the prompt was open is not lost. omt does not lock config
// writes, so a change between this read and the rename can still be lost.
export async function writeConfigTarget(target: ConfigTarget, snapshot: string, next: string): Promise<void> {
  if ((await readFileIfExists(target.path)) !== snapshot) {
    throw new OmtError("config_changed", `${target.path} changed while omt waited for confirmation; nothing was written`, {
      hint: "run the command again",
    });
  }
  await writeFileAtomic(await writeTargetFor(target.path), next);
}
