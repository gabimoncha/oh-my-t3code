import { applyUninstall } from "../install/apply.ts";
import { confirmApply } from "../install/confirm.ts";
import { buildUninstallPlan, renderUninstallPlan, uninstallHasChanges } from "../install/plan.ts";
import type { CommandRun } from "../types.ts";
import { parseArgs } from "../util/args.ts";
import { usageError } from "../util/errors.ts";

export const summary = "Remove the skills, links, and hooks that omt installed.";

export const usage = `Usage: omt uninstall [--project] [--yes] [--dry-run] [--purge] [--force]

Remove the managed skills, links, and hook entries that omt installed, and
the install manifest. Paths that omt does not manage stay unchanged. A
managed skill that you edited stays, with the links that point at it.

Options:
  --project         remove the project install of the current project:
                    also the CLI shim and the git exclude block
  --yes             apply the plan without asking
  --dry-run         print the plan and write nothing
  --purge           also remove the user config, and the config directory
                    when it is then empty; with --project, also remove an
                    edited .omt/config.jsonc that the install created
  --force           back up locally modified skills, then remove them
  -h, --help        print this help
`;

export const run: CommandRun = async (ctx) => {
  const { values, positionals } = parseArgs(ctx.argv, {
    yes: { type: "boolean" },
    "dry-run": { type: "boolean" },
    purge: { type: "boolean" },
    force: { type: "boolean" },
    project: { type: "boolean" },
  });
  if (positionals.length > 0) throw usageError(`unexpected argument "${positionals[0]}"`);
  const plan = await buildUninstallPlan(ctx, {
    purge: values.purge === true,
    force: values.force === true,
    scope: values.project === true ? "project" : "user",
  });

  ctx.stdout(renderUninstallPlan(plan));
  if (!uninstallHasChanges(plan)) {
    ctx.stdout("Nothing to remove.\n");
    return 0;
  }
  if (values["dry-run"] === true) {
    ctx.stdout("Dry run: nothing was written.\n");
    return 0;
  }
  if (!(await confirmApply(ctx, values.yes === true))) return 1;

  const result = await applyUninstall(plan, ctx.now());
  ctx.stdout(`Removed ${result.changed.length} path${result.changed.length === 1 ? "" : "s"}.\n`);
  for (const backup of result.backups) ctx.stdout(`backup   ${backup}\n`);
  ctx.stdout("Restart agent sessions in T3 Code so they stop loading the skills.\n");
  return 0;
};
