import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { promisify } from "node:util";
import { onTestFinished } from "bun:test";
import { childEnv, PACKAGE_ROOT, tempDir } from "../helpers.ts";

const execute = promisify(execFile);

export function tools() {
  const find = (name: string): string => {
    const path = Bun.which(name);
    assert.ok(path, `Required tool is missing: ${name}`);
    return realpathSync(path);
  };
  const paths = { node: find("node"), npm: find("npm"), pnpm: find("pnpm"), npx: find("npx"), bun: process.execPath };
  const dirs = [...new Set([dirname(paths.node), dirname(paths.npm), dirname(paths.pnpm), "/usr/bin", "/bin"])];
  for (const dir of dirs) assert.ok(!existsSync(join(dir, "bun")), `Node-only PATH contains bun: ${dir}`);
  return { ...paths, nodePath: dirs.join(delimiter), bunPath: [dirname(paths.bun), ...dirs].join(delimiter) };
}

export function isolatedEnv(root: string): NodeJS.ProcessEnv {
  const env = childEnv(root);
  for (const name of Object.keys(env)) {
    if (/^(OMT_|XDG_|CLAUDE_|T3CODE_)/.test(name)) delete env[name];
  }
  Object.assign(env, {
    OMT_CONFIG_DIR: join(root, "omt"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_STATE_HOME: join(root, "state"),
    CLAUDE_CONFIG_DIR: join(root, "claude"),
    T3CODE_HOME: join(root, "t3"),
    npm_config_cache: join(root, "home", ".npm"),
    npm_config_userconfig: join(root, "npmrc"),
    NPM_CONFIG_USERCONFIG: join(root, "npmrc"),
    BUN_INSTALL_CACHE_DIR: join(root, "bun-cache"),
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
  });
  mkdirSync(env.HOME!, { recursive: true });
  return env;
}

export async function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  try {
    const result = await execute(command, args, { cwd, env, encoding: "utf8", timeout: 90_000, maxBuffer: 8 * 1024 * 1024 });
    return result.stdout + result.stderr;
  } catch (error) {
    const result = error as Error & { stdout?: string; stderr?: string };
    assert.fail(`${command} ${args.join(" ")}\n${result.message}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  }
}

export async function releaseRegistry(prefix: string, tool: ReturnType<typeof tools>) {
  const parent = join(PACKAGE_ROOT, "dist", "test-e2e");
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const home = tempDir("omt-registry-home-");
  const env = isolatedEnv(home);
  env.PATH = tool.bunPath;
  const release = join(root, "release");
  await run(tool.bun, [join(PACKAGE_ROOT, "scripts", "release.ts"), "--target", `${process.platform}-${process.arch}`, "--outdir", release], PACKAGE_ROOT, env);
  const tarballs = new Map<string, Buffer>();
  const manifests = new Map<string, { name: string; version: string; bin: Record<string, string> }>();
  for (const name of ["oh-my-t3code", "omt3"]) {
    const dir = join(release, "npm", name);
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name: string; version: string; bin: Record<string, string> };
    assert.ok(existsSync(join(dir, "dist", "cli.js")), `Missing bundle for ${name}`);
    await run(tool.npm, ["pack", "--ignore-scripts", "--pack-destination", root], dir, env);
    tarballs.set(`/${name}-${manifest.version}.tgz`, readFileSync(join(root, `${name}-${manifest.version}.tgz`)));
    manifests.set(name, manifest);
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const tarball = tarballs.get(url.pathname);
      if (request.method !== "GET") return new Response("Not found", { status: 404 });
      if (tarball) return new Response(new Uint8Array(tarball), { headers: { "content-type": "application/octet-stream" } });
      const manifest = manifests.get(url.pathname.slice(1));
      if (!manifest) return new Response("Not found", { status: 404 });
      const path = `/${manifest.name}-${manifest.version}.tgz`;
      const bytes = tarballs.get(path)!;
      return Response.json({
        name: manifest.name,
        "dist-tags": { latest: manifest.version },
        versions: {
          [manifest.version]: {
            ...manifest,
            dist: {
              tarball: `${url.origin}${path}`,
              shasum: createHash("sha1").update(bytes).digest("hex"),
              integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
            },
          },
        },
      });
    },
  });
  onTestFinished(() => server.stop(true));
  const registry = server.url.origin;
  const version = manifests.get("oh-my-t3code")!.version;
  return {
    root,
    version,
    registry,
    env: (name: string, path: string): NodeJS.ProcessEnv => ({
      ...isolatedEnv(join(home, name)),
      PATH: path,
      npm_config_registry: registry,
      NPM_CONFIG_REGISTRY: registry,
      BUN_CONFIG_REGISTRY: registry,
    }),
  };
}
