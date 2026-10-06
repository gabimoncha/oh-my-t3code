import { join } from "node:path";
import { PROJECT_STARTER_CONFIG } from "../config/starter.ts";
import { OMT_GITIGNORE_LINES } from "../install/project.ts";
import { findProjectRoot, omtDir, plansDir, projectConfigPath } from "../paths.ts";
import type { CommandRun } from "../types.ts";
import { parseArgs } from "../util/args.ts";
import { usageError } from "../util/errors.ts";
import { ensureDir, pathExists, writeFileAtomic } from "../util/fs.ts";

export const summary = "Create .omt/ in the project root with a starter config.";

export const usage = `Usage: omt init

Create what is missing in the project root: .omt/config.jsonc,
.omt/plans/, and .omt/.gitignore. Never overwrites a file.

Options:
  -h, --help        print this help
`;

export const GITIGNORE = `${OMT_GITIGNORE_LINES.join("\n")}\n`;

export const run: CommandRun = async (ctx) => {
  const { positionals } = parseArgs(ctx.argv, {});
  if (positionals.length > 0) throw usageError(`unexpected argument "${positionals[0]}"`);
  const root = findProjectRoot(ctx.cwd);
  const entries: { path: string; create: () => Promise<void> }[] = [
    { path: projectConfigPath(root), create: () => writeFileAtomic(projectConfigPath(root), PROJECT_STARTER_CONFIG) },
    { path: plansDir(root), create: () => ensureDir(plansDir(root)) },
    { path: join(omtDir(root), ".gitignore"), create: () => writeFileAtomic(join(omtDir(root), ".gitignore"), GITIGNORE) },
  ];
  for (const entry of entries) {
    if (await pathExists(entry.path)) {
      ctx.stdout(`exists ${entry.path}\n`);
    } else {
      await entry.create();
      ctx.stdout(`create ${entry.path}\n`);
    }
  }
  return 0;
};
