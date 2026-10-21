import { LATEST_DEFAULT_SET } from "./defaultSets.ts";
import { setTopLevelValue } from "./jsonc.ts";

export const SCHEMA_URL = "https://raw.githubusercontent.com/gabimoncha/oh-my-t3code/main/schema/omt.schema.json";

export const USER_STARTER_CONFIG = `// oh-my-t3code user config. It applies to every project.
// A project config in .omt/config.jsonc overrides it.
// Run \`omt config show --defaults\` to see the built-in roles and limits.
{
  "$schema": "${SCHEMA_URL}",
  "version": 1,
  // The pinned default set. After an omt update, run \`omt defaults diff\` to see what a newer set changes.
  "defaults": "${LATEST_DEFAULT_SET}",
  // "profile": "prototype",
  // Example: a profile that builds like prototype, with no checkpoints and fast implementation.
  // Run \`omt profile show <name>\` to see the workflow, roles, and limits that a profile resolves to.
  // "profiles": {
  //   "fast-proto": {
  //     "description": "Prototype with no checkpoints and fast execute.",
  //     "extends": "prototype",
  //     "workflow": { "build": { "checkpoint": "none" } },
  //     "roles": { "execute": { "fast": true } },
  //   },
  // },
  "roles": {
    // Example: run reviews on Codex first, then fall back to Claude.
    // "review": {
    //   "chain": [
    //     { "driver": "codex", "model": "gpt-6-astra", "effort": "high" },
    //     { "driver": "claudeAgent", "model": "claude-opus-5-5", "effort": "high" },
    //   ],
    // },
  },
  "limits": {
    // "maxParallel": 6,
  },
  // Example: write the plan summary as text instead of showing the plan as a page.
  // "visuals": { "plan": false },
}
`;

export const PROJECT_STARTER_CONFIG = `// oh-my-t3code project config. It overrides the user config for this project.
// Run \`omt config show --defaults\` to see the built-in roles and limits,
// and \`omt profile show\` to see the effective config.
{
  "$schema": "${SCHEMA_URL}",
  "version": 1,
  // The pinned default set. After an omt update, run \`omt defaults diff\` to see what a newer set changes.
  "defaults": "${LATEST_DEFAULT_SET}",
  // "profile": "prototype",
  // Example: a profile that builds like prototype, with no checkpoints and fast implementation.
  // Run \`omt profile show <name>\` to see the workflow, roles, and limits that a profile resolves to.
  // "profiles": {
  //   "fast-proto": {
  //     "description": "Prototype with no checkpoints and fast execute.",
  //     "extends": "prototype",
  //     "workflow": { "build": { "checkpoint": "none" } },
  //     "roles": { "execute": { "fast": true } },
  //   },
  // },
  "roles": {
    // Example: use a stronger model for implementation work in this project.
    // "execute": {
    //   "chain": [
    //     { "driver": "claudeAgent", "model": "claude-opus-5-5", "effort": "high" },
    //   ],
    // },
  },
  "limits": {
    // "maxParallel": 2,
  },
  // Example: write the plan summary as text instead of showing the plan as a page.
  // "visuals": { "plan": false },
}
`;

// The starter that omt install writes: with harnesses, the key goes after the "defaults" line.
export function starterConfig(scope: "user" | "project", harnesses?: string[]): string {
  const starter = scope === "project" ? PROJECT_STARTER_CONFIG : USER_STARTER_CONFIG;
  return harnesses === undefined ? starter : setTopLevelValue(starter, "harnesses", harnesses);
}
