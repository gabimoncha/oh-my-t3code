import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

// Serves the built site the way Cloudflare Pages does: files from dist/client, "/" as index.html,
// and 404.html with status 404 for any other path.
const root = join(import.meta.dirname, "..", "dist", "client");
const port = Number(process.env.PORT ?? 4173);
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".json": "application/json",
};

async function file(path: string) {
  try {
    return await readFile(join(root, normalize(path)));
  } catch {
    return undefined;
  }
}

createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const body = await file(path.endsWith("/") ? `${path}index.html` : path);
  if (body) {
    response.writeHead(200, { "content-type": types[extname(path)] ?? "text/html; charset=utf-8" });
    response.end(body);
    return;
  }
  response.writeHead(404, { "content-type": types[".html"] });
  response.end(await file("404.html"));
}).listen(port);
