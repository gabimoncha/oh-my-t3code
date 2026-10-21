import { parseJsonc, setTopLevelValue } from "../config/jsonc.ts";
import { readConfigLayers } from "../config/load.ts";
import { confirmApply } from "../install/confirm.ts";
import {
  allDetected,
  detectHarnesses,
  formatHarnessLine,
  formatHarnessValue,
  harnessEffects,
} from "../install/harness.ts";
import type { CommandRun, HarnessReport } from "../types.ts";
import { parseArgs } from "../util/args.ts";
import { OmtError, usageError } from "../util/errors.ts";
import { readFileIfExists } from "../util/fs.ts";
import { isRecord } from "../util/json.ts";
import { formatJson } from "../util/output.ts";
import { configTarget, readConfigTarget, writeConfigTarget } from "./defaults.ts";
import type { ConfigTarget } from "./defaults.ts";
import { readCapabilities } from "./shared.ts";

export const summary = "Detect the harnesses that can run child tasks, and set the harnesses key.";

export const usage = `Usage: omt detect [--capabilities <file>] [--json] [--write] [--user | --project] [--dry-run] [--yes]

Check which harnesses (claudeAgent, codex) can run omt's child tasks, print
the "harnesses" value that fits, and compare it with one config file.
Without --capabilities, a harness is detected when T3 does not disable it
and its executable (claude or codex) is on PATH. With --capabilities, a
harness is detected when a provider of that driver can run child tasks.

Options:
  --capabilities <file>  orchestrator_capabilities output (- for stdin)
  --write                set the "harnesses" key of the config file;
                         changes nothing else in the file
  --user                 compare with or change the user config
  --project              compare with or change the project config
                         (default when it exists, else the user config)
  --dry-run              with --write: print the change and write nothing
  --yes                  with --write: apply the change without asking
  --json                 print JSON
  -h, --help             print this help
`;

function harnessesOf(text: string | undefined, path: string): unknown {
  if (text === undefined) return undefined;
  const root = parseJsonc(text, path);
  return isRecord(root) ? root.harnesses : undefined;
}

// The harnesses value that the target file should hold. undefined means no key.
function wantedValue(report: HarnessReport, target: ConfigTarget, userHarnesses: string[] | undefined): string[] | undefined {
  if (!allDetected(report)) return report.recommended;
  const excludes = userHarnesses !== undefined && report.recommended.some((driver) => !userHarnesses.includes(driver));
  return target.scope === "project" && excludes ? report.recommended : undefined;
}

export const run: CommandRun = async (ctx) => {
  const { values } = parseArgs(ctx.argv, {
    capabilities: { type: "string" },
    json: { type: "boolean" },
    write: { type: "boolean" },
    user: { type: "boolean" },
    project: { type: "boolean" },
    "dry-run": { type: "boolean" },
    yes: { type: "boolean" },
  }, { maxPositionals: 0 });
  const json = values.json === true;
  const write = values.write === true;
  if (!write && (values["dry-run"] !== undefined || values.yes !== undefined)) throw usageError("--dry-run and --yes need --write");
  const target = await configTarget(ctx, values);
  const caps = await readCapabilities(ctx, values.capabilities);
  const report = await detectHarnesses({ env: ctx.env, homedir: ctx.homedir, capabilities: caps });

  const text = write ? await readConfigTarget(target) : await readFileIfExists(target.path);
  const current = harnessesOf(text, target.path);
  const layers = await readConfigLayers(ctx);
  const user = layers.find((file) => file.kind === "user");
  const project = layers.find((file) => file.kind === "project");
  const wanted = wantedValue(report, target, user?.layer.harnesses);
  const none = report.recommended.length === 0;
  const changed = !none && JSON.stringify(current) !== JSON.stringify(wanted);
  const overriddenBy =
    changed && target.scope === "user" && project?.layer.harnesses !== undefined ? project : undefined;
  const effects = harnessEffects(report.recommended);

  if (!json) {
    for (const harness of report.harnesses) ctx.stdout(formatHarnessLine(harness));
    if (!none) {
      ctx.stdout(
        allDetected(report)
          ? "recommended: no harnesses key (every default harness is detected)\n"
          : `recommended: harnesses ${formatHarnessValue(report.recommended)}\n`,
      );
      for (const effect of effects) ctx.stdout(`${effect}\n`);
      const shown = current === undefined ? "none" : JSON.stringify(current);
      if (!changed) ctx.stdout(`no change in ${target.path}\n`);
      else ctx.stdout(`${target.path}: harnesses ${shown} -> ${formatHarnessValue(wanted)}\n`);
      if (overriddenBy !== undefined) {
        ctx.stdout(
          `note: ${overriddenBy.path} sets harnesses ${formatHarnessValue(overriddenBy.layer.harnesses)}, which overrides this change\n`,
        );
      }
      if (changed && !write) ctx.stdout("run omt detect --write to apply\n");
      else if (changed && values["dry-run"] === true) ctx.stdout("Dry run: nothing was written.\n");
    }
  }
  let applied = false;
  if (write && changed && values["dry-run"] !== true && text !== undefined) {
    if (!(await confirmApply(ctx, values.yes === true))) return 1;
    await writeConfigTarget(target, text, setTopLevelValue(text, "harnesses", wanted));
    applied = true;
    if (!json) ctx.stdout(`update ${target.path}\n`);
  }
  if (json) {
    ctx.stdout(formatJson({
      ...report,
      effects,
      file: target.path,
      current: current ?? null,
      wanted: none ? null : wanted ?? null,
      changed,
      applied,
      ...(overriddenBy === undefined ? {} : { overriddenBy: overriddenBy.path }),
    }));
  }
  if (none) {
    throw new OmtError("no_harness", "no harness can run child tasks; nothing was written", {
      hint: "sign in to Claude Code (claude) or Codex (codex), check that T3 Code enables it, then run omt detect again",
    });
  }
  return 0;
};
