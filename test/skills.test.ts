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
