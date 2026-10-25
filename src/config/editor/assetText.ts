import { readFileSync } from "node:fs";

// A Bun macro: src/config/editor/assets.ts imports it `with { type: "macro" }`, so Bun reads the page file when it
// transpiles or bundles assets.ts and inlines the text. The bundle and the binary then read no templates/ folder.
export function assetText(name: "index.html" | "app.css" | "app.js"): string {
  return readFileSync(new URL(`../../../templates/config-editor/${name}`, import.meta.url), "utf8");
}
