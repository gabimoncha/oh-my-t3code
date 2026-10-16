import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { evidenceDir, findProjectRoot, planPath } from "../paths.ts";
import type { CommandRun } from "../types.ts";
import { parseArgs } from "../util/args.ts";
import { errorMessage, OmtError, usageError } from "../util/errors.ts";
import { readFileIfExists, writeFileAtomic } from "../util/fs.ts";
import { PLAN_SLUG_RE, checkPlanSlug } from "../util/ids.ts";
import { parsePlan } from "../plan/parse.ts";
import { formatJson } from "../util/output.ts";
import { renderPage } from "../visual/page.ts";
import { mergeSpec, planSections } from "../visual/plan.ts";
import { validateSpec } from "../visual/spec.ts";
import type { PageSpec } from "../visual/spec.ts";

export const summary = "Build a self-contained HTML page from a plan or a page spec.";

export const usage = `Usage: omt visual [--plan <slug|file.md>] [--spec <file|->] [--out <path|->] [--json]

Build one self-contained HTML page with tabs, cards, tables, checklists, and
flowcharts. The flowchart layout is deterministic: the same input gives the
same bytes.

Options:
  --plan <slug|file.md>
                    add the plan's summary, units by dependency layer, and
                    checks; a value that ends in .md is a plan file path
  --spec <file|->   a JSON page spec; "-" reads it from stdin
  --out <path|->    write the page to this path; "-" prints it to stdout
                    (default: .omt/evidence/visuals/<slug>.html with --plan,
                    else .omt/evidence/visuals/page-<12 hex of its sha256>.html)
  --json            print { path, bytes, title, tabs, warnings } as JSON
  -h, --help        print this help
`;

async function readSpec(source: string, cwd: string, readStdin: () => Promise<string>): Promise<{ spec: PageSpec; warnings: string[] }> {
  let text: string;
  if (source === "-") {
    text = await readStdin();
  } else {
    const path = resolve(cwd, source);
    const content = await readFileIfExists(path);
    if (content === undefined) throw new OmtError("spec_not_found", `spec file not found: ${path}`);
    text = content;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new OmtError("invalid_spec", `invalid page spec:\n  $: not JSON: ${errorMessage(error)}`, { exitCode: 2 });
  }
  return validateSpec(value);
}

export const run: CommandRun = async (ctx) => {
  const { values } = parseArgs(ctx.argv, {
    plan: { type: "string" },
    spec: { type: "string" },
    out: { type: "string" },
    json: { type: "boolean" },
  }, { maxPositionals: 0 });
  const planArg = values.plan;
  if (planArg === undefined && values.spec === undefined) throw usageError("visual needs --plan <slug|file.md> or --spec <file|->");
  if (values.json === true && values.out === "-") throw usageError("--json and --out - cannot be used together");
  const planFile = planArg !== undefined && planArg.endsWith(".md");
  if (planArg !== undefined && !planFile) checkPlanSlug(planArg);
  const root = findProjectRoot(ctx.cwd);
  let slug = planFile ? undefined : planArg;

  const warnings: string[] = [];
  let spec: PageSpec = { tabs: [] };
  if (values.spec !== undefined) {
    const checked = await readSpec(values.spec, ctx.cwd, ctx.readStdin);
    spec = checked.spec;
    warnings.push(...checked.warnings);
  }
  let page: PageSpec;
  if (planArg !== undefined) {
    const planLocation = planFile ? resolve(ctx.cwd, planArg) : planPath(root, planArg);
    const markdown = await readFileIfExists(planLocation);
    if (markdown === undefined) {
      throw new OmtError("plan_not_found", `plan "${planArg}" not found at ${planLocation}`, { hint: `run "omt plan list" to see the plans` });
    }
    if (slug === undefined) {
      // A plan file outside .omt/plans/ names the page after its header slug, else after the file.
      const named = [parsePlan(markdown).slug, basename(planLocation, ".md")].find((name) => name !== undefined && PLAN_SLUG_RE.test(name));
      slug = named ?? "plan";
    }
    const base = planSections(markdown, slug);
    warnings.push(...base.warnings);
    page = mergeSpec(base, spec);
  } else {
    if (spec.tabs.length === 0) {
      throw new OmtError("invalid_spec", "invalid page spec:\n  $.tabs: needs at least 1 tab without --plan", { exitCode: 2 });
    }
    page = { ...spec, title: spec.title ?? "omt" };
  }
  const rendered = renderPage(page);
  warnings.push(...rendered.warnings);
  const html = rendered.html;

  if (values.out === "-") {
    ctx.stdout(html);
    for (const warning of warnings) ctx.stderr(`warning: ${warning}\n`);
    return 0;
  }
  const name = slug ?? `page-${createHash("sha256").update(html).digest("hex").slice(0, 12)}`;
  const path = values.out === undefined ? join(evidenceDir(root), "visuals", `${name}.html`) : resolve(ctx.cwd, values.out);
  await writeFileAtomic(path, html);
  if (values.json === true) {
    ctx.stdout(formatJson({
      path,
      bytes: Buffer.byteLength(html),
      title: page.title ?? "omt",
      tabs: page.tabs.map((tab) => tab.title),
      warnings,
    }));
  } else {
    ctx.stdout(`${path}\n`);
    for (const warning of warnings) ctx.stderr(`warning: ${warning}\n`);
  }
  return 0;
};

