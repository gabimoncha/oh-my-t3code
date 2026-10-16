import { readlink, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { lstatIfExists } from "../util/fs.ts";
import { resolveReal } from "./fsops.ts";

export type LinkRootName = "claude" | "gemini";
export type LinkAction = "create" | "unchanged" | "conflict";

export interface LinkRoot {
  name: LinkRootName;
  path: string;
}

export interface PlannedLink {
  root: LinkRootName;
  name: string; // skill name
  path: string; // where the symlink goes
  target: string; // relative symlink target
  canonical: string; // the skill directory in the agents root
  action: LinkAction;
  reason?: string;
}

export interface SkippedRoot {
  root: LinkRootName;
  path: string;
  reason: string;
}

export interface LinkPlan {
  links: PlannedLink[];
  skipped: SkippedRoot[];
}

export async function classifyLink(path: string, canonical: string): Promise<{ action: LinkAction; reason?: string }> {
  const stat = await lstatIfExists(path);
  if (stat === undefined) return { action: "create" };
  if (!stat.isSymbolicLink()) return { action: "conflict", reason: "exists and is not a symlink" };
  const realCanonical = await resolveReal(canonical);
  const lexical = resolve(dirname(path), await readlink(path));
  if (lexical === canonical || (await resolveReal(lexical)) === realCanonical) return { action: "unchanged" };
  try {
    if ((await realpath(path)) === realCanonical) return { action: "unchanged" };
  } catch {
    // A dangling link that points elsewhere is a conflict.
  }
  return { action: "conflict", reason: "symlink points elsewhere" };
}

export async function planLinks(agentsRoot: string, roots: LinkRoot[], skillNames: string[]): Promise<LinkPlan> {
  const realAgents = await resolveReal(agentsRoot);
  const plan: LinkPlan = { links: [], skipped: [] };
  for (const root of roots) {
    const realRoot = await resolveReal(root.path);
    if (realRoot === realAgents) {
      plan.skipped.push({ root: root.name, path: root.path, reason: "same directory as the agents root" });
      continue;
    }
    for (const name of skillNames) {
      const path = join(root.path, name);
      const canonical = join(agentsRoot, name);
      // Relative to the real directories, so the link resolves even when a root is itself a symlink.
      const target = relative(realRoot, join(realAgents, name));
      plan.links.push({ root: root.name, name, path, target, canonical, ...(await classifyLink(path, canonical)) });
    }
  }
  return plan;
}
