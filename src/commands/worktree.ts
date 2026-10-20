import { confirmApply } from "../install/confirm.ts";
import type { CommandRun, WorktreeReport } from "../types.ts";
import { parseArgs } from "../util/args.ts";
import { usageError } from "../util/errors.ts";
import { formatJson } from "../util/output.ts";
import { inspectWorktree } from "../worktree/check.ts";
import { loadRunnerTemplate } from "../worktree/runner.ts";
import { applySetup, planSetup, renderSetupPlan, setupHasChanges } from "../worktree/setup.ts";

export const summary = "Check or create the T3 worktree setup that installs dependencies in new worktrees.";

export const usage = `Usage: omt worktree [check] [--json]
       omt worktree setup [--dry-run] [--yes]

check (the default) reads the current checkout and reports its package
manager, lockfile, linker settings, t3.json setup script, and the T3
activation step. It writes nothing and starts no process.

setup writes t3.json and .t3/omt-worktree-setup.mjs in the current checkout
when they are missing, for a Bun or pnpm project. For pnpm it also writes
pnpm-workspace.yaml with enableGlobalVirtualStore: true when that file is
missing. The runner installs the dependencies into a global virtual store
before the agent starts. It never rewrites an existing file; when an
existing pnpm-workspace.yaml does not select the global store, it prints the
line to add and exits 1. In a linked worktree, the files go into that
worktree, not the main checkout. T3 runs the script only after you commit
the files on the base branch of new worktrees and import Setup in T3
Project Settings.

Options:
  --json     with check, print the report as JSON
  --dry-run  with setup, print the plan and write nothing
  --yes      with setup, apply the plan without asking
  -h, --help print this help
`;

function formatReport(report: WorktreeReport): string {
  const width = Math.max(...report.checks.map((c) => c.id.length));
  let text = report.checks.map((c) => `${c.status}  ${c.id.padEnd(width)}  ${c.message}\n`).join("");
  if (report.next !== undefined) text += `next: ${report.next}\n`;
  return text;
}

export const run: CommandRun = async (ctx) => {
  const { values, positionals } = parseArgs(ctx.argv, {
    json: { type: "boolean" },
    "dry-run": { type: "boolean" },
    yes: { type: "boolean" },
  }, { maxPositionals: 1 });
  const sub = positionals[0] ?? "check";
  if (sub !== "check" && sub !== "setup") throw usageError(`unknown subcommand "${sub}"`, "use check or setup");

  if (sub === "check") {
    if (values["dry-run"] === true || values.yes === true) throw usageError("--dry-run and --yes need setup");
    const report = await inspectWorktree(ctx);
    ctx.stdout(values.json === true ? formatJson(report) : formatReport(report));
    return report.checks.some((c) => c.status === "FAIL") ? 1 : 0;
  }

  if (values.json === true) throw usageError("--json needs check");
  const template = await loadRunnerTemplate(ctx.packageRoot);
  const report = await inspectWorktree(ctx, template);
  const plan = await planSetup(report, template.text, template.module.PNPM_WORKSPACE_CONTENT);
  ctx.stdout(renderSetupPlan(plan));
  const incomplete = plan.incomplete === undefined ? "" : `Setup is incomplete: ${plan.incomplete}\n`;
  if (!setupHasChanges(plan)) {
    if (report.setup.status === "custom") ctx.stdout(`note: ${report.setup.message}\n`);
    else ctx.stdout(incomplete === "" ? "Everything is up to date.\n" : incomplete);
    ctx.stdout(`note: ${report.activation}\n`);
    if (incomplete === "") return 0;
    if (values["dry-run"] === true) {
      ctx.stdout("Dry run: nothing was written.\n");
      return 0;
    }
    return 1;
  }
  if (values["dry-run"] === true) {
    ctx.stdout(`${incomplete}Dry run: nothing was written.\n`);
    return 0;
  }
  if (!(await confirmApply(ctx, values.yes === true))) return 1;
  const created = await applySetup(plan);
  for (const path of created) ctx.stdout(`created  ${path}\n`);
  const files = [report.t3File, report.runnerFile, ...(report.store === undefined ? [] : [report.workspaceFile])];
  const steps = [
    ...(incomplete === "" ? [] : ["Make the pnpm-workspace.yaml change above; the runner stops before the install until it is made."]),
    `Review and commit ${files.join(", ")} on the branch that new worktrees start from.`,
    "In T3 Project Settings, import Setup from t3.json, keep any inherited scripts, and check that Setup is the setup script.",
    "Run omt worktree check in a new worktree.",
  ];
  ctx.stdout(`${incomplete}Next steps:\n${steps.map((step, i) => `  ${i + 1}. ${step}\n`).join("")}`);
  return incomplete === "" ? 0 : 1;
};
