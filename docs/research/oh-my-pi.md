# oh-my-pi (omp) research for oh-my-t3code

Snapshot: oh-my-pi clone at commit `d0cc523` (`git -C oh-my-pi log --oneline -1`). Upstream pi clone at commit `1144973`. Research date: 2026-10-06.

## Path conventions

- `oh-my-pi:` is the root of a clone of https://github.com/can1357/oh-my-pi at commit `d0cc523`.
- `pi:` is the root of a clone of https://github.com/earendil-works/pi at commit `1144973`.
- `t3code:` is the root of a clone of https://github.com/pingdotgg/t3code. The report does not name its commit.
- `CA` in a path means `packages/coding-agent/src` inside oh-my-pi. Example: `oh-my-pi:CA/task/agents.ts` is `oh-my-pi:packages/coding-agent/src/task/agents.ts`.
- Facts about T3 tools come from the T3 MCP tool list and the T3 orchestration instructions in this session, not from a clone. They are labeled "T3 session".

## Catalog note check

The catalog note is the owner's private note on oh-my-pi. It is not public. It is accurate on the points this report uses. I confirmed these claims in the clone:

- Fifteen model roles exist (`oh-my-pi:packages/tui/src/overlays/model-browser.ts:64-93`).
- Fallback chains exist per role, per model, and per provider wildcard (`oh-my-pi:docs/settings.md:572`).
- Path-scoped model sets exist (`oh-my-pi:docs/models.md:670-682`).
- The marketplace reads `.claude-plugin/marketplace.json` as a fallback (`oh-my-pi:docs/marketplace.md:15`).
- The bundled agents are `scout`, `reviewer`, `security-reviewer`, `task`, and `sonic` (`oh-my-pi:CA/task/agents.ts:44-73`).

One detail in the note needs a correction. The note says the marketplace is "compatible with the Claude Code plugin registry". The catalog format is compatible. Plugin hooks are not loaded in the Claude Code `hooks/hooks.json` format. omp loads plugin hooks from `hooks/pre/*` and `hooks/post/*` files (`oh-my-pi:CA/discovery/claude-plugins.ts:362-393`). A search for `PreToolUse` and `hooks.json` in `oh-my-pi:CA` and `oh-my-pi:docs` found no match.

## 1. Summary

- The `task` tool fans out subagents in one call with a shared `context` string and a `tasks[]` array (`oh-my-pi:docs/tools/task.md:33-36`). This is the core multi-agent design. oh-my-t3code can copy the shape on top of parallel `delegate_task` calls.
- Agents are Markdown files with YAML frontmatter. The fields are `name`, `description`, `tools`, `spawns`, `model`, `thinking-level`, `output`, `blocking`, `autoloadSkills`, `read-summarize`, `prewalk`, and `advisor` (`oh-my-pi:docs/task-agent-discovery.md:25-48`). This format is small and easy to adopt.
- An agent names a model role, not a model (`model: "@smol"`). Config maps roles to models (`oh-my-pi:docs/task-agent-discovery.md:50-75`). This indirection is the most useful idea for a cross-provider orchestrator.
- Subagent results can be schema-validated. The schema comes from the call, then the agent frontmatter, then the parent (`oh-my-pi:docs/tools/task.md:48-49,109`). Results are files addressed as `agent://<id>`, with JSON-path reads like `agent://<id>/findings/0` (`oh-my-pi:docs/tools/task.md:89-94`).
- Isolation runs a subagent in a copy-on-write clone or worktree. Changes return as a patch or as a branch that is cherry-picked (`oh-my-pi:docs/tools/task.md:133-134`, `oh-my-pi:CA/task/worktree.ts:862,943`). T3 already has worktree threads and merge-back.
- Model roles have fallback chains for 429, quota, and outage errors (`oh-my-pi:docs/settings.md:572,582`). T3 has no equivalent that I can see (inferred from the T3 session tool list).
- Vibe mode is a director over worker sessions with five tools: spawn, send, wait, kill, and list (`oh-my-pi:docs/vibe-mode.md:39-45`). It maps almost one to one onto `delegate_task`, `task_status`, and `task_cancel` (inferred).
- The advisor is a second model that reviews each turn or each final answer and injects severity-tagged notes (`oh-my-pi:docs/advisor-watchdog.md:147-151`). `WATCHDOG.yml` defines a roster of named advisors (`oh-my-pi:docs/advisor-watchdog.md:316-368`). A final-answer review is feasible in T3. A per-turn review is not (inferred).
- Goal mode keeps a session working across turns with a token budget. Its continuation prompt forces an evidence audit before completion (`oh-my-pi:CA/prompts/goals/goal-continuation.md`). This prompt is a strong candidate for a skill.
- `/loop --while|--until '<cmd>'` repeats a prompt and uses a shell exit code as the stop condition (`oh-my-pi:CA/modes/loop-condition.ts:1-15,124-131`). This maps onto `schedule_task` plus a condition check (inferred).
- `omp commit` uses an agent with git tools that proposes one commit or a split into atomic commits by file, hunk, or line range, with dependency order (`oh-my-pi:CA/commit/agentic/prompts/system.md:1-33`, `oh-my-pi:CA/commit/agentic/tools/split-commit.ts:17-34`).
- `/review` picks a reviewer count from diff size and fans out `reviewer` agents (`oh-my-pi:CA/extensibility/custom-commands/bundled/review/diff.ts:239-247`). This is a ready recipe for a review skill.
- TTSR stream rules, the IRC bus, Agent Hub, and checkpoint/rewind depend on owning the agent loop or the TUI. They do not fit an orchestration layer that sits on T3 MCP tools (inferred).
- Skills placed in `~/.agents/skills` reach omp (`oh-my-pi:docs/skills.md:98-101,122`) and pi (`pi:packages/coding-agent/docs/skills.md:60`). T3 injects its MCP tools into pi through an extension (`t3code:apps/server/src/orchestration-v2/Adapters/piT3McpInjection.ts:286-292`, `t3code:apps/server/src/orchestration-v2/Adapters/piT3McpExtensionSource.ts:262-303`). So one skill set can serve several harnesses (inferred).

## 2. Findings by question

### Q1. The task tool and subagents

#### Call shape

- The task tool spawns one subagent per call, or one per item in a `tasks[]` batch. `task.batch` is on by default (`oh-my-pi:docs/tools/task.md:3`).
- A batch call is `{ context, tasks: item[] }`. `context` is required. It is rendered into every child system prompt as a `CONTEXT` section (`oh-my-pi:docs/tools/task.md:35`).
- One item is `{ name?, agent?, task, solutionSpace, effort?, outputSchema?, schemaMode?, tools?, isolated? }` (`oh-my-pi:docs/tools/task.md:33`).
- `name` becomes the registry and IRC id. It defaults to a generated AdjectiveNoun name (`oh-my-pi:docs/tools/task.md:42`).
- `solutionSpace` describes how open the problem is. The automatic thinking-level classifier reads this field, not the task text (`oh-my-pi:docs/tools/task.md:45`).
- `model` accepts one selector or an ordered array. A role alias such as `@smol` is valid. An unmatched selector fails the call at preflight (`oh-my-pi:docs/tools/task.md:47,53-55`).
- Model priority is per-call `model`, then `task.agentModelOverrides[agent]`, then agent frontmatter `model`, then the task role (`oh-my-pi:docs/tools/task.md:47,109`).
- Children do not inherit conversation history. They get workspace context files, skills, the shared `local://` root, and the approved plan if one exists (`oh-my-pi:docs/tools/task.md:195`).

#### Agent definition format

- Required fields are `name`, `description`, and the body as system prompt (`oh-my-pi:docs/task-agent-discovery.md:29`).
- Optional fields are `tools`, `spawns`, `model`, `thinking-level`, `output`, `blocking`, `autoloadSkills`, `read-summarize`, `prewalk`, and `advisor` (`oh-my-pi:docs/task-agent-discovery.md:30-48`).
- `main` and `sub` are reserved names (`oh-my-pi:docs/task-agent-discovery.md:37`).
- `tools` accepts CSV or an array. The hidden `yield` tool is always added (`oh-my-pi:docs/task-agent-discovery.md:38`).
- `spawns` lists which agents this agent may spawn. `*` allows all (`oh-my-pi:docs/task-agent-discovery.md:39-40`).
- `model` is an ordered list. Later entries become per-spawn fallbacks (`oh-my-pi:docs/task-agent-discovery.md:43`, `oh-my-pi:docs/settings.md:582`).
- `output` holds the result schema. The bundled agents write it in JSON Type Definition form with `properties`, `optionalProperties`, `elements`, `enum`, and `metadata` keys (`oh-my-pi:CA/prompts/agents/scout.md:1-38`, `oh-my-pi:CA/prompts/agents/reviewer.md:1-40`).
- `blocking: true` makes the parent wait even when async execution is on (`oh-my-pi:docs/task-agent-discovery.md:45`).
- `autoloadSkills` names parent skills to inject before the first child prompt (`oh-my-pi:docs/task-agent-discovery.md:46`).

#### Discovery directories and precedence

Discovery is first-wins by exact name (`oh-my-pi:docs/task-agent-discovery.md:149-179`):

1. The nearest project `.omp/agents/*.md`.
2. The user `~/.omp/agent/agents/*.md`.
3. `agents/` inside each enabled OMP extension package.
4. `agents/` inside Claude marketplace plugin roots, project before user.
5. Bundled agents.

- Direct `.claude/agents`, `.codex/agents`, and `.gemini/agents` roots are skipped on purpose. Their frontmatter is not the omp contract (`oh-my-pi:docs/task-agent-discovery.md:147`).
- Claude-format plugin agents lose their `model` field, so Claude aliases are not read as omp selectors (`oh-my-pi:docs/task-agent-discovery.md:163`).
- One bad agent file is skipped with a warning. Discovery continues (`oh-my-pi:docs/task-agent-discovery.md:181-196`).
- Users can tag a model with `^` in the composer. The tag becomes a session pseudonym (`m1`, `m2`) that the task tool accepts as an `agent` (`oh-my-pi:docs/task-agent-discovery.md:94-104`).

#### Bundled agents

| Agent | Model | Tools and traits | Evidence |
|---|---|---|---|
| `scout` | `@smol`, thinking `medium` | `read, find, grep, glob, web_search`. Read-only. Structured output with `summary`, `files`, `architecture`, optional `report`. | `oh-my-pi:CA/prompts/agents/scout.md:1-38` |
| `reviewer` | `@slow` | `read, find, grep, glob, bash, lsp, web_search, ast_grep`. Spawns `scout`. Output has `overall_correctness`, `explanation`, `confidence`, and P0 to P3 `findings`. | `oh-my-pi:CA/prompts/agents/reviewer.md:1-40` |
| `security-reviewer` | not set | `read, find, grep, glob, lsp, ast_grep`. Output has findings with severity, confidence, CWE, and locations. | `oh-my-pi:CA/prompts/agents/security-reviewer.md:1-40` |
| `task` | `@task`, thinking `auto` | All tools. `spawns: "*"`. | `oh-my-pi:CA/task/agents.ts:48-62` |
| `sonic` | `@smol`, thinking `medium` | Same body as `task`. For mechanical work only. | `oh-my-pi:CA/task/agents.ts:63-72` |

#### Parallel fan-out and limits

- Parallelism is a batch in one call, or several task calls in one assistant message (`oh-my-pi:docs/tools/task.md:190`).
- One session-scoped semaphore bounds all spawns. `task.maxConcurrency` defaults to 32. `0` means unlimited (`oh-my-pi:docs/tools/task.md:164`).
- `task.maxRecursionDepth` defaults to 2 (`oh-my-pi:docs/tools/task.md:172`).
- `task.softRequestBudget` defaults to 200 requests. At 1.5 times the budget the child is stopped and yields partial findings (`oh-my-pi:docs/tools/task.md:170`).
- Speculative launch starts each batch item as soon as its JSON object closes in the stream (`oh-my-pi:docs/tools/task.md:132`).
- A child must finish through the hidden `yield` tool. The parent sends up to 3 reminders (`oh-my-pi:docs/tools/task.md:116,169`).
- The `before_subagent_spawn` extension event can change the model or block the spawn (`oh-my-pi:docs/extensions.md:480-482`, `oh-my-pi:docs/tools/task.md:108`).

#### Isolation and merge-back

- `task.isolation.enabled` defaults to `false` (`oh-my-pi:CA/task/settings.ts:22-33`).
- `isolation.backend` is one of `auto`, `apfs`, `btrfs`, `zfs`, `reflink`, `overlayfs`, `projfs`, `block-clone`, or `rcopy`. `rcopy` means git worktree if available, otherwise recursive copy (`oh-my-pi:CA/task/settings.ts:35-69`).
- The Rust `pi-iso` crate resolves the backend and falls back through a candidate list (`oh-my-pi:docs/tools/task.md:111,148`).
- `task.isolation.merge` is `patch` (default) or `branch` (`oh-my-pi:CA/task/settings.ts:116-131`).
- Patch mode captures a diff and runs `git apply` after a `canApplyPatch` check (`oh-my-pi:docs/tools/task.md:197`).
- Branch mode commits to `omp/task/<id>` and cherry-picks `baseSha..branch` into the parent. It stashes the parent first (`oh-my-pi:CA/task/worktree.ts:862,918-943`, `oh-my-pi:docs/tools/task.md:197`). The settings UI label says "merge with --no-ff". The code cherry-picks. The label is stale (inferred from the two sources).
- `task.isolation.apply=false` keeps the patch or branch without applying it (`oh-my-pi:CA/task/settings.ts:102-113`).
- Nested git repos get separate patches (`oh-my-pi:docs/tools/task.md:198`).
- The uncommitted baseline snapshot is capped at 1 GiB per repo (`oh-my-pi:docs/tools/task.md:165`).
- Isolation is not available in plan mode (`oh-my-pi:docs/tools/task.md:33`).

#### Results and `agent://` URLs

- Each subagent writes `<id>.md`. Structured data also writes `<id>.json` (`oh-my-pi:docs/tools/task.md:90-91`).
- `agent://<id>` reads the output. `agent://<id>/<key>/<index>` extracts a JSON value. `agent://<id>.<child>` reads a nested child (`oh-my-pi:docs/tools/task.md:92`).
- `history://<id>` renders the child transcript (`oh-my-pi:docs/tools/task.md:93`).
- `schemaMode` is `permissive` (default) or `strict`. After schema retries run out, permissive mode accepts invalid data with a warning, and strict mode fails (`oh-my-pi:docs/tools/task.md:49`).
- The inline summary is capped at 5000 characters. The full output stays in the artifact (`oh-my-pi:docs/tools/task.md:77,173`).

#### Async jobs, `wait`, and lifecycle

- With `async.enabled=true` (default `true`), each spawn becomes a background job. The tool returns at once with agent and job ids (`oh-my-pi:docs/tools/task.md:72`, `oh-my-pi:docs/settings.md:615`).
- `async.maxJobs` defaults to 100 (`oh-my-pi:docs/settings.md:616`).
- Results arrive in the parent as injected async-result messages (`oh-my-pi:docs/tools/task.md:74,152`).
- `wait` has no arguments. It returns on the first settled owned job or peer message (`oh-my-pi:docs/tools/wait.md:10-14`).
- An owned-job wait has a 30-minute cap. A peer-only wait returns after 5, 10, 30, 60, then 300 seconds (`oh-my-pi:docs/tools/wait.md:16-17`).
- The prompt tells the model to keep working instead of polling, because results auto-deliver (`oh-my-pi:docs/tools/wait.md:20`).
- `read proc://<id>` inspects a job. `write proc://<id>/kill` cancels it (`oh-my-pi:docs/tools/wait.md:25-26`).
- Finished agents stay `idle`. After `task.agentIdleTtlMs` (default 7 minutes) they are `parked`. `write agent://<id>` revives them (`oh-my-pi:docs/tools/task.md:122-123,166`).
- The tool text prefers messaging an existing agent over a fresh spawn for follow-up work (`oh-my-pi:docs/tools/task.md:192`).

#### Agent Hub

- Agent Hub is a TUI view opened with `Alt+A` (`oh-my-pi:docs/agent-hub.md:1-13`).
- Its roster shows status, model role, resolved model, age, task, cost, requests, tool calls, and tokens (`oh-my-pi:docs/agent-hub.md:27-34`).
- The user can focus a subagent, read its transcript, and steer it by typing (`oh-my-pi:docs/agent-hub.md:71-80`).
- `r` revives a parked agent. `x` kills one (`oh-my-pi:docs/agent-hub.md:46-60`).

#### Workpool

- `workpool()` in the eval kernel runs queued items across keep-alive subagents (`oh-my-pi:CA/task/workpool.ts:24-40`). I did not read its full semantics.

### Q2. Model roles

#### Role list

The built-in role ids are in `oh-my-pi:packages/tui/src/overlays/model-browser.ts:64-93`. Metadata is in `oh-my-pi:CA/config/model-roles.ts:56-90`.

| Role | UI name | Accepts | Users found in code | Default when unset |
|---|---|---|---|---|
| `default` | Default | chat | Main session model | Provider priority list |
| `smol` | Fast | chat | `sonic` and `scout` agents (`oh-my-pi:CA/task/agents.ts:68`, `oh-my-pi:CA/prompts/agents/scout.md:5`). Prewalk target (`oh-my-pi:CA/config/model-resolver.ts:1405`). `--plan-yolo` target (`oh-my-pi:CA/main.ts:1564`). `/cleanse` (`oh-my-pi:CA/cleanse/index.ts:21`). Commit fallback (`oh-my-pi:CA/commit/model-selection.ts:46`). | Inherits an explicit `default` (`oh-my-pi:docs/models.md:619-620`) |
| `slow` | Thinking | chat | `reviewer` agent (`oh-my-pi:CA/prompts/agents/reviewer.md:6`). Advisor fallback. | Inherits an explicit `default` |
| `vision` | Vision | chat | Image questions such as `read screenshot.png?q=...` (`oh-my-pi:CA/utils/image-question.ts:56`, `oh-my-pi:docs/models.md:606`) | `@default` then active model |
| `plan` | Architect | chat | Plan mode model switch (`oh-my-pi:CA/modes/interactive-mode.ts:4600`) | not documented |
| `commit` | Commit | chat | `omp commit` (`oh-my-pi:CA/commit/model-selection.ts:46`) | `smol`, then other chat roles |
| `tiny` | Tiny | tiny or chat | Session titles (`oh-my-pi:CA/utils/title-generator.ts:118`). Speech rewrite (`oh-my-pi:CA/tts/speech-enhancer.ts:77`). | `@smol` (`oh-my-pi:CA/config/model-resolver.ts:1176-1179`) |
| `memory` | Memory | tiny or chat | Mnemopi memory backend (`oh-my-pi:CA/mnemopi/backend.ts:571`) | `@tiny` |
| `task` | Subtask | chat | Bundled `task` agent (`oh-my-pi:CA/task/agents.ts:54`) | Parent session model (inferred from `oh-my-pi:CA/config/model-resolver.ts:1130-1140`) |
| `advisor` | Advisor | chat | Advisor runtime (`oh-my-pi:CA/config/model-resolver.ts:1824`) | Explicit `slow`, then the slow priority list (`oh-my-pi:docs/advisor-watchdog.md:46`) |
| `image` | Image generation | image kind | `generate_image` (`oh-my-pi:CA/tools/image-gen.ts:245`) | Built-in chain |
| `web` | Web search | search kind or chat with web search | `web_search` (`oh-my-pi:CA/web/search/index.ts:171`) | Built-in chain |
| `speech` | Speech | tts kind | `tts` tool and vocalizer (`oh-my-pi:CA/tools/tts.ts:61`, `oh-my-pi:CA/tts/vocalizer.ts:68`) | Built-in chain |
| `dictation` | Dictation | stt kind | Push-to-talk STT (`oh-my-pi:CA/stt/stt-controller.ts:153`) | Built-in chain |
| `judge` | Judge | judge, tiny, or chat | Typed judgments (`oh-my-pi:CA/judgment/index.ts:194`). Callers include the auto-thinking classifier, the unexpected-stop classifier, `jfind`, and judged TTSR rules (`oh-my-pi:CA/auto-thinking/classifier.ts`, `oh-my-pi:CA/session/unexpected-stop-classifier.ts`, `oh-my-pi:CA/tools/jfind/index.ts`, `oh-my-pi:docs/rulebook-matching-pipeline.md:279`). | Built-in chain |

- Users can add custom roles through `modelRoles`, `modelTags`, or `cycleOrder`. Custom roles use chat models (`oh-my-pi:docs/models.md:617-618`).
- `/model` has a Roles view to assign roles and fallbacks (`oh-my-pi:docs/settings.md:433-435`).

#### Config format

- `config.yml` holds `modelRoles`. `models.yml` holds providers and model metadata (`oh-my-pi:docs/models.md:599`).
- The user config is `~/.omp/agent/config.yml`. A project can add `.omp/config.yml` (`oh-my-pi:docs/prewalk.md:15`).
- A role value is `provider/model[:thinking]`. Suffixes are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `auto`, or `inherit` (`oh-my-pi:docs/settings.md:376`).
- A role value may hold comma-separated selectors. The first available one wins. This is a selection list, not a retry chain (`oh-my-pi:docs/models.md:614-616`).
- `@role` aliases expand through `modelRoles`. `*` means `@default` (`oh-my-pi:docs/models.md:612`).
- Example from the docs (`oh-my-pi:docs/settings.md:378-397`):

```yaml
modelRoles:
  default: anthropic/claude-sonnet-4-5
  smol: openai/gpt-4.1-mini
  slow: anthropic/claude-opus-4-5:high
  plan: anthropic/claude-opus-4-5
  advisor: anthropic/claude-sonnet-4-5:medium
  tiny: local/lfm2.5-230m
  judge: typesafe/jev-latest
```

- Model presets save a whole role set under a name. `/modelpreset switch deep` applies one (`oh-my-pi:docs/models.md:625-647`).
- `task.agentModelOverrides` maps an agent name to a selector, for example `sonic: "@fast_worker"` (`oh-my-pi:docs/task-agent-discovery.md:114-124`).

#### Fallback chains on 429 or quota errors

- `retry.fallbackChains` maps a role, an exact `provider/model`, or a `provider/*` wildcard to an ordered list (`oh-my-pi:docs/settings.md:572`).
- A `provider/*` entry keeps the failing model id and swaps the provider (`oh-my-pi:docs/settings.md:549-557`).
- An explicit `[]` disables fallback for that role (`oh-my-pi:docs/settings.md:433`).
- When a chat model keeps failing on 429s, quota walls, or outages, the session picks the most specific chain. The order is exact model key, then provider wildcard, then the role chain, then `default` (`oh-my-pi:docs/settings.md:582`).
- Chat candidates that are still cooling down are skipped (`oh-my-pi:docs/settings.md:582`).
- `retry.fallbackRevertPolicy: cooldown-expiry` returns to the primary after its cooldown. `never` stays on the fallback (`oh-my-pi:docs/settings.md:573`).
- `retry.usageAwareFallback` (default `false`) reads coding-plan quota reports before a turn and moves to healthy accounts or fallback models (`oh-my-pi:docs/settings.md:575`).
- `retry.usageReservePct` defaults to 10 percent. `retry.usageReservePolicy` is `confirm`, `auto`, or `fail-closed` (`oh-my-pi:docs/settings.md:576-577`).
- Credential rotation runs before a model switch (`oh-my-pi:docs/advisor-watchdog.md:65`).
- A fallback switch is temporary. It does not rewrite saved roles (`oh-my-pi:docs/models.md:726-732`).
- Context promotion is a separate chain. It switches to `contextPromotionTarget` on a context overflow before compaction (`oh-my-pi:docs/models.md:702-750`).

#### Path-scoped model sets

- `enabledModels`, `enabledProviders`, and `disabledProviders` accept entries scoped to a path prefix (`oh-my-pi:docs/models.md:666-682`).
- A scoped entry applies when the cwd is that path or below it (`oh-my-pi:docs/models.md:682`).
- Example: `enabledModels: [{ path: ~/work, models: [anthropic/claude-opus-4-5] }]` (`oh-my-pi:docs/models.md:670-675`).

### Q3. Advisor, watchdog, TTSR, prewalk, vibe mode, and the IRC bus

#### Advisor and WATCHDOG.yml

- What it does. An advisor is a second agent that reads each new transcript delta of the primary agent. It can inspect the workspace with its own tools. It injects notes back through an `advise` tool (`oh-my-pi:docs/advisor-watchdog.md:3-5,111-117`).
- Notes have three severities (`oh-my-pi:docs/advisor-watchdog.md:147-151`):
  - `nit` is a non-interrupting aside at the next turn boundary.
  - `concern` interrupts when delivery rules allow it.
  - `blocker` interrupts and can trigger a new turn after a final answer.
- Notes render as `<advisory advisor="..." severity="..." guidance="weigh, don't blindly obey">` (`oh-my-pi:docs/advisor-watchdog.md:153-159`).
- An emission guard drops content-free notes such as "lgtm", dedupes repeats, and caps non-blocker notes per update at 4 by default (`oh-my-pi:docs/advisor-watchdog.md:181-192`).
- `advisor.immuneTurns` (default 3) limits how often concerns can interrupt (`oh-my-pi:docs/advisor-watchdog.md:177`).
- Default tools are `read`, `grep`, and `glob`. A roster entry may grant mutating tools (`oh-my-pi:docs/advisor-watchdog.md:134-141`).
- In plan mode, every advisor steer becomes a visible card instead (`oh-my-pi:docs/advisor-watchdog.md:172`).
- Config. `advisor.enabled: true` turns it on. The model is `modelRoles.advisor` (`oh-my-pi:docs/advisor-watchdog.md:26-42`).
- `WATCHDOG.md` is advisor-only guidance appended to the advisor prompt. It is discovered at `~/.omp/agent/WATCHDOG.md` and in every directory from cwd up to the repo root (`oh-my-pi:docs/advisor-watchdog.md:257-314`).
- `WATCHDOG.yml` is the roster. Top-level fields are `instructions` and `maxNotesPerUpdate`. Per-advisor fields are `name`, `enabled`, `model`, `tools`, `reviewMode`, `reviewInterval`, `syncBacklog`, `maxNotesPerUpdate`, and `instructions` (`oh-my-pi:docs/advisor-watchdog.md:316-368`).
- Trigger. `reviewMode: turn` reviews every primary turn, including tool-loop continuations. `reviewMode: agent-end` reviews only final yields (`oh-my-pi:docs/advisor-watchdog.md:364`).
- `syncBacklog` sets how long the primary waits for the advisor. Values are `off`, `1`, `3`, `5`, or `strict`. Bounded waits cap at 30 seconds (`oh-my-pi:docs/advisor-watchdog.md:194-221`).
- `strict` plus `agent-end` gives a synchronous final review before the primary finishes (`oh-my-pi:docs/advisor-watchdog.md:221`).
- Subagents have no advisor by default. Frontmatter `advisor` or `task.agentAdvisor` opts one in (`oh-my-pi:docs/advisor-watchdog.md:378-387`).
- Advisor transcripts persist as `__advisor[.<slug>].jsonl` in the session artifacts (`oh-my-pi:docs/advisor-watchdog.md:409-417`).
- Headless use is `omp -p --advisor "..."`. Print mode waits up to ten minutes for final reviews (`oh-my-pi:docs/advisor-watchdog.md:84-93`).

#### TTSR stream rules

- What it does. A TTSR rule watches the model output stream. On a match it aborts the stream, drops the partial output, injects the rule as a `<system-interrupt reason="rule_violation">` message, and retries (`oh-my-pi:docs/ttsr-injection-lifecycle.md:117-160`).
- Rules are Markdown files with frontmatter. The canonical shape has `name`, `content`, `globs`, `alwaysApply`, `description`, `condition`, `astCondition`, `question`, `scope`, `agents`, and `interruptMode` (`oh-my-pi:docs/rulebook-matching-pipeline.md:33-57`).
- Rule sources include `.omp/rules/*.md`, `~/.omp/agent/rules/*.md`, `RULES.md`, plugin rules, and Cursor, Windsurf, Cline, and GitHub instruction files (`oh-my-pi:docs/rulebook-matching-pipeline.md:59-91`).
- A rule becomes TTSR when it has a `condition` (regex), an `astCondition` (ast-grep pattern), or a `question` (judged by the `judge` role) (`oh-my-pi:docs/rulebook-matching-pipeline.md:222-231,279`).
- Other rules become always-apply rules or rulebook rules read on demand through `rule://` (`oh-my-pi:docs/rulebook-matching-pipeline.md:228-230`).
- Config. Settings are `ttsr.enabled` (default `true`), `contextMode` (default `discard`), `interruptMode` (default `always`), `repeatMode` (default `once`), `repeatGap` (default 10 turns), `builtinRules`, and `disabledRules` (`oh-my-pi:docs/ttsr-injection-lifecycle.md:76-87`).
- Trigger. Matching runs on text deltas, thinking deltas if scoped, and tool-call arguments. AST rules run in the `beforeToolCall` hook on final arguments (`oh-my-pi:docs/ttsr-injection-lifecycle.md:90-115`).
- `interruptMode` is `always`, `prose-only`, `tool-only`, or `never`. A non-interrupting tool match attaches a `<system-reminder>` after the tool result (`oh-my-pi:docs/ttsr-injection-lifecycle.md:117-127,164-180`).

#### Prewalk

- What it does. A strong model explores, writes a todo list, and starts the change. At the first `edit` or `write`, the session switches to a cheaper model for the rest (`oh-my-pi:docs/prewalk.md:1-5,42-50`).
- Config. `prewalk.enabled` defaults to `false`. The default target is `@smol`. Flags are `--prewalk`, `--no-prewalk`, and `--prewalk-into <model-or-role>` (`oh-my-pi:docs/prewalk.md:5-36`).
- Trigger. A successful `todo` call opens the gate. The switch happens at the end of the assistant turn that holds the first `edit` or `write` (`oh-my-pi:docs/prewalk.md:44-46`).
- The switch is one-shot. The target gets an implementation checklist (`oh-my-pi:docs/prewalk.md:50`).
- `/prewalk restart` returns to `@default` and re-arms the handoff (`oh-my-pi:docs/prewalk.md:65-67`).
- Subagents have their own prewalk controls (`oh-my-pi:docs/prewalk.md:71-73`, `oh-my-pi:docs/task-agent-discovery.md:47`).

#### Vibe mode

- What it does. The top-level session becomes a director. Its tools shrink to `read`, optional `todo`, and five worker tools. Workers do all searching, editing, and running (`oh-my-pi:docs/vibe-mode.md:3`).
- Worker tools (`oh-my-pi:docs/vibe-mode.md:39-45`):
  - `vibe_spawn { cli: "fast" | "good", prompt, name? }`
  - `vibe_send { session, message }`
  - `vibe_wait { sessions?, timeout? }`, default 30 seconds
  - `vibe_kill { session }`
  - `vibe_list {}`
- Tiers. `fast` uses the bundled `sonic` agent on `@smol`. `good` uses the bundled `task` agent on `@task` (`oh-my-pi:docs/vibe-mode.md:26-35`).
- Workers are keep-alive subagents with persisted transcripts. Results self-deliver to the director (`oh-my-pi:docs/vibe-mode.md:28,47`).
- The workflow is one worker per workstream, self-contained briefs, draft with `fast`, escalate to `good`, and verify claims by reading touched files (`oh-my-pi:docs/vibe-mode.md:55-65`).
- Trigger. The `/vibe` command toggles it. `/vibe <prompt>` enters and submits a first directive (`oh-my-pi:docs/vibe-mode.md:7-16`).
- Vibe mode cannot run with plan mode or goal mode (`oh-my-pi:docs/vibe-mode.md:18`).

#### IRC bus

- What it does. The IRC bus is a process-global mailbox for agent-to-agent messages (`oh-my-pi:CA/irc/bus.ts:1-10`).
- Sending never blocks on a reply. A parked recipient is revived, an idle one is woken with a real turn, and a busy one gets a non-interrupting aside at the next step (`oh-my-pi:CA/irc/bus.ts:1-10,56-60`).
- Each mailbox holds at most 100 messages (`oh-my-pi:CA/irc/bus.ts:24-25`).
- Agents send with `write agent://<id>`. `agent://all` broadcasts (`oh-my-pi:docs/tools/wait.md:27`).
- Config. There is no switch. Messaging is on for subagents and for top-level sessions that can spawn subagents (`oh-my-pi:CA/irc/messaging.ts:16-21`, `oh-my-pi:docs/tools/task.md:193`).
- Trigger. Any `write agent://<id>` call.

### Q4. Plan mode, todo, goal mode, `/loop`, ask, and checkpoint/rewind

#### Plan mode

- `plan.enabled` defaults to `true`. `plan.defaultOnStartup` defaults to `false`. `plan.autosave` saves approved plans to `<project>/.omp/plans/` (`oh-my-pi:CA/plan-mode/settings.ts:12-60`).
- In plan mode the working tree is read-only. The agent must write `local://<slug>-plan.md` (`oh-my-pi:CA/prompts/system/plan-mode-active.md:1-6`).
- The agent requests approval only by writing the slug to `xd://propose`. It must not ask in prose (`oh-my-pi:CA/prompts/system/plan-mode-active.md:8-10`).
- The prompt defines a plan as an execution spec. A fresh implementer must be able to execute it with zero design decisions (`oh-my-pi:CA/prompts/system/plan-mode-active.md:13-17`).
- The prompt says to discover facts with tools and to ask only about preferences, with 2 to 4 options and a recommended default (`oh-my-pi:CA/prompts/system/plan-mode-active.md:36-43`).
- Approval choices include "Approve and execute", "Approve and compact context", and "Approve and keep context" (`oh-my-pi:CA/modes/interactive-mode.ts:5286,6464-6465`).
- The approved plan is inlined into the next prompt. The agent must init `todo` and update it after each step (`oh-my-pi:CA/prompts/system/plan-mode-approved.md:1-30`).
- Subagents receive the approved plan reference (`oh-my-pi:CA/plan-mode/plan-handoff.ts:12-22`).
- Plan mode limits subagents to read tools and disables isolation (`oh-my-pi:docs/tools/task.md:110`).
- `--plan-yolo` plans read-only, auto-approves, then switches to the `smol` role to implement (`oh-my-pi:docs/cli-reference.md:132-133`).

#### Todo tool with phases

- One call is one op. Ops are `init`, `start`, `done`, `drop`, `block`, `unblock`, `rm`, `append`, and `view` (`oh-my-pi:docs/tools/todo.md:17-29`).
- The list has phases. `init` takes `list: [{ phase, items[] }]` (`oh-my-pi:docs/tools/todo.md:35`).
- Task status is `pending`, `in_progress`, `completed`, `abandoned`, or `blocked` with an optional blocker note (`oh-my-pi:docs/tools/todo.md:58-59`).
- `start` demotes any other `in_progress` task to `pending`. Only one task is in progress at a time (`oh-my-pi:docs/tools/todo.md:22`).

#### Goal mode

- `goal.enabled` defaults to `true` (`oh-my-pi:CA/goals/settings.ts:4-11`).
- The `goal` tool ops are `create`, `get`, `complete`, `resume`, and `drop`. `create` takes `objective` and an optional positive integer `token_budget` (`oh-my-pi:CA/goals/tools/goal-tool.ts:15-19,44-54`).
- Users start it with `/goal` or `omp --goal <objective>` (`oh-my-pi:docs/cli-reference.md:134`).
- Continuation. After each terminal turn, the runtime may send a hidden `goal-continuation` message. It requires an active goal, an idle session, plan mode off, and open todos that are not all blocked (`oh-my-pi:docs/rpc.md:480-485`).
- Continuation stops after a goal turn with no new tool activity (`oh-my-pi:docs/rpc.md:489-491`).
- `goal.continuationModes` selects run modes where goals auto-continue. RPC needs `"rpc"` in the list (`oh-my-pi:CA/goals/settings.ts:30-37`, `oh-my-pi:docs/rpc.md:475-477`).
- The continuation prompt shows tokens used, budget, and remaining. It requires an audit before `complete`. Each deliverable needs direct current-state evidence. "Budget exhaustion is not completion" (`oh-my-pi:CA/prompts/goals/goal-continuation.md`).
- At the budget limit, a separate prompt tells the agent to start no new work, summarize, and leave a next step (`oh-my-pi:CA/prompts/goals/goal-budget-limit.md`).

#### `/loop` with an exit-code condition

- `/loop [count|duration] [--while|--until '<cmd>'] [prompt]` re-submits the prompt after every yield (`oh-my-pi:CA/slash-commands/builtin-modes.ts:413-419`).
- The condition is a shell command. Only the exit code counts. Stdout is ignored (`oh-my-pi:CA/modes/loop-condition.ts:1-9`).
- Exit 1 means false. Exit codes above 1 (127, 126, 2) mean the condition is broken. The loop stops with an error rather than looking finished (`oh-my-pi:CA/modes/loop-condition.ts:11-15`).
- `--while` continues while the command succeeds. `--until` continues until it succeeds (`oh-my-pi:CA/modes/loop-condition.ts:83,124,131`).
- The condition runs in its own shell session, so a `cd` cannot move the agent (`oh-my-pi:CA/modes/loop-condition.ts:44-50`).
- `loop.mode` is `prompt` (follow-up), `compact` (compact first), or `reset` (new session first) (`oh-my-pi:CA/modes/settings.ts:766-789`).
- `loop.conditionTimeoutMs` defaults to 30 seconds (`oh-my-pi:CA/modes/settings.ts:792-808`).

#### Ask tool

- Input is `questions[]`. Each has `id`, `question`, `options[{ label, description?, preview? }]`, optional `header`, `multi`, and `recommended` (`oh-my-pi:docs/tools/ask.md:13-28`).
- Output gives the selected options, custom input, an optional note, and `timedOut` (`oh-my-pi:docs/tools/ask.md:30-40`).
- The shape is close to T3's question tool and Claude Code's `AskUserQuestion` (inferred from the T3 session tool list).

#### Checkpoint and rewind

- `checkpoint.enabled` defaults to `false` (`oh-my-pi:docs/tools/checkpoint.md:16-18`).
- `checkpoint { goal }` marks the conversation state before exploration (`oh-my-pi:docs/tools/checkpoint.md:24-28`).
- `rewind { report }` prunes the exploration since the checkpoint and keeps only the report (`oh-my-pi:docs/tools/rewind.md:1-3,22-26`).
- The pair is a context-saving tool, not a file undo (`oh-my-pi:docs/tools/checkpoint.md:3`).

### Q5. Extensibility

#### Extensions API

- An extension is a TS or JS module with a default factory that receives `ExtensionAPI` (`oh-my-pi:docs/extensions.md:17-36`).
- Methods include `on`, `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`, renderers, `sendMessage`, `sendUserMessage`, `appendEntry`, `exec`, `setActiveTools`, `setModel`, `setThinkingLevel`, `registerProvider`, and `events` (`oh-my-pi:docs/extensions.md:114-131`).
- Action methods throw if called during load (`oh-my-pi:docs/extensions.md:63-67`).
- Discovery roots are `<cwd>/.omp/extensions` and `~/.omp/agent/extensions`, plus installed plugins and the `extensions:` setting (`oh-my-pi:docs/extension-loading.md:32-102`).
- Events (`oh-my-pi:docs/extensions.md:376-523`):
  - Session events: `session_start`, `session_before_switch`, `session_switch`, `session_before_branch`, `session_branch`, `session_before_compact`, `session.compacting`, `session_compact`, `session_before_tree`, `session_tree`, `session_shutdown`.
  - Prompt and turn events: `input`, `before_agent_start`, `before_provider_request`, `after_provider_response`, `context`, `agent_start`, `agent_end`, `session_stop`, `cache_warming_decision`, `turn_start`, `turn_end`, `assistant_message`, `message_start`, `message_update`, `message_end`.
  - Tool events: `tool_call`, `tool_result`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `tool_approval_requested`, `tool_approval_resolved`.
  - Subagent event: `before_subagent_spawn`.
  - Runtime signals: `auto_compaction_start`, `auto_compaction_end`, `auto_retry_start`, `auto_retry_end`, `retry_fallback_applied`, `retry_fallback_succeeded`, `ttsr_triggered`, `todo_reminder`, `goal_updated`, `credential_disabled`.
  - Other: `mcp_notification`, `user_bash`, `user_python`, `resources_discover`.
- `session_stop` can request a continuation with `{ continue: true, additionalContext }`, capped at 8 continuations (`oh-my-pi:docs/extensions.md:412`).
- `tool_call` can block a call or rewrite its input. `tool_result` can patch the result (`oh-my-pi:docs/extensions.md:471-476`).
- The docs show a `mcp_notification` handler that turns an MCP push message into a mid-turn steer (`oh-my-pi:docs/extensions.md:495-511`).

#### Hooks

- Hooks are a legacy API. Hook files load through the extension runner (`oh-my-pi:docs/hooks.md:5-21`).
- Hook files live in `.omp/hooks/pre/*.ts` (`oh-my-pi:docs/hooks.md:10`).
- omp also loads `.claude/hooks/pre/` and `.claude/hooks/post/` files (`oh-my-pi:CA/discovery/claude.ts:374-395,621`).
- It does not read Claude Code `settings.json` hooks or `hooks/hooks.json`. Searches for `PreToolUse` and `hooks.json` found nothing.

#### Plugins and the marketplace

- A marketplace is a Git repo, a local directory, or a catalog URL (`oh-my-pi:docs/marketplace.md:15,80-90`).
- The catalog is `.omp-plugin/marketplace.json`. omp falls back to `.claude-plugin/marketplace.json` (`oh-my-pi:docs/marketplace.md:15`).
- The catalog JSON uses the Claude Code schema URL and fields `name`, `owner`, `metadata`, and `plugins[{ name, description, source, category }]` (`oh-my-pi:docs/marketplace.md:98-120`).
- A plugin can hold skills, commands, agents, rules, hooks, tools, MCP servers, LSP servers, and DAP adapters (`oh-my-pi:docs/marketplace.md:17`).
- Plugins install at user scope (`~/.omp/plugins/installed_plugins.json`) or project scope (`.omp/plugins/installed_plugins.json`) (`oh-my-pi:docs/marketplace.md:19-24`).
- Commands are `/marketplace add|install|update|...` and `omp plugin ...` (`oh-my-pi:docs/marketplace.md:31-72`).
- omp also reads the Claude Code `plugins/installed_plugins.json` (`oh-my-pi:docs/slash-command-internals.md:121-127`).

#### Skill discovery roots

Providers in priority order (`oh-my-pi:docs/skills.md:87-102`):

1. `native` (100): `.omp/skills/` in cwd and its ancestors, and `~/.omp/agent/skills/` (`oh-my-pi:CA/discovery/builtin.ts:295-313`).
2. `skillshare` (95): pinned registry packages.
3. `omp-plugins` (90): `skills/` in extension packages.
4. `claude` (80): Claude Code skill roots.
5. `agent-plugins` (75): packages with a standard `plugin.json`.
6. `claude-plugins`, `agents` (`.agent[s]/skills`), and `codex` (70).
7. `opencode` (55).
8. `github` (30): `.github/skills/<name>/SKILL.md`.
9. `omp-managed` (5): auto-learned skills in `~/.omp/agent/managed-skills`.

- Layout is `<root>/<name>/SKILL.md`, one level deep (`oh-my-pi:docs/skills.md:26-50`).
- The model sees name and description. It reads the body through `skill://` on demand. Users can force a skill with `/skill:<name>` (`oh-my-pi:docs/skills.md:3-7`).
- Foreign user-level providers are opt-in through `enabledProviders`. The `agents` provider has its own toggles (`oh-my-pi:docs/skills.md:122`).

#### Slash commands

- Native commands are `.omp/commands/*.md` and `~/.omp/agent/commands/*.md` (`oh-my-pi:docs/slash-command-internals.md:76-82`).
- omp also loads Claude (`.claude/commands/**/*.md`), Codex, OpenCode, Claude plugin, and `.agents/commands` files (`oh-my-pi:docs/slash-command-internals.md:90-131`).
- Templates support `$1`, `$@`, `$ARGUMENTS`, and slices (`oh-my-pi:docs/slash-command-internals.md:223-236`).
- Bundled TypeScript commands include `/review`, `/green`, and `/annotate` (`oh-my-pi:CA/extensibility/custom-commands/bundled/`).

#### Rules

- See the TTSR section. Rules are Markdown files with frontmatter. They split into TTSR, always-apply, and rulebook buckets (`oh-my-pi:docs/rulebook-matching-pipeline.md:215-231`).

### Q6. `omp commit` and other workflow commands

#### `omp commit`

- Flags are `--push`, `--dry-run`, `--no-changelog`, `--legacy`, `--context <text>`, and `--model <id>` (`oh-my-pi:CA/commit/cli.ts:1-80`).
- The model comes from the `commit` role, then `smol`, then other chat roles (`oh-my-pi:CA/commit/model-selection.ts:46`).
- The agent must call `git_overview` first. It may call `git_file_diff` at most twice, plus `git_hunk`, `recent_commits`, and `analyze_files` (`oh-my-pi:CA/commit/agentic/prompts/system.md:7-13`).
- `analyze_files` runs parallel `sonic` subagents (`oh-my-pi:CA/commit/agentic/prompts/system.md:30`).
- The agent ends with exactly one of `propose_commit` or `split_commit` (`oh-my-pi:CA/commit/agentic/prompts/system.md:3-5`).
- `split_commit` takes `commits[]`. Each commit lists changes as a whole file, hunk indices, or a line range, plus type, scope, summary, details, issue refs, rationale, and `dependencies` (`oh-my-pi:CA/commit/agentic/tools/split-commit.ts:17-34`).
- Groups may not overlap and must cover every staged file (`oh-my-pi:CA/commit/agentic/prompts/system.md:33`).
- Commits apply in dependency order through a topological sort (`oh-my-pi:CA/commit/agentic/tools/split-commit.ts:3`, `oh-my-pi:CA/commit/agentic/topo-sort.ts`).
- Message rules are a past-tense summary of at most 72 characters, a lowercase scope, no filler words, and 0 to 6 detail lines (`oh-my-pi:CA/commit/agentic/prompts/system.md:15-20`).
- If changelog targets exist, the agent must call `propose_changelog` (`oh-my-pi:CA/commit/agentic/prompts/system.md:35-38`).

#### Other workflow commands that fit as skills

| Command | What it does | Evidence |
|---|---|---|
| `/review` | Asks for a target: base branch, uncommitted changes, or one commit. Computes a reviewer count from diff size (1 below 100 lines, up to 16 above 5000). Fans out `reviewer` agents and groups files by locality. | `oh-my-pi:CA/extensibility/custom-commands/bundled/review/target.ts:4,22-26`, `oh-my-pi:CA/extensibility/custom-commands/bundled/review/diff.ts:239-247`, `oh-my-pi:CA/prompts/review-request.md` |
| `/green` | Loops until CI is green on the current branch. Watch runs, read failing logs, fix, push, and watch the new HEAD. | `oh-my-pi:CA/extensibility/custom-commands/bundled/ci-green/index.ts:47-48`, `oh-my-pi:CA/prompts/ci-green-request.md` |
| `/handoff` | Writes a handoff document and commits it as a compaction entry. | `oh-my-pi:docs/handoff-generation-pipeline.md:1-12` |
| `/ratchet` | Eval hill-climb with a host-side keep or revert gate, frozen splits, and leakage checks. | `oh-my-pi:CA/ratchet/ratchet.ts:1-20` |
| autoresearch | Experiment loop on a git branch with init, run, and log tools. | `oh-my-pi:CA/autoresearch/index.ts:1-25` |
| `/init` | Bundled fallback command that writes project context. | `oh-my-pi:docs/slash-command-internals.md:155-159`, `oh-my-pi:CA/prompts/agents/init.md` |
| `/plan-review`, `/guided-goal` | Present in the builtin command list. I did not read them. | `oh-my-pi:CA/slash-commands/builtin-modes.ts` (name grep) |

### Q7. Upstream pi and the T3 Pi adapter

#### What pi core offers extensions

- An extension exports a default factory that receives `ExtensionAPI` (`pi:packages/coding-agent/docs/extensions.md:13-30`).
- Integration points are `pi.on()`, `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`, `sendUserMessage`, `sendMessage`, `appendEntry`, session controls, `registerProvider`, `registerMcpServer`, `registerVirtualModel`, renderers, and `pi.events` (`pi:packages/coding-agent/docs/extensions.md:71-86`).
- Event names in the type file include `project_trust`, `resources_discover`, `session_start`, `session_before_switch`, `session_before_fork`, `session_before_compact`, `session_compact`, `session_before_tree`, `session_tree`, `session_shutdown`, `before_agent_start`, `context`, `context_with_system`, `before_provider_headers`, `after_provider_response`, `provider_stream_event`, `agent_start`, `agent_end`, `agent_before_settle`, `agent_settled`, `turn_start`, `turn_end`, `message_*`, `tool_execution_*`, `tool_call`, `tool_result`, `user_bash`, `input`, `model_select`, and `thinking_level_select` (`pi:packages/coding-agent/src/core/extensions/types.ts:703-992,1558-1572`, and an `on(event: "...")` grep over the same file).
- `turn_end` and `agent_before_settle` can request one more model request with `continue: true` (`pi:packages/coding-agent/docs/extensions.md:66,117`).
- Tools have an `exposure` field with the values `direct`, `model-only`, `codemode`, `deferred`, and `hidden` (`pi:packages/coding-agent/docs/extensions.md:152-164`).
- A tool can call other tools with `ctx.executeTool()`. Nested calls pass through `tool_call` and `tool_result` handlers (`pi:packages/coding-agent/docs/extensions.md:148`).
- pi leaves permission policy to extensions. T3 relies on this (`t3code:apps/server/src/orchestration-v2/Adapters/piT3McpExtensionSource.ts:231-247`).

#### RPC mode

- `pi --mode rpc` speaks JSONL over stdin and stdout (`pi:packages/coding-agent/docs/rpc.md:1-16`).
- Record families are commands, `response`, session events, and extension UI records (`pi:packages/coding-agent/docs/rpc.md:24-33`).
- Commands carry an optional `id`. The response repeats it (`pi:packages/coding-agent/docs/rpc.md:35-44`).

#### Skill and config directories

- The agent directory is `~/.pi/agent`. `PI_CODING_AGENT_DIR` moves it (`pi:packages/coding-agent/docs/configuration.md:1-9`).
- User skills are `<agent-dir>/skills/`. Project skills are `.pi/skills/` (`pi:packages/coding-agent/docs/configuration.md:22,35`).
- pi also reads `~/.agents/skills/` and `.agents/skills/` from cwd up to the repo root (`pi:packages/coding-agent/docs/skills.md:60`).
- Extensions are `<agent-dir>/extensions/` and `.pi/extensions/`. Prompt templates are `<agent-dir>/prompts/` and `.pi/prompts/` (`pi:packages/coding-agent/docs/configuration.md:20-37`).
- pi implements the Agent Skills specification (`pi:packages/coding-agent/docs/skills.md:7`).

#### The pi `subagent` example extension

- Subagents are an example extension, not core (`pi:packages/coding-agent/examples/extensions/subagent/README.md:1-25`).
- Each subagent runs in a separate `pi` process (`pi:packages/coding-agent/examples/extensions/subagent/index.ts:1-13`).
- Modes are single, parallel (`tasks[]`), and chain (`chain[]` with a `{previous}` placeholder) (`pi:packages/coding-agent/examples/extensions/subagent/index.ts:7-10`).
- Limits are 8 parallel tasks and 4 concurrent (`pi:packages/coding-agent/examples/extensions/subagent/index.ts:33-34`).
- Agents are Markdown files with `name`, `description`, `tools`, and `model` in `~/.pi/agent/agents`. Project agents in `.pi/agents` need `agentScope: "both"` (`pi:packages/coding-agent/examples/extensions/subagent/agents/scout.md:1-6`, `pi:packages/coding-agent/examples/extensions/subagent/README.md:54-64`).
- Workflow prompts are `/implement` (scout, planner, worker), `/scout-and-plan`, and `/implement-and-review` (`pi:packages/coding-agent/examples/extensions/subagent/prompts/implement.md`).

#### How T3 uses pi

- T3 spawns `pi --mode rpc` and keeps the user's extensions, skills, and settings (`t3code:apps/server/src/orchestration-v2/Adapters/PiAdapterV2.ts:1-11`).
- T3 rejects launch arguments that change the mode or session, such as `--mode`, `--session`, and `--print` (`t3code:apps/server/src/orchestration-v2/Adapters/piT3McpInjection.ts:14-32,102-123`).
- T3 writes an extension file `pi-t3-mcp-extension.ts` to a cache directory and passes it with `--extension` (`t3code:apps/server/src/orchestration-v2/Adapters/piT3McpInjection.ts:231-243,286-292`).
- The MCP URL and bearer token pass through the `T3_MCP_URL` and `T3_MCP_BEARER_TOKEN` environment variables (`t3code:apps/server/src/orchestration-v2/Adapters/piT3McpExtensionSource.ts:15-17`).
- The extension lists T3 MCP tools and registers each one as `mcp__t3-code__<name>` with `pi.registerTool` (`t3code:apps/server/src/orchestration-v2/Adapters/piT3McpExtensionSource.ts:262-303`).
- The extension appends the T3 orchestration instructions to the system prompt in `before_agent_start` (`t3code:apps/server/src/orchestration-v2/Adapters/piT3McpExtensionSource.ts:321-326`).
- The extension maps T3 runtime modes to approvals in a `tool_call` handler (`t3code:apps/server/src/orchestration-v2/Adapters/piT3McpExtensionSource.ts:231-247`).
- Extension UI `confirm` becomes a T3 approval request. `select`, `input`, and `editor` become user input requests (`t3code:apps/server/src/orchestration-v2/Adapters/PiAdapterV2.ts:19-24`).
- T3 observes the result of a tool named `subagent`. It reads `details.results[]` with `agent` and `task` fields and shows each as a T3 subagent node (`t3code:apps/server/src/orchestration-v2/Adapters/PiAdapterV2.ts:1026-1060`).
- The adapter marks pi subagents as visible but not waitable, closable, or forkable. Its comment says T3 delegation uses `delegate_task` (`t3code:apps/server/src/orchestration-v2/Adapters/PiAdapterV2.ts:183-192`).
- I found no omp adapter in T3. The adapter list holds Acp, AcpRegistry, Antigravity, Claude, Codex, Cursor, Devin, Grok, OpenCode, and Pi (`ls t3code:apps/server/src/orchestration-v2/Adapters`).

## 3. Implications for oh-my-t3code

This section is analysis. It is not a list of facts from the clones.

### What T3 already provides (T3 session)

- `delegate_task` runs child work on any provider and model. `task_status` and `task_cancel` manage it.
- `t3_thread_launch` starts a top-level thread in a new or existing worktree. `t3_thread_merge_back`, `t3_thread_fork`, and `t3_worktree_*` exist.
- `schedule_task` runs a prompt on an interval or at fixed times.
- `t3_thread_send`, `t3_thread_wait`, and `t3_thread_read` drive top-level threads.
- `watch_pull_request` wakes a thread on CI results and comments.
- `orchestrator_capabilities` lists providers and models.
- Threads have runtime modes such as plan and auto-accept-edits (inferred from the T3 instructions in this session and the clarity skill table).

### Ranked feature table

| Rank | omp feature | T3 today | Recommendation |
|---|---|---|---|
| 1 | Model roles (`@smol`, `@slow`, `@task`, custom roles) | Not provided. `delegate_task` takes a concrete provider and model. | Re-create. Add a `roles.yml` that maps role names to T3 `{ providerInstanceId, model, effort }`. A small CLI resolves a role against `orchestrator_capabilities`. Skills refer to roles, never to model ids. |
| 2 | Agent definitions (frontmatter Markdown) and bundled agents | Not provided. | Re-create. Use omp's field set minus loop-only fields: `name`, `description`, `model` (role list), `tools` (as a prompt constraint), `output` (schema), `mode` (read-only or edit). Ship `scout`, `reviewer`, `security-reviewer`, `worker`, and `fast-worker` as Markdown in a skill folder. The CLI renders the system prompt plus task into one `delegate_task` prompt. |
| 3 | Batch fan-out with shared `context` | Partly. An agent can call `delegate_task` several times. | Re-create as a skill convention. One shared context block plus one brief per child. Each brief has a `solutionSpace` line. The CLI caps concurrency. |
| 4 | Schema-validated results and `agent://` reads | Not provided as far as I can see. | Re-create in the CLI. Append the schema and a "reply with one JSON block" rule to each brief. Validate the reply. Retry once with the validation error. Store results under `.oh-my-t3code/runs/<id>/<agent>.json` so a parent can read one field without reloading all output. |
| 5 | `/review` recipe | Not provided. | Re-create as a skill. Use omp's reviewer-count table and file grouping by locality. Use the reviewer output schema. Route reviewers to the other model family through roles. |
| 6 | Fallback chains on 429 or quota | Not provided at the orchestration layer (inferred). | Re-create in the CLI. A role holds an ordered list. When `task_status` reports a provider failure, re-delegate to the next entry. Keep omp's rule that the fallback is temporary. |
| 7 | Vibe director (spawn, send, wait, kill, list) | Mostly provided by `delegate_task`, `task_status`, and `task_cancel`. | Re-create only the prompt. A "director" skill teaches one worker per workstream, self-contained briefs, draft on the fast role, escalate to the good role, and verify by reading touched files. Follow-up "send" is a new `delegate_task` round with prior context, as the T3 rules require. |
| 8 | Goal mode with budget and evidence audit | Not provided. | Re-create as a skill plus `schedule_task`. Store the objective and budget in a goal file. The scheduled prompt uses omp's continuation and budget-limit text. Stop when the agent marks the goal complete. Token accounting depends on T3 usage data (open question). |
| 9 | `/loop --while/--until` exit-code condition | Partly. `schedule_task` repeats prompts. | Re-create. The CLI runs the condition command, applies omp's exit-code rules (0, 1, and above 1 as error), and deletes the schedule on halt. |
| 10 | `omp commit` atomic split | Not provided by T3. A user `commit` skill exists in this environment. | Borrow the split schema (file, hunk, or line-range changes, dependencies, topological order) and the message rules for that skill. Use the commit role through the CLI. |
| 11 | Final-answer advisor (`reviewMode: agent-end`) and `WATCHDOG.md` | Not provided. | Re-create a reduced form. A skill step runs before an agent reports done. It delegates a read-only review to the advisor role with `WATCHDOG.md` content and the diff. It returns severity-tagged notes. Per-turn advice needs loop hooks and does not fit. |
| 12 | Plan mode contract | T3 has a plan interaction mode. | Borrow the prompt. Use the "execution spec with zero design decisions" rule, the plan file per slug, and the approve-then-execute handoff. `--plan-yolo` maps to plan in one delegated task and implement in a second task on a cheaper role. |
| 13 | Prewalk | Not provided. | Re-create as a pattern inside the plan skill. The strong role writes the plan and the first edit. A cheaper role continues. This needs two delegated tasks, not a live model switch. |
| 14 | `/green` CI loop | `watch_pull_request` exists. | Re-create as a skill around `watch_pull_request`. Use omp's procedure and the rule to re-watch each new HEAD. |
| 15 | Isolation and merge-back | Provided by `t3_thread_launch` with a worktree strategy and `t3_thread_merge_back`. | Do not re-create. Document when to use a worktree thread for an editing child. omp's patch-versus-branch choice can inform the docs. |
| 16 | Agent Hub | T3 UI shows threads and subagents. | Does not fit. A `oh-my-t3code status` CLI command can list runs from the results directory. |
| 17 | Marketplace and plugin format | Not in T3. | Partial fit. Publish oh-my-t3code skills as a Claude-compatible plugin with `.claude-plugin/marketplace.json`. omp, Claude Code, and pi readers can then find it (inferred). Use `SKILL.md` folders, not hooks, because omp does not read Claude `hooks.json`. |
| 18 | TTSR stream rules | Not in T3. | Does not fit. It needs stream interception inside the agent loop. |
| 19 | IRC bus and agent revival | Not in T3. | Does not fit. Use new `delegate_task` rounds or `t3_thread_send` to top-level threads. |
| 20 | Checkpoint and rewind | Not in T3. | Does not fit. It edits the harness's own context. |
| 21 | Extensions API, hooks, TS commands | T3 injects its own pi extension. | Does not fit oh-my-t3code's scope. A pi extension could expose oh-my-t3code tools inside pi threads later. |

Note, 2026-10-28: omt built rows 8 and 9 as the omt-loop skill, and the workflow fold removed it. The main thread now waits for children inside its turn, so no flow repeats a prompt with `schedule_task`. See [the workflow fold design](../design/workflow-fold.md).

### Distribution note

- Install skills under `~/.agents/skills/<name>/SKILL.md`. pi reads that root (`pi:packages/coding-agent/docs/skills.md:60`). omp reads it through the `agents` provider (`oh-my-pi:docs/skills.md:98-101,122`). Whether Claude Code and Codex in T3 read it is an open question.
- Skills must call T3 tools by the names each harness exposes. In pi threads the names are `mcp__t3-code__<tool>` (`t3code:apps/server/src/orchestration-v2/Adapters/piT3McpExtensionSource.ts:271`).

## 4. Open questions

1. Does `delegate_task` accept an output schema or return structured data? This decides whether schema validation lives in the CLI or in T3.
2. Does `task_status` report token usage and cost per task? Goal budgets and fallback triggers need this.
3. Does `task_status` separate provider errors (429, quota, outage) from task failures? Fallback chains need this.
4. What concurrency limit does T3 apply to delegated tasks? omp defaults to 32 (`oh-my-pi:docs/tools/task.md:164`).
5. Can a `schedule_task` run delete its own schedule when a condition halts? `/loop` and goal mode need a clean stop.
6. Can a delegated child run in a worktree? Or must editing children be top-level threads from `t3_thread_launch`?
7. Which skill roots do the Claude and Codex providers read inside T3? Does `~/.agents/skills` work for all of them?
8. Should oh-my-t3code ship a pi extension? T3 already injects one. A second extension would add oh-my-t3code tools to pi threads.
9. omp has no T3 adapter. Is an omp adapter planned? If yes, omp's own `task` tool would compete with `delegate_task`.
10. I did not read `/plan-review`, `/guided-goal`, or the workpool semantics. They may hold more patterns.
11. The isolation merge label says `--no-ff` while the code cherry-picks (`oh-my-pi:CA/task/settings.ts:128`, `oh-my-pi:CA/task/worktree.ts:943`). This matters only if oh-my-t3code copies the branch merge mode.
