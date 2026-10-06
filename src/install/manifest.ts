import { OmtError } from "../util/errors.ts";
import { readFileIfExists, writeFileAtomic } from "../util/fs.ts";
import { PACKAGE_NAME } from "./skills.ts";

export interface ManifestLink {
  path: string;
  target: string;
}

export interface ManifestHook {
  kind: "claude-user-prompt-submit";
  settingsPath: string;
  command: string;
}

export interface Manifest {
  package: string;
  version: string;
  installedAt: string;
  skillsRoot: string;
  skills: string[];
  links: ManifestLink[];
  config?: { path: string; created: boolean };
  hooks: ManifestHook[];
  backups: string[];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function readManifest(path: string): Promise<Manifest | undefined> {
  const text = await readFileIfExists(path);
  if (text === undefined) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new OmtError("manifest", `the install manifest ${path} is not valid JSON`, {
      hint: "fix or delete the file, then run the command again",
      cause: error,
    });
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new OmtError("manifest", `the install manifest ${path} does not hold a JSON object`, {
      hint: "fix or delete the file, then run the command again",
    });
  }
  const value = raw as Record<string, unknown>;
  const links = Array.isArray(value.links)
    ? value.links.filter(
        (link): link is ManifestLink =>
          link !== null && typeof link === "object" && typeof link.path === "string" && typeof link.target === "string",
      )
    : [];
  const hooks = Array.isArray(value.hooks)
    ? value.hooks.filter(
        (hook): hook is ManifestHook =>
          hook !== null &&
          typeof hook === "object" &&
          hook.kind === "claude-user-prompt-submit" &&
          typeof hook.settingsPath === "string" &&
          typeof hook.command === "string",
      )
    : [];
  const config = value.config as { path?: unknown; created?: unknown } | undefined;
  return {
    package: typeof value.package === "string" ? value.package : PACKAGE_NAME,
    version: typeof value.version === "string" ? value.version : "",
    installedAt: typeof value.installedAt === "string" ? value.installedAt : "",
    skillsRoot: typeof value.skillsRoot === "string" ? value.skillsRoot : "",
    skills: strings(value.skills),
    links,
    ...(config !== null && typeof config === "object" && typeof config.path === "string"
      ? { config: { path: config.path, created: config.created === true } }
      : {}),
    hooks,
    backups: strings(value.backups),
  };
}

function unique<T>(items: T[], key: (item: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) byKey.set(key(item), item);
  return [...byKey.values()];
}

// Merges a new install record into the previous manifest. Later entries win on the same key.
export function mergeManifest(previous: Manifest | undefined, next: Manifest): Manifest {
  if (previous === undefined) return next;
  const config =
    next.config === undefined
      ? previous.config
      : {
          path: next.config.path,
          created: next.config.created || (previous.config?.path === next.config.path && previous.config.created),
        };
  return {
    ...next,
    skills: unique([...previous.skills, ...next.skills], (name) => name).sort(),
    links: unique([...previous.links, ...next.links], (link) => link.path),
    ...(config === undefined ? {} : { config }),
    hooks: unique([...previous.hooks, ...next.hooks], (hook) => hook.settingsPath),
    backups: unique([...previous.backups, ...next.backups], (path) => path),
  };
}

export async function writeManifest(path: string, manifest: Manifest): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(manifest, null, 2)}\n`);
}
