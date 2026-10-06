# oh-my-t3code specification

This page is the reference for the code, the skills, and the tests. [`design.md`](design.md) explains why each part exists. When this page and the code disagree, fix one of them in the same change.

## 1. Toolchain and conventions

- Runtime: Node.js 22.18 or later. Node runs the TypeScript sources directly through type stripping.
- Language: TypeScript, ESM (`"type": "module"`). Use erasable syntax only. That means no `enum`, no `namespace`, no parameter properties, and no decorators. Use `import type` for type-only imports. Relative imports end in `.ts`.
- Runtime dependencies: none. Use only `node:` built-in modules.
- Dev dependencies: `typescript` and `@types/node`.
- Build: `tsc -p tsconfig.build.json` writes `dist/` with `rewriteRelativeImportExtensions`. The published `bin` points at `dist/cli.js`.
- Tests: the Node test runner (`node:test`, `node:assert/strict`). Test files are `test/**/*.test.ts`.
- Strict TypeScript: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`.
- Formatting: 2-space indentation, double quotes, semicolons, trailing commas in multi-line literals.
- Comments: only for a non-obvious reason that the code cannot show.
- File writes: atomic (write a temp file in the same directory, then rename). Create parent directories as needed. When the target exists, the temp file gets the target's mode before the rename, so a 0600 file stays 0600. The one exception is the ledger: each entry is one `appendFile` call, so concurrent appends do not overwrite each other.
- When the target of a write is a symlink, write next to its real path (`fs.realpath`) and rename onto the real path, so the symlink stays a symlink.
- No network calls. No telemetry.

`package.json` scripts:

| Script | Command |
| --- | --- |
| `omt` | `node src/cli.ts` |
| `test` | `node --test "test/**/*.test.ts"` |
| `typecheck` | `tsc --noEmit` |
| `build` | `tsc -p tsconfig.build.json` |
| `schema` | `node scripts/build-schema.ts` |
| `check` | `pnpm typecheck && pnpm test` |

The package is named `oh-my-t3code`. It has two bin names, `omt` and `oh-my-t3code`. The `files` list is `dist`, `skills`, `schema`, `README.md`, and `LICENSE`.

## 2. Repository layout

```text
src/
  cli.ts                 entry: shebang, calls main(process.argv.slice(2)), sets process.exitCode
  main.ts                main(), createContext(), command registry, help text
  types.ts               shared types (section 3)
  paths.ts               path helpers (section 4)
  util/                  errors.ts, args.ts, fs.ts, output.ts
  config/                jsonc.ts, defaults.ts, validate.ts, merge.ts, load.ts, starter.ts, schema.ts
  routing/               capabilities.ts, effort.ts, resolve.ts, format.ts
  brief/                 templates.ts, render.ts
  plan/                  template.ts, parse.ts
  ledger/                ledger.ts
  install/               skills.ts, links.ts, claudeHook.ts, manifest.ts, plan.ts, apply.ts, doctor.ts
  hooks/                 userPromptSubmit.ts
  commands/              one file per command, each exports `run: CommandRun`
scripts/
  build-schema.ts        writes schema/omt.schema.json from src/config/schema.ts
schema/
  omt.schema.json        JSON Schema for config files
skills/
  omt/                   router skill and shared references
  omt-ulw/ omt-plan/ omt-review/ omt-research/ omt-swarm/ omt-loop/
test/
  helpers.ts             temp dirs and a fake CliContext
  fixtures/capabilities.json
docs/
```

## 3. Shared types

`src/types.ts` holds these declarations. Other modules import them from there.

```ts
export type Effort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export const EFFORT_LADDER: readonly Effort[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export type OptionValue = string | boolean;
export type Access = "read-only" | "edit";
export type InteractionMode = "inherit" | "default" | "plan";
export type RuntimeMode = "inherit" | "approval-required" | "auto-accept-edits" | "auto" | "full-access";
export type T3Role = "implementation" | "research" | "review" | "design" | "test" | "general";
export type ResultKind = "work" | "review" | "test" | "research" | "plan";
export const RESULT_KINDS: readonly ResultKind[] = ["work", "review", "test", "research", "plan"];

export interface Rung {
  provider?: string; // T3 provider instance id, for example "claudeAgent"
  driver?: string; // T3 driver kind; used when provider is absent
  model: string; // model id as listed by orchestrator_capabilities
  effort?: Effort; // mapped onto the model's effort option
  options?: Record<string, OptionValue>; // raw T3 option selections; override the effort mapping
}

export interface RoleConfig {
  description: string;
  access: Access;
  result: ResultKind;
  t3Role: T3Role;
  interactionMode: InteractionMode;
  runtimeMode: RuntimeMode;
  chain: Rung[];
}

export interface Limits {
  maxParallel: number;
  maxTasksPerRun: number;
  maxDepth: number;
  maxReviewRounds: number;
}

export interface OmtConfig {
  version: 1;
  roles: Record<string, RoleConfig>;
  limits: Limits;
}

export interface ConfigLayer {
  version?: 1;
  roles?: Record<string, Partial<RoleConfig> | null>;
  limits?: Partial<Limits>;
}

export type IssueSeverity = "error" | "warning";

export interface ConfigIssue {
  source: string; // file path, or "defaults"
  path: string; // for example "roles.review.chain[0].effort"; "" for the whole file
  message: string;
  severity: IssueSeverity;
}

export interface ConfigSource {
  kind: "defaults" | "user" | "project";
  path?: string;
  present: boolean;
}

export interface LoadedConfig {
  config: OmtConfig;
  sources: ConfigSource[];
  issues: ConfigIssue[];
}

export interface OptionChoice {
  id: string;
  label?: string;
  isDefault?: boolean;
}

export interface OptionDescriptor {
  id: string;
  type: string; // "select" or "boolean" in current T3 builds
  label?: string;
  options?: OptionChoice[];
}

export interface ModelCapability {
  id: string;
  label?: string;
  options: OptionDescriptor[];
}

export interface ProviderCapability {
  providerInstanceId: string;
  driverKind: string;
  displayName?: string;
  canRunChildTask: boolean;
  constraints: string[];
  models: ModelCapability[];
}

export interface Capabilities {
  inheritedProviderInstanceId?: string;
  inheritedModel?: string;
  runtimeMode?: string;
  interactionMode?: string;
  providers: ProviderCapability[];
}

export interface ResolvedTarget {
  providerInstanceId?: string; // exactly one of providerInstanceId and driverKind is set
  driverKind?: string;
  model: string;
  options?: Record<string, OptionValue>; // omitted when empty
}

export interface RungAttempt {
  index: number;
  rung: Rung;
  ok: boolean;
  reason?: string; // set when ok is false
  notes: string[];
  target?: ResolvedTarget; // set when ok is true
}

export type RoleStatus = "resolved" | "unverified" | "unavailable";

export interface DelegateTaskArgs {
  target: ResolvedTarget;
  role: T3Role;
  interactionMode: InteractionMode;
  runtimeMode: RuntimeMode;
}

export interface RoleResolution {
  role: string;
  description: string;
  access: Access;
  result: ResultKind;
  t3Role: T3Role; // copied from the role, also when the role is unavailable
  interactionMode: InteractionMode;
  runtimeMode: RuntimeMode;
  status: RoleStatus;
  delegateTask?: DelegateTaskArgs; // from the first ok rung
  fallbacks: ResolvedTarget[]; // later ok rungs, in chain order
  attempts: RungAttempt[];
}

export interface RolesReport {
  version: 1;
  verified: boolean; // true when capabilities were supplied
  roles: Record<string, RoleResolution>;
  limits: Limits;
}

export interface RouteOutput {
  role: string;
  status: RoleStatus;
  description: string;
  access: Access;
  result: ResultKind;
  delegateTask?: DelegateTaskArgs;
  fallbacks: ResolvedTarget[];
  notes: string[]; // every attempt note and failure reason in chain order, each prefixed "rung <n>: "
}

export interface BriefJsonOutput {
  delegateTask: {
    task: string; // the rendered brief
    title: string;
    target: ResolvedTarget;
    role: T3Role;
    interactionMode: InteractionMode;
    runtimeMode: RuntimeMode;
    mode: "async";
    clientRequestId?: string; // present when --plan and --unit are given
  };
  fallbacks: ResolvedTarget[]; // not a delegate_task field; use one of these when the call fails
}

export type LedgerStatus = "dispatched" | "completed" | "failed" | "cancelled" | "interrupted" | "verified" | "rejected"; // every status except "dispatched" is terminal

export interface LedgerEntry {
  ts: string; // ISO timestamp from ctx.now()
  role: string;
  status: LedgerStatus;
  plan?: string;
  unit?: string;
  round?: number;
  attempt?: number;
  taskId?: string;
  clientRequestId?: string;
  provider?: string;
  model?: string;
  verdict?: string; // first word or words of the result block, for example "DONE", "APPROVE", "NOT VERIFIED"
  note?: string;
}

export interface LedgerStats {
  plan?: string;
  dispatched: number; // entries with status "dispatched"
  active: number; // dispatched entries that no terminal entry closes (section 5.6)
  terminal: number; // entries with a terminal status
  limits: { maxParallel: number; maxTasksPerRun: number }; // from the effective config
  canDispatch: boolean; // active < maxParallel && dispatched < maxTasksPerRun
}

export interface CliContext {
  argv: string[]; // arguments after the command name
  cwd: string;
  env: Record<string, string | undefined>;
  homedir: string;
  stdout: (text: string) => void; // writes text as given; callers add newlines
  stderr: (text: string) => void;
  readStdin: () => Promise<string>;
  isTTY: boolean; // true when stdin is a terminal
  prompt: (question: string) => Promise<string>;
  now: () => Date;
  packageRoot: string; // directory that holds package.json, skills/, schema/
  cliPath: string; // absolute path of the running entry file
  nodePath: string; // process.execPath
  nodeVersion: string; // process.versions.node, injectable for tests
  version: string; // package.json version
}

export type CommandRun = (ctx: CliContext) => Promise<number>;
```

Code that lists the result kinds uses `RESULT_KINDS`.

`src/util/errors.ts` defines the one error class:

```ts
export class OmtError extends Error {
  readonly code: string;
  readonly hint: string | undefined;
  readonly exitCode: number; // 1 by default, 2 for usage errors
  constructor(code: string, message: string, options?: { hint?: string; exitCode?: number; cause?: unknown });
}
```

`main()` catches `OmtError`, prints `omt: <message>` and then `hint: <hint>` to stderr, and returns its `exitCode`. Any other error prints `omt: unexpected error: <message>` and returns 1.

## 4. Paths

`src/paths.ts` exports pure functions. They take `env` and `homedir` arguments, so tests never touch the real home directory.

| Function | Result |
| --- | --- |
| `configDir(env, homedir)` | `$OMT_CONFIG_DIR`, else `$XDG_CONFIG_HOME/oh-my-t3code`, else `<home>/.config/oh-my-t3code` |
| `userConfigPath(env, homedir)` | `<configDir>/config.jsonc` |
| `manifestPath(env, homedir)` | `<configDir>/install.json` |
| `userRolesDir(env, homedir)` | `<configDir>/roles` |
| `findProjectRoot(cwd)` | the nearest ancestor of `cwd` (or `cwd` itself) that contains `.omt` or `.git` (a directory or a file); `cwd` when none exists |
| `omtDir(root)` | `<root>/.omt` |
| `projectConfigPath(root)` | `<root>/.omt/config.jsonc` |
| `projectRolesDir(root)` | `<root>/.omt/roles` |
| `plansDir(root)` | `<root>/.omt/plans` |
| `ledgerPath(root)` | `<root>/.omt/ledger.jsonl` |
| `evidenceDir(root)` | `<root>/.omt/evidence` |
| `claudeConfigDir(env, homedir)` | `$CLAUDE_CONFIG_DIR`, else `<home>/.claude` |
| `skillRoots(env, homedir)` | `{ agents: <home>/.agents/skills, claude: <claudeConfigDir>/skills, gemini: <home>/.gemini/config/skills }` |
| `claudeSettingsPath(env, homedir)` | `<claudeConfigDir>/settings.json` |
| `t3HomeDir(env, homedir)` | `$T3CODE_HOME`, else `<home>/.t3` |
| `t3SettingsPath(env, homedir)` | `<t3HomeDir>/userdata/settings.json` |

`findProjectRoot` is the only function that reads the file system.

## 5. CLI

Exit codes: 0 for success, 1 for a failure (bad config, a failed check, a conflict, a missing file), 2 for a usage error (unknown command, unknown flag, missing argument). Every command accepts `--help`, prints its usage, and exits 0. `omt --version` prints the version. `omt` with no command or with `--help` prints the command list.

Argument parsing uses `node:util` `parseArgs` with `strict: true` and `allowPositionals: true`, wrapped in `src/util/args.ts`. A parse error becomes an `OmtError` with exit code 2.

| Command | Synopsis |
| --- | --- |
| `install` | `omt install [--targets <list>] [--hooks] [--yes] [--dry-run] [--force]` |
| `uninstall` | `omt uninstall [--yes] [--dry-run] [--purge] [--force]` |
| `doctor` | `omt doctor [--capabilities <file>] [--json]` |
| `init` | `omt init` |
| `config` | `omt config [show \| path \| validate \| init] [--json] [--defaults] [--force]` |
| `roles` | `omt roles [--capabilities <file>] [--role <name>]... [--json]` |
| `route` | `omt route <role> [--capabilities <file>]` |
| `brief` | `omt brief <role> (--task <text> \| --task-file <file>) [options]` |
| `plan` | `omt plan new <slug> [--title <text>] [--light] [--force]`, `omt plan mark <slug> <id> <done\|open\|blocked>`, `omt plan status [<slug>] [--json]`, `omt plan list [--json]` |
| `ledger` | `omt ledger add [options]`, `omt ledger list [--plan <slug>] [--json]`, `omt ledger stats [--plan <slug>] [--json]`, `omt ledger request-id --plan <slug> --unit <id> --role <role> [--round <n>] [--attempt <n>]` |
| `hook` | `omt hook user-prompt-submit` |

In every flag that takes a file, `-` means standard input.

`--capabilities` is optional everywhere. Without it, routing is `unverified`: the CLI trusts the chain, and T3 validates the target when `delegate_task` runs. The skills treat that as the normal path and fall back to the next rung on a typed T3 error. To verify, the agent saves the `orchestrator_capabilities` result to a file. Claude Code saves a large tool result to a file by itself and reports the path. On ACP providers, `acp-mcp-call orchestrator_capabilities '{}' > caps.json` writes it. Any agent can also write a trimmed copy that keeps only the providers and models its chains name.

### 5.1 `omt config`

- `show` (the default subcommand) prints the effective config as JSON. `--defaults` prints the built-in defaults instead. Config issues go to stderr, and the command still exits 0.
- `path` prints two lines: `user: <path> (present)` or `(absent)`, then `project: <path> (present)` or `(absent)`. Neither path goes through `realpath`. The CLI takes its cwd from `$PWD` when `$PWD` resolves to `process.cwd()` and `findProjectRoot($PWD)` resolves to the same real directory as `findProjectRoot(process.cwd())`; otherwise it uses `process.cwd()`. So the project root always names the physical project, and `$PWD` changes only how it prints.
- `validate` prints each issue as `<severity> <source> <path>: <message>`, or `<severity> <source>: <message>` when the path is empty. A JSONC syntax error is one issue with an empty path and the message `<line>:<column>: <reason>`, so the file path appears once. It prints `config ok` when there is no issue. It exits 1 when any issue is an error. `--json` prints `{ "ok": boolean, "issues": ConfigIssue[] }`.
- `init` writes the starter user config (section 6.5) and prints `create <path>` or `overwrite <path>`. It refuses to overwrite an existing file unless `--force` is given.

### 5.2 `omt init`

Creates, in the project root, only what is missing:

- `.omt/config.jsonc` with the starter project config (section 6.5)
- `.omt/plans/`
- `.omt/.gitignore` with the two lines `ledger.jsonl` and `evidence/`

It prints one line per path: `create <path>` or `exists <path>`. It never overwrites a file.

### 5.3 `omt roles` and `omt route`

`omt roles` loads the config, resolves every role (or only the roles named with `--role`), and prints a table:

```text
ROLE         STATUS      TARGET                                         ACCESS     MODE
execute      resolved    claudeAgent/claude-opus-5-5 effort=medium      edit       default
review       resolved    claudeAgent/claude-opus-5-5 effort=high        read-only  plan
oracle       unavailable -                                              read-only  plan
  rung 1 codex/gpt-6-astra: provider codex cannot run child tasks: Provider instance is disabled.
```

`MODE` is the role's `interactionMode`. Under each role, the table prints one indented line per failure reason of the rungs before the chosen one, and the notes of the chosen rung. For an unavailable role it prints the reason of every rung. Later rungs are not shown.

A footer line says either `verified against orchestrator_capabilities` or `unverified: pass --capabilities <file> to check the chains against T3`. `--json` prints the `RolesReport`. Config issues go to stderr. An unknown `--role` exits 1.

`omt route <role>` prints a `RouteOutput` (section 3) as JSON. Its `delegateTask` fields map directly onto `delegate_task` arguments:

```json
{
  "role": "review",
  "status": "resolved",
  "description": "Review a diff against its brief and report findings by severity.",
  "access": "read-only",
  "result": "review",
  "delegateTask": {
    "target": { "providerInstanceId": "claudeAgent", "model": "claude-opus-5-5", "options": { "effort": "high" } },
    "role": "review",
    "interactionMode": "plan",
    "runtimeMode": "inherit"
  },
  "fallbacks": [{ "providerInstanceId": "codex", "model": "gpt-6-astra", "options": { "reasoningEffort": "high" } }],
  "notes": []
}
```

An unknown role is an error (exit 1) that lists the known roles. A `resolved` or `unverified` role exits 0. An `unavailable` role prints the JSON with `delegateTask` absent and exits 1.

### 5.4 `omt brief`

Options:

| Flag | Meaning |
| --- | --- |
| `<role>` | role name (positional, required) |
| `--task <text>`, `--task-file <file>` | the task; exactly one is required |
| `--context <text>`, `--context-file <file>` | background the child needs |
| `--scope <path>` | a file or directory the child may change or must read; repeatable |
| `--done <text>` | one done condition; repeatable |
| `--verify <command>` | one verify command; repeatable |
| `--prior-file <file>` | earlier rounds: findings, responses, unresolved objections |
| `--round <n>` | review or fix round, default 1 |
| `--depth <n>` | the child's depth, default 1 |
| `--max-depth <n>` | overrides `limits.maxDepth`, 0 to 3 |
| `--plan <slug>`, `--unit <id>` | plan and unit ids, used in the header and the request id |
| `--attempt <n>` | attempt number within the round, default 1 |
| `--title <text>` | thread title for `--json` output |
| `--capabilities <file>` | used with `--json` to resolve the target |
| `--json` | print a ready `delegate_task` payload instead of the brief text |

`--attempt <n>` (default 1) is the attempt number for the request id (section 10). `--round`, `--depth`, and `--attempt` are positive integers. `--task` and `--task-file` exclude each other, and so do `--context` and `--context-file`. Only one flag can read stdin. An empty task is a usage error. An unknown role exits 1. The brief's `maxDepth` is `--max-depth` when given, else `limits.maxDepth` from the effective config. A `--depth` greater than that max is a usage error (exit 2) with a hint that names `--max-depth`. `--plan` must match the plan slug regex (section 5.5) and `--unit` must match `^[A-Za-z0-9._-]{1,64}$`; a mismatch is a usage error. When the rendered brief is longer than 120,000 characters, the command prints nothing to stdout and exits 1 with a hint to shorten `--context` or `--prior-file`.

Without `--json`, the command prints the rendered brief (section 9). With `--json`, it prints a `BriefJsonOutput` (section 3). The `delegateTask` object is exactly the argument object for the `delegate_task` tool:

```json
{
  "delegateTask": {
    "task": "<rendered brief>",
    "title": "review U3 r2: token refresh",
    "target": { "providerInstanceId": "claudeAgent", "model": "claude-opus-5-5", "options": { "effort": "high" } },
    "role": "review",
    "interactionMode": "plan",
    "runtimeMode": "inherit",
    "mode": "async",
    "clientRequestId": "omt:auth:U3:review:r2:a1"
  },
  "fallbacks": []
}
```

- `title` is `--title` when given, cut to 72 characters. Otherwise it is `<role>` plus ` <unit>` when a unit is given, plus ` r<round>` when the round is greater than 1, then `: ` and the first non-empty line of the task. The title is cut to 72 characters.
- `clientRequestId` is present only when both `--plan` and `--unit` are given (section 10).
- `target` and `fallbacks` come from the role resolution. When the role is unavailable, the command prints nothing to stdout, prints the rung reasons to stderr, and exits 1.

### 5.5 `omt plan`

- `new <slug>` writes `.omt/plans/<slug>.md` from the template in section 12. A slug matches `^[a-z0-9][a-z0-9-]{0,63}$`. An existing file is an error unless `--force` is given. `--light` leaves the `F2` oracle line out. It prints the path.
- `mark <slug> <id> <done|open|blocked>` sets the checkbox of the column-zero item line for `<id>` (such as `U3`, `D1`, or `F2`) to `x`, a space, or `~`. It appends `- <ISO timestamp> <id> -> <state>` to the end of the file (the `## Log` section is last), writes atomically, prints `marked <id> <state>`, and exits 0. A missing plan or id exits 1. A bad state exits 2.
- `status [<slug>]` parses one plan and prints its counts and the next open unit (section 12). Without a slug it uses the most recently modified plan. `--json` prints the parsed `PlanStatus`.
- `list` prints one line per plan: slug, unit counts, and the next open unit. `--json` prints an array of `PlanStatus` items, each with an added `path`.
- `list` and `status` skip a `*.md` entry whose `stat` fails with ENOENT, such as a dangling symlink.

### 5.6 `omt ledger`

- `add` appends one `LedgerEntry` (section 3) as one JSON line to `.omt/ledger.jsonl`, with one `appendFile` call. Required flags: `--role` and `--status`. `--role` accepts any name, not only config roles, because the skills record `swarm` and `loop`. Optional flags: `--plan`, `--unit`, `--round`, `--attempt`, `--task-id`, `--client-request-id`, `--provider`, `--model`, `--verdict`, `--note`. `--round` and `--attempt` are positive integers. `--status dispatched` needs `--task-id` or `--unit`, else exit 2. It prints the entry as JSON. A terminal entry that closes no dispatched entry is still appended; the command then prints `omt: no dispatched entry matches; nothing was closed` to stderr and exits 0.
- In every subcommand, `--plan` must match the plan slug regex (section 5.5) and `--unit` must match `^[A-Za-z0-9._-]{1,64}$`; a mismatch is a usage error.
- Terminal statuses are `completed`, `failed`, `cancelled`, `interrupted`, `verified`, and `rejected`. A terminal entry T closes a dispatched entry D when T has a `taskId` equal to D's, or when T has no `taskId`, both T and D have a `unit`, and T and D have the same `plan`, `unit`, `role`, `round` (default 1), and `attempt` (default 1). A terminal entry with neither `taskId` nor `unit` closes nothing. `active` counts dispatched entries that no terminal entry closes, in any order.
- `list` prints a table with the columns `TIME` (HH:MM:SS of `ts`, in UTC), `PLAN`, `UNIT`, `ROLE`, `ROUND`, `STATUS`, `VERDICT`, `TASK` (the last 12 characters of `taskId`). It filters by `--plan` when given. `--json` prints an array of entries. A malformed line is skipped with a warning on stderr.
- `stats` loads the config and prints a `LedgerStats` (section 3). Text mode prints one line per field: `plan` (with `--plan`), `dispatched`, `active`, `terminal`, `max parallel`, `max tasks per run`, and `can dispatch: yes` or `can dispatch: no`. `--json` prints the object. The skills dispatch only while it reports `can dispatch: yes`.
- `request-id` prints the canonical `clientRequestId` (section 10).

### 5.7 `omt hook user-prompt-submit`

See section 13.

## 6. Config

### 6.1 Files and layering

The effective config is built from three layers, in this order:

1. The built-in defaults (`src/config/defaults.ts`).
2. The user config: `userConfigPath()`.
3. The project config: `projectConfigPath(findProjectRoot(cwd))`.

A missing file is not an error. Each file is JSONC (section 7).

### 6.2 Layer validation

`validateLayer(value, source)` returns `{ layer: ConfigLayer, issues: ConfigIssue[] }`. It prunes invalid parts and keeps valid ones.

- The root must be an object. Allowed keys: `$schema` (string, ignored), `version` (must equal 1), `roles` (object), and `limits` (object). An unknown key is an error, and the key is dropped.
- A role name matches `^[a-z][a-z0-9-]{0,31}$`. A role value is `null` (remove the role) or an object.
- Allowed role keys and values:
  - `description`: a non-empty string of at most 300 characters.
  - `access`: `read-only` or `edit`.
  - `result`: `work`, `review`, `test`, `research`, or `plan`.
  - `t3Role`: `implementation`, `research`, `review`, `design`, `test`, or `general`.
  - `interactionMode`: `inherit`, `default`, or `plan`.
  - `runtimeMode`: `inherit`, `approval-required`, `auto-accept-edits`, `auto`, or `full-access`.
  - `chain`: an array of 1 to 10 rungs.
- A role object with any invalid key or value is dropped as a whole, with one issue per problem.
- Allowed rung keys:
  - `provider` and `driver`: strings that match `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`. A rung needs at least one of them.
  - `model`: a non-empty string of at most 200 characters. It is required.
  - `effort`: a value from the effort ladder.
  - `options`: an object whose values are strings or booleans.
- Allowed limit keys and integer ranges: `maxParallel` 1 to 32, `maxTasksPerRun` 1 to 500, `maxDepth` 0 to 3, `maxReviewRounds` 1 to 10. An invalid limit is dropped with an error.

### 6.3 Merging

`mergeLayer(base: OmtConfig, layer: ConfigLayer, source: string)` returns `{ config, issues }`.

- A role set to `null` is removed. A `null` for a role that does not exist is a warning.
- A role that exists in `base` is merged field by field. `chain` replaces the old chain as a whole.
- A new role must have `description`, `access`, and `chain` after the merge. Otherwise it is dropped with an error. Missing fields get these values:
  - `result`: `work` for `edit` access, `research` for `read-only` access.
  - `t3Role`: `implementation` for `edit`, `research` for `read-only`.
  - `interactionMode`: `default` for `edit`, `plan` for `read-only`.
  - `runtimeMode`: `inherit`.
- Each limit field replaces the old value.

`loadConfig({ cwd, env, homedir })` reads, parses, validates, and merges the layers. It returns a `LoadedConfig`. A JSONC syntax error in a file becomes one error issue, and that file is skipped. Only unexpected I/O errors throw.

### 6.4 Defaults

Every default rung uses `driver`, so it also works for users whose provider instance ids differ from the driver kinds.

| Role | Access | Result | t3Role | Mode | Chain (driver/model effort) |
| --- | --- | --- | --- | --- | --- |
| `explore` | read-only | research | research | plan | claudeAgent/claude-sonnet-5-5 low, codex/gpt-6-luna low |
| `research` | read-only | research | research | plan | claudeAgent/claude-sonnet-5-5 medium, codex/gpt-6.1-sol medium |
| `plan` | edit | plan | design | default | claudeAgent/claude-opus-5-5 high, codex/gpt-6-astra high |
| `plan-review` | read-only | review | review | plan | codex/gpt-6-astra high, claudeAgent/claude-opus-5-5 high |
| `execute` | edit | work | implementation | default | claudeAgent/claude-opus-5-5 medium, codex/gpt-6.1-sol medium |
| `quick` | edit | work | implementation | default | claudeAgent/claude-sonnet-5-5 low, codex/gpt-6-luna low |
| `deep` | edit | work | implementation | default | claudeAgent/claude-opus-5-5 xhigh, codex/gpt-6-astra xhigh |
| `review` | read-only | review | review | plan | claudeAgent/claude-opus-5-5 high, codex/gpt-6-astra high |
| `oracle` | read-only | review | review | plan | codex/gpt-6-astra high, claudeAgent/claude-opus-5-5 high |
| `test` | edit | test | test | default | claudeAgent/claude-sonnet-5-5 medium, codex/gpt-6.1-sol medium |
| `writing` | edit | work | implementation | default | claudeAgent/claude-opus-5-5 medium, codex/gpt-6.1-sol medium |

Every default role has `runtimeMode: "inherit"`.

Role descriptions (shown to agents in `omt roles` and in skills):

- `explore`: Search this repository and answer one narrow question with file and line citations.
- `research`: Answer a question from docs, the web, and code, with cited sources.
- `plan`: Turn a goal into a plan file whose units have a scope, a done condition, and a verify command.
- `plan-review`: Check a plan for gaps, ambiguity, and steps that cannot be verified.
- `execute`: Implement one planned unit inside its scope and run its verify commands.
- `quick`: Make a small, mechanical change, such as a rename, a typo, or a one-file edit.
- `deep`: Solve a hard or cross-cutting problem that needs investigation before the change.
- `review`: Review a diff against its brief and report findings by severity.
- `oracle`: Attack finished work from another model family before it counts as done.
- `test`: Write and run tests and real checks, then return a verdict with evidence.
- `writing`: Write or edit documentation and other prose.

Default limits: `maxParallel` 4, `maxTasksPerRun` 24, `maxDepth` 1, `maxReviewRounds` 3.

### 6.5 Starter files

`src/config/starter.ts` exports two strings. `omt config init` and `omt install` write the user starter. `omt init` writes the project starter. Both are sparse. They hold `$schema`, `version`, empty `roles` and `limits` objects, and comments with one example override and a pointer to `omt config show --defaults`. The `$schema` URL is `https://raw.githubusercontent.com/gabimoncha/oh-my-t3code/main/schema/omt.schema.json`.

### 6.6 JSON Schema

`src/config/schema.ts` exports the JSON Schema (draft 2020-12) for a config file as a plain object. `scripts/build-schema.ts` writes it to `schema/omt.schema.json` with 2-space indentation and a final newline. A test fails when the committed file differs from the generated output. Another test checks that the schema allows exactly the keys that `validateLayer` allows.

## 7. JSONC

`parseJsonc(text: string, source: string): unknown` in `src/config/jsonc.ts`:

- Supports `//` line comments, `/* */` block comments, and trailing commas before `}` and `]`.
- Comment markers inside strings are text, not comments.
- Replaces each comment character and each trailing comma with a space, keeps newlines, then calls `JSON.parse`. Positions therefore stay the same.
- On a syntax error it throws `OmtError` with code `jsonc_parse` and the message `<source>:<line>:<column>: <reason>`. An unterminated block comment is also an error.
- Accepts and strips a UTF-8 byte order mark.

## 8. Capabilities, effort, and routing

### 8.1 Reading capabilities

`parseCapabilities(text: string): Capabilities` accepts:

- The `orchestrator_capabilities` result object, which has a `providers` array.
- An MCP content wrapper: `{ "content": [{ "type": "text", "text": "<json>" }] }` or a bare array of such items. The first text item that parses to an object with `providers` wins.

It keeps the fields listed in section 3 and ignores the rest. A missing `models`, `constraints`, or `models[].options` becomes an empty array. T3 leaves out `options` for a model with no descriptors, so an empty array means "this model has no options". A `null` value becomes `undefined`. A missing `canRunChildTask` becomes `false`. A trimmed file that lists only some providers or models is valid. Bad input throws `OmtError` with code `capabilities_parse`.

### 8.2 Effort mapping

`mapEffort(effort, descriptors, driverKind)` returns `{ options: Record<string, OptionValue>; note?: string }`.

When `descriptors` is an array (capabilities are known):

1. Look for the first descriptor whose `id` is in this list, in this order: `effort`, `reasoningEffort`, `reasoning_effort`, `reasoning`, `variant`, `thinking`. It must have `type: "select"` and at least one choice whose id is on the effort ladder.
2. If the exact effort is a choice, use it.
3. Otherwise use the highest ladder choice below the requested effort. If none is below, use the lowest ladder choice above it. Add the note `effort <requested> mapped to <used> for option <id>`.
4. Choices that are not on the ladder (for example `ultrathink`, `ultra`, `default`) are never picked.
5. If no descriptor qualifies, return no options and the note `effort <requested> not applied: the model advertises no effort option`.

When `descriptors` is `undefined` (no capabilities), use the driver table:

| Driver | Option id | Value rules |
| --- | --- | --- |
| `claudeAgent` | `effort` | `off` and `minimal` become `low` |
| `codex` | `reasoningEffort` | `off` and `minimal` become `low` |
| `grok` | `reasoningEffort` | unchanged |
| `pi` | `thinking` | unchanged |
| `opencode` | `variant` | `off` and `minimal` become `low`; `max` becomes `xhigh` |

Any other driver, or an unknown driver, returns no options and the note `effort <requested> not applied: unknown option for driver <driver>`. Every changed value adds a note.

### 8.3 Resolving a role

`resolveRole(name, role, caps?)` walks the chain and builds one `RungAttempt` per rung.

With capabilities, first check the parent's mode ceilings. T3 lets a child keep or narrow the parent's modes, never widen them.

- When `caps.interactionMode` is `plan`, a role with `access: "edit"` or `interactionMode: "default"` is `unavailable` with the reason `the parent thread is in plan mode; this role needs default mode`.
- Runtime modes rank `approval-required` < `auto-accept-edits` < `auto` < `full-access`. When the role's `runtimeMode` is not `inherit` and ranks above `caps.runtimeMode`, the role is `unavailable` with the reason `role runtime mode <x> is broader than the parent's <y>`.
- A mode-ceiling failure gives every rung the same reason.

Then walk the rungs:

1. Find the provider. With `rung.provider`, it is the provider whose `providerInstanceId` equals it. When the rung also has `driver` and the kinds differ, the rung fails with `provider instance <id> has driver <kind>, not <driver>`. With only `rung.driver`, pick in this order: the provider named by `caps.inheritedProviderInstanceId` when its `driverKind` matches and it can run child tasks (this is what T3 itself picks), then the first provider of that kind that can run child tasks, then the first provider of that kind.
2. Fail when no provider is found: `provider instance <id> is not registered in T3`, or `no provider instance with driver <driver>`.
3. Fail when `canRunChildTask` is false: `provider <id> cannot run child tasks: <constraints joined with "; ">`. Use `no reason given` when the list is empty.
4. Fail when the provider lists models and none has `id === rung.model`: `model <model> is not advertised by <id>`. A provider with an empty model list accepts any model. Effort then goes through the driver table (section 8.2), and the rung gets the note `provider <id> lists no models; T3 will check the model and its options`.
5. Build options. Apply `mapEffort` with the model's descriptors when `rung.effort` is set. Then copy `rung.options` over the result.
6. Validate options when the model has descriptors. Every id must match a descriptor. A `boolean` descriptor needs a boolean value. A `select` descriptor needs one of its choice ids. On failure the reason is `invalid options: <problem>; <problem>`. When the model has no descriptors and options are present, keep them and add the note `the model advertises no options; T3 will not check them`.
7. The target is `{ providerInstanceId, model, options }`. Omit `options` when it is empty.

Without capabilities, every rung is ok. The target uses `providerInstanceId: rung.provider` when present, else `driverKind: rung.driver`. Effort goes through the driver table, using `rung.driver`, or `rung.provider` when no driver is given.

Status:

- `resolved`: capabilities were given and at least one rung is ok.
- `unverified`: no capabilities were given.
- `unavailable`: no rung is ok. This holds without capabilities too, for example for a rung that names no provider or driver.

`delegateTask` uses the first ok rung's target plus the role's `t3Role`, `interactionMode`, and `runtimeMode`. `fallbacks` holds the targets of the later ok rungs.

`resolveAll(config, caps?, only?)` returns a `RolesReport`. It keeps the order of `only` and drops duplicates. An unknown name in `only` throws `OmtError` with code `unknown_role`.

## 9. Briefs

### 9.1 Templates

A role template is a Markdown file. Its whole content is the persona and rules for that role. `src/brief/templates.ts` looks for `<role>.md` in this order and uses the first file found:

1. `projectRolesDir(projectRoot)`
2. `userRolesDir(env, homedir)`
3. `<packageRoot>/skills/omt/references/roles/`
4. `<packageRoot>/skills/omt/references/roles/_generic.md`

The result contract for a role comes from `<packageRoot>/skills/omt/references/results/<result>.md`, where `<result>` is the role's `result` field. A contract file holds only one fenced `text` block. The renderer inserts the file content as is, trimmed.

### 9.2 Rendered brief

`renderBrief(input, persona, contract)` returns Markdown in this layout. A section with no content is left out, except `Role`, `Task`, `Constraints`, and `Final message`, which are always present.

```text
<!-- omt-brief v1 role=<role> round=<n> depth=<d>/<max>[ plan=<slug>][ unit=<id>] -->

# Role: <role>

<persona>

# Task

<task>

# Context

<context>

# Scope

- `<path>`

# Constraints

- <access line>
- <delegation line>
- <evidence line, only for roles whose access is edit>
- <plan-mode line, only for roles whose interactionMode is plan>
- You do not see the parent conversation. This brief is your full context. If you need something that is missing, say so in your final message.
- Other agents may edit other files in this repository at the same time. Leave changes outside your scope alone. Do not commit, push, or create branches.

# Done when

- <condition>

# Verify

- `<command>`

# Prior rounds

<prior>

# Final message

End your work with the block below as your final message. Keep it under 60 lines and put nothing after it.

<contract>
```

Access lines:

- `read-only`: `Access: read-only. Change no files. Run only commands that leave the repository unchanged.`
- `edit` with a scope: `Access: edit. Change only the files in Scope. If the task needs a change outside Scope, stop and report it under OPEN.`
- `edit` without a scope: `Access: edit. Change only what the task needs.`

Delegation lines:

- When `depth >= maxDepth`: `Delegation: you are at depth <d> of <max>. Do all work yourself. Start no subagents and no delegated tasks.`
- Otherwise, when `<max>` equals `limits.maxDepth` from the effective config: `Delegation: you are at depth <d> of <max>. You may delegate with the T3 delegate_task tool. Give each child depth <d+1> in its brief.`
- Otherwise (`--max-depth` changed the max): `Delegation: you are at depth <d> of <max>. You may delegate with the T3 delegate_task tool. Give each child depth <d+1>, and pass --max-depth <max> to omt brief.`

Evidence line, added after the delegation line when the role's `access` is `edit`:

- `Evidence: save command output and logs under <absolute project root>/.omt/evidence/.`

Plan-mode line, added after the delegation line when the role's `interactionMode` is `plan`:

- `Mode: you run in plan mode. Stay in it. Do not call ExitPlanMode and do not write a proposed plan. Put the result block in your final assistant message.`

T3 stores a proposed plan as its own item type, and `task_status.summary` reads only assistant messages. Without this line, a plan-mode child can return its result where the parent's summary does not show it.

## 10. Request ids

`requestId(plan, unit, role, round, attempt)` returns `omt:<plan>:<unit>:<role>:r<round>:a<attempt>`. `round` and `attempt` default to 1. Characters outside `[A-Za-z0-9._-]` in each part become `-`. Then `plan` and `unit` are cut to 64 characters and `role` to 32, so the `:r<round>:a<attempt>` suffix always survives.

T3 derives the child thread id from this value. So:

- Reuse an id only to resend the same payload after a lost response. T3 then returns the existing task instead of starting a second one.
- Increase the attempt when you send the same round again to a fallback rung, or again after a child failed.
- Increase the round for each new review or fix round.

## 11. Result contracts

Each file in `skills/omt/references/results/` holds one fenced `text` block. The parent reads the first word after each label.

`work.md`:

```text
STATUS: DONE | BLOCKED | ESCALATE
SUMMARY: <one or two sentences>
CHANGES:
- <path>: <what changed>
VERIFY:
- `<command>` -> pass | fail: <key output line>
EVIDENCE: <path under .omt/evidence/, or none>
OPEN:
- <unresolved issue, or none>
```

`review.md`:

```text
VERDICT: APPROVE | REQUEST_CHANGES | BLOCK
SUMMARY: <one or two sentences>
FINDINGS:
- [P0|P1|P2|P3] <path>:<line> <problem>. Fix: <fix>.
NOTES:
- <non-blocking note, or none>
```

`test.md`:

```text
VERDICT: VERIFIED | NOT VERIFIED | INCONCLUSIVE
CHECKS:
- `<command>` -> exit <code>: <key output line>
FAILURES:
- <test or scenario>: observed <x>, expected <y>; or none
EVIDENCE: <path under .omt/evidence/, or none>
```

`research.md`:

```text
ANSWER: <direct answer in one to three sentences>
FINDINGS:
- <fact> (<path:line or URL>)
UNKNOWN:
- <what was not found, with the searches run; or none>
```

`plan.md`:

```text
PLAN: <path of the plan file>
UNITS: <count>
DECISIONS NEEDED:
- <decision for the owner, with options and a recommendation; or none>
```

Severity meanings for review findings: P0 breaks the build, loses data, or opens a security hole. P1 is a wrong result in a normal path. P2 is a wrong result in an edge case or a missing test. P3 is style or clarity.

## 12. Plans

### 12.1 Template

`omt plan new <slug> --title <title>` writes (title defaults to the slug):

```markdown
# <title>

<!-- omt-plan v1 slug=<slug> created=<ISO timestamp> -->

## Objective

<what changes for the user, in one paragraph>

## Done when

- [ ] D1. <a check that can fail: a command, a test, or an observable result>

## Roles

<paste the output of `omt roles` here>

## Units

- [ ] U1. <title>
  - Role: execute
  - Scope: <files or directories>
  - Done when: <condition>
  - Verify: `<command>`
  - Depends on: none

## Final verification

- [ ] F1. The full test suite passes: `<command>`
- [ ] F2. The oracle role approves the whole change.

## Log

- <ISO timestamp> plan created
```

`--light` leaves out the `F2` line. `omt plan mark` appends its log lines after the last line.

### 12.2 Grammar and status

Checkbox lines start at column zero and match `^- \[( |x|X|~)\] (U|D|F)(\d+)\. (.*)$`. A space means open, `x` or `X` means done, and `~` means blocked.

`parsePlan(markdown)` returns:

```ts
interface PlanItem { kind: "U" | "D" | "F"; id: string; title: string; state: "open" | "done" | "blocked"; line: number } // id is kind plus number, for example "U4"; line is 1-based
interface PlanStatus {
  title: string;
  slug?: string;
  items: PlanItem[];
  counts: Record<"U" | "D" | "F", { open: number; done: number; blocked: number; total: number }>;
  next?: PlanItem; // the first open U item in file order
  complete: boolean; // every U, D, and F item is done; false for a plan with no items
}
```

Human output of `omt plan status`:

```text
plan: auth-refactor (.omt/plans/auth-refactor.md)
units: 3/7 done, 1 blocked, 3 open
done-when: 0/2
final: 0/2
next: U4 Add the token refresh endpoint
```

## 13. Claude Code ultrawork hook

`omt hook user-prompt-submit` reads the hook input JSON from stdin and looks at its `prompt` string.

Detection (`detectUltrawork(prompt)`):

1. Return false when the prompt contains `<!-- omt-brief` or starts with `Act as the `. Both mark a delegated child's brief. T3 loads user settings in child sessions too, so without this rule a brief that mentions ultrawork would start a nested loop.
2. Return false when the prompt starts with `/omt-ulw`. The skill is already loading.
3. Remove fenced code blocks, inline code spans, lines that start with `>`, and text inside double quotes.
4. Match the words `ulw` or `ultrawork`, case-insensitive, with no letter, digit, `_`, `-`, `/`, or `$` directly before or after.

On a match the command prints one line of JSON and exits 0:

```json
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"<pointer>"}}
```

The pointer text is at most 1,000 characters. It says that ultrawork is on for this request, that the agent loads the `omt-ulw` skill and follows it from step 1 before anything else, and that done needs evidence from checks that ran.

On no match, on empty input, or on invalid JSON, the command prints nothing and exits 0. It ignores arguments after the hook name and never exits non-zero. Only `omt hook` with no hook name or an unknown one is a usage error.

## 14. Install, uninstall, and doctor

### 14.1 Bundled skills

The bundled skills are the directories in `<packageRoot>/skills/` that contain `SKILL.md`.

### 14.2 Install plan

`omt install` first builds a plan without writing anything.

Skill copies go to `skillRoots().agents/<name>`. Each target is one of:

- `create`: the target is absent.
- `update`: the target is managed, the hash of the installed files equals the marker hash, and the marker hash differs from the source hash.
- `unchanged`: the target is managed and the marker hash equals the source hash.
- `conflict`: the target exists and is not managed, or it is managed but the hash of the installed files differs from the marker hash (the user edited it). This holds even when the source is unchanged.

Links go to `skillRoots().claude/<name>`, and to `skillRoots().gemini/<name>` when that target is selected. The link is relative. Its target is computed from real paths, `path.relative(realpath(link root), join(realpath(agents root), name))`, so the link resolves even when a root is itself a symlink. Each link is `create`, `unchanged` (a symlink that resolves to the canonical directory), or `conflict` (anything else). Before planning links, resolve each root and the agents root with `fs.realpath` (a missing root resolves to its own path). When a link root and the agents root are the same directory, plan no links for that root.

The user config is `create` when absent, else `unchanged`. The Claude hook, only with `--hooks`, is `create`, `update`, or `unchanged` (section 14.4).

`--targets` is a comma-separated subset of `agents`, `claude`, and `gemini`. `agents` is always included. The default is `agents,claude`, plus `gemini` when `<home>/.gemini` exists.

A directory is managed when it contains `.omt-managed.json`:

```json
{ "package": "oh-my-t3code", "version": "0.1.0", "skill": "omt-ulw", "hash": "<sha256>" }
```

The hash is SHA-256 over the sorted relative paths and the contents of a skill directory. The marker file itself is not part of the hash, and neither is any file named `.DS_Store` (Finder writes these). The marker stores the hash of the files as installed, which equals the source hash at install time.

### 14.3 Install flow

1. Print the plan, grouped by skills, links, config, and hooks. One line per action, such as `create   omt-ulw`.
2. With any `conflict` and no `--force`, print a hint that names `--force` and exit 1. With `--force`, mark each conflict as `replace` in the plan.
3. With `--dry-run`, stop here and exit 0. Nothing is written. When every action is `unchanged`, skip the prompt in step 4.
4. Without `--yes`: when `isTTY` is true, ask `Apply this plan? [y/N] ` and continue only on `y` or `yes`. Any other answer prints `Nothing was changed.` and exits 1. When it is false, print `Re-run with --yes to apply.` and exit 1. Nothing is written in either case.
5. Apply:
   - For each `replace`, move the existing path to `<configDir>/backups/<YYYYMMDDHHmmss>/<root name>/<name>`. When the stamp directory already exists, use `<YYYYMMDDHHmmss>-<n>` with the lowest free `n`. Backups never stay inside a skill root, because Cursor and OpenCode scan skill roots recursively and would load a backup as a duplicate skill.
   - For each `create`, `update`, or `replace` copy, build the new directory at `<parent of the agents root>/.omt-tmp-<random>`, write the marker into it, then move it into place. For an existing target, first rename it to `<parent of the agents root>/.omt-old-<random>`, then rename the new directory in, then delete the old one. Temp directories never sit inside a skill root.
   - When a swap fails, delete the temp directory and move the old directory back, so the installed skill stays in place.
   - Create the links, write the starter user config, add the hook, and write the manifest.
6. Print a summary and the next steps: restart agent sessions in T3 so they load the new skills, then try `$omt-ulw <task>`.

A second run on an unchanged system shows only `unchanged` actions and writes nothing except the manifest timestamp.

### 14.4 Claude hook entry

The hook command is:

```text
"<nodePath>" "<cliPath>" hook user-prompt-submit # oh-my-t3code
```

The trailing comment is the signature that marks the entry as managed. `--hooks` is refused, with exit 1 and a hint to install the package globally, when `cliPath` is inside a temp directory (`os.tmpdir()`) an npx cache (a path that contains `/_npx/`), or a pnpm dlx cache (a path that contains `/dlx/` under a `pnpm` directory). Such a path can disappear.

The installer edits `claudeSettingsPath()`:

1. A missing file counts as `{}`. A file that is not valid JSON is an error, and the installer changes nothing.
2. Under `hooks.UserPromptSubmit`, add `{ "hooks": [{ "type": "command", "command": "<command>", "timeout": 10 }] }`. When an entry with the signature exists, replace its command instead.
3. Keep every other key and entry unchanged. Serialize with 2-space indentation and a final newline.
4. When the new content equals the old content, write nothing. This is the `unchanged` case.
5. Otherwise back up the old file, with mode 0600, to `<configDir>/backups/<YYYYMMDDHHmmss>/claude-settings.json`, then write. The new `settings.json` keeps the mode of the old one. When `settings.json` is a symlink, write next to its real path and rename onto the real path, so the symlink stays in place.

Verify the hook schema against the current Claude Code hooks documentation before you write this code.

### 14.5 Manifest

`manifestPath()` holds:

```json
{
  "package": "oh-my-t3code",
  "version": "0.1.0",
  "installedAt": "<ISO timestamp>",
  "skillsRoot": "<agents root>",
  "skills": ["omt", "omt-ulw"],
  "links": [{ "path": "<link path>", "target": "<relative target>" }],
  "config": { "path": "<user config path>", "created": true },
  "hooks": [{ "kind": "claude-user-prompt-submit", "settingsPath": "<path>", "command": "<command>" }],
  "backups": ["<path>"]
}
```

A new install merges into an existing manifest.

### 14.6 Uninstall

`omt uninstall` builds its plan from the manifest and from a scan:

- Remove each link in the Claude and Gemini roots that is a symlink resolving to a managed directory, except a link to a kept skill.
- Remove each managed skill directory in the agents root. A locally modified skill (its hash differs from the marker hash) is planned as `keep` with `(locally modified)` and stays in place. With `--force`, it is moved to `<configDir>/backups/<stamp>/agents/<name>` instead.
- Remove each hook entry with the signature, with the same backup and symlink rules as section 14.4.
- Keep the user config unless `--purge` is given. `--purge` also removes the config directory when it is then empty.
- Remove the manifest.

The plan lists the user config and the manifest only when they exist. It never removes a path that is not managed. It leaves the skill roots in place, even when they are empty. A manifest or Claude settings file that is not valid JSON stops the command before any change. The confirmation flow is the same as for install.

### 14.7 Doctor

`omt doctor` runs these checks and prints one line per check, such as `PASS  config  11 roles`:

| Id | PASS | WARN | FAIL | INFO |
| --- | --- | --- | --- | --- |
| `node` | `ctx.nodeVersion` is 22.18 or later | | older version | |
| `config` | no issues | warnings only | any error | |
| `skills` | every bundled skill is installed, managed, and current | missing, outdated, or locally modified skills | | |
| `links` | every Claude link resolves to its canonical directory | a missing link | a broken or conflicting link | |
| `hooks` | the manifest hook is present in the Claude settings, and its node and CLI paths exist | the manifest hook is missing from the settings | the hook's node or CLI path does not exist | no hook installed; suggest `omt install --hooks` |
| `path` | an executable `omt` exists in a `PATH` directory | none found; skills fall back to manual role resolution | | |
| `t3` | `t3SettingsPath()` exists | it does not exist | | |
| `homes` | every T3 `claudeAgent` instance that sets `config.homePath` has the skills linked in `<homePath>/skills` | an instance with a `homePath` that lacks the skills | | no instance sets a `homePath` |
| `roles` | every role resolves (only with `--capabilities`) | some roles are unavailable | the `execute` role is unavailable | |

The `hooks` check reads the settings paths from the manifest. With no manifest hook, it looks for a signed entry in `claudeSettingsPath()`. The `homes` check reads `providerInstances` from `t3SettingsPath()` and never writes it. It looks at instances whose `driver` is `claudeAgent`, expands a leading `~`, and accepts a link or a managed copy for each skill. The `roles` check is left out without `--capabilities`. The status set is `PASS`, `WARN`, `FAIL`, and `INFO`. `--json` prints `{ "ok": boolean, "checks": [{ "id", "status", "message" }] }`, where `ok` is false when any check fails. The exit code is 1 when any check fails.

## 15. Skills

### 15.1 Common rules

- Each skill is `skills/<name>/SKILL.md` with YAML frontmatter. `name` equals the directory name. `description` is at most 1,024 characters.
- A user-invoked skill sets `disable-model-invocation: true` (read by Claude, Cursor, and Pi). It also ships `agents/openai.yaml`, because Codex reads that file instead:

  ```yaml
  interface:
    display_name: "<Display name>"
    short_description: "<one line>"
  policy:
    allow_implicit_invocation: false
  ```

- Skills call the CLI as `omt` on `PATH`. That works after `npm install -g oh-my-t3code`, or `pnpm link --global` in a clone. When `omt` is not found, a skill falls back to the manual steps in `roles.md` and `brief.md`. Skills never use `npx`, which needs the network.
- Skills name T3 tools by their base names (`delegate_task`, `task_status`). The first skill text that names a tool says that harnesses may add a prefix, such as `mcp__t3-code__delegate_task`.
- Shared reference lives in `skills/omt/references/`. Other skills link to it with relative paths such as `../omt/references/delegation.md`.
- Every relative link in a skill must resolve to a file in the repository. A test checks this.
- Write for agents. Front-load the trigger words in each description. Give each step a completion criterion. State the target behavior instead of a ban where possible.

### 15.2 Skill list

| Skill | Invocation | Purpose |
| --- | --- | --- |
| `omt` | user | Router. Lists the omt workflows, when to use each, and the shared references. |
| `omt-ulw` | model | Ultrawork loop: frame, route, explore, plan, dispatch, review, test, fix, final gate, report. Trigger words: ulw, ultrawork, build or fix with subagents in T3. |
| `omt-plan` | model | Planning: read-only exploration, owner-decision questions only, plan file, cross-family plan-review rounds with a frozen blocker list, handoff. |
| `omt-review` | model | Review of uncommitted changes, a branch, a commit, or a PR. Reviewer count by diff size, grouping by file locality, a fresh task per round, a final oracle pass, merged findings. |
| `omt-research` | model | Parallel read-only research into a cited report. |
| `omt-swarm` | user | Independent tracks in separate worktree threads with `t3_thread_launch`, stacked branches, `link_pull_request`, and `watch_pull_request`. Invoking it is the explicit user request that T3 requires for new threads. |
| `omt-loop` | user | Keep work going across turns. On Claude and Codex threads, it asks the user to type `/goal <objective>`; no MCP tool sets a goal. Otherwise it uses a `schedule_task` heartbeat bound to the thread, a condition command, and a hard iteration cap counted in the ledger. It deletes the schedule when done. |

Rules that the skills must carry:

- Before each dispatch, the conductor runs `omt ledger stats --plan <slug>` and dispatches only while it reports `can dispatch: yes`. Without the CLI, it counts the open task ids in the plan's log.
- A read-only role's brief carries the plan-mode line (section 9.2). When a summary is `Child task completed without an assistant result.`, the conductor reads the child with `t3_thread_read` (view `messages`, which includes proposed plans) before it re-dispatches.
- The conductor keeps its own turn short: dispatch async work, then end the turn and let the wake start the next one. When the turn cannot end (a goal or a stop hook keeps it running), it uses `delegate_task` with `mode: "wait"` and a `timeoutMs` of at most 3,600,000 for one blocking task. For parallel tasks, it uses `t3_thread_wait` on each child thread, then `task_status` for each. A later wake that names tasks it already read needs no action.
- `interaction_mode_escalation_denied` and `runtime_mode_escalation_denied` are stop codes: report them and do not fall back. `provider_unavailable`, `model_unavailable`, and an `invalid_request` about options move to the next rung with the next attempt number.
- `omt-swarm` tracks are top-level threads, not delegated children. Their launch message does not use `omt brief`. It tells the track to run `omt-ulw`, to commit each verified unit on its own branch, to push, and to open a PR against its base. Before it launches, the skill checks with `orchestrator_capabilities` that the caller runs in `full-access` runtime mode and `default` interaction mode, which `t3_thread_launch` requires. It launches at most `maxParallel` tracks and gives each track a lower `limits.maxParallel`. Top-level threads never wake the caller, so the skill monitors them with a `schedule_task` heartbeat bound to the caller's thread. The heartbeat prompt is complete on its own, and the skill deletes the heartbeat when every track has a PR or a blocker.
- `omt-ulw`, `omt-plan`, `omt-review`, and `omt-research` start with a step 0 that reads `interactionMode` from `orchestrator_capabilities`. In `plan` mode they dispatch only read-only roles, write no files, and deliver the result in the final message, or ask the user to switch to default mode.
- Skills tick plan items with `omt plan mark` and create LIGHT plans with `omt plan new <slug> --light`. They record a dispatch with `--task-id` and the result with the same plan, unit, role, round, and attempt, without the task id.
- Fix rounds: round 1 is `execute`, the round 2 fix is `execute`, the round 3 fix is `deep`, and a failed round 3 review stops the unit and asks the user. Oracle rounds count against `maxReviewRounds` too.
- A `test` persona never runs `git stash` or other commands that touch files outside its scope, because the checkout is shared.
- The cross-family gate is the `oracle` role. `review` runs on the same family as `execute` by default, so the final gate of every heavy run uses `oracle`.

### 15.3 Shared references in `skills/omt/references/`

- `delegation.md`: the T3 rules. Covers the `delegate_task` fields, getting arguments from `omt brief --json` or `omt route`, and `clientRequestId` per round and attempt (section 10). Covers async dispatch and the wake message, which names only task ids, plus the waiting rules from section 15.2. It also covers `task_status` and `task_cancel`, the failure codes with the recovery for each, the 120,000-character prompt limit, the shared checkout, depth and budget limits, and when `t3_thread_launch` is allowed.
- `roles.md`: the default roles and when to choose each one. Covers how to resolve them with `omt roles` and `omt route`, and how to resolve them by hand when the CLI is missing, including the effort option table per driver. Also covers falling back to the next rung on `provider_unavailable`, `model_unavailable`, or `invalid_request`, and custom roles and templates.
- `brief.md`: the brief layout, how to write the task text (deliverable, scope, verify, stop condition), and one complete example.
- `results.md`: how the parent reads each result block, and the rule that a done claim stays unverified until the parent or a tester checks it.
- `roles/<role>.md`: one persona file per default role, plus `_generic.md`.
- `results/<kind>.md`: the contracts from section 11.

## 16. Tests

Each module has tests in `test/`. Use `test/helpers.ts` to make temp directories and a fake `CliContext` that records stdout and stderr. Tests never read or write the real home directory.

Required coverage:

- JSONC: comments, comment markers inside strings, trailing commas, a byte order mark, and error positions.
- Config: defaults pass validation, layering order, `null` removal, chain replacement, new-role defaults, every validation error class, and a syntax error that skips one file.
- Routing: a fixture with Claude, Codex, Pi, and Cursor enabled and Grok disabled. Cover a resolved role, fallback past a disabled provider, a missing model, effort mapping for each driver, nearest-value mapping, invalid raw options, driver-only rungs, unverified mode, and the MCP content wrapper.
- Routing also covers both mode ceilings and the inherited-instance preference for driver-only rungs.
- Brief: every section, omitted sections, both access lines, both delegation lines, the plan-mode line, template lookup order, the title rule, and the `--json` payload.
- Plan: the template, parsing every checkbox state, counts, the next unit, and `complete`.
- Ledger: append, list, stats, a malformed line, and `requestId` sanitizing with round and attempt.
- Hook: a detection matrix (inside a code block, inside quotes, `ulwx`, `$ulw`, `ULTRAWORK`, a prompt with `<!-- omt-brief`, a prompt that starts with `Act as the `, a prompt that starts with `/omt-ulw`), invalid JSON, and the output shape.
- Install: create, idempotent rerun, conflict without and with `--force`, a locally modified managed skill, backups outside the skill roots, `--dry-run` and a declined prompt write nothing, non-TTY without `--yes`, roots that resolve to the same directory, hook add and update that keep other settings, an unchanged hook writes nothing, a symlinked `settings.json` stays a symlink, `--hooks` refused for a temp `cliPath`, uninstall removes only managed paths, and `--purge`.
- Doctor: each status that the table in section 14.7 defines, with `nodeVersion` injected through the context.
- Skills: frontmatter rules, every relative link resolves, a persona file for every default role, a contract file for every result kind.
- Schema: the committed schema equals the generated one, and it allows the same keys as the validator.
- CLI: `--help`, `--version`, an unknown command (exit 2), and an unknown flag (exit 2), run as a child process.
- Commands: `roles`, `route`, `brief`, and `doctor` in `test/commands/`, including the `brief --json` payload fields and the title rule.
- End to end: one child-process flow in a temp `HOME` (`test/e2e.test.ts`) that installs, runs every command in a temp git project, and uninstalls. It runs the CLI with `process.execPath`, because a version-manager `node` shim can fail when `HOME` is a temp directory.
