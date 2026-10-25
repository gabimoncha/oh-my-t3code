import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import type { EditorState } from "../../src/config/editor/api.ts";
import { parseJsonc } from "../../src/config/jsonc.ts";
import { childEnv, CLI_PATH, tempDir, writeFile } from "../helpers.ts";

test("config edit web preserves comments through a nested profile write and exits on SIGINT", async () => {
  const root = tempDir("omt-editor-e2e-");
  const env = childEnv(root);
  const project = join(root, "project");
  mkdirSync(join(project, ".git"), { recursive: true });
  const path = join(env.OMT_CONFIG_DIR!, "config.jsonc");
  const text = `// user config
{
  "version": 1, // keep version
  "profiles": {
    /* profile settings */
    "fast-proto": {
      "extends": "prototype",
      "limits": { "maxParallel": 2 /* keep limit */ }
    }
  }
} // end config
`;
  writeFile(path, text);
  const child = spawn(process.execPath, [CLI_PATH, "config", "edit", "--web", "--no-open"], {
    cwd: project,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const deadline = Date.now() + 8_000;
  try {
    while (!stdout.match(/omt config editor: (http:\/\/127\.0\.0\.1:\d+\/[\w-]+\/)/)) {
      assert.equal(child.exitCode, null, stderr);
      assert.ok(Date.now() < deadline, `editor URL timeout: ${stdout} ${stderr}`);
      await Bun.sleep(10);
    }
    const url = stdout.match(/omt config editor: (http:\/\/127\.0\.0\.1:\d+\/[\w-]+\/)/)![1]!;
    const page = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<html/i);
    const stateResponse = await fetch(`${url}api/state`, { signal: AbortSignal.timeout(2_000) });
    assert.equal(stateResponse.status, 200);
    const state = await stateResponse.json() as EditorState;
    const user = state.files.find((file) => file.kind === "user")!;
    assert.equal(user.text, text);
    const headers = { Origin: new URL(url).origin, "Content-Type": "application/json" };
    const ping = await fetch(`${url}api/ping`, { method: "POST", headers, signal: AbortSignal.timeout(2_000) });
    assert.equal(ping.status, 204);
    const write = await fetch(`${url}api/write`, {
      method: "POST", headers, signal: AbortSignal.timeout(2_000),
      body: JSON.stringify({ file: "user", base: user.hash, edits: [{ path: ["profiles", "fast-proto", "limits", "maxParallel"], value: 3 }] }),
    });
    assert.equal(write.status, 200, await write.text());
    const saved = readFileSync(path, "utf8");
    for (const comment of text.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g)!) {
      assert.ok(saved.includes(comment), `saved config must keep ${comment}`);
    }
    const config = parseJsonc(saved, path) as { profiles: Record<string, { limits: { maxParallel: number } }> };
    assert.equal(config.profiles["fast-proto"]!.limits.maxParallel, 3);
    child.kill("SIGINT");
    const result = await Promise.race([
      exited,
      Bun.sleep(3_000).then(() => { throw new Error("SIGINT exit timeout"); }),
    ]);
    assert.deepEqual(result, { code: 0, signal: null }, stderr);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  }
}, 15_000);
