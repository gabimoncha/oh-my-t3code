import { join } from "node:path";
import { projectRolesDir, userRolesDir } from "../paths.ts";
import type { Env } from "../paths.ts";
import type { ResultKind } from "../types.ts";
import { OmtError } from "../util/errors.ts";
import { readFileIfExists } from "../util/fs.ts";

export interface TemplateRoots {
  packageRoot: string;
  projectRoot: string;
  env: Env;
  homedir: string;
}

export interface RoleTemplate {
  path: string;
  content: string;
}

const ROLE_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

export function packageRolesDir(packageRoot: string): string {
  return join(packageRoot, "skills", "omt", "references", "roles");
}

export function roleTemplateCandidates(roots: TemplateRoots, role: string): string[] {
  const generic = join(packageRolesDir(roots.packageRoot), "_generic.md");
  if (!ROLE_NAME_RE.test(role)) return [generic];
  const file = `${role}.md`;
  return [
    join(projectRolesDir(roots.projectRoot), file),
    join(userRolesDir(roots.env, roots.homedir), file),
    join(packageRolesDir(roots.packageRoot), file),
    generic,
  ];
}

export async function findRoleTemplate(roots: TemplateRoots, role: string): Promise<RoleTemplate> {
  const candidates = roleTemplateCandidates(roots, role);
  for (const path of candidates) {
    const content = await readFileIfExists(path);
    if (content !== undefined) return { path, content };
  }
  throw new OmtError("template_missing", `no role template for "${role}"`, {
    hint: `looked in: ${candidates.join(", ")}`,
  });
}

export async function loadResultContract(packageRoot: string, kind: ResultKind): Promise<string> {
  const path = join(packageRoot, "skills", "omt", "references", "results", `${kind}.md`);
  const content = await readFileIfExists(path);
  if (content === undefined) {
    throw new OmtError("contract_missing", `no result contract for "${kind}" at ${path}`, {
      hint: `run "omt doctor" to check the installed skills`,
    });
  }
  return content.trim();
}
