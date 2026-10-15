export const SCHEMA_URL = "https://raw.githubusercontent.com/gabimoncha/oh-my-t3code/main/schema/omt.schema.json";

export const USER_STARTER_CONFIG = `// oh-my-t3code user config. It applies to every project.
// A project config in .omt/config.jsonc overrides it.
// Run \`omt config show --defaults\` to see the built-in roles and limits.
{
  "$schema": "${SCHEMA_URL}",
  "version": 1,
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
    // "maxParallel": 4,
  },
  // Example: write the plan summary as text instead of showing the plan as a page.
  // "visuals": { "plan": false },
}
`;

export const PROJECT_STARTER_CONFIG = `// oh-my-t3code project config. It overrides the user config for this project.
// Run \`omt config show --defaults\` to see the built-in roles and limits,
// and \`omt config show\` to see the effective config.
{
  "$schema": "${SCHEMA_URL}",
  "version": 1,
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
