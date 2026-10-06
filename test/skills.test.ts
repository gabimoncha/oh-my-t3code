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
    "omt-loop",
    "omt-plan",
    "omt-research",
    "omt-review",
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
    rows[match[1] ?? ""] = [(match[2] ?? "").trim(), (match[3] ?? "").trim()];
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
