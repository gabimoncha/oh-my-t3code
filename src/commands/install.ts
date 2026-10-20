import { applyInstall } from "../install/apply.ts";
import { confirmApply } from "../install/confirm.ts";
import { buildInstallPlan, installConflicts, installHasChanges, parseTargets, renderInstallPlan } from "../install/plan.ts";
import { shimPaths } from "../install/project.ts";
import type { CommandRun } from "../types.ts";
import { parseArgs } from "../util/args.ts";
import { usageError } from "../util/errors.ts";
import { plural } from "../util/output.ts";

export const summary = "Install the omt skills, links, starter config, and optional Claude hook.";

export const usage = `Usage: omt install [--project [--no-git-exclude]] [--targets <list>] [--hooks] [--yes] [--dry-run] [--force]

Install the bundled skills into ~/.agents/skills and link them into the
selected agent skill roots. Shows the plan first, then asks to apply it.
With --project, install into the current project instead: skills in
.agents/skills, links in .claude/skills, the CLI shim .omt/bin/omt, and the
hook in .claude/settings.local.json, all hidden from git. When omt runs
from npx, pnpm dlx, or bunx, a user install is refused. Use --project, and
the shim calls that runner.

Options:
  --project         install into the project root, not the home directory
  --no-git-exclude  with --project, write no block to the repository's
                    info/exclude, and remove an earlier one
  --targets <list>  comma-separated subset of agents, claude, gemini
                    (default: agents,claude, plus gemini when ~/.gemini exists;
                    agents is always included; gemini is not available
                    with --project)
  --hooks           also add the Claude Code UserPromptSubmit ultrawork hook
  --yes             apply the plan without asking
  --dry-run         print the plan and write nothing
  --force           back up conflicting paths, then install over them
  -h, --help        print this help
`;

export const run: CommandRun = async (ctx) => {
  const { values } = parseArgs(ctx.argv, {
    targets: { type: "string" },
    hooks: { type: "boolean" },
    yes: { type: "boolean" },
    "dry-run": { type: "boolean" },
    force: { type: "boolean" },
    project: { type: "boolean" },
    "no-git-exclude": { type: "boolean" },
  }, { maxPositionals: 0 });
  const scope = values.project === true ? "project" : "user";
  if (values["no-git-exclude"] === true && scope !== "project") throw usageError("--no-git-exclude needs --project");
  const targets = await parseTargets(values.targets, ctx.homedir, scope);
  const plan = await buildInstallPlan(ctx, {
    targets,
    hooks: values.hooks === true,
    force: values.force === true,
    scope,
    gitExclude: values["no-git-exclude"] !== true,
  });

  ctx.stdout(renderInstallPlan(plan));
  const conflicts = installConflicts(plan);
  if (conflicts > 0) {
    ctx.stderr(
      `${plural(conflicts, "conflict")}: these paths exist and omt does not manage them, or they were edited.\n` +
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
  ctx.stdout(`Applied ${plural(result.changed.length, "change")}.\n`);
  for (const backup of result.backups) ctx.stdout(`backup   ${backup}\n`);
  if (plan.project?.excludeNote !== undefined && plan.project.excludeNote !== "--no-git-exclude") {
    ctx.stdout(`note: ${plan.project.excludeNote}\n`);
  }
  const runner = plan.project === undefined ? undefined : shimPaths(plan.project.shim.after).runner;
  if (runner !== undefined) ctx.stdout(`note: .omt/bin/omt runs ${runner}, which needs the network again after its cache is cleared\n`);
  ctx.stdout(
    plan.project === undefined
      ? "Next steps:\n" +
          "  1. Restart agent sessions in T3 Code so they load the new skills.\n" +
          "  2. Try $omt-ulw <task>.\n"
      : "Next steps:\n" +
          "  1. Restart agent sessions in T3 Code for this project so they load the new skills.\n" +
          "  2. Agents in this project call the CLI as .omt/bin/omt.\n" +
          "  3. Try $omt-ulw <task>.\n",
  );
  return 0;
};
