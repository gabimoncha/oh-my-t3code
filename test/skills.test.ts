import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import { RESULT_KINDS } from "../src/types.ts";
import { PACKAGE_ROOT } from "./helpers.ts";

const SKILLS_DIR = join(PACKAGE_ROOT, "skills");
const USER_INVOKED = ["omt", "omt-swarm", "omt-loop"];

function parseFrontmatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  assert.ok(match, "missing frontmatter");
  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const field = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!field) continue;
    let value = (field[2] ?? "").trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    fields[field[1] ?? ""] = value;
  }
  return fields;
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

function skillDirs(): string[] {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(SKILLS_DIR, entry.name, "SKILL.md")))
    .map((entry) => entry.name);
}

// Links inside fenced code blocks and inline code are examples, not links.
function relativeLinks(markdown: string): string[] {
  const prose = markdown.replace(/^```[\s\S]*?^```/gm, "").replace(/`[^`\n]*`/g, "");
  const links: string[] = [];
  for (const match of prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1] ?? "";
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
    links.push(target);
  }
  return links;
}

test("the bundled skills are all present", () => {
  assert.deepEqual(skillDirs().sort(), [
    "omt",
    "omt-design",
    "omt-loop",
    "omt-plan",
    "omt-research",
    "omt-review",
    "omt-show",
    "omt-swarm",
    "omt-ulw",
  ]);
});

for (const name of skillDirs()) {
  test(`skill ${name} has valid frontmatter`, () => {
    const fields = parseFrontmatter(readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8"));
    assert.equal(fields.name, name);
    const description = fields.description ?? "";
    assert.ok(description.length >= 1 && description.length <= 1024, `description length ${description.length}`);
    if (USER_INVOKED.includes(name)) {
      assert.equal(fields["disable-model-invocation"], "true");
      const yaml = readFileSync(join(SKILLS_DIR, name, "agents", "openai.yaml"), "utf8");
      assert.match(yaml, /^policy:\s*\n\s+allow_implicit_invocation:\s*false\s*$/m);
    } else {
      assert.equal(fields["disable-model-invocation"], undefined);
    }
  });
}

test("every relative Markdown link under skills/ resolves to a file", () => {
  const broken: string[] = [];
  for (const file of walk(SKILLS_DIR).filter((path) => path.endsWith(".md"))) {
    for (const link of relativeLinks(readFileSync(file, "utf8"))) {
      const pathPart = decodeURIComponent(link.split("#")[0] ?? "");
      const target = resolve(dirname(file), pathPart);
      if (!existsSync(target) || !statSync(target).isFile()) {
        broken.push(`${relative(PACKAGE_ROOT, file)}: ${link}`);
      }
    }
  }
  assert.deepEqual(broken, []);
});

test("a persona file exists for every default role and for custom roles", () => {
  const rolesDir = join(SKILLS_DIR, "omt", "references", "roles");
  for (const role of [...Object.keys(DEFAULT_CONFIG.roles), "_generic"]) {
    assert.ok(existsSync(join(rolesDir, `${role}.md`)), `missing roles/${role}.md`);
  }
});

test("a contract file holding one text block exists for every result kind", () => {
  const resultsDir = join(SKILLS_DIR, "omt", "references", "results");
  for (const kind of RESULT_KINDS) {
    const text = readFileSync(join(resultsDir, `${kind}.md`), "utf8").trim();
    assert.match(text, /^```text\n[\s\S]+\n```$/, `results/${kind}.md`);
    assert.equal(text.split("```").length, 3, `results/${kind}.md has one fenced block`);
  }
});

test("each mode-check step calls t3_thread_configuration, and no skill reads modes from orchestrator_capabilities", () => {
  const modeSteps: Record<string, string> = {
    "omt-ulw": "### 0. ",
    "omt-plan": "### 0. ",
    "omt-design": "### 0. ",
    "omt-research": "### 0. ",
    "omt-review": "### 0. ",
    "omt-swarm": "### 1. ",
  };
  for (const [name, heading] of Object.entries(modeSteps)) {
    const text = readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8");
    const start = text.indexOf(`\n${heading}`);
    assert.ok(start >= 0, `${name} has no step ${heading.trim()}`);
    const end = text.indexOf("\n### ", start + 1);
    const step = text.slice(start, end < 0 ? undefined : end);
    assert.match(step, /t3_thread_configuration/, `${name} mode step`);
    assert.doesNotMatch(step, /orchestrator_capabilities/, `${name} mode step`);
  }
  const offenders: string[] = [];
  for (const file of walk(SKILLS_DIR).filter((path) => path.endsWith(".md"))) {
    for (const sentence of readFileSync(file, "utf8").split(/(?<=[.!?])\s+|\n\s*\n/)) {
      if (!sentence.includes("orchestrator_capabilities") || !sentence.includes("interactionMode")) continue;
      if (/^Do not call `orchestrator_capabilities` to read your modes\.$/.test(sentence.trim())) continue;
      offenders.push(`${relative(PACKAGE_ROOT, file)}: ${sentence.trim()}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("the resolve-by-hand table in roles.md matches the default chains", () => {
  const text = readFileSync(join(SKILLS_DIR, "omt", "references", "roles.md"), "utf8");
  const section = text.slice(text.indexOf("## Resolve by hand"), text.indexOf("Build the target as"));
  const rows: Record<string, string[]> = {};
  for (const match of section.matchAll(/^\| `([a-z-]+)` \| ([^|]+) \| ([^|]+) \|$/gm)) {
    rows[match[1] ?? ""] = [(match[2] ?? "").trim(), (match[3] ?? "").trim()].filter((rung) => rung !== "none");
  }
  const expected: Record<string, string[]> = {};
  for (const [name, role] of Object.entries(DEFAULT_CONFIG.roles)) {
    for (const rung of role.chain) assert.equal(rung.provider, rung.driver, name);
    expected[name] = role.chain.map((rung) => `${rung.driver ?? ""} / ${rung.model} / ${rung.effort ?? ""}`);
  }
  assert.deepEqual(rows, expected);
  assert.match(text, /Build the target as `\{ "providerInstanceId": "<driver>", /);
  const crossFamily = Object.entries(DEFAULT_CONFIG.roles)
    .filter(([, role]) => role.crossFamily === true)
    .map(([name]) => `\`${name}\``);
  assert.match(section, new RegExp(`The cross-family roles are ${crossFamily.slice(0, -1).join(", ")}, and ${crossFamily.at(-1)}\\.`));
});

test("no skill text says that review runs on the same family as execute", () => {
  const offenders = walk(SKILLS_DIR)
    .filter((path) => path.endsWith(".md"))
    .filter((path) => /same family as `execute`/i.test(readFileSync(path, "utf8")));
  assert.deepEqual(offenders, []);
});

function readSkill(name: string): string {
  return readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8");
}

function section(text: string, heading: string): string {
  const start = text.indexOf(`\n${heading}`);
  assert.ok(start >= 0, `no section ${heading}`);
  const level = /^#+ /.exec(heading)?.[0] ?? "### ";
  const end = text.indexOf(`\n${level}`, start + 1);
  return text.slice(start, end < 0 ? undefined : end);
}

test("delegation.md has a branch check, and both step 0s link to it", () => {
  const delegation = readFileSync(join(SKILLS_DIR, "omt", "references", "delegation.md"), "utf8");
  const check = section(delegation, "## Branch check");
  assert.match(check, /refs\/remotes\/origin\/HEAD/);
  assert.match(check, /git merge --ff-only <default>/);
  assert.match(check, /In `plan` mode, only report the count\./);
  for (const name of ["omt-ulw", "omt-plan", "omt-design"]) {
    assert.match(section(readSkill(name), "### 0. "), /\(\.\.\/omt\/references\/delegation\.md#branch-check\)/, name);
  }
});

test("omt-plan asks in one message after independent work and runs one plan-review per family in round 1", () => {
  const text = readSkill("omt-plan");
  const ask = section(text, "### 2. ");
  assert.match(ask, /finish all work that does not depend on the answers/);
  assert.match(ask, /ask every owner decision in one message/);
  const rounds = section(text, "### 4. ");
  for (const fragment of ["--unit plan.claude --against codex", "--unit plan.codex --against claudeAgent", "can dispatch: no", "do not fall back"]) {
    assert.ok(rounds.includes(fragment), fragment);
  }
  assert.doesNotMatch(rounds, /omt ledger stats(?! --plan <slug>)/);
  assert.doesNotMatch(text, /\.omt\/plans\/<slug>\.md/);
});

test("omt-swarm does not tell a track to edit limits.maxParallel", () => {
  const text = readSkill("omt-swarm");
  assert.doesNotMatch(text, /limits\.maxParallel/);
  assert.match(text, /omt plan limit <slug>-<track> <k>/);
});

test("skills name the shared evidence directory, not a bare .omt/evidence/ path", () => {
  const offenders = walk(SKILLS_DIR)
    .filter((path) => path.endsWith(".md"))
    .filter((path) => readFileSync(path, "utf8").includes(".omt/evidence"))
    .map((path) => relative(PACKAGE_ROOT, path));
  assert.deepEqual(offenders, []);
  for (const name of ["omt-ulw", "omt-review", "omt-research"]) {
    assert.match(readSkill(name), /`omt paths --evidence`/, name);
  }
  assert.match(readFileSync(join(SKILLS_DIR, "omt", "references", "roles", "ui.md"), "utf8"), /`omt paths --evidence`/);
});

test("the design and ui personas exist, and no model reviews design artifacts", () => {
  const rolesDir = join(SKILLS_DIR, "omt", "references", "roles");
  for (const role of ["design", "ui"]) {
    assert.ok(DEFAULT_CONFIG.roles[role], role);
    assert.ok(existsSync(join(rolesDir, `${role}.md`)), `missing roles/${role}.md`);
  }
  const design = readSkill("omt-design");
  assert.doesNotMatch(design, /omt brief review/);
  assert.doesNotMatch(design, /omt brief oracle/);
  assert.match(design, /--unit DS<k>/);
  const review = readSkill("omt-review");
  assert.match(section(review, "### 2. "), /Leave every file under `docs\/design\/` out of the groups/);
  assert.match(section(review, "### 3. "), /never include `docs\/design\/`/);
  assert.match(section(review, "### 5. "), /`docs\/design\/` excluded/);
  const ulw = readSkill("omt-ulw");
  assert.match(section(ulw, "### 7. "), /Leave `docs\/design\/` out of the scope paths/);
  assert.match(section(ulw, "### 10. "), /without `docs\/design\/`/);
  assert.match(section(ulw, "### 8. "), /Design exclusion: for a `ui` unit, leave `docs\/design\/` out of the test scope paths/);
  assert.match(section(ulw, "### 8. "), /leave out every done condition and every piece of context that compares the result with the design/);
  assert.match(section(ulw, "### 9. "), /A `ui` unit uses `ui` in every round/);
  assert.match(section(readSkill("omt-plan"), "### 3. "), /plan an `omt-design` step before those units/);
});

test("omt-ulw keeps visual checks out of review and oracle briefs of ui units", () => {
  const ulw = readSkill("omt-ulw");
  assert.match(section(ulw, "### 8. "), /every piece of context that compares the result with the design/);
  assert.match(section(ulw, "### 8. "), /Review briefs \(step 7\) and the oracle brief \(step 10\) apply the same exclusion/);
  assert.match(section(ulw, "### 7. "), /For a `ui` unit, also apply the \[design exclusion\]\(#8-test\)/);
  assert.match(section(ulw, "### 10. "), /every done condition except those that the \[design exclusion\]\(#8-test\)/);
});

test("omt-ulw uses the ui role for UI units also in a LIGHT run", () => {
  const ulw = readSkill("omt-ulw");
  assert.match(section(ulw, "## Contract"), /a `ui` child for a unit that implements a design or changes UI, with no fallback to another family/);
  assert.match(section(ulw, "### 5. "), /A `ui` unit uses the `ui` role, also in a LIGHT run\. When `ui` cannot run, stop/);
  assert.match(section(ulw, "### 5. "), /do not fall back to `execute` or to another family/);
});

test("the design check runs before any ui dispatch, also after the omt-plan hand-off", () => {
  const ulw = readSkill("omt-ulw");
  const dispatch = section(ulw, "### 5. ");
  const check = dispatch.indexOf("Design check:");
  assert.ok(check >= 0, "step 5 has no design check");
  assert.ok(check < dispatch.indexOf("For each unit"), "the design check comes after the dispatch loop");
  assert.match(dispatch, /also the hand-off from `omt-plan`/);
  const handOff = section(readSkill("omt-plan"), "### 5. ");
  assert.match(handOff, /return to its step 5 with the plan slug\. Step 5 starts with the design check/);
});

test("omt-ulw asks each owner question once", () => {
  assert.match(section(readSkill("omt-ulw"), "## Conductor rules"), /Ask each owner question once\. Later status messages do not repeat open questions\./);
});

test("omt-ulw step 9 runs a relevance check before each fix round", () => {
  const fix = section(readSkill("omt-ulw"), "### 9. ");
  assert.match(fix, /Relevance check: before each fix round/);
  assert.match(fix, /Record each dropped finding with its reason under `Log` in the plan and in the next `--prior-file`/);
  assert.match(fix, /When you drop every finding, the unit goes to step 8\./);
});

test("omt-ulw fix rounds use deep only when a finding needs investigation", () => {
  const fix = section(readSkill("omt-ulw"), "### 9. ");
  assert.match(fix, /A fix is an `execute` fix, or a `deep` fix when an open finding needs investigation/);
});

test("omt-plan asks for the task budget and sets it with omt plan limit --tasks", () => {
  const text = readSkill("omt-plan");
  assert.match(section(text, "### 2. "), /plus 4 for the plan-review rounds, plus 5 per unit, plus 1 more per `ui` unit, plus 3 for the final gate/);
  assert.match(section(text, "### 3. "), /run `omt plan limit <slug> --tasks <n>`/);
});

test("omt-plan hashes the plan after every edit", () => {
  const rounds = section(readSkill("omt-plan"), "### 4. ");
  assert.match(rounds, /Make every plan edit first, `omt plan limit` included\. Then compute the hash/);
  assert.match(rounds, /After any edit to the plan, header edits included, compute the hash again before the next brief\./);
});

test("omt-plan shows the final plan as a page unless visuals.plan is off, and every plan has a summary", () => {
  const plan = readSkill("omt-plan");
  const handOff = section(plan, "### 5. ");
  assert.match(handOff, /Show the plan to the owner first, also when `omt-ulw` called this skill\./);
  assert.match(handOff, /Run `omt config show` and read `visuals\.plan`\. When it is `true` and you have the T3 `html_render` tool, run the `omt-show` skill with the plan slug/);
  assert.match(handOff, /Otherwise, write the `## Summary` text in full in the reply, also when `omt-show` could not show the page\./);
  assert.match(section(plan, "### 3. "), /Fill `## Summary` last, by the summary rule in \[roles\/plan\.md\]/);
  assert.match(section(readSkill("omt-ulw"), "### 4. "), /`## Summary` last by the rule in \[roles\/plan\.md\]/);
  const rolesDir = join(SKILLS_DIR, "omt", "references", "roles");
  assert.match(readFileSync(join(rolesDir, "plan.md"), "utf8"), /Write `## Summary` last, in at most 15 lines for the owner/);
  assert.match(readFileSync(join(rolesDir, "plan-review.md"), "utf8"), /6\. A line of `## Summary` that the rest of the plan does not support\./);
});

test("omt-show builds the page with omt visual and shows it with html_render", () => {
  const show = readSkill("omt-show");
  assert.match(section(show, "### 2. "), /omt visual --plan <slug> --spec - --json <<'EOF'/);
  assert.match(section(show, "### 2. "), /In `plan` mode, write no file in the project: add `--out "\$TMPDIR\/omt-<slug>-page\.html"`/);
  assert.match(section(show, "### 3. "), /Call `html_render` with the exact page text as `html`, the page title as `title`, and `2000` as `height`\./);
  assert.match(section(show, "### 3. "), /When the harness has no `html_render`, or the call fails, the page file is the result\./);
  assert.match(readSkill("omt"), /\| `omt-show` \|/);
});

test("delegation.md names the plan task budget in the limits and the stalled-run text", () => {
  const limits = section(readFileSync(join(SKILLS_DIR, "omt", "references", "delegation.md"), "utf8"), "## Limits");
  assert.match(limits, /a `max-tasks` key in the plan header replaces `maxTasksPerRun` for that plan/);
  assert.match(limits, /the `dispatched` count/);
  assert.match(limits, /recommend `omt plan limit <slug> --tasks <n>` first, or `limits\.maxTasksPerRun`/);
});

test("omt-design asks for 3 variants per screen in a new Paper file and a pick per screen", () => {
  const design = readSkill("omt-design");
  assert.match(section(design, "### 2. "), /3 distinct variants of each screen/);
  assert.match(section(design, "### 2. "), /make a new Paper file named after the project/);
  assert.match(section(design, "### 3. "), /Group the screenshots by screen, with one line on each variant/);
  assert.match(section(design, "### 3. "), /The owner may mix variants across screens\./);
  const persona = readFileSync(join(SKILLS_DIR, "omt", "references", "roles", "design.md"), "utf8");
  assert.match(persona, /The first variants task makes a new Paper file named after the project\. Do not reuse a file that is already open\./);
  assert.match(persona, /Every later task works in the Paper file that the task names\./);
  assert.match(persona, /make 3 variants of each screen/);
});

test("omt-ulw starts a stall heartbeat, and the test role proves failures in a working-tree copy", () => {
  const delegation = readFileSync(join(SKILLS_DIR, "omt", "references", "delegation.md"), "utf8");
  assert.match(section(delegation, "## Stalled tasks"), /`updatedAt` is more than 30 minutes old/);
  assert.match(section(delegation, "## Stalled tasks"), /call `task_cancel`, record `--status interrupted --note "stalled"`/);
  assert.match(section(readSkill("omt-ulw"), "### 5. "), /delegation\.md#stalled-tasks/);
  const test = readFileSync(join(SKILLS_DIR, "omt", "references", "roles", "test.md"), "utf8");
  assert.match(test, /git ls-files -co --exclude-standard -z/);
  assert.doesNotMatch(test, /git archive HEAD/);
  assert.match(test, /Never add an exit code to a log afterwards\./);
});

test("omt-ulw splits BLOCK into a fixable P0 and a wrong approach", () => {
  const review = section(readSkill("omt-ulw"), "### 7. ");
  assert.match(review, /A P0 finding that has a clear fix inside the unit's scope: go to step 9, as for `REQUEST_CHANGES`\./);
  assert.match(review, /A wrong approach, or a P0 whose fix changes the plan: run `omt plan mark <slug> <unit> blocked`/);
});

test("omt-ulw drops a finding only when its case cannot happen, and reopens done units", () => {
  const fix = section(readSkill("omt-ulw"), "### 9. ");
  assert.match(fix, /a case that cannot happen in the planned flow/);
  assert.match(fix, /Never drop a finding because its case is rare or unlikely\./);
  assert.match(fix, /Reopen: when a task or a check finds a defect in code that a done unit owns, run the relevance check on the finding first\./);
  assert.match(fix, /A cycle starts at the unit's first dispatch, or at a reopen/);
  assert.match(fix, /the table and `maxReviewRounds` use the round within the cycle/);
  assert.match(fix, /It is round 1 of a new cycle, with the next `--round` value after the unit's last round\./);
  assert.match(fix, /\| `maxReviewRounds` \(default 3\) \| a fix \| stop \|/);
  assert.match(section(readSkill("omt-ulw"), "### 10. "), /A failing final check reopens the unit that owns the code/);
});

test("omt-ulw shows screenshots and recordings to the user", () => {
  const ulw = readSkill("omt-ulw");
  assert.match(section(ulw, "### 8. "), /show them in your message about the unit: one Markdown image per file with its absolute path/);
  assert.match(section(ulw, "### 11. "), /the latest screenshot or recording of each screen or flow that the change adds or changes/);
});

test("the test role keeps to the done conditions, uses real-shaped data, and closes device sessions", () => {
  const persona = readFileSync(join(SKILLS_DIR, "omt", "references", "roles", "test.md"), "utf8");
  assert.match(persona, /Do not add edge, property, or stress suites that no done condition needs\./);
  assert.match(persona, /at least one input shaped like real data/);
  assert.match(persona, /in the code under test that the done condition names, not in a test helper, a fixture, or a mock/);
  assert.match(persona, /save a screenshot of the screen that shows the result, or a recording/);
  assert.match(persona, /Close each device or browser session that you open, also when a check fails\./);
  const contract = readFileSync(join(SKILLS_DIR, "omt", "references", "results", "test.md"), "utf8");
  assert.match(contract, /EVIDENCE:\n- <path of a log, screenshot, or recording in the evidence directory>; or none/);
  const work = readFileSync(join(SKILLS_DIR, "omt", "references", "results", "work.md"), "utf8");
  assert.match(work, /EVIDENCE:\n- <path of a log, screenshot, or recording in the evidence directory>; or none/);
  assert.match(section(readSkill("omt-plan"), "### 3. "), /its done condition includes a check on an input shaped like real data/);
});

test("the Mira fixes pin every new rule in the skills and references", () => {
  const ulw = readSkill("omt-ulw");
  const fix = section(ulw, "### 9. ");
  assert.match(fix, /Drop the others: a style preference, an input or a state that the plan rules out, a case that cannot happen in the planned flow, or a missing test for a done condition that already has a check that can fail\./);
  assert.match(fix, /Keep a missing check on an input shaped like real data for code that reads outside data/);
  assert.match(fix, /run the relevance check on the finding first\. When you drop it, log the drop and leave the unit done\./);
  assert.match(fix, /reopen the unit: run `omt plan mark <slug> <unit> open`/);
  assert.match(fix, /Before a third reopen of the same unit, stop and ask the user/);
  assert.match(fix, /Take the finding out of the fix round of the unit whose task found it\./);
  assert.match(fix, /When that unit has no other kept finding, it waits until the reopened unit is done again, then goes to step 8 for the same round\./);
  assert.match(fix, /Dispatch no new task for a unit that depends on the reopened unit, directly or through other units, until the reopened unit is done again\./);
  assert.match(fix, /Wait until no active task has a scope that overlaps the reopened unit's scope/);
  assert.match(fix, /the first `--round` value of the new cycle/);
  assert.match(fix, /When `maxReviewRounds` is 1, round 1 is also the last round/);
  assert.match(section(ulw, "### 4. "), /has a done condition on an input shaped like real data, also in a LIGHT plan/);
  assert.match(section(ulw, "### 8. "), /Do not ask for edge, property, or stress suites that no done condition needs\./);
  assert.match(section(ulw, "### 11. "), /from the `EVIDENCE` lines of the test and `ui` results/);
  const references = join(SKILLS_DIR, "omt", "references");
  const results = readFileSync(join(references, "results.md"), "utf8");
  assert.match(results, /A P0 with a clear fix inside the unit's scope goes to a fix task\./);
  assert.doesNotMatch(results, /Stop the unit and re-plan before more fixes\./);
  assert.match(readFileSync(join(references, "roles", "plan.md"), "utf8"), /give it a done condition on an input shaped like real data/);
  const persona = readFileSync(join(references, "roles", "test.md"), "utf8");
  assert.match(persona, /or when the existing checks of outside data use only seeded or ideal samples/);
  assert.match(persona, /List every log, screenshot, and recording under `EVIDENCE`\./);
});
