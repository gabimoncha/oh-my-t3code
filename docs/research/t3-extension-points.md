# T3 Code extension points for oh-my-t3code

> Note, 2026-10-18: this report reads a T3 Code source snapshot from before T3 Code v0.1.0, which was released on 2026-10-15. Two facts changed in v0.1.0:
>
> - `delegate_task` accepts `isolation: "worktree"`. A child with that option runs in a separate checkout based on the parent's local commit ([tools.ts](https://github.com/pingdotgg/t3code/blob/v0.1.0/apps/server/src/mcp/toolkits/orchestrator/tools.ts#L66)).
> - Agents outside T3 can connect to T3's `/mcp` endpoint with OAuth ([outside-agents.md](https://github.com/pingdotgg/t3code/blob/v0.1.0/docs/user/outside-agents.md)). Thread-only tools such as `delegate_task` and `task_status` still need a T3 thread as the caller ([handlers.ts](https://github.com/pingdotgg/t3code/blob/v0.1.0/apps/server/src/mcp/toolkits/orchestrator/handlers.ts#L19)).
>
> Release data: [GitHub API, latest release](https://api.github.com/repos/pingdotgg/t3code/releases/latest). Provider setup: [install.md, Providers](https://github.com/pingdotgg/t3code/blob/v0.1.0/docs/user/install.md#providers).

Research date: 2026-10-06.

Sources and versions read:

- `t3code` clone at commit `a172e1c4` (2026-10-05).
- `codex` clone at commit `7f89227` (2026-10-04).
- `pi` clone at commit `1144973` (2026-10-03).
- `opencode` clone at commit `907b3bc` (2026-10-02).
- Claude Agent SDK `0.3.284` type declarations from the local Bun cache at `~/.bun/install/cache/@anthropic-ai/claude-agent-sdk@0.3.284@@@1/sdk.d.ts`. T3 declares `"@anthropic-ai/claude-agent-sdk": "^0.3.276"` (`t3code:apps/server/package.json:31`). The T3 clone has no `node_modules`. The cached version is in the same caret range, so it is the closest available copy (inferred).

Path prefixes: `t3code:` means the T3 clone. `codex:`, `pi:`, and `opencode:` mean the other clones. `sdk:` means the cached Claude Agent SDK. `local:` means a path on this machine. Server source paths in `t3code` are under `apps/server/src/` unless they start with `packages/` or `docs/`.

## 1. Summary

- T3 Code has no plugin API. Drivers are a static list compiled into the server (`t3code:apps/server/src/provider/builtInDrivers.ts:1-27`). No doc, issue template, or code comment announces a plugin API.
- T3 runs each provider with its native configuration. Claude loads user, project, and local settings. Codex loads `config.toml` and `hooks.json`. Pi loads user extensions and packages. OpenCode loads its global and project config. Cursor loads all its setting sources. So provider-native hooks, plugins, skills, and MCP servers are the main extension surface.
- Antigravity is the exception. T3 runs it with a private `GEMINI_HOME` profile. Only the two user skill directories are linked back to `~/.gemini`. User MCP servers, hooks, and rules in `~/.gemini` do not load.
- Claude: T3 calls the Agent SDK `query()` without `settingSources`. In SDK `0.3.284`, an omitted `settingSources` loads user, project, and local settings, which matches the CLI. So `~/.claude/settings.json` hooks, enabled plugins, skills, and `CLAUDE.md` apply in T3 sessions.
- Codex: T3 adds only `tools.update_plan.enabled` and a `t3-code` MCP server as thread config overrides. Codex layers these above the user and project `config.toml`. Codex hooks run only when they are trusted (a stored `trusted_hash`) or managed.
- Pi: T3 spawns `pi --mode rpc` with no `--no-*` flags and adds one `--extension` file it writes to `~/.t3/caches/pi-t3-mcp-extension.ts`. User extensions, packages, skills, and context files load as in the Pi TUI.
- Skills: every composer `$name` mention is rewritten to the native syntax per provider. Claude gets `/name`. Cursor gets `/name`. Pi gets `/skill:name`. Codex keeps `$name`. OpenCode 2.x gets a structured `skills` field. The `$` menu lists skills from provider-specific scans or provider APIs.
- The only skill directories that all of Claude, Codex, Cursor, OpenCode, and Pi read are not the same. `~/.agents/skills` is read by Codex, Cursor, OpenCode, and Pi. Claude does not read it. T3 states this explicitly (`t3code:apps/server/src/provider/Drivers/ClaudeSkills.ts:7-9`).
- T3 has no user-configurable instructions for agent chats. `sourceControlWritingStyle.customInstructions` only feeds commit and PR text generation. T3 itself appends fixed runtime and orchestration instructions.
- T3 settings live in `~/.t3/userdata/settings.json`. The server watches this file and revalidates it on external edits. Provider instances and custom models are plain JSON entries in it. The database `statev2.sqlite` is server-owned state.
- `t3.json` supports `scripts` with `runOnWorktreeCreate`, plus `iconPath`, `defaultThreadEnvMode`, and `worktreeSubmodules`. It has no other lifecycle triggers.
- A process outside a provider session can drive T3 through `t3 auth session issue` (an administrative bearer token), the HTTP API (`/api/projects/mutate`, read-only orchestration snapshots), and the WebSocket RPC (`orchestration.dispatchCommand`, `server.updateSettings`). The `/mcp` endpoint accepts only per-thread credentials that T3 mints for provider sessions.
- T3 sets `T3_MCP_URL`, `T3_MCP_BEARER_TOKEN`, and `T3_PI_RUNTIME_MODE` for Pi only. It sets `T3_ACP_MCP_ENDPOINT`, `T3_ACP_MCP_AUTHORIZATION`, `T3_ACP_MCP_NODE`, and `T3_ACP_MCP_ENTRYPOINT` for ACP providers (Grok, Antigravity, ACP registry). Claude, Codex, Cursor, and OpenCode get the `t3-code` MCP server through config, not through env vars.
- T3 has no setting for user MCP servers. Users add MCP servers in each provider's native config, and T3 keeps those active (except Antigravity).

## 2. Skills (question 1)

### 2.1 How T3 lists and dispatches skills, per driver

**claudeAgent.**

- T3 scans two roots: `<config dir>/skills` (user) and `<cwd>/.claude/skills` (project) (`t3code:provider/Drivers/ClaudeSkills.ts:335-338`).
- The config dir is the instance `homePath`, then an inherited `CLAUDE_CONFIG_DIR`, then `~/.claude` (`t3code:provider/Drivers/ClaudeSkills.ts:293-313`).
- `.agents/skills` is not scanned. The comment says the Claude CLI answers a skill that lives only there with `Unknown command` (`t3code:provider/Drivers/ClaudeSkills.ts:7-9`).
- The user root wins on a name collision (`t3code:provider/Drivers/ClaudeSkills.ts:316-324`, `374-378`).
- The skill name is the directory name, not the frontmatter `name` (`t3code:provider/Drivers/ClaudeSkills.ts:363-369`).
- Frontmatter fields read: `description`, `disable-model-invocation`, `user-invocable`. YAML 1.1 booleans such as `yes` and `no` are accepted (`t3code:provider/Drivers/ClaudeSkills.ts:43-117`).
- Malformed frontmatter hides the skill (`t3code:provider/Drivers/ClaudeSkills.ts:355-361`).
- `skillOverrides` from user, project, project-local, repository-root local, and managed settings files mark skills as disabled or user-only (`t3code:provider/Drivers/ClaudeSkills.ts:139-172`, `200-237`). Values are `on`, `name-only`, `user-invocable-only`, `off`.
- Skills from Claude plugins are not scanned, so they do not appear in the `$` menu (inferred from the two roots above).
- Dispatch: the last `$name` mention that names a known skill becomes a leading `/name` command in the last text block. Earlier mentions become inline `/name` text (`t3code:provider/Drivers/ClaudeSkillDispatch.ts:1-23`, `49-80`).
- The adapter re-scans skills on every send (`t3code:orchestration-v2/Adapters/ClaudeAdapterV2.ts:3019-3032`).

**codex.**

- T3 asks the Codex app server with `skills/list` for the workspace cwd (`t3code:provider/Layers/CodexProvider.ts:484-494`).
- Dispatch: Codex parses `$name` natively. T3 only rewrites other currency sigils such as `€name` to `$name` (`t3code:orchestration-v2/Adapters/CodexAdapterV2.ts:418-425`).

**cursor.**

- T3 scans eight roots in this order: `<cwd>/.cursor/skills`, `<cwd>/.agents/skills`, `<cwd>/.codex/skills`, `<cwd>/.claude/skills`, then the same four under the user home (`t3code:provider/Drivers/CursorSkills.ts:219-231`).
- The scan is recursive, to depth 10, with entry and byte budgets (`t3code:provider/Drivers/CursorSkills.ts:26-29`, `130-217`).
- The first copy of a name wins, so project skills win over user skills (`t3code:provider/Drivers/CursorSkills.ts:240-246`).
- Frontmatter fields read: `name` (display name), `description`, `disable-model-invocation`, `user-invocable`, and `metadata.surfaces` (a skill is listed only if surfaces is empty or includes `cli`) (`t3code:provider/Drivers/CursorSkills.ts:91-128`).
- Dispatch: known `$name` mentions become `/name` (`t3code:provider/Drivers/CursorSkills.ts:278-290`, `t3code:orchestration-v2/Adapters/CursorAdapterV2.ts:2115-2134`).

**grok.**

- T3 runs `grok inspect --json` and reads `skills[]` with `name`, `description`, `source.type` (`user`, `project`, `bundled`, `plugin`), `source.path`, and `userInvocable` (`t3code:provider/Drivers/GrokSkills.ts:1-16`, `50-92`).
- Grok plugin skills live under `~/.grok/installed-plugins/` (`t3code:provider/Drivers/GrokSkills.ts:9-11`).
- Dispatch: no rewrite was found. `$name` text reaches Grok unchanged (inferred). Searches run: `rg -i skill` in `GrokAdapterV2.ts`, `AcpAdapterV2.ts`, `GrokAcpSupport.ts` returned no dispatch code.

**pi.**

- T3 sends the Pi RPC `get_commands` request and keeps commands with `source: "skill"`. Names drop the `skill:` prefix (`t3code:provider/PiCommands.ts:45-91`).
- Dispatch: every known `$name` is removed from the text and hoisted to a leading `/skill:name` prefix (`t3code:provider/PiCommands.ts:94-127`, `t3code:orchestration-v2/Adapters/PiAdapterV2.ts:2184-2189`).

**antigravity.**

- T3 scans five roots in order: `~/.gemini/config/skills` (user), `<cwd>/.gemini/skills` (project), `~/.gemini/antigravity-cli/skills` (user), `<cwd>/.agents/skills` (project), `<cwd>/.agent/skills` (project) (`t3code:provider/Drivers/AntigravitySkills.ts:160-180`).
- Each root loads its own `SKILL.md` or those in immediate subdirectories. The first valid name wins (`t3code:provider/Drivers/AntigravitySkills.ts:155-159`).
- Frontmatter fields read: `name` and `description`. The name falls back to the file name (`t3code:provider/Drivers/AntigravitySkills.ts:55-59`, `96-113`).
- `~/.agents/skills` is not read (`t3code:provider/Drivers/AntigravitySkills.ts:37-40`, `t3code:docs/user/providers-antigravity.md:91-93`).
- Dispatch: no rewrite found (inferred unchanged `$name`). Same searches as Grok.

**opencode.**

- 1.x: T3 reads skills through the SDK `app.skills` endpoint (`t3code:provider/Drivers/OpenCodeDriver.ts:395-407`).
- 2.x: T3 reads `client.skill.list({ location })` per directory (`t3code:provider/Drivers/OpenCodeDriver.ts:316-343`).
- Dispatch on 2.x: known `$name` mentions are sent as a structured `skills: [{ id }]` field on the prompt (`t3code:orchestration-v2/Adapters/OpenCode2AdapterV2.ts:779-790`, `3518-3536`).
- Dispatch on 1.x: no rewrite found (inferred unchanged `$name`). Search run: `rg -i skill OpenCodeAdapterV2.ts` found only the `skill` tool name at line 603.

**acpRegistry.**

- Skills are the commands that the ACP agent advertises with a `$` prefix in `available_commands`. Their path is `acp://skill/<name>` and scope is `agent` (`t3code:provider/acp/AcpRegistryProbe.ts:203-239`, `t3code:docs/user/providers-acp.md:84-87`).
- Dispatch: no rewrite found (inferred unchanged `$name`, which matches how the agent names the command).

### 2.2 Where each provider loads skills natively

- Claude: `<CLAUDE_CONFIG_DIR or ~/.claude>/skills` and `.claude/skills`, plus plugin skills (`t3code:provider/Drivers/ClaudeSkills.ts:4-6`; plugin skills from the SDK `skills` option doc at `sdk:sdk.d.ts:2241-2262`, which names `plugin:skill`).
- Codex: user `$CODEX_HOME/skills` (deprecated but read), user `~/.agents/skills`, system cache under `$CODEX_HOME/skills`, admin `<system config folder>/skills`, project `<project config folder>/skills` (the `.codex` folder), and `.agents/skills` in every directory from the project root to the cwd (`codex:codex-rs/ext/skills/src/host_roots.rs:85-118`, `136-171`).
- Pi: `~/.pi/agent/skills`, `.pi/skills`, `~/.agents/skills`, and `.agents/skills` from the cwd up to the repository root. Project locations need Pi project trust (`pi:packages/coding-agent/docs/skills.md:59-61`, `pi:packages/coding-agent/docs/security.md:35-45`). The `~/.pi/agent/skills` path is confirmed on this machine (`local:~/.pi/agent/skills`).
- OpenCode: `~/.claude/skills` and `~/.agents/skills` (global, pattern `skills/**/SKILL.md`), `.claude` and `.agents` directories from the cwd up to the worktree, every config directory with `{skill,skills}/**/SKILL.md` (this includes `~/.config/opencode` and `.opencode`), plus `skills.paths` and `skills.urls` from config (`opencode:packages/opencode/src/skill/index.ts:21-25`, `184-226`).
- Cursor: Cursor is closed source. T3 states that its scan mirrors Cursor's own roots (`t3code:provider/Drivers/CursorSkills.ts:1-8`).
- Grok: closed source. Native directories are not found. Searches run: `rg -n "\.grok"` in the T3 server and docs found only `~/.grok/installed-plugins/`.
- Antigravity: closed source. T3 states the native roots match its scan (`t3code:provider/Drivers/AntigravitySkills.ts:155-159`).

### 2.3 Table

| Provider | User-level skill dirs | Project-level skill dirs | Format | Invocation in T3 → native |
| --- | --- | --- | --- | --- |
| claudeAgent | `~/.claude/skills` or `$CLAUDE_CONFIG_DIR/skills`; plugin skills (not in `$` menu) | `.claude/skills` | `<dir>/SKILL.md`, YAML frontmatter `description`, `disable-model-invocation`, `user-invocable`; name = directory | `$name` → leading `/name` |
| codex | `~/.agents/skills`, `$CODEX_HOME/skills` (deprecated) | `.codex/skills`, `.agents/skills` from project root to cwd | `SKILL.md` with frontmatter (fields not read by T3; Codex owns parsing) | `$name` (native) |
| cursor | `~/.cursor/skills`, `~/.agents/skills`, `~/.codex/skills`, `~/.claude/skills` | same four under `<cwd>` | recursive `SKILL.md`; `name`, `description`, `disable-model-invocation`, `user-invocable`, `metadata.surfaces` | `$name` → `/name` |
| grok | reported by `grok inspect --json`; plugins in `~/.grok/installed-plugins/` | reported by `grok inspect --json` | Grok-defined | `$name` unchanged (inferred) |
| pi | `~/.pi/agent/skills`, `~/.agents/skills`, settings and packages | `.pi/skills`, `.agents/skills` up to repo root (needs project trust) | Agent Skills spec: `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`, `disable-model-invocation` | `$name` → leading `/skill:name` |
| antigravity | `~/.gemini/config/skills`, `~/.gemini/antigravity-cli/skills` | `.gemini/skills`, `.agents/skills`, `.agent/skills` | `SKILL.md`; `name`, `description` | `$name` unchanged (inferred) |
| opencode | `~/.claude/skills`, `~/.agents/skills`, `~/.config/opencode/skill(s)` | `.claude/skills`, `.agents/skills` up to worktree, `.opencode/skill(s)` | `**/SKILL.md` | 2.x: structured `skills` field; 1.x: `$name` unchanged (inferred) |
| acpRegistry | owned by the agent | owned by the agent | ACP command with `$` prefix | `$name` unchanged (inferred) |

The Pi frontmatter fields come from `pi:packages/coding-agent/docs/skills.md:67-85`.

## 3. Hooks and plugins inside T3 sessions (question 2)

### 3.1 claudeAgent

- Launch options are built in `makeClaudeQueryOptions` (`t3code:orchestration-v2/Adapters/ClaudeAdapterV2.ts:804-924`).
- The options set `model`, `tools` (the `claude_code` preset), `permissionMode`, `effort`, `settings` (a merged object from model selection and `autoCompactWindow`), `env`, `mcpServers`, `systemPrompt`, `extraArgs`, `additionalDirectories`, and `cwd`.
- The options do not set `settingSources`, `hooks`, `plugins`, or `skills`. Search run: `rg settingSources` across the T3 clone found it only in Cursor files.
- SDK `0.3.284` documents the default: "When omitted, all sources are loaded (matches CLI defaults)." It also says `'project'` is needed to load CLAUDE.md files (`sdk:sdk.d.ts:2229-2239`).
- So user `~/.claude/settings.json`, project `.claude/settings.json`, and local `.claude/settings.local.json` apply. Their hooks, `enabledPlugins`, and permissions apply. `CLAUDE.md` loads (inferred from the SDK default and the omitted option).
- Supporting evidence: T3 reads Claude Stop hook feedback for `/goal` (`t3code:orchestration-v2/Adapters/ClaudeAdapterV2.ts:1021`, `1060`). T3 disables hooks only for its own text generation helper with `--settings {"disableAllHooks":true}` and `--strict-mcp-config` (`t3code:textGeneration/ClaudeTextGeneration.ts:175-217`). This implies hooks run in normal chat sessions (inferred).
- A user can pass extra CLI flags through the instance `launchArgs`. T3 parses them and forwards them as SDK `extraArgs`, except `permission-mode` and `dangerously-skip-permissions`, which it maps itself (`t3code:orchestration-v2/Adapters/ClaudeAdapterV2.ts:832-836`, `916`).
- Per-instance config dir: the instance `homePath` becomes `CLAUDE_CONFIG_DIR` (`t3code:provider/Drivers/ClaudeHome.ts:36-55`).
- Hook events available (SDK `0.3.284`): `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `Notification`, `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`, `SessionEnd`, `Stop`, `StopFailure`, `SubagentStart`, `SubagentStop`, `PreCompact`, `PostCompact`, `PreModelSwitch`, `PostModelSwitch`, `PermissionRequest`, `PermissionDenied`, `Setup`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`, `Elicitation`, `ElicitationResult`, `ConfigChange`, `WorktreeCreate`, `WorktreeRemove`, `InstructionsLoaded`, `CwdChanged`, `FileChanged`, `DirectoryAdded`, `MessageDisplay` (`sdk:sdk.d.ts:952`).

### 3.2 codex

- T3 spawns `codex app-server <launchArgs>` (`t3code:provider/Layers/codexLaunchArgs.ts:12-15`, `t3code:orchestration-v2/Adapters/CodexAdapterV2.ts:1468-1482`).
- `launchArgs` comes from the instance setting, or from the `T3CODE_CODEX_LAUNCH_ARGS` environment variable, which wins (`t3code:provider/Layers/codexLaunchArgs.ts:3-8`). A user can pass `-c key=value` or `--profile` here (inferred from the free-form argument list).
- The instance `homePath` becomes `CODEX_HOME` (`t3code:orchestration-v2/Adapters/CodexAdapterV2.ts:1473-1476`).
- Every `thread/start`, `thread/resume`, and `thread/fork` sends a config override with `tools.update_plan.enabled = true` and, when a T3 MCP session exists, `mcp_servers.t3-code` (`t3code:orchestration-v2/Adapters/CodexAdapterV2.ts:1276-1310`). The comment says Codex layers these above the user's and project's `config.toml`.
- T3 does not pass `bypass_hook_trust`. Search run: `rg bypass_hook_trust` in the T3 clone found nothing.
- Shadow homes: a second account uses a shadow home. Every entry of the shared home is symlinked into it except `auth.json`, `models_cache.json`, `log`, `memories`, and `tmp` (`t3code:provider/Drivers/CodexHomeLayout.ts:19-34`, `373-376`). So `config.toml`, `hooks.json`, `skills`, and `plugins` from the shared home apply to every account (inferred from the link rule).
- T3-managed (ChatGPT) Codex instances other than the default use a shadow home at `<stateDir>/providers/codex/<instanceId>/shadow` over `~/.codex` (`t3code:provider/CodexManagedHome.ts:6-19`).
- Codex hook sources: `hooks.json` in each config layer folder, and `[hooks]` tables in each `config.toml` layer (`codex:codex-rs/hooks/src/engine/discovery.rs:129-166`, `339-343`). Layers include user (`$CODEX_HOME`) and project (`.codex/`) (`codex:codex-rs/hooks/src/engine/discovery.rs:824-830`).
- Codex hook trust: a non-managed hook runs only when its current hash equals a stored `trusted_hash` (`codex:codex-rs/hooks/src/engine/discovery.rs:715-721`, `796-813`). The state lives in `HooksToml.state`, a map from hook key to `{ enabled, trusted_hash }` (`codex:codex-rs/config/src/hook_config.rs:19-33`). In `config.toml` this is the `[hooks.state."<key>"]` table (inferred from the serde layout).
- Codex hook events: `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `SubagentStart`, `SubagentStop`, `Stop`, `Interrupt` (`codex:codex-rs/app-server-protocol/src/protocol/v2/hook.rs:19-21`). Handler types: `Command`, `McpTool`, `Prompt`, `Agent` (`codex:codex-rs/app-server-protocol/src/protocol/v2/hook.rs:24-28`).
- Codex plugins can ship `hooks/hooks.json` (`codex:codex-rs/hooks/src/engine/mod_tests.rs:1333-1340`).
- Project `.codex/` layers depend on Codex project trust (inferred from `project_trust_context` in `codex:codex-rs/config/src/loader/local.rs:143`).
- This machine has `~/.codex/config.toml`, `~/.codex/hooks.json`, `~/.codex/plugins`, and `~/.codex/skills` (`local:~/.codex/`).

### 3.3 cursor

- T3 uses the Cursor SDK with `settingSources: ["project", "user", "team", "mdm", "plugins"]` (`t3code:orchestration-v2/Adapters/CursorAdapterV2.ts:289-325`).
- The comment says these layers include project and user rules, skills, hooks, MCP servers, team and MDM policy, and account plugins. It also says the SDK loads none of them when `settingSources` is omitted (`t3code:orchestration-v2/Adapters/CursorAdapterV2.ts:289-296`).
- Cursor hooks "can only deny or ask" in local SDK runs, per the same comment.
- Cursor hook event names: not found. Cursor is closed source and the clones do not include it. Searches run: `rg -i "hook" CursorAdapterV2.ts CursorAgentSdk.ts`.

### 3.4 grok

- T3 spawns `grok agent stdio` with mode flags such as `--permission-mode auto` or `--always-approve` (`t3code:provider/acp/GrokAcpSupport.ts:55-66`).
- T3 does not isolate the Grok home. The process uses the user's normal Grok config (inferred, no `HOME` or config override found in `GrokAcpSupport.ts` or `GrokAdapterV2.ts`).
- Grok hooks and plugin format: not found. Grok is closed source. T3 only knows that plugins install under `~/.grok/installed-plugins/` (`t3code:provider/Drivers/GrokSkills.ts:9-11`).

### 3.5 pi

- T3 spawns `pi --mode rpc <launchArgs> --extension <path>` (`t3code:orchestration-v2/Adapters/piT3McpInjection.ts:250-316`).
- The file header states the design: no `--no-*` flags, so user extensions, skills, prompt templates, `AGENTS.md` and `SYSTEM.md`, `settings.json`, custom models, and auth all load (`t3code:orchestration-v2/Adapters/PiAdapterV2.ts:1-11`).
- T3 rejects launch args that control mode or session identity: `--continue`, `--export`, `--fork`, `--mode`, `--no-session`, `--print`, `--resume`, `--session`, `--session-id`, and help or version flags (`t3code:orchestration-v2/Adapters/piT3McpInjection.ts:14-32`, `107-170`).
- Pi extensions load from `~/.pi/agent/extensions/` and the project extensions directory. Pi loads `.ts` or `.js` files and directories with `index.ts` or `index.js` (`pi:packages/coding-agent/docs/extensions.md:17`, `44-50`).
- Project extensions, `.pi/settings.json`, `.pi/mcp.json`, and project packages need Pi project trust (`pi:packages/coding-agent/docs/security.md:35-55`).
- Pi packages are listed in `~/.pi/agent/settings.json` or the project settings (`pi:packages/coding-agent/docs/packages.md:19-21`).
- Pi extension events (from `on(event: ...)` overloads): `session_start`, `session_shutdown`, `session_compact`, `session_compact_failed`, `session_info_changed`, `session_tree`, `project_trust`, `input`, `user_bash`, `context`, `context_with_system`, `agent_start`, `agent_end`, `agent_settled`, `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `tool_call`, `tool_result`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `model_select`, `thinking_level_select`, `before_provider_headers`, `after_provider_response`, `provider_stream_event`, `mcp_servers_change`, `ui_prompt_start`, `ui_prompt_end`. Source: the extension `types.ts` under `pi:packages/coding-agent/src`. T3's own extension also uses `before_agent_start` and `before_provider_request` (`t3code:orchestration-v2/Adapters/piT3McpExtensionSource.ts:215`, `324`), so the list from the regex is not complete (inferred).
- Extension UI dialogs (`confirm`, `select`, `input`, `editor`) become T3 approval and question requests. `notify` becomes an activity item. Status, widget, and title updates are ignored (`t3code:orchestration-v2/Adapters/PiAdapterV2.ts:19-24`).

### 3.6 opencode

- T3 spawns `opencode serve --hostname=<h> --port=<p>` (`t3code:provider/opencodeRuntime.ts:689`).
- T3 sets `OPENCODE_CONFIG_CONTENT` to the caller's value, the inherited value, or `{}` (`t3code:provider/opencodeRuntime.ts:53-61`, `708-715`).
- OpenCode merges `OPENCODE_CONFIG_CONTENT` as an extra layer after the global and project config (`opencode:packages/opencode/src/config/config.ts:259-275`, `482-489`). So user and project config, including plugins, still load.
- OpenCode auto-loads local plugins from `{plugin,plugins}/*.{ts,js}` in each config directory, and npm plugins from the `plugin` config key (`opencode:packages/opencode/src/config/plugin.ts:19-29`).
- OpenCode plugin hooks: `event`, `config`, `tool`, `chat.message`, `chat.params`, `chat.headers`, `permission.ask`, `command.execute.before`, `tool.execute.before`, `shell.env`, `tool.execute.after`, `experimental.chat.messages.transform`, and more (`opencode:packages/plugin/src/index.ts:224-285`).
- T3 adds its MCP server at runtime. On 1.x it calls `client.mcp.add({ name: "t3-code" })` (`t3code:orchestration-v2/Adapters/OpenCodeAdapterV2.ts:977-979`). On 2.x it registers `t3-code-<thread>` and denies other threads' entries (`t3code:orchestration-v2/Adapters/OpenCode2AdapterV2.ts:448-464`).
- An external OpenCode server (instance `serverUrl`) stays owned by the user and may need an external restart to pick up config (`t3code:docs/internals/providers.md:24-26`).

### 3.7 antigravity

- T3 runs the agent with a private `GEMINI_HOME` at `<stateDir>/providers/antigravity/<key>` (`t3code:provider/antigravityAuthSupport.ts:207`, `243`).
- T3 links `config/skills` and `antigravity-cli/skills` back to `~/.gemini`. MCP servers, hooks, and credentials stay isolated (`t3code:provider/antigravityAuthSupport.ts:254-260`, `t3code:docs/internals/providers.md:38-45`).
- T3 rewrites the profile `settings.json` on every launch (`t3code:provider/antigravityAuthSupport.ts:415-421`).
- So user hooks and MCP servers in `~/.gemini` do not run in T3 sessions. Project-level Antigravity hooks: not found. Searches run: `rg -i hook antigravityAuthSupport.ts AntigravityAdapterV2.ts`.

### 3.8 acpRegistry

- T3 launches the registry agent or a local command with the configured arguments. Credentials and skills stay managed by the agent (`t3code:docs/user/providers-acp.md:20-35`).
- Native hooks depend on the agent. Not found in T3.

### 3.9 Lifecycle events per provider that oh-my-t3code can hook

| Provider | Session start | User prompt submit | Stop or turn end | Tool use |
| --- | --- | --- | --- | --- |
| claudeAgent | `SessionStart` | `UserPromptSubmit` | `Stop`, `SubagentStop` | `PreToolUse`, `PostToolUse` |
| codex | `SessionStart` | `UserPromptSubmit` | `Stop`, `SubagentStop` | `PreToolUse`, `PostToolUse` (trusted hooks only) |
| pi | `session_start` | `input`, `before_agent_start` | `agent_end`, `agent_settled`, `turn_end` | `tool_call`, `tool_result` |
| opencode | `event` (session events) | `chat.message` | `event` (session idle, inferred) | `tool.execute.before`, `tool.execute.after` |
| cursor | not found | not found | not found | not found |
| grok | not found | not found | not found | not found |
| antigravity | not available in T3 (profile isolation) | same | same | same |
| acpRegistry | agent-specific | agent-specific | agent-specific | agent-specific |

## 4. Instructions and settings storage (question 3)

### 4.1 Instructions T3 injects

- Claude: T3 appends runtime info and PR-linking rules to the `claude_code` preset system prompt. It adds the orchestration block when the T3 MCP server is attached (`t3code:orchestration-v2/Adapters/ClaudeAdapterV2.ts:909-915`, `t3code:provider/RuntimeInstructions.ts:1-24`).
- Codex: T3 sends orchestration and runtime text as `turn/start.additionalContext` entries `t3_code_orchestration` and `t3_code_runtime` (`t3code:provider/CodexDeveloperInstructions.ts:197-220`). It also sets `collaborationMode.settings.developer_instructions` for plan and default modes when the MCP server is attached (`t3code:orchestration-v2/Adapters/CodexAdapterV2.ts:730-757`, `t3code:provider/CodexDeveloperInstructions.ts:191-195`).
- Pi: the T3 extension appends the orchestration block in `before_agent_start` (`t3code:orchestration-v2/Adapters/piT3McpExtensionSource.ts:321-327`).
- OpenCode 2.x: T3 registers instructions under the key `t3-code` (`t3code:orchestration-v2/Adapters/OpenCode2AdapterV2.ts:645`).
- None of these blocks contain user text. No setting adds user instructions to agent chats. Searches run: `rg customInstructions` in the server returned only Git text generation, Pi `/compact`, and the environment MCP tool.

### 4.2 User-configurable instruction settings

- `sourceControlWritingStyle` has `mode` (`repo_conventions`, `conventional_commits`, `custom`), `customInstructions`, and `followChangeRequestTemplates` (`t3code:packages/contracts/src/settings.ts:1027-1037`).
- `customInstructions` is used only for commit messages and PR descriptions (`t3code:git/GitManager.ts:780-793`).
- In `repo_conventions` mode, T3 reads the repository `AGENTS.md`, and `CLAUDE.md` when the writer is a Claude instance, as examples for commit text (`t3code:git/GitManager.ts:794-822`).
- `branchNameInstructions` feeds worktree branch naming (`t3code:packages/contracts/src/settings.ts:1369-1370`, `t3code:orchestration-v2/ThreadLaunchService.ts:290`).
- Agents can read and update `sourceControlWritingStyle` through the MCP tools `t3_environment_read` and `t3_environment_preferences_update`, with a 4,000 character limit (`t3code:mcp/toolkits/environment/tools.ts:17-66`).

### 4.3 AGENTS.md and CLAUDE.md in chats

- T3 does not inject `AGENTS.md` or `CLAUDE.md` into chats. Each provider loads them natively (inferred from the absence of chat code; search `rg "AGENTS\.md|CLAUDE\.md"` found only `GitManager.ts` and a Pi comment).
- Pi loads `AGENTS.override.md`, `AGENTS.md`, and `CLAUDE.md` regardless of project trust (`pi:packages/coding-agent/docs/security.md:53`).
- Claude loads `CLAUDE.md` because the `project` setting source is loaded by default (`sdk:sdk.d.ts:2229-2237`).

### 4.4 Where T3 stores settings and state

Paths come from `deriveServerPaths` (`t3code:config.ts:130-160`). The base dir is `~/.t3` by default (`T3CODE_HOME` overrides it; inferred from the env var list). The state dir is `<base>/userdata` (or `<base>/dev` in development).

| Path | Format | Owner | Notes |
| --- | --- | --- | --- |
| `~/.t3/userdata/settings.json` | sparse JSON, defaults stripped | user-editable, server-validated | Watched for external edits with a 100 ms debounce (`t3code:serverSettings.ts:1185-1255`). Written atomically by the server (`t3code:serverSettings.ts:659-675`). |
| `~/.t3/userdata/keybindings.json` | JSON | user-editable | `t3code:config.ts:147` |
| `~/.t3/userdata/themes/` | theme files | user-editable via `t3 theme` | `t3code:config.ts:149` |
| `~/.t3/userdata/statev2.sqlite` (+ `-wal`, `-shm`) | SQLite | server-owned | Threads, projects, auth sessions (`t3code:config.ts:139`). |
| `~/.t3/userdata/secrets/` | secret store | server-owned | Sensitive provider env values and Bitbucket tokens (`t3code:serverSettings.ts:166-178`, `984-996`). |
| `~/.t3/userdata/server-runtime.json` | JSON | server-owned | Running server port and identity (`t3code:config.ts:159`). |
| `~/.t3/userdata/environment-id`, `anonymous-id` | text | server-owned | `t3code:config.ts:157-158` |
| `~/.t3/userdata/attachments/`, `browser-artifacts/`, `logs/` | files | server-owned | `t3code:config.ts:141-156` |
| `~/.t3/caches/` | provider status caches, Pi extension file | server-owned | `t3code:config.ts:144`; local listing shows `claudeAgent.json`, `codex.json`, `pi.json`, `acp-registry` and others. |
| `~/.t3/worktrees/` | git worktrees | server-owned | `t3code:config.ts:150` |
| `~/.t3/tools/` | ACP registry agent installs | server-owned | `t3code:docs/user/providers-acp.md:39` |

The local machine also has `client-settings.json`, `desktop-settings.json`, `connection-catalog.json`, `clerk-tokens.json`, `model-manifest.json`, and a legacy `state.sqlite` in `~/.t3/userdata` (`local:~/.t3/userdata`). These are client or server state. File contents were not read.

## 5. Provider instances and models (question 4)

### 5.1 Instances

- `settings.json` holds two maps. `providers.<driver>` is the legacy single-instance config. `providerInstances.<instanceId>` is the new map (`t3code:packages/contracts/src/settings.ts:1386-1409`).
- An instance envelope has `driver`, `displayName`, `accentColor`, `environment`, `enabled`, and an opaque `config` (`t3code:packages/contracts/src/providerInstance.ts:124-131`).
- `environment` is a list of `{ name, value, sensitive }`. Sensitive values move to the secret store and appear as redacted in `settings.json` (`t3code:packages/contracts/src/providerInstance.ts:97-113`, `t3code:serverSettings.ts:166-178`).
- Instance ids and driver kinds match `^[a-zA-Z][a-zA-Z0-9_-]*$`, max 64 characters (`t3code:packages/contracts/src/providerInstance.ts:42-49`).
- Unknown drivers round-trip and show as unavailable (`t3code:packages/contracts/src/providerInstance.ts:16-32`).
- Per-driver config fields:
  - codex: `setupMode`, `enabled`, `binaryPath`, `homePath` (CODEX_HOME), `shadowHomePath`, `launchArgs`, `customModels` (`t3code:packages/contracts/src/settings.ts:584-635`).
  - claudeAgent: `enabled`, `binaryPath`, `homePath` (CLAUDE_CONFIG_DIR), `customModels`, `launchArgs`, `autoCompactWindow` (`t3code:packages/contracts/src/settings.ts:642-692`).
  - cursor: `enabled`, legacy `binaryPath`, `apiEndpoint`, `customModels` (`t3code:packages/contracts/src/settings.ts:695-716`).
  - grok: `enabled`, `binaryPath`, `customModels` (`t3code:packages/contracts/src/settings.ts:718-737`).
  - antigravity: `enabled`, `authMethod`, `apiKey`, `gcpProject`, `gcpLocation`, `binaryPath`, `customModels` (`t3code:packages/contracts/src/settings.ts:754-811`).
  - pi: `enabled`, `binaryPath`, `launchArgs`, `customModels` (`t3code:packages/contracts/src/settings.ts:813-838`).
  - acpRegistry: `source` (`registry` or `local`), `enabled`, `agentId`, `commandPath`, `commandArgs`, `authMethodId`, `distribution`, `customModels` (string list) (`t3code:packages/contracts/src/settings.ts:843-904`).
  - opencode: `enabled`, `binaryPath`, `serverUrl`, `serverPassword`, `customModels` (`t3code:packages/contracts/src/settings.ts:906-948`).
- The local `settings.json` has `providerInstances` entries for `cursor` and `pi` (key names only were read).

### 5.2 Custom models

- A custom model is a bare slug string or `{ slug, name?, capabilities? }`. When `capabilities.optionDescriptors` is set, it replaces the driver default in the picker (`t3code:packages/contracts/src/model.ts:128-144`).
- A descriptor is `select` (`id`, `label`, `options[]`, `currentValue`, `promptInjectedValues`) or `boolean` (`id`, `label`, `currentValue`) (`t3code:packages/contracts/src/model.ts:7-44`).
- Selections persist as `[{ id, value }]`. A legacy object shape is still decoded (`t3code:packages/contracts/src/model.ts:46-91`).

### 5.3 Option descriptors per driver

| Driver | Option ids | Source |
| --- | --- | --- |
| claudeAgent | `effort` (`low`, `medium`, `high`, `xhigh`, `max`, `ultrathink`, `ultracode`), `contextWindow` (`200k`, `1m`), `fastMode`, `thinking` | `t3code:provider/model-manifest.json` profiles; `t3code:provider/ClaudeModelCatalog.ts:196`, `226` |
| codex | `reasoningEffort`, `serviceTier` | `t3code:provider/Layers/CodexProvider.ts:186-205` |
| cursor | Cursor SDK model parameters. `context` maps to `contextWindow`, `fast` to `fastMode`. Others pass through (for example `effort`, `thinking`). | `t3code:provider/cursorSdkModel.ts:4-35`, `t3code:provider/Layers/CursorProvider.ts:98-162` |
| grok | `reasoningEffort` from ACP model info | `t3code:provider/Layers/GrokProvider.ts:194-212` |
| pi | `thinking` (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, per model) | `t3code:provider/Layers/piThinkingCapabilities.ts:10`, `28-49` |
| opencode | `variant` (`low`, `medium`, `high`, `xhigh`), `agent` (`build`, `plan`) | `t3code:provider/Layers/OpenCodeProvider.ts:169-196` |
| antigravity | none; models are slugs such as `gemini-3.8-flash-high` | `t3code:provider/model-manifest.json` `providers.antigravity` |
| acpRegistry | ACP session config options, passed through; T3 adds `_t3/session-mode` | `t3code:provider/acp/AcpSessionConfig.ts:18`; `t3code:docs/user/providers-acp.md:72-80` |

### 5.4 Can a tool add an instance or model by editing a file?

- Yes, by editing `~/.t3/userdata/settings.json` (inferred). The server watches the file, revalidates it, and emits changes (`t3code:serverSettings.ts:1-10`, `1245-1255`).
- The safer path is the WebSocket RPC `server.updateSettings` (`t3code:packages/contracts/src/rpc.ts:443-444`). It goes through the same validation and keeps secrets in the store.
- The built-in Claude model catalog comes from `model-manifest.json`. T3 fetches a remote copy from `main` and keeps a cache (`t3code:docs/internals/model-manifest.md:1-20`). A tool should not edit the manifest. It should use `customModels` instead.

## 6. The `t3.json` project file (question 5)

Schema: `t3code:packages/contracts/src/t3ProjectFile.ts:28-107`. Published schema URL: `https://t3.codes/schema/t3.json` (`t3code:packages/contracts/src/t3ProjectFile.ts:12`). The file is JSONC (lenient JSON) at the workspace root (`t3code:packages/shared/src/t3ProjectFile.ts:8-24`).

Top-level fields:

- `$schema`: string.
- `iconPath`: workspace-relative path, max 512 characters.
- `defaultThreadEnvMode`: `worktree` or `local`.
- `worktreeSubmodules`: `recursive`, `top-level`, or `none`.
- `scripts`: array, max 50 entries.

Script fields:

- `name` (required, non-empty).
- `command` (required, non-empty). It runs in a T3 terminal at the project root.
- `icon`: one of `play`, `test`, `lint`, `configure`, `build`, `debug` (`t3code:packages/contracts/src/project.ts:23-30`).
- `runOnWorktreeCreate`: boolean. The script runs after a worktree is created for a new thread.
- `async`: boolean, default true. When false, the agent waits for the script to exit.
- `previewUrl`: URL opened in the desktop preview.
- `autoOpenPreview`: boolean.

How scripts flow:

- The web client offers `t3.json` scripts for import (`t3code:apps/web/src/hooks/useT3ProjectFileScripts.ts:55-64`, `t3code:docs/user/project-settings.md:74-76`).
- Imported scripts become project actions stored in server settings as `projectScriptOverrides` (`t3code:packages/contracts/src/settings.ts:1245`).
- The setup runner runs the project's stored scripts, not the file directly (`t3code:project/ProjectSetupScriptRunner.ts:59-67`, `t3code:orchestration-v2/ThreadLaunchService.ts:483-510`). So an edited `t3.json` needs a re-import (inferred).
- `worktreeSubmodules` is read from the `t3.json` of the checked-out branch at worktree creation (`t3code:vcs/GitVcsDriverCore.ts:3326-3343`).
- Setting resolution order: project override, environment setting, `t3.json`, built-in (`t3code:packages/contracts/src/t3ProjectFile.ts:110-133`).

Other lifecycle events: none. The only automatic trigger is `runOnWorktreeCreate`. Worktree setup stages are `fetch`, `checkout`, `submodules`, `setup-script`, `agent` (`t3code:packages/contracts/src/worktreeSetup.ts:15-21`). Searches run: `rg "runOnWorktreeCreate|teardown|onWorktreeRemove|postCreate"` in the server found no other trigger.

## 7. The `t3` CLI and external control (question 6)

### 7.1 Commands

Root: `t3 [server flags]` runs the server (`t3code:binCli.ts:56-90`).

| Command | Purpose | Flags |
| --- | --- | --- |
| `t3`, `t3 start`, `t3 serve` | run the server | `--mode`, `--port`, `--host`, `--base-dir`, `--dev-url`, `--no-browser`, `--bootstrap-fd`, `--auto-bootstrap-project-from-cwd`, `--log-websocket-events` (alias `--log-ws-events`), `--tailscale-serve`, `--tailscale-serve-port` (`t3code:cli/config.ts`) |
| `t3 app [path]` | open the app for a project | `path` argument (`t3code:cli/app.ts:252-256`) |
| `t3 pair` | create a pairing link | `--label`, `--ttl`, `--tailscale`, `--tailscale-serve-port` |
| `t3 auth pairing create, list, revoke` | manage pairing links | `--base-url`, `--label`, `--ttl`, `--json` |
| `t3 auth session issue, list, revoke` | manage bearer sessions | `--ttl`, `--label`, `--subject`, `--token-only`, `--json` (`t3code:cli/auth.ts:162-243`) |
| `t3 project add <path>`, `remove <project>`, `rename` | manage projects | `--title`, `--force` (`t3code:cli/project.ts:445-574`) |
| `t3 service install, update, restart, uninstall, status` | background service | `--allow-downgrade` |
| `t3 update` | update T3 | `--channel`, `--allow-downgrade`, `--yes` |
| `t3 uninstall` | uninstall | `--yes` |
| `t3 theme set, clear, show` | environment theme | `--id`, `--base-dir` |
| `t3 trace summary` | trace summary | `--since`, `--limit` |
| `t3 triage` | triage helper | `--agent`, `--model` |
| `t3 connect login, link, status, publish, unlink, logout` | T3 Connect | `--headless`, `--json`, `--publish-only`, `--disable` |
| `t3 acp-mcp-bridge` (unlisted) | stdio MCP bridge for ACP agents | env `T3_ACP_MCP_ENDPOINT`, `T3_ACP_MCP_AUTHORIZATION` (`t3code:cli/acpMcpBridge.ts:18-22`) |
| `t3 acp-mcp-call <tool> <json>` (unlisted) | call one T3 MCP tool from a terminal | same env (`t3code:cli/acpMcpBridge.ts:24-34`) |
| `__service-launcher`, `__ssh-helper`, `__claude-history`, `__service-preflight` | internal | not for users |

There is no CLI command to create threads or send messages. Searches run: `rg 'Command.make\("'` across `apps/server/src/cli`.

### 7.2 External control paths

- `t3 auth session issue` issues a bearer token with `AuthAdministrativeScopes` (`t3code:cli/auth.ts:162-193`). These scopes are `orchestration:read`, `orchestration:operate`, `terminal:operate`, `review:write`, `relay:read`, `access:read`, `access:write`, `relay:write` (`t3code:packages/contracts/src/auth.ts:80-115`).
- HTTP API endpoints include `/api/auth/websocket-ticket`, `/api/orchestration/shell`, `/api/orchestration/threads/:threadId` (plus `/bounded` and `/history`), `/api/projects`, and `/api/projects/mutate` (`t3code:packages/contracts/src/environmentHttp.ts:430-569`). The orchestration HTTP endpoints are read-only.
- Thread creation and messages go through the WebSocket RPC `orchestration.dispatchCommand` (`t3code:packages/contracts/src/orchestrationV2.ts:3091`, `t3code:packages/contracts/src/rpc.ts:1498-1500`). Bearer clients first get a short-lived WebSocket ticket over HTTP (`t3code:docs/internals/environment-auth.md:26-31`).
- `t3 project add` is a working example of an external client. It calls the running server over HTTP, or writes SQLite directly when the server is offline (`t3code:cli/project.ts:1-50`, execution modes `live` and `offline`).
- The `/mcp` endpoint accepts only tokens from `McpSessionRegistry`, which T3 mints per thread and provider session (`t3code:mcp/McpHttpServer.ts:102-128`, `t3code:mcp/McpSessionRegistry.ts:15-40`). An environment bearer token does not work there (inferred from the resolver).

### 7.3 Auth model (from `t3code:docs/internals/environment-auth.md`)

- The environment issues its own scoped sessions. T3 Connect relay credentials are a separate trust boundary.
- Pairing delegates a set of scopes. Exchanging a bootstrap credential can narrow but never widen a grant.
- Creating another pairing link needs `access:write` and every delegated scope.
- Cookies, bearer tokens, and DPoP tokens share one scoped session model. An invalid DPoP proof fails and does not fall back to bearer.
- Every RPC declares a required scope, and middleware checks it before the handler runs.
- `T3CODE_DEV_AUTH_TOKEN` is a reusable admin credential for web development servers only.
- The environment is the filesystem boundary. `orchestration:read` can read any file the server account can read.
- Signed asset URLs are bearer credentials for one file.

### 7.4 Environment variables T3 sets in provider sessions

| Provider | Variables | Source |
| --- | --- | --- |
| claudeAgent | `CLAUDE_CONFIG_DIR` when the instance sets `homePath`; instance env vars | `t3code:provider/Drivers/ClaudeHome.ts:36-55`. MCP goes through `mcpServers` with an `Authorization` header (`t3code:orchestration-v2/Adapters/ClaudeAdapterV2.ts:966-997`). |
| codex | `CODEX_HOME` when the instance sets `homePath` or a shadow home; instance env vars | `t3code:orchestration-v2/Adapters/CodexAdapterV2.ts:1473-1476`. MCP goes through `mcp_servers` config with `http_headers`. |
| pi | `T3_MCP_URL`, `T3_MCP_BEARER_TOKEN`, `T3_PI_RUNTIME_MODE`; inherited copies of the first two are deleted first | `t3code:orchestration-v2/Adapters/piT3McpExtensionSource.ts:15-17`, `t3code:orchestration-v2/Adapters/piT3McpInjection.ts:289-313` |
| grok, antigravity, acpRegistry | process env `T3_ACP_MCP_ENDPOINT`, `T3_ACP_MCP_AUTHORIZATION`, `T3_ACP_MCP_NODE`, `T3_ACP_MCP_ENTRYPOINT` (when set); the stdio bridge gets `ELECTRON_RUN_AS_NODE=1` and the first two | `t3code:orchestration-v2/Adapters/AcpAdapterV2.ts:683-717` |
| antigravity (extra) | `GEMINI_HOME` set to the private profile; ambient Google credentials removed | `t3code:provider/antigravityAuthSupport.ts:243`, `t3code:docs/internals/providers.md:36-40` |
| cursor | none found; MCP goes through SDK `mcpServers` with `type: "http"` | `t3code:orchestration-v2/Adapters/CursorAdapterV2.ts:205-220` |
| opencode | `OPENCODE_CONFIG_CONTENT`, `OPENCODE_SERVER_PASSWORD` (1.x) or `OPENCODE_PASSWORD` (2.x) | `t3code:provider/opencodeRuntime.ts:705-715`, `t3code:provider/opencode2/OpenCode2Server.ts:52-61` |
| all with device access | `agent-device` env vars and a `PATH` shim | `t3code:mcp/McpProviderSession.ts:21-45` |

`T3_MCP_URL` and `T3_MCP_BEARER_TOKEN` are not set for Claude or Codex. The harness of this session shows only `T3_ACP_MCP_*` in the orchestration instructions (`t3code:provider/T3OrchestrationInstructions.ts:30`).

## 8. MCP servers (question 7)

- T3 has no setting for user MCP servers per instance. Searches run: `rg -i mcp packages/contracts/src/settings.ts` found no MCP server field.
- Users add MCP servers in each provider's native config. T3 keeps them active:
  - Claude: user, project, and local settings load by default (section 3.1). T3 passes `--strict-mcp-config` only for text generation (`t3code:textGeneration/ClaudeTextGeneration.ts:215`).
  - Codex: T3's `mcp_servers.t3-code` is layered above `config.toml`, so other servers stay (`t3code:orchestration-v2/Adapters/CodexAdapterV2.ts:1276-1310`).
  - Cursor: the `user` and `project` setting sources include MCP servers (`t3code:orchestration-v2/Adapters/CursorAdapterV2.ts:289-296`).
  - OpenCode: global and project config load; T3 adds `t3-code` at runtime (section 3.6).
  - Pi: Pi has native MCP. It reads `~/.pi/agent/mcp.json` and `.pi/mcp.json` (project needs trust) (`pi:packages/coding-agent/docs/mcp.md:32`). T3's comment says "Pi core has no MCP client" (`t3code:orchestration-v2/Adapters/piT3McpExtensionSource.ts:4`). This comment is older than the Pi docs (inferred), so both paths may run.
  - Antigravity: user MCP servers in `~/.gemini` do not load (section 3.7).
- The composer docs tell users to use **Restart agent session** after adding skills, plugins, or MCP servers (`t3code:docs/user/composer.md:186-188`).

## 9. Pi integration detail (question 8)

- T3 writes the extension source to `<baseDir>/caches/pi-t3-mcp-extension.ts`. It rewrites the file only when the content differs (`t3code:orchestration-v2/Adapters/piT3McpInjection.ts:233-248`, `t3code:orchestration-v2/Adapters/PiAdapterV2.ts:405-411`, `t3code:config.ts:144`).
- The extension is TypeScript that Pi loads through `--extension`. It imports `@earendil-works/pi-coding-agent` and `typebox` from the user's Pi install (`t3code:orchestration-v2/Adapters/piT3McpExtensionSource.ts:1-10`, `25-27`).
- T3 materializes the extension even without an MCP credential, because it also implements T3's permission modes (`t3code:orchestration-v2/Adapters/PiAdapterV2.ts:405-411`).
- The extension registers handlers:
  - `before_provider_request` caps `max_tokens` at 32,768 for OpenRouter (`piT3McpExtensionSource.ts:215-228`).
  - `tool_call` asks for approval unless the mode allows the tool (`piT3McpExtensionSource.ts:234-246`).
  - `session_start` connects to T3 MCP and registers each tool as `mcp__t3-code__<name>` (`piT3McpExtensionSource.ts:258-319`).
  - `before_agent_start` appends the orchestration instructions to the system prompt (`piT3McpExtensionSource.ts:321-327`).
- The launch adds `--extension <path>` after the user's launch args, unless the same path is already present (`t3code:orchestration-v2/Adapters/piT3McpInjection.ts:272-288`).
- User extensions, packages, skills, and context files also load. The adapter header states this (`t3code:orchestration-v2/Adapters/PiAdapterV2.ts:5-8`). `t3code:docs/internals/providers.md:32-36` says Pi "owns native extension, package, and project trust discovery".
- Text generation helpers are different. They can pass `--no-extensions` and `--no-tools` (`t3code:orchestration-v2/Adapters/piT3McpInjection.ts:264-281`). So user Pi extensions do not run for titles and commit text (inferred from `disableExtensions`).

## 10. Plugin API, extension API, or roadmap notes (question 9)

- No plugin or extension API exists for T3 itself. Searches run: `rg -i "plugin api|extension api|plugin system|third-party plugin|roadmap|extensib"` in `docs`, `.github`, `README.md`, `AGENTS.md`, and `CONTRIBUTING.md`. The only hit is a general sentence in `AGENTS.md` line 13 about sharing the roadmap.
- `ProviderDriverKind` is an open slug so that forks can add drivers. Drivers "live in (or will be extracted to) their own packages" (`t3code:packages/contracts/src/providerInstance.ts:16-32`). This is a code-level extension point for forks, not a runtime plugin API.
- Adding a driver means adding a file and an entry in `BUILT_IN_DRIVERS` and rebuilding (`t3code:provider/builtInDrivers.ts:1-17`).
- `.github` contains `actions`, `ISSUE_TEMPLATE`, `workflows`, `triage`, and related files. No plugin notes were found there.
- Hook mentions in docs refer to provider-native hooks: Antigravity isolation (`t3code:docs/internals/providers.md:44`, `76-77`), "Opening a provider session can start MCP servers, run hooks" (`t3code:docs/internals/providers.md:54`), and Claude Stop hook feedback for `/goal` (`t3code:docs/internals/providers.md:125`).

## 11. Implications for oh-my-t3code

This section is a recommendation. It is not a statement of fact.

### 11.1 Install plan per provider

**Shared skills.** Keep one source directory owned by oh-my-t3code, for example `~/.oh-my-t3code/skills/<name>/SKILL.md`. Link or copy each skill into:

- `~/.agents/skills/<name>` for Codex, Cursor, OpenCode, and Pi.
- `~/.claude/skills/<name>` for Claude. Claude does not read `~/.agents/skills`. This machine already uses this link pattern (`local:~/.claude/skills`).
- `~/.gemini/config/skills/<name>` for Antigravity.

Use frontmatter `name` equal to the directory name, plus `description`. Add `disable-model-invocation` only when a skill must be manual. This keeps one file valid for every reader.

**claudeAgent.**

- Write hooks into `~/.claude/settings.json` under `hooks` (user scope), or ship a Claude plugin and enable it through `enabledPlugins`. A plugin keeps oh-my-t3code entries separate from user entries (inferred).
- For instances with a custom `homePath`, write to `<homePath>/settings.json` too.
- Useful events: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`.
- Project scope: `.claude/settings.json` and `.claude/skills`.

**codex.**

- Write hooks to `$CODEX_HOME/hooks.json` (default `~/.codex/hooks.json`), or ship a Codex plugin with `hooks/hooks.json`.
- Hooks will not run until trusted. The installer must either record trust in `[hooks.state."<key>"] trusted_hash` in `config.toml`, or tell the user to trust them in Codex. Recording trust needs Codex's hash algorithm, which may change (see risks).
- Skills: `~/.agents/skills`.
- Shadow homes share `hooks.json`, `config.toml`, `skills`, and `plugins` with the shared home, so one write covers all accounts of that home.

**cursor.**

- Skills: `~/.agents/skills` or `~/.cursor/skills`.
- Hooks and rules: use Cursor's native locations. The format was not found in the clones. Treat Cursor hooks as a later phase.

**pi.**

- Install an extension at `~/.pi/agent/extensions/oh-my-t3code/index.ts`, or publish a Pi package and add it to `~/.pi/agent/settings.json`.
- Use `session_start`, `input`, `before_agent_start`, `tool_call`, `tool_result`, `agent_settled`.
- Do not register tools named `mcp__t3-code__*`. T3's extension owns that prefix.
- Skills: `~/.agents/skills` or `~/.pi/agent/skills`.

**opencode.**

- Install a plugin file at `~/.config/opencode/plugin/oh-my-t3code.ts`, or add an npm plugin to the `plugin` key of `~/.config/opencode/opencode.json` (the global config path is inferred from OpenCode's `Global.Path.config`).
- Use `chat.message`, `tool.execute.before`, `tool.execute.after`, `event`, `shell.env`.
- Skills: `~/.agents/skills`.

**grok.** Skills only, through Grok's own skill config. Hooks are unknown.

**antigravity.** Skills only, in `~/.gemini/config/skills`. Hooks and MCP servers from `~/.gemini` do not reach T3 sessions. Do not write into T3's profile directory.

**acpRegistry.** Nothing generic. Each agent owns its config.

**T3 itself.**

- Add custom models and instances through the WebSocket RPC `server.updateSettings`, using a token from `t3 auth session issue`. Edit `~/.t3/userdata/settings.json` directly only when the server is stopped, or with an atomic write.
- Use the T3 MCP tools from inside sessions (`delegate_task`, `t3_thread_launch`, `schedule_task`) for orchestration. Skills can call them because every provider gets the `t3-code` server.
- Ship a `t3.json` template for projects that want worktree setup scripts.

### 11.2 Risks

- `statev2.sqlite`, `secrets/`, `server-runtime.json`, `environment-id`, `caches/`, `worktrees/`, and `tools/` are server-owned. A third-party tool must not write them.
- `settings.json` is server-owned in practice. The server rewrites it sparsely and atomically. A concurrent external write can be lost (inferred). Sensitive env values must not be written in plain text.
- T3 rewrites the Antigravity profile `settings.json` and the Pi extension file on launch.
- Codex hook trust uses a hash of the normalized hook identity (`codex:codex-rs/hooks/src/engine/discovery.rs:769-794`). Codex can change this. An installer that writes `trusted_hash` must recompute it per Codex version, or leave trust to the user.
- Claude SDK defaults for `settingSources` changed across versions. If T3 later passes `settingSources: []`, user hooks and plugins stop running in T3. Pin a check in the installer's doctor command (inferred).
- T3 moves fast. The clone shows a release on 2026-10-05. Driver details such as skill roots and dispatch rules change often.
- `$name` dispatch differs per provider. A skill that depends on arguments must accept both `/name args` (Claude, Cursor), `/skill:name args` (Pi), and plain prompts.
- Claude only expands one skill per message. Earlier mentions rely on the Skill tool (`t3code:provider/Drivers/ClaudeSkillDispatch.ts:16-19`).
- Pi project resources and Codex project config need native project trust. Project-level installs will not load until the user trusts the project.
- `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` on this machine are symlinks into a dotfiles repository (`local:~/.claude/CLAUDE.md`, `local:~/.codex/AGENTS.md`). An installer that edits them would edit the dotfiles repository.

## 12. Open questions

1. Does T3 pin the Claude Agent SDK to a version whose `settingSources` default is "load all"? The lockfile was not checked. The T3 clone has no `bun.lock` read in this session.
2. What are Cursor's native hook events and file locations? Cursor is closed source.
3. What are Grok's native skill directories and hook support? Grok is closed source.
4. Does Pi's native MCP client conflict with T3's extension bridge when a user also configures a `t3-code` server in `~/.pi/agent/mcp.json`?
5. How does Codex compute `trusted_hash`, and does the app server expose an RPC to trust a hook? Only the comparison was read.
6. Does `OPENCODE_CONFIG_CONTENT="{}"` change plugin load order for OpenCode 2.x servers? Only the 1.x config loader in `packages/opencode` was read.
7. Can `orchestration.dispatchCommand` create a thread from an external client with the same options as `t3_thread_launch`? The command schema in `orchestrationV2.ts` was not read in full.
8. Does editing `t3.json` update already imported project scripts, or does it need a manual re-import? The import code in the web client was not read in full.
