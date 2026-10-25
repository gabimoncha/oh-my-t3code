import { assetText } from "./assetText.ts" with { type: "macro" };

export interface Asset {
  type: string;
  body: string;
}

// The page files by their path under the editor's base path.
export const ASSETS: Readonly<Record<string, Asset>> = {
  "": { type: "text/html; charset=utf-8", body: assetText("index.html") },
  "app.css": { type: "text/css; charset=utf-8", body: assetText("app.css") },
  "app.js": { type: "text/javascript; charset=utf-8", body: assetText("app.js") },
};
