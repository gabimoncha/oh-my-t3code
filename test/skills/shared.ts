import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PACKAGE_ROOT } from "../helpers.ts";

export const SKILLS_DIR = join(PACKAGE_ROOT, "skills");

export function readSkill(name: string): string {
  return readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8");
}

export function section(text: string, heading: string): string {
  const start = text.indexOf(`\n${heading}`);
  assert.ok(start >= 0, `no section ${heading}`);
  const level = /^#+ /.exec(heading)?.[0] ?? "### ";
  const end = text.indexOf(`\n${level}`, start + 1);
  return text.slice(start, end < 0 ? undefined : end);
}
