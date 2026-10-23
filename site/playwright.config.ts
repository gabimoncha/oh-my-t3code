import { defineConfig, devices } from "@playwright/test";

// The tests run against the built site (bun run build), served like Cloudflare Pages serves it.
export default defineConfig({
  testDir: "e2e",
  // Not *.spec.ts: the root bun test would pick that name up.
  testMatch: "*.e2e.ts",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: "http://localhost:4173" },
  webServer: {
    command: "bun e2e/serve.ts",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { ...devices["iPhone 15"] } },
  ],
});
