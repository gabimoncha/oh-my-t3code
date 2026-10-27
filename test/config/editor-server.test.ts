import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import { connect } from "node:net";
import { test } from "bun:test";
import { startConfigEditor } from "../../src/config/editor/server.ts";
import type { ConfigEditor } from "../../src/config/editor/server.ts";
import type { EditorState } from "../../src/config/editor/api.ts";
import { userConfigPath } from "../../src/paths.ts";
import { fakeContext, tempDir, writeFile } from "../helpers.ts";

function send(editor: ConfigEditor, route: string, options: {
  method?: string; headers?: Record<string, string | undefined>; body?: string; absolute?: boolean;
} = {}): Promise<{ status: number; headers: IncomingHttpHeaders; text: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(editor.url);
    const headers: Record<string, string | undefined> = {
      Host: url.host, Origin: url.origin, "Content-Type": "application/json", ...options.headers,
    };
    for (const key of Object.keys(headers)) if (headers[key] === undefined) delete headers[key];
    const req = request({ hostname: "127.0.0.1", port: editor.port,
      path: options.absolute ? route : `${url.pathname}${route}`,
      method: options.method ?? "GET", headers, agent: false,
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, text }));
      res.on("error", reject);
    });
    req.setTimeout(2_000, () => req.destroy(new Error("request timeout")));
    req.on("error", reject);
    req.end(options.body);
  });
}

// The server answers 413 from the Content-Length header and closes while the upload runs, so a normal client can fail
// with ECONNRESET in its write. This one sends the head and a part of the body, then reads the response.
function sendTooLarge(editor: ConfigEditor, route: string, length: number): Promise<{ status: number; headers: IncomingHttpHeaders; text: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(editor.url);
    const socket = connect({ host: "127.0.0.1", port: editor.port });
    const chunks: Buffer[] = [];
    socket.setTimeout(2_000, () => socket.destroy(new Error("request timeout")));
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("error", (error) => { if (chunks.length === 0) reject(error); });
    socket.on("close", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const split = raw.indexOf("\r\n\r\n");
      if (split === -1) {
        reject(new Error(`no response head: ${JSON.stringify(raw)}`));
        return;
      }
      const [statusLine, ...lines] = raw.slice(0, split).split("\r\n");
      const headers: IncomingHttpHeaders = {};
      for (const line of lines) {
        const colon = line.indexOf(":");
        headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
      }
      let text = raw.slice(split + 4);
      if (headers["transfer-encoding"] === "chunked") {
        let rest = text;
        text = "";
        for (let size = parseInt(rest, 16); size > 0; size = parseInt(rest, 16)) {
          const start = rest.indexOf("\r\n") + 2;
          text += rest.slice(start, start + size);
          rest = rest.slice(start + size + 2);
        }
      }
      resolve({ status: Number(statusLine!.split(" ")[1]), headers, text });
    });
    socket.write([
      `POST ${url.pathname}${route} HTTP/1.1`, `Host: ${url.host}`, `Origin: ${url.origin}`,
      "Content-Type: application/json", `Content-Length: ${length}`, "", "x".repeat(1024),
    ].join("\r\n"));
  });
}

function setup() {
  const ctx = fakeContext({ root: tempDir("omt-editor-server-") });
  const path = userConfigPath(ctx.env, ctx.homedir);
  const text = '{ "version": 1, "limits": { "maxParallel": 2 } }\n';
  writeFile(path, text);
  return { ctx, path, text };
}

test("editor server rejects unsafe requests without CORS headers", async () => {
  const { ctx, path, text } = setup();
  const editor = await startConfigEditor(ctx, { open: false, idleMs: 1_000, closeGraceMs: 100 });
  try {
    const cases = [
      { route: `${new URL(editor.url).pathname.replace(/^\/./, "/!")}api/state`, absolute: true, status: 404, code: "not_found" },
      { route: "api/state", headers: { Host: "foreign.example" }, status: 403, code: "forbidden" },
      { route: "api/state", headers: { Origin: "https://foreign.example" }, status: 403, code: "forbidden" },
      { route: "api/state", headers: { Origin: "null" }, status: 403, code: "forbidden" },
      { route: "api/ping", method: "POST", headers: { Origin: undefined }, status: 403, code: "forbidden" },
      { route: "api/state", headers: { "Sec-Fetch-Site": "cross-site" }, status: 403, code: "forbidden" },
      { route: "missing", status: 404, code: "not_found" },
      { route: "api/state", method: "OPTIONS", status: 405, code: "method_not_allowed", allow: "GET" },
      { route: "api/write", method: "GET", status: 405, code: "method_not_allowed", allow: "POST" },
      { route: "api/write", method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}", status: 415, code: "unsupported_media_type" },
      { route: "api/write", method: "POST", tooLarge: 1024 * 1024 + 1, status: 413, code: "payload_too_large" },
    ];
    for (const scenario of cases) {
      const response = scenario.tooLarge
        ? await sendTooLarge(editor, scenario.route, scenario.tooLarge)
        : await send(editor, scenario.route, scenario);
      assert.equal(response.status, scenario.status, JSON.stringify(scenario.headers ?? scenario.route));
      assert.equal(JSON.parse(response.text).code, scenario.code);
      if (scenario.allow) assert.equal(response.headers.allow, scenario.allow);
      if (scenario.tooLarge) {
        assert.equal(response.headers["x-content-type-options"], "nosniff");
        assert.equal(response.headers["cache-control"], "no-store");
        assert.ok(response.headers["content-security-policy"]?.includes("default-src 'none'"));
      }
      assert.ok(Object.keys(response.headers).every((name) => !name.startsWith("access-control-")));
    }
    const success = await send(editor, "api/state", { headers: { Origin: undefined } });
    assert.equal(success.status, 200);
    assert.ok(Object.keys(success.headers).every((name) => !name.startsWith("access-control-")));
    assert.equal(readFileSync(path, "utf8"), text);
  } finally { await editor.close(); }
});

test("editor server rejects stale and concurrent writes and new config errors", async () => {
  const { ctx, path, text } = setup();
  const editor = await startConfigEditor(ctx, { open: false, idleMs: 1_000, closeGraceMs: 100 });
  try {
    const state = JSON.parse((await send(editor, "api/state")).text) as EditorState;
    const base = state.files.find((file) => file.kind === "user")!.hash!;
    const write = (hash: string, value: unknown, file = "user") => send(editor, "api/write", {
      method: "POST", body: JSON.stringify({ file, base: hash, edits: [{ path: ["limits", "maxParallel"], value }] }),
    });
    const stale = await write("stale", 3);
    assert.equal(stale.status, 409);
    assert.equal(JSON.parse(stale.text).code, "config_changed");
    assert.equal(JSON.parse(stale.text).hint, "reload the page");
    assert.equal(readFileSync(path, "utf8"), text);
    const invalid = await write(base, "invalid");
    assert.equal(invalid.status, 422);
    const error = JSON.parse(invalid.text);
    assert.equal(error.code, "config_invalid");
    assert.ok(error.newErrors.length > 0);
    assert.equal(readFileSync(path, "utf8"), text);
    const missing = await write(base, 3, "project");
    assert.equal(missing.status, 404);
    assert.equal(JSON.parse(missing.text).code, "config_not_found");
    const [first, second] = await Promise.all([write(base, 3), write(base, 4)]);
    assert.equal(first.status, 200, first.text);
    assert.equal(second.status, 409, second.text);
    assert.equal(JSON.parse(second.text).code, "config_changed");
    assert.equal(JSON.parse(second.text).hint, "reload the page");
    const written = JSON.parse(first.text).state.files.find((file: { kind: string }) => file.kind === "user").text;
    assert.equal(readFileSync(path, "utf8"), written);
  } finally { await editor.close(); }
});

for (const firstPing of [false, true]) {
  test(`editor server closes after a close beacon ${firstPing ? "after" : "before"} the first ping`, async () => {
    const { ctx } = setup();
    const editor = await startConfigEditor(ctx, { open: false, idleMs: 60, closeGraceMs: 150 });
    try {
      if (firstPing) assert.equal((await send(editor, "api/ping", { method: "POST" })).status, 204);
      const start = Date.now();
      assert.equal((await send(editor, "api/close", { method: "POST" })).status, 204);
      const closed = await Promise.race([editor.closed.then(() => true), Bun.sleep(1_000).then(() => false)]);
      assert.equal(closed, true, "close beacon must resolve closed within the grace time");
      assert.ok(Date.now() - start >= 120, "close beacon must allow the grace time instead of the idle time");
    } finally { await editor.close(); }
  });
}

test("editor server stays open when a ping follows a close beacon", async () => {
  const { ctx } = setup();
  const editor = await startConfigEditor(ctx, { open: false, idleMs: 1_000, closeGraceMs: 100 });
  let closed = false;
  void editor.closed.then(() => { closed = true; });
  try {
    assert.equal((await send(editor, "api/close", { method: "POST" })).status, 204);
    assert.equal((await send(editor, "api/ping", { method: "POST" })).status, 204);
    await Bun.sleep(200);
    assert.equal(closed, false, "ping must cancel the close grace timer");
    assert.equal((await send(editor, "api/state")).status, 200);
  } finally { await editor.close(); }
});

test("editor landing assets disclose no session token or configuration", async () => {
  const { ctx } = setup();
  let opened: string | undefined;
  const editor = await startConfigEditor(ctx, { open: true }, async (url) => { opened = url; return true; });
  try {
    assert.equal(opened, `${new URL(editor.url).origin}/`);
    const token = new URL(editor.url).pathname.split("/")[1]!;
    for (const route of ["/", "/login.js"]) {
      const response = await send(editor, route, { absolute: true });
      assert.equal(response.status, 200);
      assert.ok(!response.text.includes(token));
      assert.equal(response.headers["cache-control"], "no-store");
    }
    assert.equal((await send(editor, "/api/state", { absolute: true })).status, 404);
    assert.equal((await send(editor, "/", { absolute: true, method: "POST", body: "{}" })).status, 405);
    assert.equal((await send(editor, "/", { absolute: true, headers: { Host: "other" } })).status, 403);
  } finally {
    await editor.close();
  }
});
