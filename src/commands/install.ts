import { applyInstall } from "../install/apply.ts";
import { confirmApply } from "../install/confirm.ts";
import { buildInstallPlan, installConflicts, installHasChanges, parseTargets, renderInstallPlan } from "../install/plan.ts";
import type { CommandRun } from "../types.ts";
import { parseArgs } from "../util/args.ts";
import { usageError } from "../util/errors.ts";

export const summary = "Install the omt skills, links, starter config, and optional Claude hook.";

export const usage = `Usage: omt install [--targets <list>] [--hooks] [--yes] [--dry-run] [--force]

Install the bundled skills into ~/.agents/skills and link them into the
selected agent skill roots. Shows the plan first, then asks to apply it.

Options:
  --targets <list>  comma-separated subset of agents, claude, gemini
                    (default: agents,claude, plus gemini when ~/.gemini exists;
                    agents is always included)
  --hooks           also add the Claude Code UserPromptSubmit ultrawork hook
  --yes             apply the plan without asking
  --dry-run         print the plan and write nothing
  --force           back up conflicting paths, then install over them
  -h, --help        print this help
`;

export const run: CommandRun = async (ctx) => {
  const { values, positionals } = parseArgs(ctx.argv, {
    targets: { type: "string" },
    hooks: { type: "boolean" },
    yes: { type: "boolean" },
    "dry-run": { type: "boolean" },
    force: { type: "boolean" },
  });
  if (positionals.length > 0) throw usageError(`unexpected argument "${positionals[0]}"`);
  const targets = await parseTargets(values.targets, ctx.homedir);
  const plan = await buildInstallPlan(ctx, {
    targets,
    hooks: values.hooks === true,
    force: values.force === true,
  });

  ctx.stdout(renderInstallPlan(plan));
  const conflicts = installConflicts(plan);
  if (conflicts > 0) {
    ctx.stderr(
      `${conflicts} conflict${conflicts === 1 ? "" : "s"}: these paths exist and omt does not manage them, or they were edited.\n` +
        "hint: re-run with --force to back them up and replace them\n",
    );
    return 1;
  }
  if (values["dry-run"] === true) {
    ctx.stdout("Dry run: nothing was written.\n");
    return 0;
  }
  const changes = installHasChanges(plan);
  if (changes && !(await confirmApply(ctx, values.yes === true))) return 1;

  const result = await applyInstall(plan, ctx.now());
  if (!changes) {
    ctx.stdout("Everything is up to date.\n");
    return 0;
  }
  ctx.stdout(`Applied ${result.changed.length} change${result.changed.length === 1 ? "" : "s"}.\n`);
  for (const backup of result.backups) ctx.stdout(`backup   ${backup}\n`);
  ctx.stdout(
    "Next steps:\n" +
      "  1. Restart agent sessions in T3 Code so they load the new skills.\n" +
      "  2. Try $omt-ulw <task>.\n",
  );
  return 0;
};
