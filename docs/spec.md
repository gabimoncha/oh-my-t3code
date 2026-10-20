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
- File writes: atomic, except the ledger and lock metadata (section 5.11). Write a temp file in the same directory, then rename. Create parent directories as needed. When the target exists, the temp file gets the target's mode before the rename, so a 0600 file stays 0600. Each ledger entry is one `appendFile` call, so concurrent appends do not overwrite each other.
- When the target of a write is a symlink, write next to its real path (`fs.realpath`) and rename onto the real path, so the symlink stays a symlink.
- No network calls. No telemetry. The CLI starts no package manager. Only the generated worktree setup runner (section 5.12) starts one, when T3 runs it.

`package.json` scripts:

| Script | Command |
| --- | --- |
| `omt` | `node src/cli.ts` |
| `test` | `node --test "test/**/*.test.ts"` |
| `typecheck` | `tsc --noEmit` |
| `build` | `tsc -p tsconfig.build.json` |
| `schema` | `node scripts/build-schema.ts` |
| `check` | `pnpm typecheck && pnpm test` |

The package is named `oh-my-t3code`. It has two bin names, `omt` and `oh-my-t3code`. The `files` list is `dist`, `skills`, `schema`, `templates`, `README.md`, and `LICENSE`.

## 2. Repository layout

```text
src/
  cli.ts                 entry: shebang, calls main(process.argv.slice(2)), sets process.exitCode
  main.ts                main(), createContext(), command registry, help text
  types.ts               shared types (section 3)
  paths.ts               path helpers (section 4)
  util/                  errors.ts, args.ts, fs.ts, output.ts, json.ts, ids.ts
  config/                jsonc.ts, defaults.ts, validate.ts, merge.ts, load.ts, starter.ts, schema.ts
  routing/               capabilities.ts, effort.ts, resolve.ts, format.ts, family.ts
  brief/                 templates.ts, render.ts
  plan/                  template.ts, parse.ts
  visual/                spec.ts, inline.ts, flow.ts, plan.ts, page.ts
  ledger/                ledger.ts
  profile/               resolve.ts
  lock/                  lock.ts
  install/               skills.ts, links.ts, claudeHook.ts, manifest.ts, plan.ts, apply.ts, doctor.ts, confirm.ts, fsops.ts, project.ts
  hooks/                 userPromptSubmit.ts
  worktree/              runner.ts, check.ts, setup.ts (section 5.12)
  commands/              one file per command, each exports `run: CommandRun`
                         profile.ts and lock.ts add profile and lock commands
                         worktree.ts adds the worktree command
                         shared.ts holds the helpers that commands share and exports no `run`
scripts/
  build-schema.ts        writes schema/omt.schema.json from src/config/schema.ts
schema/
  omt.schema.json        JSON Schema for config files
templates/
  worktree-setup.mjs     the standalone worktree setup runner (section 5.12)
skills/
  omt/                   router skill and shared references
  omt-ulw/ omt-plan/ omt-design/ omt-review/ omt-research/ omt-swarm/ omt-loop/ omt-show/
test/
  helpers.ts             temp dirs and a fake CliContext
  run.ts                 command helpers
  fixtures/              capabilities.json, capabilities-live.json
  config/profiles.test.ts profile validation and merging
  profile/               resolve.test.ts, profile.test.ts
  lock/                  lock.test.ts
  routing/fast.test.ts    fast option mapping and precedence
  skills/                common.test.ts, personas.test.ts, plan-design.test.ts, review.test.ts, ulw.test.ts, shared.ts
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
export type ResultKind = "work" | "review" | "test" | "research" | "plan" | "guardrail";
export const RESULT_KINDS: readonly ResultKind[] = ["work", "review", "test", "research", "plan", "guardrail"];

export interface Rung {
  provider?: string; // T3 provider instance id, for example "claudeAgent"
  driver?: string; // T3 driver kind; used when provider is absent
  model: string; // model id as listed by orchestrator_capabilities
  effort?: Effort; // mapped onto the model's effort option
  fast?: boolean;
  options?: Record<string, OptionValue>; // raw T3 option selections; override the effort mapping
}

export interface RoleConfig {
  description: string;
  access: Access;
  result: ResultKind;
  t3Role: T3Role;
  interactionMode: InteractionMode;
  runtimeMode: RuntimeMode;
  crossFamily?: boolean; // review from the family other than the worker's when --against names the worker
  fast?: boolean;
  chain: Rung[];
}

export interface Limits {
  maxParallel: number;
  maxTasksPerRun: number;
  maxDepth: number;
  maxReviewRounds: number;
}

export interface Visuals {
  plan: boolean;
}

export interface Workflow {
  plan: {
    review: "two-families" | "one" | "owner";
    testLayers: ("e2e" | "integration" | "unit")[];
  };
  design: {
    variants: number;
  };
  build: {
    review: "every-round" | "first-round" | "off";
    verify: "heavy" | "every-unit";
    qa: "planned" | "off";
    failureProofs: "on" | "off";
    oracle: "heavy" | "always" | "off";
    checkpoint: "none" | "layer" | "unit";
    stallMinutes: number;
  };
  review: {
    reviewers: "auto" | number;
    families: "one" | "both";
    oracle: "on" | "off";
    fixLoop: "offer" | "off";
    ci: "off" | "check" | "fix";
    verify: "off" | "changed-flows";
    tests: "off" | "offer";
    guardrails: "off" | "propose";
    crap: "off" | "report";
  };
}

export type WorkflowLayer = { [K in keyof Workflow]?: Partial<Workflow[K]> };

export interface ModelConfig {
  fast?: boolean;
}

export interface ProfileConfig {
  description: string;
  extends?: string;
  workflow?: WorkflowLayer;
  limits?: Partial<Limits>;
  roles?: Record<string, Partial<RoleConfig> | null>;
  models?: Record<string, ModelConfig>;
}

export interface OmtConfig {
  version: 1;
  profile: string;
  profiles: Record<string, ProfileConfig>;
  models: Record<string, ModelConfig>;
  roles: Record<string, RoleConfig>;
  limits: Limits;
  visuals: Visuals;
}

export interface ConfigLayer {
  version?: 1;
  profile?: string;
  profiles?: Record<string, Partial<ProfileConfig> | null>;
  models?: Record<string, ModelConfig>;
  roles?: Record<string, Partial<RoleConfig> | null>;
  limits?: Partial<Limits>;
  visuals?: Partial<Visuals>;
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
  crossFamily: boolean; // the role's crossFamily, false when unset
  status: RoleStatus;
  delegateTask?: DelegateTaskArgs; // from the first ok rung
  fallbacks: ResolvedTarget[]; // later ok rungs, in the order they were tried
  attempts: RungAttempt[]; // in the order they were tried; index is the configured position
  notes?: string[]; // role-level routing notes, such as the cross-family notes; omitted when empty
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
  notes: string[]; // the role-level notes, then every attempt note and failure reason in the order tried, each prefixed "rung <n>: "
}

export interface BriefJsonOutput {
  delegateTask: {
    task: string; // the rendered brief, or the saved brief pointer with --save
    title: string;
    target: ResolvedTarget;
    role: T3Role;
    interactionMode: InteractionMode;
    runtimeMode: RuntimeMode;
    mode: "async";
    clientRequestId?: string; // present when --plan and --unit are given
  };
  fallbacks: ResolvedTarget[]; // not a delegate_task field; use one of these when the call fails
  ledger?: { dispatched: string }; // present with --save --json
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
  limits: { maxParallel: number; maxTasksPerRun: number }; // from the effective config; with a plan limit, maxParallel is the lower of the two, and a plan max-tasks replaces maxTasksPerRun (section 5.6)
  planMaxParallel?: number; // the plan header max-parallel; set only when the plan has one
  planMaxTasks?: number; // the plan header max-tasks; set only when the plan has one
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

`src/types.ts` also holds the worktree report types of section 5.12: `PackageManagerName`, `WorktreeManager`, `WorktreeLinker`, `WorktreeStore`, `WorktreeSetupStatus`, `WorktreeSetup`, `WorktreeCheck`, and `WorktreeReport`. `omt worktree check --json` prints a `WorktreeReport`.

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
| `mainCheckoutOf(root)` | the main checkout of a linked worktree. When `<root>/.git` is a file whose first line is `gitdir: <path>`, it resolves `<path>` against `root`, reads `<gitdir>/commondir` (relative or absolute, resolved against `<gitdir>`), and returns `dirname(<common dir>)` when `basename(<common dir>)` is `.git` and the repository is not bare; `undefined` for a normal checkout (`.git` is a directory), a submodule, a bare or unknown layout, or any read error. It reads `core.bare` in the plain form that git writes: the repository is bare when the `[core]` section of `<common dir>/config` sets `bare` to true (`true`, `yes`, `on`, `1`, or no value). Hand-edited forms, such as quoted values, repeated keys, or an entry on the section line, are not supported. A missing `config` counts as not bare. So a bare repository stored at `<repo>/.git` gives `undefined` |
| `findProjectRoot(cwd)` | the nearest ancestor of `cwd` (or `cwd` itself) that contains `.omt` or `.git` (a directory or a file); when that directory has a `.git` file and `mainCheckoutOf` returns a main checkout, the main checkout, whether or not it has `.omt` yet; `cwd` when none exists |
| `findCheckoutRoot(cwd)` | the nearest ancestor of `cwd` (or `cwd` itself) that contains `.git` (a directory or a file); `undefined` when none exists. Unlike `findProjectRoot`, a linked worktree stays itself, because worktree setup files belong to the checkout's branch |
| `shadowedWorktreeState(cwd)` | `{ worktree, main }` when the directory that `findProjectRoot` stops at is a linked worktree whose own `.omt/plans` holds a regular file whose name ends in `.md`, or whose own `.omt/ledger.jsonl` is a regular file; else `undefined` |
| `omtDir(root)` | `<root>/.omt` |
| `projectConfigPath(root)` | `<root>/.omt/config.jsonc` |
| `projectRolesDir(root)` | `<root>/.omt/roles` |
| `plansDir(root)` | `<root>/.omt/plans` |
| `planPath(root, slug)` | `<root>/.omt/plans/<slug>.md` |
| `ledgerPath(root)` | `<root>/.omt/ledger.jsonl` |
| `evidenceDir(root)` | `<root>/.omt/evidence` |
| `projectManifestPath(root)` | `<root>/.omt/install.json` |
| `projectShimPath(root)` | `<root>/.omt/bin/omt` |
| `projectSkillRoots(root)` | `{ agents: <root>/.agents/skills, claude: <root>/.claude/skills }` |
| `projectInstallDirs(root)` | Folders under `<root>`, in order: `.omt`, `.omt/plans`, `.omt/bin`, `.omt/backups`, `.agents`, `.agents/skills`, `.claude`, `.claude/skills` |
| `projectClaudeSettingsPath(root)` | `<root>/.claude/settings.local.json` |
| `claudeConfigDir(env, homedir)` | `$CLAUDE_CONFIG_DIR`, else `<home>/.claude` |
| `skillRoots(env, homedir)` | `{ agents: <home>/.agents/skills, claude: <claudeConfigDir>/skills, gemini: <home>/.gemini/config/skills }` |
| `claudeSettingsPath(env, homedir)` | `<claudeConfigDir>/settings.json` |
| `t3HomeDir(env, homedir)` | `$T3CODE_HOME`, else `<home>/.t3` |
| `t3SettingsPath(env, homedir)` | `<t3HomeDir>/userdata/settings.json` |
| `t3ProjectFilePath(root)` | `<root>/t3.json` |
| `worktreeRunnerPath(root)` | `<root>/.t3/omt-worktree-setup.mjs` |
| `pnpmWorkspacePath(root)` | `<root>/pnpm-workspace.yaml` |
| `runnerTemplatePath(packageRoot)` | `<packageRoot>/templates/worktree-setup.mjs` |

`mainCheckoutOf`, `findProjectRoot`, `findCheckoutRoot`, and `shadowedWorktreeState` are the only functions that read the file system. None of them starts a `git` process.

All worktrees of one repository share one `.omt` in the main checkout. It holds the config, the plans, the ledger, the evidence, and the shim. So a build thread in one worktree finds the plan that a planning thread wrote in another. A worktree's own `.omt` never wins. Git writes `gitdir:` as a real path. `findProjectRoot` rebuilds the main checkout under the nearest ancestor of the worktree whose real path holds it, so a cwd in a worktree and a cwd in the main checkout give the same root string, such as `/var/...` and not `/private/var/...`.

Shadowed state. Before `plan`, `ledger`, `brief`, `route`, `init`, and `visual` run, the CLI calls `shadowedWorktreeState(cwd)`. When it returns a value, the CLI prints two lines to stderr: `warning: <worktree>/.omt holds plans or a ledger that omt no longer reads; move them to <main>/.omt`, then `hint: if git tracks them, untrack them with "git rm --cached" and commit; .omt/.gitignore keeps plans out of git`. It moves no file. A worktree copy of a plan usually comes from a commit of the main copy, so the hint names the fix.

No project. Before `plan`, `profile`, `ledger`, `brief`, `visual`, and `lock` run, the CLI looks for a `.omt` or `.git` entry in the current directory and its parents. When it finds none, it prints one line to stderr: `warning: no .omt or .git found above <cwd>; omt uses it as the project root. Run omt from the project or worktree folder.` The command still runs.

## 5. CLI

Exit codes: 0 for success, 1 for a failure (bad config, a failed check, a conflict, a missing file), 2 for a usage error (unknown command, unknown flag, missing argument). `omt lock run` also returns the command's exit code, or 75 for a busy lock. `omt lock run` and `omt lock list` also return the lock tool's exit code when it is neither 0 nor 75. Every command accepts `--help`, prints its usage, and exits 0. `omt --version` prints the version. `omt` with no command or with `--help` prints the command list.

Argument parsing uses `node:util` `parseArgs` with `strict: true` and `allowPositionals: true`, wrapped in `src/util/args.ts`. A parse error becomes an `OmtError` with exit code 2.

| Command | Synopsis |
| --- | --- |
| `install` | `omt install [--project [--no-git-exclude]] [--targets <list>] [--hooks] [--yes] [--dry-run] [--force]` |
| `uninstall` | `omt uninstall [--project] [--yes] [--dry-run] [--purge] [--force]` |
| `doctor` | `omt doctor [--project] [--capabilities <file>] [--json]` |
| `init` | `omt init` |
| `config` | `omt config [show \| path \| validate \| init] [--json] [--defaults] [--force]` |
| `roles` | `omt roles [--capabilities <file>] [--role <name>]... [--plan <slug>] [--profile <name>] [--json]` |
| `route` | `omt route <role> [--capabilities <file>] [--against <provider\|driver\|auto>] [--plan <slug>] [--profile <name>] [--unit <id>]` |
| `brief` | `omt brief <role> (--task <text> \| --task-file <file>) [options]` |
| `plan` | `omt plan new <slug> [--title <text>] [--light] [--max-parallel <n>] [--max-tasks <n>] [--profile <name>] [--force]`, `omt plan profile <slug> <name\|none>`, `omt plan mark <slug> <id> <done\|open\|blocked>`, `omt plan limit <slug> [<n\|none>] [--tasks <n\|none>]`, `omt plan status [<slug>] [--json]`, `omt plan list [--json]` |
| `ledger` | `omt ledger add [options]`, `omt ledger list [--plan <slug>] [--json]`, `omt ledger stats [--plan <slug>] [--json]`, `omt ledger request-id --plan <slug> --unit <id> --role <role> [--round <n>] [--attempt <n>]` |
| `profile` | `omt profile list [--json]`, `omt profile show [<name>] [--plan <slug>] [--profile <name>] [--json]` |
| `lock` | `omt lock run <name> [--wait <seconds>] -- <command> [args...]`, `omt lock list` |
| `paths` | `omt paths [--json] [--root \| --plans \| --ledger \| --evidence \| --config \| --shim]` |
| `visual` | `omt visual [--plan <slug\|file.md>] [--spec <file\|->] [--out <path\|->] [--json]` |
| `worktree` | `omt worktree [check] [--json]`, `omt worktree setup [--dry-run] [--yes]` |
| `hook` | `omt hook user-prompt-submit` |

In every flag that takes a file, `-` means standard input.

`--project` selects project scope for `install`, `uninstall`, and `doctor` (section 14.8). Without it, these commands work in user scope. `--no-git-exclude` without `--project` is a usage error.

`--capabilities` is optional everywhere. Without it, routing is `unverified`: the CLI trusts the chain, and T3 validates the target when `delegate_task` runs. The skills treat that as the normal path and fall back to the next rung on a typed T3 error. To verify, the agent saves the `orchestrator_capabilities` result to a file. Claude Code saves a large tool result to a file by itself and reports the path. On ACP providers, `acp-mcp-call orchestrator_capabilities '{}' > caps.json` writes it. Any agent can also write a trimmed copy that keeps only the providers and models its chains name.

### 5.1 `omt config`

- `show` (the default subcommand) prints the merged config as JSON, before the selected profile is applied (section 6.7). `--defaults` prints the built-in defaults instead. Config issues go to stderr, and the command still exits 0.
- `path` prints two lines: `user: <path> (present)` or `(absent)`, then `project: <path> (present)` or `(absent)`. Neither path goes through `realpath`. The CLI takes its cwd from `$PWD` when `$PWD` resolves to `process.cwd()` and `findProjectRoot($PWD)` resolves to the same real directory as `findProjectRoot(process.cwd())`; otherwise it uses `process.cwd()`. So the project root always names the physical project, and `$PWD` changes only how it prints.
- `validate` prints each issue as `<severity> <source> <path>: <message>`, or `<severity> <source>: <message>` when the path is empty. A JSONC syntax error is one issue with an empty path and the message `<line>:<column>: <reason>`, so the file path appears once. It prints `config ok` when there is no issue. It exits 1 when any issue is an error. `--json` prints `{ "ok": boolean, "issues": ConfigIssue[] }`.
- `init` writes the starter user config (section 6.5) and prints `create <path>` or `overwrite <path>`. It refuses to overwrite an existing file unless `--force` is given.

### 5.2 `omt init`

Creates, in the project root, only what is missing:

- `.omt/config.jsonc` with the starter project config (section 6.5)
- `.omt/plans/`
- `.omt/.gitignore` with the eight lines `ledger.jsonl`, `evidence/`, `bin/`, `install.json`, `backups/`, `plans/`, `locks/`, and `guardrails.md`. A live plan is shared state of all worktrees (section 4), not source, so git does not see it.

When `.omt/.gitignore` exists and lacks some of these lines, `init` appends the missing lines and keeps every other line. An older omt wrote fewer lines, so this brings an existing project up to date. A symlinked `.gitignore` is updated through its target, and a dangling symlink is left alone.

It prints one line per path: `create <path>`, `update <path>`, or `exists <path>`. It never overwrites the config, and it never removes a line. Then it prints one line about the worktree setup of the current checkout, `worktree setup: <status> <message>`, from the `summary` of section 5.12. A read error in that check gives a `WARN` line and does not fail `init`.

### 5.3 `omt roles` and `omt route`

`omt roles` loads the config, applies the selected profile, resolves every role (or only the roles named with `--role`), and prints a table. In this example, the capabilities show Grok as disabled, and a project config sets a custom `oracle` chain with the rungs `grok/grok-build` and `codex-pro/gpt-6-astra`. The second rung names only the provider `codex-pro`, without a `driver`.

```text
ROLE         STATUS      TARGET                                         ACCESS     MODE     CROSS
execute      resolved    claudeAgent/claude-opus-5-5 effort=medium      edit       default  no
review       resolved    codex/gpt-6-astra reasoningEffort=high         read-only  plan     yes
oracle       unavailable -                                              read-only  plan     yes
  rung 1 grok/grok-build: provider grok cannot run child tasks: Provider instance is disabled.
  rung 2 codex-pro/gpt-6-astra: provider instance codex-pro is not registered in T3
```

`MODE` is the role's `interactionMode`. `CROSS` is `yes` when the role has `crossFamily: true`, else `no`. Under each role, the table prints one indented line per failure reason of the rungs before the chosen one, and the notes of the chosen rung. For an unavailable role it prints the reason of every rung. Later rungs are not shown.

A footer line says either `verified against orchestrator_capabilities` or `unverified: pass --capabilities <file> to check the chains against T3`. `--json` prints the `RolesReport`. Config issues go to stderr. An unknown `--role` exits 1.

`omt route <role>` prints a `RouteOutput` (section 3) as JSON. Its `delegateTask` fields map directly onto `delegate_task` arguments. This is `omt route review --against codex --capabilities caps.json`:

```json
{
  "role": "review",
  "status": "resolved",
  "description": "Review a diff against its brief and report findings by severity. Runs on the family that did not make the change when the worker is known.",
  "access": "read-only",
  "result": "review",
  "delegateTask": {
    "target": { "providerInstanceId": "claudeAgent", "model": "claude-opus-5-5", "options": { "effort": "high" } },
    "role": "review",
    "interactionMode": "plan",
    "runtimeMode": "inherit"
  },
  "fallbacks": [{ "providerInstanceId": "codex", "model": "gpt-6-astra", "options": { "reasoningEffort": "high" } }],
  "notes": ["cross-family: worker family codex; other families first"]
}
```

An unknown role is an error (exit 1) that lists the known roles. A `resolved` or `unverified` role exits 0. An `unavailable` role prints the JSON with `delegateTask` absent and exits 1.

`--against <value>` names the worker whose change the task reviews. The value is a provider instance id, a driver kind, or `auto`. The value must match `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`, else it is a usage error (exit 2). Section 8.3 defines the reorder and its notes. `--plan` also selects the plan header's profile. `--profile` overrides the selected profile (section 6.7). Both `roles` and `route` accept these flags. They accept a `--plan` id with no plan file and use the config profile unless `--profile` is given. `--unit` filters worker selection for `--against auto`. The ids follow section 5.6.

`--against auto` reads `.omt/ledger.jsonl` in the project root. It needs `--plan`; without it the command is a usage error (exit 2). A role without `crossFamily: true` does not read the ledger. Otherwise the CLI picks the worker with `pickWorker` (section 8.3):

- A worker entry has status `dispatched`, the given plan, a `provider`, and a role whose `result` in the effective config is `work` or `plan`. Entries of unknown roles are skipped. An entry without a `provider` is skipped. An entry whose `provider` is set but is not a non-empty string is skipped with `warning: skipped a ledger entry with an invalid provider <value> (role <role>, unit <unit or none>, ts <ts>)` on stderr.
- With `--unit`, when the unit has worker entries, the worker is the provider of the last one in file order. The note is `--against auto: worker <provider> from the last work dispatch of unit <id>`.
- Otherwise, for each unit, take its last worker entry. Entries without a unit count as one unit. The worker is the provider of most of these last entries. On a tie, it is the tied provider with the latest of these last entries in the file. An earlier entry that a later entry of the same unit replaces does not count for the tie. The note is `--against auto: worker <provider> from the provider of most units in plan <slug>`.
- When the plan has no worker entry, the chain keeps its configured order, and the note is `--against auto: no worker dispatch with a provider in plan <slug>; the configured order applies`.
- A malformed ledger line prints `warning: <path>:<line>: skipped a malformed ledger line` to stderr.

The `--against auto` note comes before the cross-family notes.

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
| `--plan <slug>`, `--unit <id>` | plan and unit ids for the header and request id; `--plan` also selects the plan profile |
| `--profile <name>` | override the selected profile |
| `--attempt <n>` | attempt number within the round, default 1 |
| `--title <text>` | thread title for `--json` output |
| `--capabilities <file>` | used with `--json` to resolve the target |
| `--against <provider\|driver\|auto>` | the worker whose change the task reviews, used with `--json` (section 5.3) |
| `--json` | print a ready `delegate_task` payload instead of the brief text |
| `--save` | save the full brief to evidence; with `--json`, return a short task that names the saved file |

`--attempt <n>` (default 1) is the attempt number for the request id (section 10). `--round`, `--depth`, and `--attempt` are positive integers. `--task` and `--task-file` exclude each other, and so do `--context` and `--context-file`. Only one flag can read stdin. An empty task is a usage error. An unknown role exits 1. The brief's `maxDepth` is `--max-depth` when given, else `limits.maxDepth` from the effective config. A `--depth` greater than that max is a usage error (exit 2) with a hint that names `--max-depth`. One exception: role `verify` may be one level deeper, because a worker at max depth still hands device checks to a `verify` child; that brief then uses its own depth as its max. `--plan` must match the plan slug regex (section 5.5) and `--unit` must match `^[A-Za-z0-9._-]{1,64}$`; a mismatch is a usage error. When the rendered brief is longer than 120,000 characters, the command prints nothing to stdout and exits 1 with a hint to shorten `--context` or `--prior-file`.

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
- `target` and `fallbacks` come from the role resolution, after the `--against` reorder (section 8.3). When the role is unavailable, the command prints nothing to stdout, prints the rung reasons to stderr, and exits 1.
- `--against`, `--plan`, `--profile`, and `--unit` follow section 5.3, also without `--json`. A `--plan` id does not require a plan file. With `--json`, role-level notes, rung notes, and rung failures go to stderr as `note: <note>`.

With `--save`, the CLI atomically writes the full brief to `<evidence>/briefs/<clientRequestId>.md`. Without both `--plan` and `--unit`, the name is `<role>-<first 12 hex of the brief's sha256>.md`. Without `--json`, stdout still contains the full brief.

With `--save --json`, `delegateTask.task` is:

```text
Act as the <role> sub-agent for this task. Your full brief is in the file <absolute path>. Read it in full first, then follow it exactly. End with the result block that the brief defines.
```

The pointer has no fixed length cap of its own. The path length determines its length. The other dispatch fields stay unchanged. The output adds `ledger.dispatched`, a shell command:

```text
<cli> ledger add --plan <p> --unit <u> --role <r> --round <n> --attempt <a> --status dispatched --task-id <taskId> --client-request-id <id> --provider <provider> --model <model>
```

Only `<taskId>` remains a placeholder. The CLI fills and quotes all other values and omits absent plan, unit, and request-id flags. A target change requires the conductor to update the provider and model. An unavailable JSON route saves no brief. The full rendered brief still has the 120,000-character limit before a save.

### 5.5 `omt plan`

- `new <slug>` writes `.omt/plans/<slug>.md` from the template in section 12. A slug matches `^[a-z0-9][a-z0-9-]{0,63}$`. An existing file is an error unless `--force` is given. `--light` leaves the `F2` oracle line out. `--max-parallel <n>` writes the `max-parallel=<n>` header key (section 12.2). An integer outside 1 to 32 is a usage error (exit 2). `--max-tasks <n>` writes the `max-tasks=<n>` header key, after `max-parallel` when both are given. An integer outside 1 to 500 is a usage error (exit 2). `--profile <name>` validates the selected profile and adds `profile=<name>` after the limit keys. Without that flag, `new` validates the config profile but writes no profile key. It prints the path.
- `profile <slug> <name|none>` changes only the plan header. A name sets `profile=<name>` and prints `set profile=<name> for <slug>`. `none` removes the override and prints `removed the profile of <slug>`. It validates the resulting selection, keeps other header keys, and writes atomically. A missing plan or header exits 1. An unknown profile exits 2 and lists known profiles. The `--profile` flag applies only to `new`; other plan subcommands reject it with exit 2.
- `mark <slug> <id> <done|open|blocked>` sets the checkbox of the column-zero item line for `<id>` (such as `U3`, `D1`, or `F2`) to `x`, a space, or `~`. It appends `- <ISO timestamp> <id> -> <state>` to the end of the file (the `## Log` section is last), writes atomically, prints `marked <id> <state>`, and exits 0. A missing plan or id exits 1. A bad state exits 2.
- `limit <slug> [<n|none>] [--tasks <n|none>]` changes the header comment of an existing plan. The positional value sets the `max-parallel` key to `<n>`, or removes it with `none`. `--tasks <n>` sets the `max-tasks` key, and `--tasks none` removes it. One call can give both. With neither, it exits 2. It changes only the header comment (section 12.2), not a later omt-plan comment in the body, keeps the other keys, and writes atomically. It prints one line per changed key: `set <key>=<n> for <slug>` or `removed the <key> limit of <slug>`. A missing plan exits 1. A positional value that is not `none` or an integer from 1 to 32 exits 2. A `--tasks` value that is not `none` or an integer from 1 to 500 exits 2.
- `status [<slug>]` parses one plan and prints its counts, the next open unit, and the ready units (section 12.2). The first line has the absolute path of the plan file, so a skill can hash and edit the shared plan from any worktree. The next line is `profile: <effective name>`. When the plan has `maxParallel`, it prints `max parallel: <n>` after the `final` line. When the plan has `maxTasks`, it prints `max tasks: <n>` after that. The line after `next:` is `ready: <id>, <id>` with the ids of the `ready` units in file order, or `ready: none`. Without a slug it uses the most recently modified plan. `--json` prints the parsed `PlanStatus` with an added `path` and the effective `profile` name.
- `list` prints one line per plan: slug, unit counts, and the next open unit. `--json` prints an array of `PlanStatus` items, each with an added `path`, so each item also has `ready`. Unlike `status`, `list` keeps the stored optional profile name without resolving it.
- `list` and `status` skip a `*.md` entry whose `stat` fails with ENOENT, such as a dangling symlink.

### 5.6 `omt ledger`

- `add` appends one `LedgerEntry` (section 3) as one JSON line to `.omt/ledger.jsonl`, with one `appendFile` call. Required flags: `--role` and `--status`. `--role` accepts any name, not only config roles, because the skills record `swarm` and `loop`. Optional flags: `--plan`, `--unit`, `--round`, `--attempt`, `--task-id`, `--client-request-id`, `--provider`, `--model`, `--verdict`, `--note`. `--round` and `--attempt` are positive integers. `--status dispatched` needs `--task-id` or `--unit`, else exit 2. A `dispatched` entry without `--task-id` is still appended, and the command prints `warning: this dispatched entry has no --task-id; the stall check and result matching need it` to stderr. It prints the entry as JSON. A terminal entry that closes no dispatched entry is still appended; the command then prints `omt: no dispatched entry matches; nothing was closed` to stderr and exits 0.
- In every subcommand, `--plan` must match the plan slug regex (section 5.5) and `--unit` must match `^[A-Za-z0-9._-]{1,64}$`; a mismatch is a usage error.
- Terminal statuses are `completed`, `failed`, `cancelled`, `interrupted`, `verified`, and `rejected`. A terminal entry T closes a dispatched entry D when T has a `taskId` equal to D's, or when T has no `taskId`, both T and D have a `unit`, and T and D have the same `plan`, `unit`, `role`, `round` (default 1), and `attempt` (default 1). A terminal entry with neither `taskId` nor `unit` closes nothing. `active` counts dispatched entries that no terminal entry closes, in any order.
- `list` prints a table with the columns `TIME` (HH:MM:SS of `ts`, in UTC), `PLAN`, `UNIT`, `ROLE`, `ROUND`, `STATUS`, `VERDICT`, `TASK` (the last 12 characters of `taskId`). It filters by `--plan` when given. `--json` prints an array of entries. A malformed line is skipped with a warning on stderr.
- `stats` loads the config, applies the plan header's profile or the config profile, and prints a `LedgerStats` (section 3). Text mode prints one line per field: `plan` (with `--plan`), `profile` (the effective name), `dispatched`, `active`, `terminal`, `max parallel`, `max tasks per run`, and `can dispatch: yes` or `can dispatch: no`. `--json` prints the object. The command has no `--profile` flag. Its JSON has no `profile` field. Before a plan file exists, a skill with a selected run profile compares these counts with `omt profile show <name> --json` limits (section 15.2).
- With `--plan <slug>`, when `.omt/plans/<slug>.md` exists and its header has `max-parallel` (section 12.2), the effective `maxParallel` is the lower of the profile-applied config value and the plan value. `limits.maxParallel` holds the effective value, `planMaxParallel` holds the plan value, and `canDispatch` uses the effective value. Text mode then prints `max parallel: <effective> (plan <n>, config <m>)`. Without a plan file, the config selects the profile. Without a plan limit, the profile-applied config limits apply.
- With `--plan <slug>`, when the plan header has `max-tasks` (section 12.2), the plan value replaces the config value of `maxTasksPerRun`, also when it is higher. `dispatched` counts every dispatched entry of the plan, planning tasks included, so a global cap stops a large plan early; the owner sets `max-tasks` for the size of this plan. This differs from `max-parallel`, where the lower value wins. `limits.maxTasksPerRun` holds the effective value, `planMaxTasks` holds the plan value, and `canDispatch` uses the effective value. Text mode then prints `max tasks per run: <effective> (plan <n>, config <m>)`. Without the key, the output does not change.
- `request-id` prints the canonical `clientRequestId` (section 10).

### 5.7 `omt hook user-prompt-submit`

See section 13.

### 5.8 `omt paths`

Prints the absolute paths of the project state, resolved through `findProjectRoot`. So from a linked worktree it prints the paths in the main checkout.

- Without a flag it prints one `name: path` line for each path. The order is `root` (the project root), `omt` (`omtDir`), `plans` (`plansDir`), `ledger` (`ledgerPath`), `evidence` (`evidenceDir`), `config` (`projectConfigPath`), and `shim` (`projectShimPath`).
- `--json` prints an object with the same keys.
- One of `--root`, `--plans`, `--ledger`, `--evidence`, `--config`, or `--shim` prints only that path and a newline, for use as `$(omt paths --evidence)`.
- Two path flags, a path flag with `--json`, or a positional argument is a usage error (exit 2).
- The command creates no path. Root resolution can read the worktree metadata from section 4.

### 5.9 `omt visual`

Builds one self-contained HTML page with tabs, status cards, tables, checklists, callouts, code blocks, and flowcharts. The `omt-show` skill passes the page text to the T3 `html_render` tool. The same plan and spec give the same bytes on every run: the layout uses no clock and no randomness.

**Arguments.**

- `--plan <slug|file.md>` adds the tabs built from a plan (below). A value that ends in `.md` is a plan file path, resolved from the cwd; the page is then named after the header `slug`, else the file name, else `plan`. Any other value must be a plan slug of `.omt/plans/`. A missing plan exits 1 with `plan_not_found`.
- `--spec <file|->` reads a JSON page spec, from stdin with `-`. A missing spec file exits 1.
- `--out <path|->` writes the page to the path, or prints it to stdout with `-`. The default is `<evidence>/visuals/<slug>.html` with `--plan`, else `<evidence>/visuals/page-<first 12 hex of the page's sha256>.html`. The page is written with `writeFileAtomic`, which creates the directory.
- `--json` prints `{ path, bytes, title, tabs, warnings }`, where `tabs` holds the tab titles. Without it, the command prints the page path, and each warning goes to stderr as `warning: <message>`. With `--out -`, warnings go to stderr.
- Usage errors (exit 2): neither `--plan` nor `--spec`, `--json` with `--out -`, an invalid slug, and a positional argument.

**Page spec.** The root is `{ title?, subtitle?, tabs? }`. `title` has 1 to 200 characters, `subtitle` 0 to 300, and `tabs` holds 0 to 8 tabs; without `--plan`, a spec needs at least 1 tab. A tab is `{ title, blocks }` with a title of 1 to 40 characters and 1 to 40 blocks. Each block has a `type`:

| `type` | Fields |
| --- | --- |
| `text` | `text` (1 to 8000). Paragraphs split on blank lines. A paragraph whose lines start with `- ` or `* ` is a bullet list, and with `<n>. ` a numbered list. A line that starts with two spaces continues the item above. |
| `cards` | `cards`: 1 to 6 of `{ title (1 to 60), value? (0 to 24), text? (0 to 300), tone? }`. |
| `table` | `title?` (0 to 120), `columns` (1 to 8 strings of 0 to 120 characters), `rows` (0 to 80 arrays of strings of 0 to 2000 characters), `nowrap?` (0 to 8 column indexes). A row with fewer cells is padded and a row with more is cut, each with a warning. |
| `checklist` | `title?`, `items`: 1 to 80 of `{ text (1 to 2000), state? }`, where `state` is `done`, `open` (default), or `blocked`. |
| `callout` | `tone?`, `title?` (0 to 120), `text` (1 to 2000). |
| `code` | `text` (1 to 8000). |
| `flow` | `title` (1 to 120), `description?` (0 to 600, default the title), `nodes` (1 to 60), `edges` (0 to 120). |

- `tone` is `info`, `ok`, `warn`, `bad`, or `muted` (default).
- A node is `{ id, label, sub?, kind?, tone?, badge?, row?, col? }`: `id` matches `^[A-Za-z0-9_-]{1,40}$`, `label` has 1 to 120 characters, `sub` 0 to 160, `badge` 0 to 16, `row` 0 to 60, `col` 0 to 7. `kind` is `step` (default), `task`, `decision`, `start`, `end`, or `stop`. Node `tone` is `done`, `open`, or `blocked`.
- An edge is `{ from, to, label?, dashed? }`; `label` has 0 to 24 characters.
- Inline markup in `text`, card `text`, table cells, checklist items, and callout `text`: `` `code` `` and `**bold**`. A link `[text](url)` shows its text only, so the page loads no URL. All other text is HTML-escaped. Node labels, `sub`, and badges are plain text with the backticks removed.
- Every problem of an invalid spec is listed in one error (exit 2) as `<JSON path>: <message>`, for example `$.tabs[1].blocks[3].edges[0].to: unknown node "zz"`. The problems are: not JSON, a wrong type, a missing required field, a value out of range, an unknown key, an unknown `type`, `kind`, `tone`, or `state`, a duplicate node id, and an edge to an unknown node.

**Flow layout.**

1. Back edges: a DFS from each node in input order, following edges in input order, marks an edge to a node on the DFS stack as a back edge.
2. Rows: a node keeps its `row`. Otherwise its row is 0 with no forward in-edge, else 1 plus the highest row of its forward predecessors.
3. Columns: nodes with `col` are placed first; each other node, in input order, takes the lowest free column of its row. A node whose cell is taken moves to the next free column with a warning. When no node of the flow has a `col`, each row is centered under the widest row (`K` nodes): a row of `k` nodes shifts right by `(K - k) / 2` columns. A flow with any `col` centers no row, so its main column stays straight.
4. Size: with `K` at most 4, the canvas is 720 px wide and a column is `(720 - 56) / K` px; wider grids use 150 px columns. A node is 28 px narrower than its column. The label wraps on spaces at `floor((width - 22) / 7.1)` characters (`- 34` for a decision), and `sub` at `floor((width - 22) / 6.3)`. A word longer than the line breaks after the last `/` that fits, else after the last `-`, `_`, or `.` that fits, else at the line width. A label or `sub` longer than 4 lines is cut with `…` and a warning. Node height is `12 + 17 × label lines + (4 + 14 × sub lines, when there is a sub) + 8`, plus 6 for a decision. A row is as tall as its tallest node, and each node is centered in its row.
5. Gaps between rows are at least 32 px, and 14 px plus 8 px per edge that runs across inside the gap. Each such edge gets its own lane in the gap. An edge that leaves a node above a given x takes a higher lane than an edge that drops into a node at that x.
6. Routes are axis-aligned. A route is valid when no segment enters the box of a node other than its two ends (boxes grown by 4 px), nor the open inside of its own ends. Forward edges choose before back edges, and each edge takes its first valid candidate that shares no line with an earlier edge; edges that leave or enter the same node in the same direction may share a line. When every candidate shares a line, the first valid candidate stays.
   - Forward edge: a straight line when both centers share `x`; down to the lane in the gap below the source, across, and down into the target; the same with the lane in the gap above the target; else the nearer side lane outside all nodes.
   - Edge in the same row: a straight line between the facing sides; else down to the gap below the row, across, and up into the target's bottom.
   - Back edge: up from the source top to the target's middle and across into its facing side; else across from the source's facing side and up into the target's bottom; else the right lane.
   - Self-loop: out of the bottom, through the right lane, and back into the node.
   - Side lanes are 16 px apart, and the canvas grows to hold them.
7. An edge label sits on the edge's own part: when the path turns from a first vertical stub into a horizontal run, the label is centered 5 px above that run (or 13 px below it); a straight vertical start puts it 6 px beside the line, 13 px below a downward start or 5 px above an upward one; a horizontal start puts it centered 5 px above. A label that would overlap another label or a node box, or leave the canvas, takes the next of these places, in steps of 12 px. Then it tries places along each of its segments: centered 5 px above or 13 px below a horizontal run, from the middle toward each end in 24 px steps, and 6 px beside a vertical run on both sides in 12 px steps. A first vertical stub that turns into a horizontal run gets no such places. When no place inside the canvas is free, the canvas grows right or down if that frees a place. Else the label takes its first place inside the canvas, with the warning `flow "<title>": the label "<text>" of edge <from> -> <to> overlaps another label or a node`. Labels have a 4 px halo in the page background color.
8. SVG numbers are rounded to one decimal place. `layoutFlow(block)` returns the node boxes and edge segments, and `renderFlow(block, id)` returns the SVG; ids are `f<tab>-<block>`, so no spec text reaches an id.

**Plan tabs** (`--plan`).

- Title: the plan's `# ` title. Subtitle: `plan <slug> · <n> units in <L> layers · <done>/<n> done`, plus ` · budget <max-tasks> tasks` when the header has `max-tasks`.
- `Summary`: a `text` block with the `## Summary` section; when it is missing or empty, the `## Objective` section and the warning `plan has no ## Summary; showing ## Objective`. Then cards: `Units`, `Done`, `Checks`, and `Budget` (with `max-tasks` only).
- `Units`: the flow `Units by dependency layer`, one `task` node per unit with label `<id> <title>`, the role as `sub`, and the unit state as `tone`. A label longer than 3 lines at the widest layer's width is shortened at a word with `…`; the table keeps the full title. The `U<n>` tokens of a unit's `Depends on:` line that name a unit of the plan are its dependencies; other tokens stay in the table only, and a `U<n>` that names no unit, a unit that names itself, and a cycle each give a warning. Edges are the transitive reduction of the dependencies, so row `r` is layer `L<r + 1>`. Then a table: `Unit`, `Title`, `Role`, `Depends on`, `State`.
- `Checks`: checklists `Done when` (the `D` items) and `Final verification` (the `F` items).
- Unit fields are the lines `  - <Field>: <value>` after a unit line, up to the next item or heading. Lines inside code fences are never items, fields, or headings, but a section keeps its fenced text. A fence closes only on a line of the opening character (`` ` `` or `~`) that is at least as long as the opening fence; a fence that does not close runs to the end of the plan.
- Merge: the spec's `title` and `subtitle` win. A spec tab with the same title as a built tab adds its blocks to that tab. Other spec tabs follow, in spec order.

**Page.** One document: a doctype, `<html lang="en">`, a charset and a viewport meta, a `<title>`, one inline `<style>`, the body, and one inline `<script>` that runs the tabs. No element loads a resource: no `<link>`, no `src=`, no `@import`, no URL. Colors come from `--o-*` variables that read the T3 theme variables (`--foreground`, `--background`, `--muted-foreground`, `--border`, `--info`, `--success`, `--warning`, `--warning-surface`, `--destructive`, `--code-background`, `--font-sans`, `--font-mono`, `--radius`) with light fallbacks and dark fallbacks under `prefers-color-scheme: dark`. The header is an `h2` title and a subtitle line. A page with more than 1 tab has `button role="tab"` elements and `section role="tabpanel"` panels; the script shows the first panel and hides the others, so a reader without script sees every panel. A flow sits in a wrapper that scrolls sideways, with `width: 100%`, `min-width: 520px`, and `max-width` the canvas width, and a legend of the node kinds and tones it uses; each tone swatch has the kind of the first node with that tone.

### 5.10 `omt profile`

- `list` prints a table of profile names and descriptions in config order. `--json` prints an array of `{ name, description }`. It includes the presets and custom profiles. `--plan` and `--profile` are usage errors with `list`.
- `show [<name>] [--plan <slug>] [--profile <name>]` prints the resolved profile from section 6.7. A positional name and `--profile` are alternatives. Giving both exits 2. Text output starts with `profile: <name>` and `source: <source>`, then JSON for `workflow`, `limits`, `roles`, and `models`.
- `show --json` prints `{ profile, source, workflow, limits, roles, models }`. `source` is `argument` for a positional name or `--profile`, `plan` for a plan header selection, `config` for a config selection other than `normal`, and `default` otherwise. A config that explicitly selects `normal` still gives `default`.
- `show --plan <slug>` requires the plan file, even with an explicit name. A missing file exits 1 with `plan_not_found`. An unknown profile exits 2 and lists known names. A cycle or a chain deeper than eight profiles exits 1 and names the chain.
- Profile role-merge issues go to stderr. Valid fields still appear in the output.

### 5.11 `omt lock`

`omt lock run <name> [--wait <seconds>] -- <command> [args...]` runs the command with inherited stdio and returns its exit code. The command runs in the caller's cwd and environment. A command killed by a signal returns 128 plus the signal number. The wrapper forwards SIGINT and SIGTERM to the command and waits for it to exit.

- A lock name matches `^[a-z0-9][a-z0-9._-]{0,63}$`. `--wait` is a non-negative safe integer in seconds, default 900. A missing `--`, command, or valid name exits 2.
- The CLI prefers `flock` on `PATH`, then `lockf`. It opens `<lock folder>/<name>.lock` with `a+` and gives the open file to the tool as fd 3. The tool command is `flock -E 75 -w <seconds> 3` or `lockf -s -t <seconds> 3`.
- When `flock` or `lockf` exits with a code other than 0 or 75, the CLI returns that code. It prints `omt: <tool> exited with code <n>` to stderr. This applies to both `omt lock run` and `omt lock list`.
- It first tries with zero seconds. When busy, it prints `waiting for lock <name> (pid <n>: <command>)` to stderr, then waits up to `--wait`. Missing holder data gives `pid unknown: unknown command`. A timeout exits 75 with `omt: lock <name> is busy`.
- After acquisition, it truncates the same open file and writes one JSON line with `pid`, `command`, and `startedAt`. `pid` is the wrapper PID. After command start, it rewrites the line with `childPid` too. The lock file is never replaced or deleted. This preserves the inode that the kernel locks.
- The command receives the locked open file as fd 3. The kernel holds the lock while any process keeps that open file. It can outlive a killed wrapper. A descendant that closes fd 3 or does not inherit it is covered only while another holder remains. Node's default `spawn` stdio does not pass fd 3. The workflow uses locks for commands whose subprocesses end before the command ends. Long-running servers, watchers, and daemons run outside the lock, with a serial plan (section 15.2).
- With neither tool on `PATH`, it prints `warning: no flock or lockf on PATH; running <command> without a lock`. It runs the command without a lock and returns its exit code. This path creates no lock folder.

`src/lock/lock.ts` finds the lock folder through Git when possible. `<project path>` is the project root's path relative to the Git top level.

1. When `git worktree list --porcelain` names the main checkout, use `<main checkout>/<project path>/.omt/locks/`.
2. When the first worktree path is the Git common directory itself, use `<git common dir>/omt/locks/<project path>/`. This covers a repository with a separate Git directory.
3. When Git cannot identify a main checkout, use `<project root>/.omt/locks/`.

Each lock folder gets a `.gitignore` with `*`. `omt init` also adds `locks/` to `.omt/.gitignore`. Worktrees of the same project therefore use the same lock files without new Git changes.

`omt lock list` opens each regular `*.lock` file in name order and tries a zero-second lock on that new open file. It prints `<file> free` or `<file> held <holder JSON>`. Missing holder data leaves out the JSON. An absent lock folder gives no output and exits 0. With an existing folder and neither lock tool, it exits 1 with `no flock or lockf on PATH; cannot list locks`. There is no clear or takeover command.

### 5.12 `omt worktree`

`omt worktree` checks and creates the T3 setup script that installs a checkout's dependencies when T3 creates a worktree. It supports Bun and pnpm, and it selects a global virtual store, so the worktrees of one machine share installed package directories. Each checkout keeps its own `node_modules` links.

Root. The command works on `findCheckoutRoot(cwd)`, the checkout of the current directory, not on `findProjectRoot(cwd)`. In a linked worktree the setup files go into that worktree, while `.omt` stays in the main checkout (section 4). Without `.git` above `cwd`, the report inspects `findProjectRoot(cwd)` and setup refuses.

Shared code. `templates/worktree-setup.mjs` is the runner that setup copies to `<root>/.t3/omt-worktree-setup.mjs`. It uses only Node built-ins and runs without omt. The CLI loads the same file with a dynamic `import()` and uses its exports, `detectManager(root)`, `checkLinker(root, manager, { env, home })`, `persistentGlobalStore(root)`, and `PNPM_WORKSPACE_CONTENT`, so a check and a runner agree. `src/worktree/runner.ts` declares those exports as `RunnerModule`. The runner starts the install only when its path is `process.argv[1]`, so an import has no effect. `node --check templates/worktree-setup.mjs` must pass, because `tsc` does not check it.

Package manager detection (`detectManager`):

- It reads `package.json` (a byte order mark is allowed). Invalid JSON or a value that is not an object blocks with `fix package.json`.
- Declarations: `packageManager` (`<name>@<version>`, with an optional `+<integrity>` suffix) and `devEngines.packageManager` (an object, or a list with one entry, with `name` and an optional `version`). Two declarations must name the same manager, and two exact versions must be equal.
- A declared `npm`, `yarn`, or other manager is unsupported; omt never replaces it. A declared version must be exact (`<major>.<minor>.<patch>`). A range or a tag blocks generation with a manual-setup hint. omt has no semver implementation.
- An exact declared version below the minimum blocks: Bun 1.3.14, pnpm 10.12.1.
- The lockfile of the selected manager must exist: `pnpm-lock.yaml` for pnpm, `bun.lock` or `bun.lockb` for Bun. The two Bun formats are one manager.
- Without a declaration, the lockfiles decide. One supported manager selects it. Both pnpm and Bun lockfiles block as ambiguous. Only `package-lock.json`, `npm-shrinkwrap.json`, or `yarn.lock` is unsupported. A `package.json` without a lockfile blocks. No `package.json` and no lockfile gives `status: "none"`: there is nothing to install.

Linker check (`checkLinker`). A global virtual store needs the isolated linker. The check reads explicit settings in their ordinary scalar forms, plain or quoted, with comments:

- pnpm: the `npm_config_node_linker` and `pnpm_config_node_linker` environment variables (any case), `node-linker` in `<root>/.npmrc` outside any section, and a top-level `nodeLinker:` in `<root>/pnpm-workspace.yaml`.
- Bun: `linker` in the `[install]` table of `<root>/bunfig.toml`, or a top-level `install.linker`. Without a project setting, the global bunfig, `$XDG_CONFIG_HOME/.bunfig.toml` then `<home>/.bunfig.toml`.
- Comments: in `.npmrc` and `pnpm-workspace.yaml` a `#` (and in `.npmrc` a `;`) starts a comment only at the line start or after whitespace. In `bunfig.toml` a `#` outside a string always starts a comment, so `[install]# note` and `linker = "hoisted"#note` are read. A table header that names `install` in another form, such as `[[install]]`, is `unverified`.
- `isolated` passes. No setting passes, and the setup selects `isolated`. Another value is `incompatible`. A setting that the check cannot read, such as a flow mapping, an inline table, an environment reference, or a multi-line value, is `unverified`. A config file that exists but cannot be read (for example `EACCES`), `.npmrc` and `pnpm-workspace.yaml` for pnpm or the local or global bunfig for Bun, is also `unverified`, with the action to make the file readable. `checkLinker` returns this result and never throws, so the check still prints its report and the runner exits 1 before the install. Both block generation and execution. omt never changes a config file. It does not claim to read arbitrary TOML or YAML.

Persistent store (`persistentGlobalStore`, pnpm only). pnpm checks `node_modules` before `pnpm run` and `pnpm exec` and re-installs it when its settings differ from the install. pnpm 12.13.0 was observed to turn a global-store install from command-line flags back into a local store this way. A top-level setting in `pnpm-workspace.yaml` keeps the global store. pnpm 10.12.1 and later read `enableGlobalVirtualStore: true`. pnpm 11.23.0 and later also read `virtualStoreType: global`, and when both keys are set, `virtualStoreType` wins (pnpm 12.13.0 was observed to resolve `virtualStoreType: project` with `enableGlobalVirtualStore: true` to a project store). pnpm below 11.23.0 ignores `virtualStoreType`. So `persistentGlobalStore(root, version)` judges the file for an exact pnpm version: the check passes the exact declared version, and the runner passes the installed version after its probe. The result (`WorktreeStore`) has a `status`:

| Status | Meaning |
| --- | --- |
| `set` | the file selects the global store |
| `no-file` | there is no `pnpm-workspace.yaml`; `omt worktree setup` creates it with the one line `enableGlobalVirtualStore: true` (`PNPM_WORKSPACE_CONTENT`), which every supported pnpm version reads |
| `missing` | the file has no setting that this pnpm version reads, for example only `virtualStoreType` for pnpm below 11.23.0 |
| `off` | the key that this pnpm version uses selects another store: `virtualStoreType` other than `global` from 11.23.0, else `enableGlobalVirtualStore` other than `true` |
| `version-dependent` | there is no exact declared version, and exactly one of pnpm below 11.23.0 and pnpm 11.23.0 or later selects the global store, for example only `virtualStoreType: global`, or two keys that disagree. When neither selects it, for example only `virtualStoreType: project`, the status is `off` (or `missing` when neither result is `off`), and the action is a configuration change, not a version pin |
| `unverified` | the file cannot be read, is a dangling symlink, or sets the value in a form that the check cannot read |

`missing`, `off`, and `unverified` keep the file and give the manual action: add the top-level line `enableGlobalVirtualStore: true`, or `virtualStoreType: global` with pnpm 11.23.0 or later (for a version below 11.23.0, only `enableGlobalVirtualStore: true`). `version-dependent` gives the action to pin an exact pnpm version, or to set `enableGlobalVirtualStore: true` with no `virtualStoreType` or `virtualStoreType: global`. Any status but `set` is `WARN store` in the check (`INFO` for a custom setup, which omt does not judge), so the check never reports a version-dependent key as verified. The runner stops before the install on any status but `set`, and decides a `version-dependent` file from the installed version.

`t3.json` validation follows the T3 project file schema (`packages/contracts/src/t3ProjectFile.ts`): `$schema` a string; `iconPath` a non-empty string of at most 512 characters; `defaultThreadEnvMode` `local` or `worktree`; `worktreeSubmodules` `recursive`, `top-level`, or `none`; `scripts` a list of at most 50 objects, each with a non-empty `name` and `command`, an optional `icon` from `play`, `test`, `lint`, `configure`, `build`, `debug`, booleans `runOnWorktreeCreate`, `runOnSettle`, `async`, `autoOpenPreview`, and a non-empty `previewUrl`. Unknown keys are allowed. The file is parsed with the JSONC parser (section 7). The setup script is the first script with `runOnWorktreeCreate: true`. `async: false` makes T3 wait for it before the agent starts. A missing or `true` `async` gives a warning.

Setup states (`WorktreeSetup.status`):

| Status | Meaning |
| --- | --- |
| `not-needed` | no `t3.json`, and `detectManager` found nothing to install |
| `missing` | no `t3.json`: the repository has no setup script. A saved or inherited T3 setup can still exist, so the message says that activation is unverified, not that worktrees get no install. `runner` is set as for `managed` |
| `invalid` | `t3.json` cannot be read or parsed, or breaks the schema; `issues` lists each problem |
| `no-setup` | `t3.json` has no `runOnWorktreeCreate` script |
| `managed` | the setup command is `node .t3/omt-worktree-setup.mjs`; `runner` is `current` (equal to the bundled runner), `different` (outdated or edited), `missing`, `linked` (the runner or `.t3` is a symlink, also one inside the checkout or a dangling one), or `occupied` (`.t3` exists and is not a folder; the check inspects `.t3` before the runner, so it reports this and does not fail) |
| `custom` | any other setup command. omt keeps it and cannot verify that it installs dependencies or uses a global store |

`omt worktree check [--json]` (the default subcommand) prints one line per check, `<STATUS>  <id>  <message>`, then `next: <action>` when there is one. The ids are `checkout` (the root, and whether it is a main checkout or a linked worktree of `<main>`), `manager`, `linker` and `store` (when they apply), `setup`, and `activation`. The statuses are those of `omt doctor`. Problems are `WARN`; nothing in this command is `FAIL`. It exits 0. `--json` prints the `WorktreeReport`. Its `complete` is true when the setup is `managed`, the runner is `current`, and for pnpm the store is `set`. Its `summary` is one `worktree` check: `INFO` when no setup is needed or a custom setup waits for completion, `PASS` when the managed setup is current, waits, and every check passes, else `WARN` with the next action. When the pnpm store is not `set` (and the setup is not custom or not needed), the summary message also holds the store message, so `init`, `install --project`, and `doctor --project` show it after the setup line. The next action names the store step: create the file with `omt worktree setup`, or the manual line to add. `--dry-run` or `--yes` with `check` is a usage error (exit 2), and so is an unknown subcommand.

The check starts no process. It reads no T3 database or settings. `activation` always says: T3 runs a setup script only from the project's saved scripts, not from `t3.json` at worktree creation; commit `t3.json` and `.t3/` (and `pnpm-workspace.yaml` for pnpm) on the branch that new worktrees start from, then import Setup in T3 Project Settings; activation is unverified here.

`omt worktree setup [--dry-run] [--yes]` plans, prints, and asks with the install confirmation flow (section 14.3, steps 3 and 4). `--json` with `setup` is a usage error. The plan:

- No `.git` at or above `cwd`: exit 1. The root is the home directory: exit 2. The check compares the real paths of the root and the home directory, so a symlinked alias of the home directory is refused too.
- `invalid`: exit 1 with the issues; `no-setup`: exit 1 with a hint that holds the script to add. omt never rewrites an existing `t3.json`, so comments and unknown keys stay.
- `custom`: the plan shows `keep <t3.json>  (custom setup script "<command>")`, prints the setup message and the activation note, and exits 0.
- A `different` runner: exit 1 with a hint to compare and update it by hand, or delete it and run again. omt never replaces it.
- A `linked` runner: exit 1. Node resolves symlinks in a script path, so a runner reached through a symlinked `.t3` or runner file computes its checkout root from the link target and installs in another folder. The hint says to replace the link with a real folder and file.
- An `occupied` runner: exit 1 with `<.t3> exists and is not a folder` and a hint to move it away. Nothing is written, also with `--dry-run`.
- Otherwise `t3.json` is `create` (with no `t3.json`) or `keep` (`managed`), and the runner is `create` (absent) or `unchanged` (current). A missing runner is created also when a hand-edited `t3.json` runs the managed command, because that write changes no existing file.
- For pnpm, `pnpm-workspace.yaml` is a third step: `create` for `no-file` (with the reason `keeps the global virtual store after pnpm run and pnpm exec`), `unchanged` for `set`, and `keep  (omt never changes an existing file)` for `missing`, `off`, or `unverified`. The last case makes the plan incomplete: the command prints `Setup is incomplete: <store message>; <action>` and the other steps still apply.
- When the plan creates a file and a blocker exists (no checkout, the home directory, a blocked manager, or an incompatible or unverified linker), exit 1 with the blockers. Preflight, before any write: for every new file, each folder between the checkout root and the file is absent or a real folder. A symlink there, also a dangling one or one that stays inside the checkout, or a non-folder, exits 1. The new file's own path must be free. A refusal leaves every file unchanged.
- With no `create`, it prints `Everything is up to date.` and the activation note, and exits 0. When the plan is incomplete, it prints the `Setup is incomplete` line instead of `Everything is up to date.`, then the activation note, and exits 1. A custom setup prints its setup message instead. `--dry-run` prints the `Setup is incomplete` line when it applies, then `Dry run: nothing was written.`, and exits 0. This includes a plan with no `create` that is incomplete: the dry run prints the plan, the `Setup is incomplete` line, the activation note, and the dry-run line, and exits 0. A complete plan with no `create` prints `Everything is up to date.` with or without `--dry-run`.
- Apply: first the whole preflight runs again, because a folder can become a symlink after the plan. Then each file is written atomically (section 1), each after another check of its folders and that its path is still free. It prints `created  <path>` per file, the `Setup is incomplete` line when it applies, and the numbered next steps: when incomplete, first make the `pnpm-workspace.yaml` change; commit `t3.json`, the runner, and for pnpm `pnpm-workspace.yaml` on the branch that new worktrees start from; import Setup in T3 Project Settings while keeping inherited scripts; and run `omt worktree check` in a new worktree. It exits 1 when the plan is incomplete, else 0.

The generated `t3.json`:

```json
{
  "$schema": "https://t3.codes/schema/t3.json",
  "scripts": [
    {
      "name": "Setup",
      "command": "node .t3/omt-worktree-setup.mjs",
      "icon": "configure",
      "runOnWorktreeCreate": true,
      "async": false
    }
  ]
}
```

The runner. T3 starts it in the new worktree. It works on the checkout two levels above its own file, not on the caller's cwd, and detects the manager again on each run, so an intentional manager switch never runs a stale choice. Node gives the runner its real path, so when the real path of the folder two levels above `process.argv[1]` differs from that checkout (a symlinked `.t3` or runner), it exits 1 before any step and installs nothing:

1. `detectManager`. `none` prints `nothing to do` and exits 0. A blocked result exits 1 with its action.
2. `checkLinker` with the process environment and home directory. `incompatible` or `unverified` exits 1. For pnpm, `persistentGlobalStore` with the exact declared version too: any status but `set` or `version-dependent` exits 1 with `nothing was installed` and the action, before the probe.
3. Layout. When `node_modules` holds entries and its layout needs a conversion, it exits 1 and asks the user to review and remove that checkout's `node_modules`. For pnpm: no `node_modules/.modules.yaml`, a `nodeLinker` other than `isolated`, or a `virtualStoreDir` inside `node_modules`. For Bun: no `node_modules/.bun`. It never purges `node_modules`, never sets `CI` to skip a prompt, and never waits for input.
4. Environment for every child: `COREPACK_ENABLE_NETWORK=0`, `npm_config_manage_package_manager_versions=false`, `npm_config_package_manager_strict_version=true`, and `pnpm_config_pm_on_fail=error`, so neither Corepack nor pnpm downloads or switches a version. A shim outside these tools can have its own policy.
5. Probe: `<manager> --version` in the checkout, stdin closed, a 60-second limit. A launch failure or a non-zero exit stops with the output. The version must be at least the minimum, and equal to an exact declared version. The runner never installs or upgrades a tool.
6. pnpm only: `pnpm config get node-linker`, with the probe's limits. A launch failure, a timeout, or a non-zero exit stops with its output, because the effective linker is then unknown. A value other than empty, `undefined`, or `isolated` stops. Then `persistentGlobalStore` with the installed version: any status but `set` exits 1 with `nothing was installed` and the action. With `CI` set and pnpm below 11.23.0, a warning says that this pnpm can turn off the global store in CI.
7. Install, with stdin closed and stdout and stderr inherited, so pnpm refuses a purge that needs a terminal:
   - Bun: `BUN_INSTALL_GLOBAL_STORE=1 bun install --linker isolated --frozen-lockfile`.
   - pnpm: `pnpm install --frozen-lockfile --config.node-linker=isolated`, plus `--config.virtual-store-type=global` from 11.23.0 or `--config.enable-global-virtual-store=true` below it, plus `--pm-on-fail=error` from 11.0.0 or `--config.manage-package-manager-versions=false --config.package-manager-strict-version=true` below it.
8. A launch error or a signal exits 1. A non-zero install exit returns that code. Success prints `dependencies installed`.

The runner sets no global configuration and no store or cache path, so the user's store and cache settings apply. Package managers may keep patched, trusted, or local packages out of the global store. On Windows, a `.exe` on `PATH` runs directly, and a `.cmd` or `.bat` shim runs through `%ComSpec% /d /s /c` with `windowsVerbatimArguments`. The arguments are fixed strings from the runner, never text from `package.json`, and a path or argument with a quote, `%`, `!`, `^`, or a line break is refused. `launchSpec(name, args, { platform, env, exists })` and `installCommand(manager, version)` are exported for tests.

## 6. Config

### 6.1 Files and layering

The merged config is built from three layers, in this order:

1. The built-in defaults (`src/config/defaults.ts`).
2. The user config: `userConfigPath()`.
3. The project config: `projectConfigPath(findProjectRoot(cwd))`.

A missing file is not an error. Each file is JSONC (section 7). Profile selection applies after these layers (section 6.7).

### 6.2 Layer validation

`validateLayer(value, source)` returns `{ layer: ConfigLayer, issues: ConfigIssue[] }`. It prunes invalid parts and keeps valid ones.

- The root must be an object. Allowed keys: `$schema` (string, ignored), `version` (must equal 1), `profile` (name), `profiles` (object), `models` (object), `roles` (object), `limits` (object), and `visuals` (object). An unknown key is an error, and the key is dropped.
- A role name matches `^[a-z][a-z0-9-]{0,31}$`. A role value is `null` (remove the role) or an object.
- Allowed role keys and values:
  - `description`: a non-empty string of at most 300 characters.
  - `access`: `read-only` or `edit`.
  - `result`: `work`, `review`, `test`, `research`, `plan`, or `guardrail`.
  - `t3Role`: `implementation`, `research`, `review`, `design`, `test`, or `general`.
  - `interactionMode`: `inherit`, `default`, or `plan`.
  - `runtimeMode`: `inherit`, `approval-required`, `auto-accept-edits`, `auto`, or `full-access`.
  - `crossFamily` and `fast`: booleans. Any other value is an error with the message `must be a boolean, got <value>`.
  - `chain`: an array of 1 to 10 rungs.
- A role object with any invalid key or value is dropped as a whole, with one issue per problem.
- Allowed rung keys:
  - `provider` and `driver`: strings that match `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`. A rung needs at least one of them.
  - `model`: a non-empty string of at most 200 characters. It is required.
  - `effort`: a value from the effort ladder.
  - `fast`: a boolean.
  - `options`: an object whose values are strings or booleans.
- Allowed limit keys and integer ranges: `maxParallel` 1 to 32, `maxTasksPerRun` 1 to 500, `maxDepth` 0 to 3, `maxReviewRounds` 1 to 10. An invalid limit is dropped with an error.
- `visuals` must be an object, else it is an error and the whole key is dropped. Its only key is `plan`, a boolean. An unknown key or a non-boolean value is an error, and only that key is dropped.
- `profile` and each profile name match the role-name pattern. A profile value is `null` or an object. Allowed fields are `description`, `extends`, `workflow`, `limits`, `roles`, and `models`. `visuals` is not a profile field.
- Profile `description` is a non-empty string of at most 300 Unicode code points. An invalid description drops the whole profile override. Other invalid profile fields are dropped individually. `extends` matches the profile-name pattern.
- Profile `roles` and `limits` use the root validation rules. Each workflow group and key follows section 6.7. An unknown group, key, or value is an error. Valid fields remain. `plan.testLayers` can be empty and can contain only `e2e`, `integration`, and `unit`.
- A model id is a non-empty string of at most 200 Unicode code points. Each `models.<id>` value is an object with only an optional boolean `fast`. Invalid model fields are dropped individually.
- Role descriptions and rung model ids use the same code-point limits as profile descriptions and model ids.
- A `roles.test` key, at root or inside a profile, warns: `role "test" was split into "verify" and "qa"; rename it`. It remains a custom role with no special behavior. A partial legacy override can fail the new-role requirements in section 6.3.

### 6.3 Merging

`mergeLayer(base: OmtConfig, layer: ConfigLayer, source: string)` returns `{ config, issues }`.

- A role set to `null` is removed. A `null` for a role that does not exist is a warning.
- A role that exists in `base` is merged field by field. `chain` replaces the old chain as a whole. `crossFamily` and `fast` are fields like the others, so a layer can set or override either one.
- A new role must have `description`, `access`, and `chain` after the merge. Otherwise it is dropped with an error. Missing fields get these values:
  - `result`: `work` for `edit` access, `research` for `read-only` access.
  - `t3Role`: `implementation` for `edit`, `research` for `read-only`.
  - `interactionMode`: `default` for `edit`, `plan` for `read-only`.
  - `runtimeMode`: `inherit`.
  - `crossFamily` stays unset, which counts as `false`. `fast` stays unset, so model settings can apply.
- Each limit field replaces the old value.
- Each `visuals` field replaces the old value.
- `profile` replaces the selected name. `models` merges per model and field.
- Profiles merge per name. An existing profile keeps fields that a layer omits. `workflow` merges per group and key, `limits` per key, `roles` per role and field, and `models` per model and field. Arrays, including `chain` and `testLayers`, replace the old array.
- A new profile needs `description`. `null` removes a custom profile, with a warning when it does not exist. Removing `normal`, `prototype`, or `pr-review` is an error.

`loadConfig({ cwd, env, homedir })` reads, parses, validates, and merges the layers. It returns a `LoadedConfig`. After all layers merge, `validateMergedProfiles` checks the selected name and every inheritance chain. A project profile can extend a user profile. Unknown parents, cycles, and chains longer than eight profiles are errors that name the chain. Issues name the last source of the profile, or the selection source for an unknown root `profile`. This pass leaves the merged profiles intact. A JSONC syntax error in a file becomes one error issue, and that file is skipped. Only unexpected I/O errors throw.

### 6.4 Defaults

Every default rung sets `driver` and also sets `provider` to the same value (`claudeAgent` or `codex`). These are the ids of the T3 built-in provider instances. So an unverified default target names `providerInstanceId`, and a verified one still checks the instance. Observed T3 behavior is the reason. T3 checks a named provider instance again before it refuses it, but it picks a `driverKind`-only target from a cached provider snapshot, and that snapshot can be stale, for example when the T3 window is in the background. With capabilities, a default rung whose instance is not registered runs on an instance of its driver (section 8.3). Without capabilities, a user whose provider instance ids differ from the driver kinds overrides the chains in a config layer.

For a role without `crossFamily`, rung 2 runs only when T3 refuses rung 1. For a cross-family role, `--against` can put rung 2 first (section 8.3).

`design` and `ui` have one rung each, on Opus, and no fallback. The owner rules that OpenAI models do not design, implement designs, or review designs (`docs/design.md`).

| Role | Access | Result | t3Role | Mode | crossFamily | Chain (driver/model effort) |
| --- | --- | --- | --- | --- | --- | --- |
| `explore` | read-only | research | research | plan | false | codex/gpt-6-luna low, claudeAgent/claude-sonnet-5-5 low |
| `research` | read-only | research | research | plan | false | codex/gpt-6.1-sol low, claudeAgent/claude-opus-5-5 low |
| `plan` | edit | plan | design | default | false | claudeAgent/claude-opus-5-5 xhigh, codex/gpt-6-astra xhigh |
| `plan-review` | read-only | review | review | plan | true | codex/gpt-6-astra high, claudeAgent/claude-opus-5-5 high |
| `execute` | edit | work | implementation | default | false | claudeAgent/claude-opus-5-5 medium, codex/gpt-6.1-sol xhigh |
| `quick` | edit | work | implementation | default | false | codex/gpt-6-luna high, claudeAgent/claude-sonnet-5-5 low |
| `deep` | edit | work | implementation | default | false | claudeAgent/claude-opus-5-5 max, codex/gpt-6-astra xhigh |
| `review` | read-only | review | review | plan | true | codex/gpt-6-astra high, claudeAgent/claude-opus-5-5 high |
| `oracle` | read-only | review | review | plan | true | codex/gpt-6-astra high, claudeAgent/claude-opus-5-5 high |
| `verify` | edit | test | test | default | false | claudeAgent/claude-haiku-5-5 medium, claudeAgent/claude-sonnet-5-5 low, codex/gpt-6.1-sol low |
| `qa` | edit | test | test | default | false | codex/gpt-6.1-sol medium, claudeAgent/claude-sonnet-5-5 medium |
| `guardrail` | read-only | guardrail | review | plan | false | claudeAgent/claude-opus-5-5 high, codex/gpt-6-astra high |
| `writing` | edit | work | implementation | default | false | claudeAgent/claude-opus-5-5 high, codex/gpt-6-astra medium |
| `design` | edit | work | design | default | false | claudeAgent/claude-opus-5-5 high |
| `ui` | edit | work | implementation | default | false | claudeAgent/claude-opus-5-5 medium |

Every default role has `runtimeMode: "inherit"` and an explicit `crossFamily`. Without `--against`, the cross-family roles start on codex, which fits the default worker (`execute` on claudeAgent).

Role descriptions (shown to agents in `omt roles` and in skills):

- `explore`: Search this repository and answer one narrow question with file and line citations.
- `research`: Answer a question from docs, the web, and code, with cited sources.
- `plan`: Turn a goal into a plan file whose units have a scope, a done condition, and a verify command.
- `plan-review`: Check a plan for gaps, ambiguity, and steps that cannot be verified.
- `execute`: Implement one planned unit inside its scope and run its verify commands.
- `quick`: Make a small, mechanical change, such as a rename, a typo, or a one-file edit.
- `deep`: Solve a hard or cross-cutting problem that needs investigation before the change.
- `review`: Review a diff against its brief and report findings by severity. Runs on the family that did not make the change when the worker is known.
- `oracle`: Attack the finished change from the family other than the main implementer's before it counts as done.
- `verify`: Drive the Simulator, a device, a browser, or a computer, and run the unit's checks; return a verdict with logs and screenshots.
- `qa`: Write the tests that the plan lists for the unit, e2e first, and make them pass.
- `guardrail`: Turn review findings into deterministic checks and rule fixes, so that the next change cannot repeat them.
- `writing`: Write or edit documentation and other prose.
- `design`: Design screens and flows in Paper, and write a design spec that UI units cite.
- `ui`: Implement one UI unit from its design spec, inside its scope.

Default limits: `maxParallel` 6, `maxTasksPerRun` 24, `maxDepth` 1, `maxReviewRounds` 4.

Default profile: `normal`. Default models: `{ "gpt-6.1-sol": { "fast": true } }`. No default role or rung sets `fast`.

Default visuals: `plan` is `true`. omt-plan then shows a final plan as a page in the T3 thread (section 15.2). With `false`, omt-plan writes the plan summary in its reply instead.

### 6.5 Starter files

`src/config/starter.ts` exports two strings. `omt config init` and `omt install` write the user starter. `omt init` writes the project starter. Both are sparse. They hold `$schema`, `version`, empty `roles` and `limits` objects, and comments with one example override, a commented `"profile": "prototype"` line, a commented `"visuals": { "plan": false }` line, and a pointer to `omt config show --defaults`. The `$schema` URL is `https://raw.githubusercontent.com/gabimoncha/oh-my-t3code/main/schema/omt.schema.json`.

### 6.6 JSON Schema

`src/config/schema.ts` exports the JSON Schema (draft 2020-12) for a config file as a plain object. `scripts/build-schema.ts` writes it to `schema/omt.schema.json` with 2-space indentation and a final newline. A test fails when the committed file differs from the generated output. Another test checks that the schema allows exactly the keys that `validateLayer` allows. Role and rung definitions include boolean `fast`. The role definition also includes boolean `crossFamily`. The schema defines `profile`, `profiles`, `models`, and all workflow groups. Preset profile values cannot be null. New-profile descriptions and inheritance chains need the runtime merge checks. `visuals` is an object with `additionalProperties: false` and a boolean `plan`.

### 6.7 Profiles and workflow

`src/profile/resolve.ts` selects a profile and applies its inheritance chain. Selection uses this order, highest first:

1. A command's explicit name or `--profile <name>`.
2. The plan header's `profile=<name>`.
3. The project config's `profile`.
4. The user config's `profile`.
5. `normal`.

`resolveProfile(config, name)` starts from the merged config. It walks `extends`, then applies the chain from parent to child. A profile without `extends` inherits `normal`, except `normal` itself. Each profile applies its roles, limits, and models through `mergeLayer`. Workflow values start from the built-in normal workflow and merge per group and key. Profile overrides therefore apply after root config overrides. The function does not mutate the input.

`effectiveConfig(loaded, { profile?, planProfile? })` returns the loaded fields plus the resolved `profile`. Its `config` has the selected name and the profile-applied `roles`, `limits`, and `models`. The resolved `profile` contains the full `workflow` and its merge issues. `omt config show` returns the layers before this application. `omt profile show` returns the resolved values.

The following keys are under `profiles.<name>.workflow`. The table shows the resolved preset values. `normal` defines the full workflow. `prototype` and `pr-review` extend `normal` with sparse overrides.

| Key | Allowed values | `normal` | `prototype` | `pr-review` |
| --- | --- | --- | --- | --- |
| `plan.review` | `two-families`, `one`, `owner` | `two-families` | `one` | `two-families` |
| `plan.testLayers` | array of `e2e`, `integration`, `unit` | `["e2e"]` | `["e2e"]` | `["e2e"]` |
| `design.variants` | integer 1 to 5 | 3 | 1 | 3 |
| `build.review` | `every-round`, `first-round`, `off` | `every-round` | `first-round` | `every-round` |
| `build.verify` | `heavy`, `every-unit` | `heavy` | `every-unit` | `heavy` |
| `build.qa` | `planned`, `off` | `planned` | `planned` | `planned` |
| `build.failureProofs` | `on`, `off` | `on` | `off` | `on` |
| `build.oracle` | `heavy`, `always`, `off` | `heavy` | `off` | `heavy` |
| `build.checkpoint` | `none`, `layer`, `unit` | `none` | `layer` | `none` |
| `build.stallMinutes` | integer 10 to 120 | 30 | 30 | 30 |
| `review.reviewers` | `auto` or integer 1 to 4 | `auto` | 1 | `auto` |
| `review.families` | `one`, `both` | `one` | `one` | `one` |
| `review.oracle` | `on`, `off` | `on` | `off` | `on` |
| `review.fixLoop` | `offer`, `off` | `offer` | `offer` | `offer` |
| `review.ci` | `off`, `check`, `fix` | `check` | `off` | `fix` |
| `review.verify` | `off`, `changed-flows` | `off` | `off` | `changed-flows` |
| `review.tests` | `off`, `offer` | `off` | `off` | `offer` |
| `review.guardrails` | `off`, `propose` | `off` | `off` | `propose` |
| `review.crap` | `off`, `report` | `off` | `off` | `report` |

`prototype` also sets `limits.maxReviewRounds` to 2. `normal` and `pr-review` set no limits, roles, or models. Profiles cannot set `visuals`.

The skills apply these switches at the steps in section 15. They reload the profile on wake and after an owner switch. `omt plan profile <slug> <name>` changes the remaining work of a running plan. It does not change completed tasks.

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

`resolveRole(name, role, caps?, options?)` walks the chain and builds one `RungAttempt` per rung. `options` is `{ models?: Record<string, ModelConfig>; against?: string; notes?: string[]; drivers?: Map<string, string> }`. `notes` are role-level notes that go first, such as the `--against auto` note (section 5.3). `drivers` maps a provider instance id to a driver kind for the family rule below. The command layer passes `configuredDrivers(config.roles)` and the effective `config.models`.

With capabilities, first check the parent's mode ceilings. T3 lets a child keep or narrow the parent's modes, never widen them.

- When `caps.interactionMode` is `plan`, a role with `access: "edit"` or `interactionMode: "default"` is `unavailable` with the reason `the parent thread is in plan mode; this role needs default mode`.
- Runtime modes rank `approval-required` < `auto-accept-edits` < `auto` < `full-access`. When the role's `runtimeMode` is not `inherit` and ranks above `caps.runtimeMode`, the role is `unavailable` with the reason `role runtime mode <x> is broader than the parent's <y>`.
- A mode-ceiling failure gives every rung the same reason.

Then walk the rungs:

1. Find the provider. With `rung.provider`, it is the provider whose `providerInstanceId` equals it. When the rung also has `driver` and the kinds differ, the rung fails with `provider instance <id> has driver <kind>, not <driver>`. With only `rung.driver`, pick in this order: the provider named by `caps.inheritedProviderInstanceId` when its `driverKind` matches and it can run child tasks (this is what T3 itself picks), then the first provider of that kind that can run child tasks, then the first provider of that kind. When no provider has the id `rung.provider` and the rung also has `driver`, pick by the driver with the same rule, and add the note `provider instance <id> is not registered; using instance <picked id> of driver <driver>`. So a default rung still runs when the T3 instance ids differ from the driver kinds.
2. Fail when no provider is found. A rung with only `provider` fails with `provider instance <id> is not registered in T3`. A rung with `provider` and `driver` fails with `provider instance <id> is not registered in T3; no provider instance with driver <driver>`. A rung with only `driver` fails with `no provider instance with driver <driver>`.
3. Fail when `canRunChildTask` is false: `provider <id> cannot run child tasks: <constraints joined with "; ">`. Use `no reason given` when the list is empty.
4. Fail when the provider lists models and none has `id === rung.model`: `model <model> is not advertised by <id>`. A provider with an empty model list accepts any model. Effort then goes through the driver table (section 8.2), and the rung gets the note `provider <id> lists no models; T3 will check the model and its options`.
5. Build options. Apply `mapEffort` with the model's descriptors when `rung.effort` is set. Apply fast mode (section 8.4), then copy `rung.options` over the result.
6. Validate options when the model has descriptors. Every id must match a descriptor. A `boolean` descriptor needs a boolean value. A `select` descriptor needs one of its choice ids. On failure the reason is `invalid options: <problem>; <problem>`. When the model has no descriptors and options are present, keep them and add the note `the model advertises no options; T3 will not check them`.
7. The target is `{ providerInstanceId, model, options }`. Omit `options` when it is empty.

Cross-family order. The pure functions live in `src/routing/family.ts`.

- `configuredDrivers(roles)` maps each provider instance id that a configured rung names together with a `driver` to that driver. It reads the rungs of every role in the effective config, and the first such rung wins.
- `rungFamily(rung, caps?, drivers?)` gives the family of a rung, in this order. With capabilities, when a provider has the `providerInstanceId` `rung.provider`, the family is that provider's `driverKind`. Otherwise it is `rung.driver` when set. Otherwise it is `drivers.get(rung.provider)` when that is set, else `rung.provider`. Families are compared as strings.
- `workerFamily(against, caps?, drivers?)` gives the worker family. It is the `rungFamily` of a rung that names only the provider `against`. The worker and the rungs use the same rule and the same `drivers`, so a provider instance id gets the same family on both sides of the comparison. A driver kind that is not a provider instance id stays as it is.
- The family is the driver, not the model vendor. This is a known limit. A driver that runs models of more than one vendor (`cursor`, `opencode`) counts as its own family.
- When `options.against` is set and the role has `crossFamily: true`, the chain is reordered before the walk, as a stable partition (`crossFamilyOrder`). The rungs whose family differs from the worker family come first, in configured order. The rungs of the worker family come after them, in configured order. When the order changed, the note is `cross-family: worker family <family>; other families first`. When it did not change, the note is `cross-family: worker family <family>; the configured order applies`.
- When no rung of the chain is in the worker family, the order does not change, no other cross-family note is added, and the note is `cross-family: no rung is in family <family>; check that --against names a driver or a configured provider, or pass --capabilities`.
- After the walk, when the first ok rung is in the worker family, the note is `cross-family: no rung outside family <family> is available; the same family reviews`.
- When `options.against` is set and the role does not have `crossFamily: true`, the order does not change, and the note is `role <name> is not cross-family; --against has no effect`.
- Without `options.against`, the configured order applies.
- `RungAttempt.index` keeps the configured position, so every `rung <n>` label uses the configured rung number. `attempts` and `fallbacks` are in the order tried.

`pickWorker(entries, roles, plan, unit?, warn?)` returns `{ provider, from: "unit" | "plan" }` or `undefined`, with the rules of section 5.3. `warn` gets one message for each worker entry whose `provider` is set but is not a non-empty string. The command layer reads the ledger file, passes the entries, and prints each message as a `warning:` line on stderr.

Without capabilities, every rung is ok. The target uses `providerInstanceId: rung.provider` when present, else `driverKind: rung.driver`. The default rungs set `provider`, so they give `providerInstanceId` targets (section 6.4). Effort goes through the driver table, using `rung.driver`, or `rung.provider` when no driver is given.

Status:

- `resolved`: capabilities were given and at least one rung is ok.
- `unverified`: no capabilities were given.
- `unavailable`: no rung is ok. This holds without capabilities too, for example for a rung that names no provider or driver.

`delegateTask` uses the first ok rung's target plus the role's `t3Role`, `interactionMode`, and `runtimeMode`. `fallbacks` holds the targets of the later ok rungs. `RoleResolution.crossFamily` copies the role's flag (`false` when unset). `RoleResolution.notes` holds the role-level notes, and is absent when there are none. `toRouteOutput` puts them before the rung notes.

`resolveAll(config, caps?, only?)` returns a `RolesReport`. It keeps the order of `only` and drops duplicates. An unknown name in `only` throws `OmtError` with code `unknown_role`.

### 8.4 Fast mode

For each rung, the first defined value wins: `rung.fast`, `roles.<role>.fast`, `models.<model id>.fast`, then `false`. Explicit `false` stops inheritance. It adds no fast option, so the provider default applies. A raw option in `rung.options` still applies.

With `fast: true` and known capabilities:

1. A `serviceTier` select that offers `priority` gives `serviceTier: "priority"`.
2. Otherwise, a boolean `fastMode` gives `fastMode: true`.
3. Otherwise, add no fast option and the note `fast mode is not offered by <provider>/<model>`.

Known capabilities with no model descriptors never infer a fast option. Without capabilities, driver `codex` gives `serviceTier: "priority"`. Driver `claudeAgent` with a model id that starts with `claude-opus` gives `fastMode: true`. Other targets get the same unsupported note and no fast option. Unverified routing uses `rung.driver`, or `rung.provider` when no driver is set.

Effort mapping applies first, fast mapping second, and explicit `rung.options` last. The chosen target and each fallback keep their mapped options. An unsupported fast option does not make the rung unavailable.

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
- <children line, only when the child may start children>
- CLI: Run omt as <command>.
- Tests: <role policy; qa ends with failureProofs: on or failureProofs: off>
- You do not see the parent conversation. This brief is your full context. If you need something that is missing, say so in your final message.
- Other agents may edit other files in this repository at the same time. Leave changes outside your scope alone. Do not commit, push, or create branches.
- Processes: do not run `pkill`, `killall`, or another kill by name, because it can stop your own run. Stop only a process that you started, by its PID. Give each command that can run long a time limit, for example `timeout 900 <command>`. Close each device or browser session that you or your script opens on every exit path, for example `trap '<close command>' EXIT`.
- Shared files: never break and restore files in the shared checkout, for example to prove that a test can fail. The qa role makes that proof in a private copy.
- Shared builds: <lock and retry rule>
- <device line, for every role except `verify`>

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

- When `depth >= maxDepth`, for role `verify` and for roles whose `interactionMode` is `plan`: `Delegation: you are at depth <d> of <max>. Do all work yourself. Start no subagents and no delegated tasks.`
- When `depth >= maxDepth`, for every other role: `Delegation: you are at depth <d> of <max>. Do all work yourself. Start no subagents and no delegated tasks, except `verify` tasks for device checks (see Devices).` With a plan or an explicit profile, append `For device checks, pass <selection> to omt brief.` The device line (section 15.2) gives the command for those `verify` children.
- Otherwise, with a plan or an explicit profile: `Delegation: you are at depth <d> of <max>. You may delegate with the T3 delegate_task tool. For each child, pass <selection> --depth <d+1>[ --max-depth <max>] to omt brief.` Here `<selection>` contains `--plan <slug>` when set and `--profile <name>` when explicit. Keep both flags when both were given. Include `--max-depth <max>` only when the max differs from `limits.maxDepth` in the effective config.
- Otherwise, without a plan or an explicit profile, when `<max>` equals `limits.maxDepth` from the effective config: `Delegation: you are at depth <d> of <max>. You may delegate with the T3 delegate_task tool. Give each child depth <d+1> in its brief.`
- Otherwise, without a plan or an explicit profile (`--max-depth` changed the max): `Delegation: you are at depth <d> of <max>. You may delegate with the T3 delegate_task tool. Give each child depth <d+1>, and pass --max-depth <max> to omt brief.`

Evidence line, added after the delegation line when the role's `access` is `edit`:

- `Evidence: save command output and logs under <absolute project root>/.omt/evidence/.`

Plan-mode line, added after the delegation line when the role's `interactionMode` is `plan`:

- `Mode: you run in plan mode. Stay in it. Do not call ExitPlanMode and do not write a proposed plan. Put the result block in your final assistant message.`

T3 stores a proposed plan as its own item type, and `task_status.summary` reads only assistant messages. Without this line, a plan-mode child can return its result where the parent's summary does not show it.

Children line, added after the evidence and plan-mode lines, before the CLI line, unless `depth >= maxDepth` and the role is `verify` or its `interactionMode` is `plan`:

- ``Children: after you read a child's result, settle the child with the T3 `t3_thread_organize` tool, with `action: "settle"` and the child's `childThreadId`, never the `taskId`. Skip a child that still runs or waits for an answer. Settle nothing when `git rev-parse --git-dir --git-common-dir` prints two different paths, because then you work in a git worktree. A settle error is not a failure of your task.``

Every brief has these constraint lines:

- `CLI:` names `<project root>/.omt/bin/omt` when that path exists, else `omt`. The saved dispatch command uses the same shell-quoted command.
- `Tests:` for `execute`, `quick`, `deep`, `ui`, and `writing` forbids new test files, new test cases, and failure proofs. It permits an existing-test update only when the change breaks that test, with a note under `NOTES`.
- `Tests:` for `qa` permits only the task's test lines, top-down. It ends with `failureProofs: on` or `failureProofs: off` from the selected profile's `build.failureProofs`.
- `Tests:` for `review` and `oracle` makes a missing test a finding only when the plan or task names that test. Other roles get `Tests: write no tests.`
- `Shared builds:` requires the exact lock-wrapped command from the task. Retry a failed build or test only when the file is outside your scope and outside the task's named code under test. The file is the one where the error occurs, such as a file with a compile or load error, also when a test in your scope loads it. Wait 60 seconds and run the command once more. When it fails there again, report the command, the outside-scope file, and the message as another unit's state. For a failure in your scope or the named code under test, follow your result block. For `test` results, return `VERDICT: NOT VERIFIED` for that failure. When `omt lock run` exits 75, report the command, the lock name, and its message. Leave the lock to the conductor. For both reports: in `work` results, keep the `STATUS` that your own work earns and put the report under `OPEN`. For `test` results, including `verify` and `qa`, return `VERDICT: INCONCLUSIVE` and put the report under `FAILURES`. For other results, put the report under `NOTES`, or before the result block when it has no `NOTES`.

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
NOTES:
- <existing test updated because the change broke it, or other note; optional>
EVIDENCE:
- <path of a log, screenshot, or recording in the evidence directory>; or none
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
TESTS:
- <new test name and file path; optional for verify>
FAILURES:
- <test or scenario>: observed <x>, expected <y>; or none
EVIDENCE:
- <path of a log, screenshot, or recording in the evidence directory>; or none
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

`guardrail.md`:

```text
VERDICT: PROPOSALS | NONE
SUMMARY: <one or two sentences>
PROPOSALS:
- G<k> [check|rule-fix|new-rule] <finding ids>: <proposal>. Where: <file>. Proof: <command that fails on the PR head and passes after the change, or none>.
NOTES:
- <each finding with no proposal and why, or none>
```

`qa` lists every new test under `TESTS`. `verify` can omit that section and names each checked flow's covering test file, or `none`, under `CHECKS`. Worker `NOTES` are optional. A review or oracle finding needs a concrete failure scenario. When CRAP is requested, a CRAP finding instead names the changed function and its complexity, coverage, and CRAP values. This exception applies in every round.

Severity meanings for review findings: P0 breaks the build, loses data, or opens a security hole. P1 is a wrong result in a normal path. P2 is a wrong result in an edge case, a named missing test, or a requested CRAP finding above 30. P3 is style or clarity.

## 12. Plans

### 12.1 Template

`omt plan new <slug> --title <title>` writes (title defaults to the slug):

```markdown
# <title>

<!-- omt-plan v1 slug=<slug> created=<ISO timestamp> -->

## Summary

<at most 15 lines for the owner: what changes for them, the work and its task budget, the main risk, the open decisions, and what is not in this plan>

## Objective

<what changes for the user, in one paragraph>

## Done when

- [ ] D1. <a check that can fail: a command, a test, or an observable result>

## Research

<research questions, their cited answers, and sources; or "none">

## Roles

<paste the output of `omt roles` here>

## Tests

An empty section means no new tests.

- <layer> <unit>: <flow or case>. File: <path>. Reason: <why>.

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

`--light` leaves out the `F2` line. The `## Summary`, `## Research`, and `## Tests` sections are in both forms. `--max-parallel <n>` adds ` max-parallel=<n>` before the `-->` of the header comment. `--max-tasks <n>` adds ` max-tasks=<n>` after it. `--profile <name>` adds ` profile=<name>` after the limit keys. `omt plan mark` appends its log lines after the last line.

### 12.2 Grammar and status

Checkbox lines start at column zero and match `^- \[( |x|X|~)\] (U|D|F)(\d+)\. (.*)$`. A space means open, `x` or `X` means done, and `~` means blocked.

The header comment is the first line of the file that is only an `<!-- omt-plan v1 ... -->` comment; the template writes it as line 3. The parser reads `slug`, `profile`, `max-parallel`, and `max-tasks` only from this header, so an example header that the body quotes later does not change them. The header comment `<!-- omt-plan v1 slug=<slug> created=<ISO timestamp> -->` can have an optional `max-parallel=<n>` key. `<n>` is an integer from 1 to 32, the same range as `limits.maxParallel`. It can also have an optional `max-tasks=<n>` key, the task budget of the plan. This `<n>` is an integer from 1 to 500, the same range as `limits.maxTasksPerRun`. The parser ignores a missing or invalid numeric limit. It returns the `profile` text without validation. Commands resolve that name against config. The parser does not read the `## Research` or `## Tests` section.

`parsePlan(markdown)` returns:

```ts
interface PlanItem { kind: "U" | "D" | "F"; id: string; title: string; state: "open" | "done" | "blocked"; line: number } // id is kind plus number, for example "U4"; line is 1-based
interface PlanStatus {
  title: string;
  slug?: string;
  profile?: string; // the header profile key; status replaces it with the effective name
  maxParallel?: number; // the header max-parallel key, when it is valid
  maxTasks?: number; // the header max-tasks key, when it is valid
  items: PlanItem[];
  counts: Record<"U" | "D" | "F", { open: number; done: number; blocked: number; total: number }>;
  next?: PlanItem; // the first open U item in file order
  ready: PlanItem[]; // the open U items, in file order, whose dependencies are all done
  complete: boolean; // every U, D, and F item is done; false for a plan with no items
}
```

Human output of `omt plan status`:

```text
plan: auth-refactor (/home/me/app/.omt/plans/auth-refactor.md)
profile: normal
units: 3/7 done, 1 blocked, 3 open
done-when: 0/2
final: 0/2
next: U4 Add the token refresh endpoint
ready: U4, U6
```

`ready` reads the plan after it blanks every fenced line, so a checkbox inside a code fence is never ready and never satisfies a dependency. The dependencies of a unit are the `\bU\d+\b` tokens in its `Depends on` field (`  - Depends on: ...` under the item). An empty field, a missing field, or `none` means no dependencies. A self reference is ignored. A unit is ready when it is open and every other token names a `U` item of the plan in state `done`. A token that names no unit of the plan keeps the unit out of `ready`. A blocked unit is never ready. A unit id that appears on more than one `U` item is never ready, and a dependency on that id is unresolved. `next` does not check dependencies.

## 13. Claude Code ultrawork hook

`omt hook user-prompt-submit` reads the hook input JSON from stdin and looks at its `prompt` string.

Detection (`detectUltrawork(prompt)`). The start checks in rules 1 to 3 ignore leading whitespace.

1. Return false when the prompt contains `<!-- omt-brief` or starts with `Act as the `. Both mark a delegated child's brief. T3 loads user settings in child sessions too, so without this rule a brief that mentions ultrawork would start a nested loop.
2. Return false when the prompt starts with `/omt-ulw`. The skill is already loading.
3. Return false when the prompt starts with `<task-notification>`. Claude Code sends the result of a background task to the session as a prompt that starts with this tag, and that result holds no user request. The tag later in a prompt does not skip it.
4. Remove fenced code blocks, inline code spans, lines that start with `>`, and text inside double quotes.
5. Match the words `ulw` or `ultrawork`, case-insensitive, with no letter, digit, `_`, `-`, `/`, or `$` directly before or after.
6. Skip a match that is negated. A match is negated when one of the words `no`, `not`, `never`, `without`, `dont`, `don't`, or `don’t` (case-insensitive) comes before it on the same line, with at most two other words between them. The negator is a whole word. It has no letter, digit, or `_` directly before it, so `know` and `cannot` do not negate. A word is a run of letters, digits, `'`, and `’`. Only spaces or tabs separate the negator, the words, and the match, so a comma, a period, a non-breaking space, or a line break ends the window. Return true at the first match that is not negated, so `no ulw here, but ultrawork this` matches. The window is wide on purpose. A missed match costs less than a false one, because the agent can still load omt-ulw from its skill description, but a false match tells it to run the loop against the user's words. The cost is that `don't forget to ulw this` stays silent.

On a match the command prints one line of JSON and exits 0:

```json
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"<pointer>"}}
```

The pointer text is at most 1,000 characters. It says that ultrawork is on for this request, that the agent loads the `omt-ulw` skill before anything else and follows it in order (the banner, then step 0 and step 1), that the full loop runs even for a small task, that children make every product edit, and that done needs evidence from checks that ran.

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
   - For each `create`, `update`, or `replace` copy, build the new directory at `<parent of the agents root>/.omt-tmp-<random>`, write the marker into it, then move it into place. For an existing target, first rename it to `<parent of the agents root>/.omt-old-<random>`, then rename the new directory in, then delete the old one. Temp directories never sit inside a skill root. When the delete of a scratch directory fails, the run stops with an error that names the directory.
   - When a swap fails, delete the temp directory and move the old directory back, so the installed skill stays in place.
   - Create the links, write the starter user config, add the hook, and write the manifest.
6. Print a summary and the next steps: restart agent sessions in T3 so they load the new skills, then try `$omt-ulw <task>`.

With `--project`, right after the plan in step 1, the install prints one line about the current checkout's worktree setup, `Worktree setup: <status> <message>`, from the `summary` of section 5.12. It prints it also with `--dry-run`. The line has no indent, so it is not a plan action. It changes no exit code.

A second run on an unchanged system shows only `unchanged` actions and writes nothing except the manifest timestamp.

### 14.4 Claude hook entry

The hook command is:

```text
"<nodePath>" "<cliPath>" hook user-prompt-submit # oh-my-t3code
```

In project scope, the command calls the shim instead, so one file holds the node and CLI paths:

```text
"<root>/.omt/bin/omt" hook user-prompt-submit # oh-my-t3code
```

The trailing comment is the signature that marks the entry as managed. `--hooks` is refused, with exit 1 and a hint to install the package globally, when `cliPath` is inside a temp directory (`os.tmpdir()`) an npx cache (a path that contains `/_npx/`), or a pnpm dlx cache (a path that contains `/dlx/` under a `pnpm` directory). Such a path can disappear.

The installer edits `claudeSettingsPath()`:

1. A missing file counts as `{}`. A file that is not valid JSON is an error, and the installer changes nothing.
2. Under `hooks.UserPromptSubmit`, add `{ "hooks": [{ "type": "command", "command": "<command>", "timeout": 10 }] }`. When an entry with the signature exists, replace its command instead.
3. Keep every other key and entry unchanged. Serialize an existing file in its own style: detect the indentation from the first indented line (2 spaces, 4 spaces, or a tab), and keep compact JSON compact. The write serializes the whole file in that indentation, so a mixed layout, such as inline arrays in an indented file, becomes fully indented. An empty object such as `{}` shows no style and gets 2-space indentation. Keep a final newline only when the old file had one, and keep CRLF line ends. A new file gets 2-space indentation and a final newline.
4. When the new content equals the old content, write nothing. This is the `unchanged` case.
5. Otherwise back up the old file, with mode 0600, to `<configDir>/backups/<YYYYMMDDHHmmss>/claude-settings.json`, then write. A missing file needs no backup. When this write adds the entry to an existing file (the `create` action), the manifest hook records the backup as `backup`. An `update` backup is not recorded there, because it holds an older omt entry. In project scope an `update` makes no backup when the file is in the layout that omt writes, that is, when serializing the parsed file in its detected style gives its exact bytes. Then the rewrite changes only the command of the omt entry. A file in any other layout gets the backup, so its original bytes stay recoverable. A settings path that is a dangling symlink counts as a missing file, and the write creates the link's target. The new `settings.json` keeps the mode of the old one. When `settings.json` is a symlink, write next to its real path and rename onto the real path, so the symlink stays in place.

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
  "hooks": [{ "kind": "claude-user-prompt-submit", "settingsPath": "<path>", "command": "<command>", "created": true, "backup": "<path>" }],
  "backups": ["<path>"]
}
```

A new install merges into an existing manifest. `created` is present, and true, when an install created the settings file. A later run keeps it. `backup` is the install-time backup of the settings file (section 14.4). A later run keeps the old value when it records none.

### 14.6 Uninstall

`omt uninstall` builds its plan from the manifest and from a scan:

- Remove each link in the Claude and Gemini roots that is a symlink resolving to a managed directory, except a link to a kept skill.
- Remove each managed skill directory in the agents root. In project scope, a skill or link that was in place before the install stays (section 14.8). A locally modified skill (its hash differs from the marker hash) is planned as `keep` with `(locally modified)` and stays in place. With `--force`, it is moved to `<configDir>/backups/<stamp>/agents/<name>` instead.
- Remove each hook entry with the signature, with the same style, backup, and symlink rules as section 14.4. When the manifest says that an install created the settings file, and removing the entry leaves `{}`, delete the file without a backup. When the settings path is a symlink, delete the link's target, which the install created, and keep the link.
- Exact restore: when the manifest hook has a `backup`, and the JSON left after removing the entry deep-equals the parsed backup, write the backup's bytes back exactly and make no new backup. Then delete that backup, and remove its stamp directory and `backups/` when they become empty. Otherwise write the edited JSON in the file's own style, after a new backup.
- Keep the user config unless `--purge` is given. `--purge` also removes the config directory when it is then empty.
- Remove the manifest.

The plan lists the user config and the manifest only when they exist. Two names of one directory or file (a symlink, or `/tmp` and `/private/tmp`) count as one, so the plan lists each skill, link, and settings file once. It never removes a path that is not managed. It leaves the skill roots in place, even when they are empty. A manifest or Claude settings file that is not valid JSON stops the command before any change. The confirmation flow is the same as for install.

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

With `--project`, doctor checks the project scope (section 14.8). It runs `node` and `config` as above, and `skills`, `links`, and `hooks` against the project paths. It replaces `path` and `homes` with these checks, keeps `t3` and `roles`, and adds `worktree` after `t3`. `worktree` checks the checkout of the current directory, which can be a linked worktree, while the other project checks use the main checkout:

| Id | PASS | WARN | FAIL | INFO |
| --- | --- | --- | --- | --- |
| `shim` | `.omt/bin/omt` is present, carries the signature, is executable, and its node and CLI paths exist | the shim is missing or not managed, or its recorded node path does not exist (the shim falls back to `node` on `PATH`) | the shim's CLI path does not exist, or the shim is not executable | |
| `exclude` | the exclude file holds the block of this root | the exclude file has no block for this root, or it holds a block for a root that no longer exists | | no `.git` in the root or a parent directory, or the last install ran with `--no-git-exclude` and there is no block |
| `worktree` | the current checkout's managed setup is current, waits for completion, and every worktree check passes (section 5.12) | setup is missing, invalid, incomplete, blocked, does not wait, or the pnpm store is not `set` (the message then holds the store problem); also a read error | | no setup is needed, or a custom setup waits for completion |

In project scope, every install hint names the running CLI, `node <cliPath> install --project`, because `omt` may not be on `PATH` and the shim may be broken.

The `hooks` check reads the settings paths from the manifest. With no manifest hook, it looks for a signed entry in `claudeSettingsPath()`. The `homes` check reads `providerInstances` from `t3SettingsPath()` and never writes it. It looks at instances whose `driver` is `claudeAgent`, expands a leading `~`, and accepts a link or a managed copy for each skill. The `roles` check is left out without `--capabilities`. The status set is `PASS`, `WARN`, `FAIL`, and `INFO`. `--json` prints `{ "ok": boolean, "checks": [{ "id", "status", "message" }] }`, where `ok` is false when any check fails. The exit code is 1 when any check fails.

### 14.8 Project scope

`--project` installs into one repository, so the owner can try oh-my-t3code there without touching the global skill roots, the global Claude settings, or `PATH`. The project root is `findProjectRoot(cwd)`. `install`, `uninstall`, and `doctor` with `--project` refuse, with exit 2 and a hint, a root that is the home directory, or whose skill roots, `settings.local.json`, or `.omt` are the user-scope agents root, Claude skills root, `claudeSettingsPath()`, or `configDir()`. That happens in the home directory, or below it when the home directory holds `.git` or `.omt`. Project scope reuses the planning, apply, backup, marker, hash, hook, and manifest rules of sections 14.2 to 14.6, with these paths:

| Item | User scope | Project scope |
| --- | --- | --- |
| Skill copies | `~/.agents/skills/<name>` | `<root>/.agents/skills/<name>` |
| Claude links | `<claudeConfigDir>/skills/<name>` | `<root>/.claude/skills/<name>`, relative link `../../.agents/skills/<name>` |
| Gemini links | optional | none |
| Config | `<configDir>/config.jsonc` (user starter) | `<root>/.omt/config.jsonc` (project starter), plus `.omt/plans/` |
| Hook (`--hooks`) | `<claudeConfigDir>/settings.json` | `<root>/.claude/settings.local.json` |
| Backups | `<configDir>/backups/<stamp>/...` | `<root>/.omt/backups/<stamp>/...` |
| Manifest | `<configDir>/install.json` | `<root>/.omt/install.json` |
| CLI shim | none | `<root>/.omt/bin/omt` |
| Git exclude | none | a managed block in the repository's `info/exclude` |

Skills and links that were in place before the install. A repository can track a setup that `--no-git-exclude` wrote, or hold a copy of a skill that the user made. A skill or link counts as existing when the plan finds it in place (`unchanged` or `update`) and no earlier install of this root created it. The manifest lists the existing skill names and link paths as `existing`, and its `skills` and `links` lists name only the skills and links that an install created or replaced. The block does not list an existing path, so git sees it as before the install. The uninstall keeps an existing skill or link with `keep (existed before the install)`, also with `--force`. So a clone of a committed setup can run `install --project` to get the shim, and `uninstall --project` leaves the tracked setup in place. When the install updates an outdated existing skill, git shows its files as modified, and the uninstall keeps the updated copy. Without a manifest, the uninstall cannot know which paths existed, and it removes every managed skill and link.

`--targets` with `gemini` and `--project` is a usage error (exit 2). Antigravity reads `<root>/.agents/skills` directly. The default targets are `agents,claude`.

The shim is `<root>/.omt/bin/omt`, with mode 0755:

```sh
#!/bin/sh
# oh-my-t3code project shim
node="<nodePath>"
[ -x "$node" ] || node=node
exec "$node" "<cliPath>" "$@"
```

The second line is the signature. The shim tries the recorded node first and falls back to `node` on `PATH`, so a Node upgrade does not break it or the project hook. The shim is `create` (absent), `update` (managed, different content), `unchanged`, or `conflict` (a path without the signature). With `--force`, a conflict becomes `replace`, and the old file moves to `<root>/.omt/backups/<stamp>/bin/omt`. `--project` is refused with exit 1 and a hint when `cliPath` is in a temp directory or a package-runner cache, with the check of section 14.4. A node or CLI path that contains `"`, `$`, a backquote, a backslash, or a newline is refused too.

`.omt/.gitignore` holds the lines `ledger.jsonl`, `evidence/`, `bin/`, `install.json`, `backups/`, `plans/`, `locks/`, and `guardrails.md`. When the file is missing, the install creates it with these lines. A dangling symlink at that path is the user's, the same as a dangling settings link: the install leaves it alone, with `keep (a dangling symlink; left alone)`, and never writes its target. With the git exclude step on, the install never edits an existing `.omt/.gitignore`, because the repository may track it. One exception upgrades an unedited file: when the previous manifest lists the file in `project.files` and the file's SHA-256 equals the recorded hash, an earlier install created it and nobody edited it. Then the install appends the missing lines, the plan shows `update` for the file, and the manifest records the new hash. With `--no-git-exclude`, a setup meant to be committed, the install appends the missing lines and never removes a line. The manifest then records the file's old content and the hash of what the install wrote, as `gitignoreRestore`, and the uninstall writes the old content back while the file still has that hash.

The git exclude step is on by default. `--no-git-exclude` turns it off: the install writes no block, removes a block that an earlier install wrote for this root (the plan shows `remove managed block in <file>  (--no-git-exclude)`), and the manifest records `"gitExcludeOff": true`. The installer finds the exclude file without running git:

- Walk up from the root to the nearest directory `<top>` that holds `.git`. `<top>` is the repository top level, which is the root itself or a parent of it (a package in a monorepo).
- When `<top>/.git` is a directory, the file is `<top>/.git/info/exclude`.
- When `<top>/.git` is a file with a `gitdir: <path>` line (a worktree), the git directory is that path, resolved from `<top>`. When the git directory holds a `commondir` file, the common directory is its content, resolved from the git directory; otherwise it is the git directory. The file is `<common dir>/info/exclude`.
- When no `.git` is found, the step is skipped. The plan shows `skip` with the reason, and the install prints a `note:` line.

Each entry is anchored at `<top>`: the root's path relative to `<top>` prefixes it, as in `/pkg/.agents/skills/omt/`. A backslash goes before each `\`, `[`, `]`, `*`, and `?` in that path, and before a trailing space, so git reads the path literally. An entry starts with `/`, so a leading `!` or `#` cannot occur.

Worktrees share one exclude file, so each root has its own block, with the root in both markers. The install replaces the block of its root in place, and every other line of the file stays unchanged. A new block goes at the end of the file:

```text
# >>> oh-my-t3code project install: <root> >>>
/.agents/skills/<name>/
/.claude/skills/<name>
/.agents/.omt-*/
/.omt/bin/
/.omt/install.json
/.omt/backups/
/.omt/config.jsonc
/.omt/.gitignore
/.claude/settings.local.json
# <<< oh-my-t3code project install: <root> <<<
```

The block runs from a BEGIN marker of the root to the next END marker of the root. A BEGIN marker without an END marker after it is no block: the install appends a new block, and no edit ever deletes to the end of the file.

The block always lists each skill copy and each link that the manifest records, except the existing ones, the scratch directories `/.agents/.omt-*/` of section 14.3, then `/.omt/bin/`, `/.omt/install.json`, and `/.omt/backups/`. It also lists each file that an install created: `/.omt/config.jsonc`, `/.omt/.gitignore`, and `/.claude/settings.local.json`. It lists no directory that only holds those entries, such as `/.omt/` or `/.omt/plans/`, because git never shows an empty directory. So a new file in `.omt/` of another worktree shows in git. A plan in `.omt/plans/` does not, because `.omt/.gitignore` holds `plans/`.

So after `install --project`, with or without `--hooks`, `git status --porcelain` shows nothing new. The one exception is a `settings.local.json` that the repository tracks: it shows as modified while the hook is installed. The manifest records what an install created, so a later run keeps the same block.

Git applies the common exclude file to every worktree, with each entry anchored at that worktree's top level. So the block of one worktree also hides the same paths in the other worktrees, such as a `.omt/config.jsonc` that the user creates there. In a repository with worktrees, the plan marks the step `(shared by all worktrees)`. A repository has one project install, in the main checkout. Because `findProjectRoot` resolves a linked worktree to its main checkout (section 4), `install`, `uninstall`, and `doctor` with `--project` in a worktree act on the main checkout. A second install from another worktree is an idempotent rerun. The skill folders stay in the main checkout, so a harness finds them in a worktree only if it reads the skill folders of the main checkout.

Stale blocks. Install and uninstall also replace or remove a block that belongs to no live project:

- the block of another spelling of the same root, a path whose real path equals the root's real path (a symlink, or `/tmp` and `/private/tmp`);
- the block of a root that no longer exists, such as a removed worktree or a moved clone;
- the block of the root that the manifest names, when it differs from the current root (a copied or moved project), and that root keeps no install of its own in this exclude file.

Doctor warns about a block whose root no longer exists.

The manifest records how the install changed the exclude file, as `excludeFile`: `created` (the file was missing), `dirCreated` (its `info/` directory was missing), and `addedNewline` (the install added a final newline before it appended the block). When the uninstall removes the last block, it removes that newline again, deletes a file that the install created and that is then empty, and removes an `info/` directory that the install created when it is empty. When the exclude file already holds the block of another root, such as another worktree, the install copies `excludeFile` from the manifest of that root, when that manifest names the same exclude file. Every root then holds the facts of the first install, so whichever root removes the last block undoes them. So the exclude file gets its exact bytes back, in any uninstall order.

When the install makes a backup in `<root>/.omt/backups/`, it also writes `<root>/.omt/backups/.gitignore` with the single line `*` when that file is missing, so a backup never shows in git, even after an uninstall. A run that makes no backup does not write it. The uninstall writes it too when it makes a backup.

`settingsCreated` is true only when nothing was at the settings path, so a dangling symlink there stays the user's: the block does not list it, and the uninstall keeps the link (section 14.6).

Write order: the install writes the exclude block first, then a provisional manifest that lists what the run will create (the `dirs`, the `files` with their planned hashes, including `.omt/backups/.gitignore` when the run will make a backup, `omtDirCreated`, and `settingsCreated`), and only then any other path. At the end it rewrites the manifest with what it did create. So a run that fails midway leaves no file that git shows or that the next run takes for the user's. When the exclude write fails, the install stops before any other write, and the hint names `--no-git-exclude`. The uninstall uses the mirror order: it changes the exclude block last, after every delete and after the manifest. A delete that fails stops the run with an error that names the path and says to run the command again; the block still hides every path that stays, and the next run finishes the work.

The exclude file and `.omt/.gitignore` can be symlinks, for example from a dotfiles setup. Each write goes to the real path (section 1), so the link stays a link. When the exact-bytes rule would delete a file that the install created and that is now a symlink, the uninstall writes the empty content to the target and keeps the link. Install and uninstall in project scope first delete the scratch directories `<root>/.agents/.omt-tmp-*` and `.omt-old-*` that an interrupted run left; the plan lists each one as `remove <path>  (left by an interrupted run)`.

The manifest adds `"scope": "project"`, `"root": "<root>"`, and:

```json
"project": {
  "omtDirCreated": true,
  "settingsCreated": true,
  "shim": "<shim path>",
  "gitExclude": "<exclude path>",
  "excludeFile": { "created": false, "dirCreated": false, "addedNewline": false },
  "existing": { "skills": ["omt"], "links": ["<root>/.claude/skills/omt"] },
  "files": [{ "path": "<root>/.omt/config.jsonc", "sha256": "<hash of the content the install wrote>" }],
  "dirs": ["<root>/.omt", "<root>/.omt/plans", "<root>/.agents", "<root>/.agents/skills", "<root>/.claude", "<root>/.claude/skills"]
}
```

`files` lists `.omt/config.jsonc`, `.omt/.gitignore`, and `.omt/backups/.gitignore` when an install created them. `dirs` lists each of `.omt`, `.omt/plans`, `.omt/bin`, `.omt/backups`, `.agents`, `.agents/skills`, `.claude`, and `.claude/skills` that was absent before an install and present after it. A later run merges both lists into the old ones. `gitExcludeOff` and `gitignoreRestore` are present only after a `--no-git-exclude` install. `existing` is present only when an install found an existing skill or link.

Every command reads a project manifest relative to the current root. Each recorded path inside the recorded `root` maps to the same relative path under the current root, and each recorded path outside it is dropped. Then only the paths that a project install writes stay: `skillsRoot` only when it is `<root>/.agents/skills`, skill names and link names that are one path segment, links and `existing` links directly in `<root>/.claude/skills`, the config only at `<root>/.omt/config.jsonc`, the shim only at `<root>/.omt/bin/omt`, hooks only for `<root>/.claude/settings.local.json`, hook `backup` and `backups` paths only under `<root>/.omt/backups/`, `files` only for `.omt/.gitignore`, `.omt/config.jsonc`, and `.omt/backups/.gitignore`, and `dirs` only for the directories that the `dirs` list below names. So a copied or moved clone, or a manifest that the repository tracks or that someone copied in, never makes a run act on another project, on the user install, or on a project file that no install writes. The exclude file always comes from the current root.

`omt uninstall --project` follows section 14.6 with the project paths, and also:

- It removes the shim when it carries the signature, and the manifest.
- It keeps each existing skill and link (see above). It removes only the links whose real target is a directory in `<root>/.agents/skills`, so a link to the user install, such as `<root>/.claude/skills/x -> ~/.agents/skills/x`, stays.
- It removes the hook entry from `settings.local.json`, with the exact-restore rule of section 14.6. When an install created that file and only `{}` is left, it deletes the file without a backup.
- It rewrites the root's exclude block with only the paths that stay: each kept skill and its kept link (not an existing one), each kept file that an install created, an edited config that an install created, a `settings.local.json` that an install created and that stays because other keys are left in it (Claude Code writes permissions there), and the manifest when it stays. It removes the block when nothing stays, with the exact-bytes rule above, and it removes stale blocks.
- It removes each file in the manifest `files` list while its SHA-256 equals the recorded hash. A created `.omt/.gitignore` that was edited stays, with `keep (edited after the install)`. A created `.omt/.gitignore` also stays while `.omt/ledger.jsonl` or `.omt/evidence/` exists, with `keep (keeps the ledger and evidence that stay out of git)`, and the reduced block hides it.
- With `gitignoreRestore`, it writes the old `.omt/.gitignore` back while the file still has the recorded hash, with `update (removes the lines that the install added)`. A created `.omt/config.jsonc` that was edited stays with `keep (edited after the install; add --purge to remove it)`, and `--purge` removes it. A config that no install created stays, with `keep (not created by omt install)`, also with `--purge`.
- It removes `.omt/backups/.gitignore` when an install created it, it still holds what the install wrote, and it is the last file in `.omt/backups/`.
- Then it removes each directory in the manifest `dirs` list when it is empty, in this order: `.omt/bin/`, `.omt/backups/`, `.omt/plans/`, `.agents/skills/`, `.agents/`, `.claude/skills/`, `.claude/`, `.omt/`. It never removes a directory that an install did not create, even an empty `.omt/bin/` or `.omt/backups/`.
- It never removes the plans, the ledger, the evidence, or a backup other than the install-time backup that an exact restore wrote back.
- When it keeps a locally modified skill, it keeps the manifest too, with `keep (a locally modified skill is kept)`, so that a later `uninstall --project --force` still knows the created directories.
- When a file that an install created stays (a kept `.omt/.gitignore`, an edited created config, or a created `settings.local.json` with other keys left in it), it rewrites the manifest as a reduced manifest, with `keep (records the created files that stay)`. The reduced manifest lists no skill, link, hook, or backup. Its `files` lists the kept created files, `config` stays only for a kept created config, `settingsCreated` is true only while that settings file stays, and `omtDirCreated`, `gitExclude`, `excludeFile`, `existing`, and `dirs` stay as recorded. So a later install still counts these files as created and keeps their block entries, and a later uninstall keeps the same reduced block and every existing skill and link. When no created file stays, the uninstall removes the reduced manifest and the block. When the repository's exclude file holds no block of the root, as after a `--no-git-exclude` install, no block can hide a reduced manifest, so the uninstall removes the manifest. The kept files then count as the user's.
- It removes every hook entry that has the omt signature (section 14.6), also one that was in the settings file before the install, such as a tracked `settings.local.json` that holds the entry of another clone. Such a file shows as modified in git after the uninstall.

So the project tree after `uninstall --project`, and the exclude file, are byte for byte as before the install, apart from data that the user created meanwhile (plans, ledger, evidence), what keeps that data out of git (`.omt/.gitignore` and a reduced block), the reduced manifest that records the created files that stay, the exception for an omt entry that was in the settings file before the install, and an existing skill that the install updated. A file that the user edited stays, with its block entry. A backup that the uninstall could not restore exactly stays in `.omt/backups/`, hidden from git by its `.gitignore`. A path that `install --force` replaced stays in `.omt/backups/<stamp>/` too, and the uninstall does not move it back. Git does not show it there, so a replaced path that git showed before the install is gone from `git status`.

User scope and project scope never read or write each other's files.

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

- Skills call the CLI as `omt` on `PATH`. That works after `pnpm link --global` in a clone. When `command -v omt` finds nothing, a skill uses `.omt/bin/omt` from the project root, which `omt install --project` creates. When that file is missing, as in a linked worktree, a skill uses the shim of the main checkout, `"$(git rev-parse --path-format=absolute --git-common-dir)/../.omt/bin/omt"`. Without any of them, a skill falls back to the manual steps in `roles.md` and `brief.md`. The rule lives in the section "The CLI" of `skills/omt/references/delegation.md`. Skills never use `npx`, which needs the network.
- Skills name T3 tools by their base names (`delegate_task`, `task_status`). The first skill text that names a tool says that harnesses may add a prefix, such as `mcp__t3-code__delegate_task`.
- Shared reference lives in `skills/omt/references/`. Other skills link to it with relative paths such as `../omt/references/delegation.md`.
- Every relative link in a skill must resolve to a file in the repository. A test checks this.
- Write for agents. Front-load the trigger words in each description. Give each step a completion criterion. State the target behavior instead of a ban where possible.

### 15.2 Skill list

| Skill | Invocation | Purpose |
| --- | --- | --- |
| `omt` | user | Router. Lists the omt workflows, when to use each, and the shared references. |
| `omt-ulw` | model | Ultrawork loop: mode and branch check, frame, route, explore, plan, dispatch, review, test, fix, final gate, report. Trigger words: ulw, ultrawork, build or fix with subagents in T3. |
| `omt-plan` | model | Explore, ask owner decisions in one message, write the plan and approved test list, set its task budget, review by `plan.review`, and show the final plan. |
| `omt-design` | model | Dispatch `design.variants` options per screen in a new Paper file, show screenshots by screen, carry owner steering through fresh design tasks, and write `docs/design/<slug>.md` after approval. |
| `omt-review` | model | Review uncommitted changes, a branch, a commit, or a PR. The profile controls group count, families, oracle, and fix offers. PRs use the eleven steps in section 15.4. |
| `omt-research` | model | Parallel read-only research into a cited report. |
| `omt-swarm` | user | Independent tracks in separate worktree threads with `t3_thread_launch`, stacked branches, `link_pull_request`, and `watch_pull_request`. Invoking it is the explicit user request that T3 requires for new threads. |
| `omt-show` | model | A page in the T3 thread with flowcharts, tables, and status cards. The skill writes a page spec (section 5.9) with only what the built tabs do not show, builds the page with `omt visual`, and passes the page text to `html_render` with `height` 2000. Without `html_render`, the page file is the result. Reference: `references/page-spec.md`. |
| `omt-loop` | user | Keep work going across turns. On Claude and Codex threads, it asks the user to type `/goal <objective>`; no MCP tool sets a goal. Otherwise it uses a `schedule_task` heartbeat bound to the thread, a condition command, and a hard iteration cap counted in the ledger. It deletes the schedule when done. |

Rules that the skills must carry:

- `omt-ulw` runs the full loop for every task. The conductor edits no product files, including code, tests, docs, and config. It writes only `.omt/` state and brief temp files. A LIGHT run may skip exploration but still creates a plan with `--light` and delegates each unit. UI work uses `ui` with no fallback to another family. Both tiers apply `build.review`, `build.verify`, `build.qa`, and `build.oracle`. The conductor records each task and result, runs verify commands and final checks, and reports. When no child can edit, it stops and tells the user.
- Before each dispatch with a plan file, the conductor runs `omt ledger stats --plan <slug>` and requires `can dispatch: yes`. A plan header `max-tasks` replaces the profile task limit. Without a plan file and with a selected run profile, it compares ledger `dispatched` and `active` with that profile's `maxTasksPerRun` and `maxParallel`. `ledger stats` has no `--profile` flag. This comparison also applies to ledger-only review and design ids. Without the CLI, it counts tasks itself. At `can dispatch: no` and `active: 0`, it stops, names the limit and count, and recommends `omt plan limit <slug> --tasks <n>` for a plan budget.
- Before the conductor ends a turn with an active task and no heartbeat exists, it starts one `schedule_task` heartbeat every 10 minutes. Each tick reloads the profile and ledger, then reads active child threads with `t3_thread_read`. A task is stalled when its `updatedAt` is older than `workflow.build.stallMinutes`, default 30 minutes. The conductor accepts an existing result block from `task_status` or the thread. Otherwise it cancels, records `interrupted` with note `stalled`, checks partial edits, and retries with the next attempt in the same round. A waiting check-in defers that retry until the owner replies. A tick with no stalled task sends no message. The conductor deletes the heartbeat at run end. At a check-in or another owner stop, it keeps the heartbeat while a task is active. During a waiting check-in, any turn with no active task deletes it. A retained heartbeat is reused after the owner replies. A new heartbeat starts only when none exists.
- Only `verify` drives a device, a Simulator UI, a browser, or a computer. Every other default-mode brief delegates device checks with `omt brief verify --depth <depth + 1> --json`, with `--plan <slug>` when set, `--profile <name>` when explicit, and `--max-depth` when needed. It keeps the routed target and uses `mode: "wait"`. This delegation is allowed at any depth. A plan-mode role lists the steps and expected results for the conductor because it cannot start an edit child. The depth exception belongs only to `verify`. A local-tool `INCONCLUSIVE` result gets one retry on the next rung of another provider, with a higher attempt. After that retry, the workflow fixes or stops.
- `omt-ulw` step 8 first applies `build.verify`. `every-unit` dispatches `verify` for every unit. `heavy` dispatches it for each HEAVY unit; the LIGHT conductor runs the verify commands and saves output. After verification passes, `build.qa: planned` dispatches `qa` only for the unit's approved `## Tests` lines. `off` or no lines skips `qa`. Verification and qa run in sequence. Each qa dispatch uses the current round and a higher attempt when that round already has a qa dispatch. Only qa makes failure proofs, with `build.failureProofs: on`, in a private copy of the working tree. A product failure goes to the unit's fix role. A test-only finding goes to qa with the approved lines.
- The `omt-ulw` conductor asks each owner question once. Later status messages do not repeat open questions. Only the message that stops the run to wait for the answers lists them again.
- A read-only role's brief carries the plan-mode line (section 9.2). When a summary is `Child task completed without an assistant result.`, the conductor reads the child with `t3_thread_read` (view `messages`, which includes proposed plans) before it re-dispatches.
- The conductor keeps its own turn short: dispatch async work, then end the turn and let the wake start the next one. When the turn cannot end (a goal or a stop hook keeps it running), it uses `delegate_task` with `mode: "wait"` and a `timeoutMs` of at most 3,600,000 for one blocking task. For parallel tasks, it uses `t3_thread_wait` on each child thread, then `task_status` for each. A later wake that names tasks it already read needs no action.
- The conductor settles each child that it started with `delegate_task` right after it reads the final result with `task_status` and records it. In `plan` interaction mode it records nothing and settles all the same; after `task_cancel` it settles after the `cancelled` or `interrupted` entry; after a `mode: "wait"` return it calls `task_status` first. It calls `t3_thread_organize` with `action: "settle"` and `threadId` set to the `childThreadId`, never the `taskId`, when `status` is `completed`, `failed`, `cancelled`, or `interrupted`, `hasPendingChildRuns` and `hasPendingQuestion` are `false`, and it will not send that child a message with `t3_thread_send` (a new task for the same unit is not such a message). When a condition is false or the settle returns an error, it does not cancel the child. A settle error never stops the run and never triggers a Failure codes action. Before the first settle of a run, the conductor runs `git rev-parse --git-dir --git-common-dir`; when it prints two different paths, the conductor works in a git worktree and settles no child in that run. T3 runs the project's settle script, also one inherited from T3 settings, in a settled thread's worktree, a non-isolated child shares the conductor's worktree, and a thread in the main checkout runs no settle script (`ThreadSettlementService` `cleanUpSettledThread`). A settle sweep catches what the per-result settle missed. The conductor runs it at its next wake after a skipped or failed settle, after each `task_cancel`, before it stops the run to ask the owner, and before its final report; a skill that another skill called leaves the sweep to the caller. The sweep starts from tasks, not threads: it reads its task ids from `omt ledger list --plan <slug> --json`, or the ids it kept in `plan` mode, calls `task_status` for each, and skips an id that returns `task_not_found` (another thread's task, not a lost task). A child is done when the per-result condition holds; a thread that shows `completed` can still wait for its own children, so the thread status alone is not enough. Then it pages `t3_thread_list` with `includeSubagents: true`, following `nextCursor` until it is `null`, settles each done child whose thread shows `settled: false`, and settles each finished thread below a done child, linked by `relationshipToParent: "subagent"`, that shows `settled: false`. Starting from task ids keeps forks and other threads out. When the stall check accepts a result block from a thread that still runs, the conductor calls `task_cancel` for it after it records the result, with no further ledger entry, and the sweep after that cancel settles it. The conductor settles only its children and their children: never its own thread, a top-level thread, or any other thread, and never with `archive`. A child that may start children gets the brief's children line and settles its own children; the sweep covers the children of a cancelled or failed child. A later task neither uses processes that an earlier child left running nor counts on them being gone, because a settle ends them only when the provider closes the thread (Codex after its unload delay). `omt-plan` explore and `plan` tasks, `omt-loop` ticks, and both `omt-loop` stop paths follow the same rules. Measured on 2026-10-17: T3 sent `thread/unsubscribe` 3 ms after the settle of a delegated Codex child, and a settle unsubscribed a Codex thread and its native subagents within 4 ms; a delegated child settled its own Codex child, which was unsubscribed 2 ms later; a settled Claude child's process and a settled Cursor child's MCP servers exited within 10 seconds. Without a settle, each finished child stayed loaded for 30 idle minutes, a Codex thread then for the Codex unload delay, and the Codex native subagents of an idle parent until the app-server stopped.
- The `omt` router lists `omt worktree check` and `omt worktree setup` and links `worktrees.md`. `omt-ulw` step 0 and the section "Worktree setup" of `delegation.md` point to `worktrees.md` for the first run in a project. No skill runs the worktree check before every CLI command. `docs/agents/quickstart.md` runs the check before it reports the install as complete.
- `interaction_mode_escalation_denied` and `runtime_mode_escalation_denied` are stop codes: report them and do not fall back. `provider_unavailable`, `model_unavailable`, and an `invalid_request` about options move to the next rung with the next attempt number.
- On `provider_unavailable` for a target that names only `driverKind`, the skill first retries that target once, with the next attempt number and `providerInstanceId` in place of `driverKind`, set to the same value. The target is the one that failed, rung 1 or a fallback, so the skill keeps it until the retry is sent. Observed T3 behavior is the reason. T3 checks a named provider instance again before it refuses it, but it takes a `driverKind`-only target from a cached provider snapshot that can be stale.
- `omt-swarm` tracks are top-level threads, not delegated children. Their launch message does not use `omt brief`. It tells the track to run `omt-ulw`, to commit each verified unit on its own branch, to push, and to open a PR against its base. Before it launches, the skill checks with `t3_thread_configuration` that the caller runs in `full-access` runtime mode and `default` interaction mode, which `t3_thread_launch` requires. It launches at most `maxParallel` tracks. Each track uses the plan slug `<slug>-<track>` and, after its plan exists, runs `omt plan limit <slug>-<track> <k>` with a lower `<k>`. The track does not change `limits` in the config, because all worktrees share one `.omt/`. Top-level threads never wake the caller, so the skill monitors them with a `schedule_task` heartbeat bound to the caller's thread. The heartbeat prompt is complete on its own, and the skill deletes the heartbeat when every track has a PR or a blocker.
- `omt-ulw`, `omt-plan`, `omt-review`, and `omt-research` start with a step 0 that calls `t3_thread_configuration` with no `threadId` and reads `interactionMode`. In `plan` mode they dispatch only read-only roles, write no files, and deliver the result in the final message, or ask the user to switch to default mode. No skill calls `orchestrator_capabilities` to read its modes, because that result holds the full provider and model catalog.
- Step 0 of `omt-ulw` and `omt-plan` also links to the branch check in `delegation.md`. It finds the default branch from the repository metadata (`refs/remotes/origin/HEAD`, then `init.defaultBranch` when that branch exists, then `main` or `master`) and counts `git rev-list --count HEAD..<default>`. When the count is above 0, `plan` mode only reports it. `default` mode runs `git merge --ff-only <default>` when the worktree is clean and `HEAD` is an ancestor of the default branch; otherwise it reports the count and asks the user. When no default branch is found, the skill skips the check and says so.
- `omt-plan` finishes independent research and a draft plan before it asks all owner decisions in one message. The message includes the proposed `## Tests` lines and reasons for layers outside `plan.testLayers`. Each research question, answer, and source goes under `## Research`. It names shared resources and wraps verify commands with `omt lock run <resource> -- <command>`. It runs `omt plan limit <slug> 1` only for shared build state without `flock` or `lockf`, or for commands that leave processes running after exit. Those commands run outside the lock. For a HEAVY budget, start with dispatched tasks, add 4 for plan reviews, and add 5 per unit. Use 4 per unit when `workflow.build.review` is `first-round` or `off`. Add 1 per `ui` unit, 1 per unit with test lines, 3 for the final gate, and 5 for an `omt-design` step. Round up to a multiple of 10. Set the owner-approved budget with `omt plan limit <slug> --tasks <n>`. In plan mode, report it instead. Edit and hash the absolute plan path from `omt plan status`. Compute the hash after every edit, including header changes, before the next brief.
- Every plan has a `## Summary` of at most 15 lines for the owner, in plain words with no `path:line` citations and no code blocks. The `plan` persona writes it last, and `omt-plan` step 3 updates it after each review fix. The `plan-review` persona blocks a summary line that the rest of the plan does not support. `omt-ulw` fills it last in a LIGHT plan too.
- `omt-plan` step 5 shows the plan before it hands off, also when `omt-ulw` called it. It reads `visuals.plan` from `omt config show`. When the value is `true` and the harness has `html_render`, it runs `omt-show` with the plan slug (in `plan` mode, with the temp plan file, and `omt-show` writes the page to `$TMPDIR`). When the page is in the thread, the reply leaves the summary out. Otherwise, also when `omt-show` could not show the page, the reply holds the `## Summary` text in full. Either way the reply gives the plan path, the review result, and each open decision.
- Skills write and name evidence files in the directory that `omt paths --evidence` prints, never under a path relative to `.omt/evidence/`, so a worktree uses the shared evidence directory.
- Skills tick plan items with `omt plan mark` and create LIGHT plans with `omt plan new <slug> --light`. They record a dispatch with `--task-id`, `--provider`, and `--model`, and the result with the same plan, unit, role, round, and attempt, without the task id. `--provider` is `target.providerInstanceId`, or `target.driverKind` when the target has no instance id, and `--model` is `target.model`, both from the target of the `delegate_task` call that returned the task. After a fallback, that is the fallback's target.
- Fix rounds: rounds count per cycle, which starts at the unit's first dispatch or at a reopen. Round 1 of the first cycle uses the unit's planned role. Every later round, and round 1 after a reopen, is a fix. A failed review or test in round `maxReviewRounds` of a cycle stops the unit and asks the user. The `--round` value in briefs and in the ledger goes on rising across cycles. A fix is `deep` only when an open finding needs investigation: its cause is unknown, the previous fix failed for the same reason, or the fix changes the design. Otherwise the fix is `execute`. A `ui` unit uses `ui` in every round. Before each fix round, the conductor runs a relevance check. It keeps a finding that breaks a done condition, a plan requirement, or the correctness of the changed code for inputs the plan covers. It drops the others: a style preference, an input or a state that the plan rules out, a case that cannot happen in the planned flow, or a missing test that the plan or task does not name. It keeps a missing check on an input shaped like real data for code that reads outside data. It never drops a finding because its case is rare or unlikely; a race or an order of events that the planned flow allows breaks correctness. It records each dropped finding with its reason under `Log` in the plan and in the next `--prior-file`. A requested CRAP finding keeps its complexity, coverage, and CRAP values instead of a failure scenario. When it drops every finding, the unit goes to step 8 (test). When it drops every finding of an oracle round, it records the drops under `Log` in the plan and marks `F2` done, and the report lists the dropped oracle findings. From oracle round 2, the oracle brief passes the earlier oracle findings with the conductor's response to each in `--prior-file`. Oracle rounds count against `maxReviewRounds` too.
- A `BLOCK` review verdict has two causes. A P0 finding with a clear fix inside the unit's scope goes to a fix round, as `REQUEST_CHANGES` does. A wrong approach, or a P0 whose fix changes the plan, marks the unit blocked for a re-plan or an owner question.
- When a task or a check finds a defect in code that a done unit owns, the conductor runs the relevance check first. When it keeps the finding, it reopens the unit: `omt plan mark <slug> <unit> open`, a `Log` line with the defect, its source, and the first `--round` value of the new cycle, and a fix task as round 1 of the new cycle, with the next `--round` value. The finding leaves the fix round of the unit whose task found it. When that unit has no other kept finding, it waits until the reopened unit is done again, then goes to step 8 (test) for the same round. Units that depend on the reopened unit, directly or through other units, get no new task until it is done again, and the reopen fix waits until no active task has a scope that overlaps the reopened unit's scope. The task budget still applies. Before a third reopen of the same unit, the conductor stops and asks the user. A failing final check reopens the unit that owns the code. The report lists each reopen.
- `verify` saves a screenshot for each device check, or a recording for motion or a flow. It lists every evidence path. The conductor shows a verified unit's screenshots as Markdown images with absolute paths, grouped by screen. The final report shows the latest image or recording for each changed screen or flow from the verify and ui results. A ui worker's verify child captures only design-comparison screenshots. Step 8 verification checks behavior. Neither repeats the other's work.
- `verify` runs existing checks and main flows without new tests or product edits. For each checked flow, it names a covering test file or `none`. Code that reads outside data needs a check with at least one input shaped like real data. The check can be a command or a flow. The task captures each exit code with the command that runs it. It closes every device or browser session that it opens and never restarts or replaces a shared device daemon. A local-tool failure returns `INCONCLUSIVE`. Section 15.5 defines test writing and failure proofs.
- Design artifacts get no model review. No `review`, `oracle`, `plan-review`, or other model task looks at files under `docs/design/`; the owner is the design review. `omt-ulw` review and oracle briefs, and `omt-review` reviewer groups, diff commands, and oracle input leave `docs/design/` out; `omt-ulw` test, review, and oracle briefs of `ui` units leave out `docs/design/`, every visual-match done condition, and design context, and keep code and behavior checks; `omt-review` lists the design files for the owner, and a change that holds only design files goes to the owner. Code review of `ui` units stays. A `design` or `ui` dispatch never falls back to another family: when its rung cannot run, the skill stops and tells the user.
- `omt-plan` plans an `omt-design` step before units that build or change UI when no spec exists under `docs/design/`. UI units cite the spec and use the `ui` role. A unit that implements a design or changes UI uses the `ui` role in HEAVY and LIGHT runs. `omt-ulw` step 5 (dispatch) starts with the design check: when the plan asks for an `omt-design` step that has not run, it runs `omt-design` before it dispatches any `ui` unit. The `omt-plan` hand-off returns to step 5, so it passes through that check.
- `verify` and `qa` leave product code unchanged. Their scope does not permit commands that change other workers' files.
- `plan-review`, `review`, and `oracle` are cross-family relative to the worker. A reviewer comes from the family other than the worker's; when that family is not available, the same family reviews. The `oracle` is the whole-change gate from the family other than the main implementer's.
- `omt-ulw` builds the review briefs (step 7) and the oracle brief (step 10) with `--against auto`.
- `omt-plan` applies `plan.review`. `owner` dispatches no plan reviewer and waits for owner approval of the plan and test list. `two-families` uses two round-1 tasks, `plan.claude --against codex` and `plan.codex --against claudeAgent`. Both must approve. `one` uses one reviewer from the family other than the plan author in every round. From round 2, both reviewed modes use `plan --against <plan author provider>`. The author is the step-0 `modelSelection.instanceId`, or the provider of a plan worker. Every required family must be available. Each dispatch passes the effective `plan.testLayers` in the task. Round 1 freezes the union of blockers. Later rounds count frozen blockers, fix regressions, or findings with a requirement, regression, or concrete risk. The limit is the profile's `maxReviewRounds`.
- `omt-review` uses `review.reviewers` for the number of file groups. `auto` gives 1 below 200 changed lines, 2 below 1,000, 3 below 3,000, and 4 otherwise. `review.families: one` uses one reviewer per group. `both` uses one reviewer per family per group and requires both families to be available. Round 1 passes no `--against` unless selecting both families. `review.oracle: on` uses the family other than the provider that ran most reviewers of that round. `review.fixLoop: offer` asks before each fix loop. Later rounds review each fix under `F<k> --against auto`, against that fix's worker. Every round is a fresh task.
- `omt-ulw`, `omt-plan`, and `omt-design` read `omt profile show --plan <slug> --json` when the plan file exists. Otherwise they use `omt profile show <name> --json`, or omit the name for the config selection. Before plan creation, every brief, roles, and route call carries the selected `--profile`. `omt-plan` creates a HEAVY plan with `--profile <name>` to store the effective profile. A LIGHT plan stores a profile only when the run has an explicit `--profile`. Otherwise, it has no `profile=` header and follows the current config. The planner creates a missing file before a plan worker starts and tells that worker to edit the existing file without `--force`.
- `omt-ulw` reloads the profile on each wake, switch, and context reset. `build.review: every-round` reviews every round, `first-round` reviews only the first implementation round, and `off` skips unit reviews. `build.oracle: heavy` requires the final oracle only for HEAVY, `always` for both tiers, and `off` for neither. After plan creation and profile switches, the conductor adds or removes the `F2` oracle item to match that rule.
- `build.checkpoint: layer` permits only the current approved dependency layer. Layer 1 starts approved. A reopened unit's fix, review, verify, and qa tasks belong to the current layer. Later layers remain blocked. When all current-layer units are done or blocked, the conductor stops for a check-in. A reopened unit does not cause a second check-in for an already checked layer. `unit` stops after each verified unit. `none` continues without check-ins.
- Before a check-in, the conductor dispatches nothing new and waits for active tasks of the unit or layer. It records results without new dispatches. It shows verified units, screenshots by screen, open findings, and the next layer. The plan `Log` records the waiting check-in and the owner's answer. Under `unit`, another unit verified during the wait joins that check-in and gets a short follow-up message. One reply answers all units in that check-in. Only an owner reply resumes work. Continue permits one more unit or layer. A stop-check-ins instruction lasts for the run. Task wakes, goal continuations, and loop ticks do not answer a check-in.
- `omt-loop` reloads the profile and check-in answers before dispatch. A waiting check-in gets no `loop` ledger entry and consumes no tick. It deletes its loop schedule while waiting, then creates it again with the same prompt and cadence after the owner replies. Under a goal, it asks the owner to clear the goal during the wait and restart the same objective after the answer. This loop schedule is separate from the active-task stall heartbeat.
- A busy lock or a failure in another unit's file is not a defect of the unit under test. Keep the unit in step 8 while you handle it. Apply these rules to a `verify` or `qa` result and to a verify command that you run yourself. When a busy lock or a failure in another unit's file makes `verify` or `qa` return `INCONCLUSIVE`, skip the retry on another provider. For a busy lock, run `omt lock list`. When `omt lock list` shows the lock as free, dispatch the next attempt with the same target, or run your own command again. Count that attempt toward the second busy lock. Treat the holder as a task of this run only when an active task of this run gave that command. For that holder, wait for the task to end. Then dispatch the next attempt with the same target, or run your own command again. For any other holder, stop it only when you own it or have permission. Otherwise ask the owner. Never take over or clear a held lock. After a second busy lock for the same unit and step, ask the owner. For a failure in another unit's file, or for a `NOT VERIFIED` result or a failed verify command of your own while a work or qa task of another unit was active, read `omt ledger list --plan <slug> --json`. Another unit's file is any file outside the failed task's scope and named code under test, also a file that no unit's scope contains. For your own command, use the unit's scope. Find the work and qa tasks of other units that were active while the failed attempt ran: dispatched before that attempt ended, with no terminal entry before it started. Wait until each of them has a terminal entry and every reopened unit that the unit under test depends on is done again. While a check-in awaits the owner's reply, also wait for the reply. Then dispatch the next attempt with the same target, or run your own command once more. Do this at most once per round for each of `verify`, `qa`, and your own command. Ask the owner instead when that retry is already used, or when a failure in another unit's file has no such task. Do not apply the step 9 relevance check or Reopen rule to a failure in another unit's file; the owner decides. Name the unit under test, the file, the command, and the message.

### 15.3 Shared references in `skills/omt/references/`

- `delegation.md`: the T3 rules. Covers the `delegate_task` fields, getting arguments from `omt brief --save --json` or `omt route`, and `clientRequestId` per round and attempt (section 10). Covers async dispatch and the wake message, which names only task ids, plus the waiting rules from section 15.2. It also covers `task_status` and `task_cancel`, releasing finished children, the failure codes with the recovery for each, the 120,000-character prompt limit, the shared checkout, depth and budget limits, fast mode, device routing, shared build locks, stall thresholds, and when `t3_thread_launch` is allowed.
- `roles.md`: the default roles and when to choose each one. Covers how to resolve them with `omt roles` and `omt route`, and how to resolve them by hand when the CLI is missing, including the effort option table per driver and the manual cross-family rule (start from the first rung whose family differs from the family of the provider recorded for the unit's last work dispatch, with the family rule of section 8.3). Covers `--against` and the cross-family roles. Also covers falling back to the next rung on `provider_unavailable`, `model_unavailable`, or `invalid_request`, and custom roles and templates.
- `brief.md`: the brief layout, how to write the task text (deliverable, scope, verify, stop condition), and one complete example.
- `results.md`: how the parent reads each result block, records it, settles the child, and reads qa test lists and guardrail proposals. A done claim stays unverified until the parent or verify checks it.
- `roles/<role>.md`: one persona file per default role, plus `_generic.md`.
- `results/<kind>.md`: the contracts from section 11.
- `worktrees.md`: the T3 worktree setup on first use. Run `omt worktree check`. Work out the effective saved scripts in the order of T3's `resolveProjectScripts`: `projectSettingsOverrides[projectId].defaultProjectScripts` first (an explicit empty list wins), then `defaultProjectScripts` when `projectSettingsFolded` is true, then the legacy `projectScriptOverrides`, the project's `scripts`, and `defaultProjectScripts`. A project read alone never proves activation. Keep a compatible setup and verify a custom command (frozen install, `async: false`, store reuse across two checkouts). Generate a missing setup only with the owner's yes. Import it only after `t3.json`, `.t3/`, and for pnpm `pnpm-workspace.yaml` are committed on the base branch of new worktrees and the owner's yes covers activation, through T3 Project Settings or a tool that writes the same project override, with the inherited scripts copied in. Never change `defaultProjectScripts`. Read the effective scripts back, or report activation as unverified.

### 15.4 Pull request review

`omt-review --profile pr-review <number>` enables all PR steps. Every profile uses the same order. Steps 1, 2, 6, and 10 always run. Other steps use `workflow.review` switches. The skill posts no GitHub comment or review.

The review uses the ledger-only id `review-<slug>`. It reads `omt profile show <name> --json`, not `--plan`, and passes `--profile <name>` to each brief and role lookup. It reloads the profile on each wake. Dispatch limits use ledger counts and that profile's limits, not the ledger's config-profile `can dispatch` line. Plan mode omits `--save`, evidence writes, and ledger writes. A PR step that needs a checkout, file write, or edit role stops for a switch to default mode.

1. Target. Run `gh pr view <n> --json number,title,body,url,baseRefName,headRefName,files,additions,deletions`. Link the PR immediately with `link_pull_request` when available. Save the original branch, or the detached HEAD commit. `review.ci: fix`, `review.verify: changed-flows`, `review.tests: offer`, or `review.crap: report` requires a clean PR checkout. Check `git status --porcelain`. With changes, stop for the owner. Otherwise run `gh pr checkout <n>`. When no step needs a checkout, keep the current branch. Size and group files by the rules in section 15.2. Run `gh pr view <n> --json baseRefOid,headRefOid` once and save both values. Run `git fetch origin <baseRefName> pull/<n>/head` once.
2. Rules. List root and ancestor `AGENTS.md` and `CLAUDE.md` files for each changed file. Add `CONTRIBUTING.md`, linked rule docs, and relevant project skills under `.claude/skills/` and `.agents/skills/`. Add lint, format, type-check, and CI config files. Every review task gets the list. A finding that breaks a written rule cites its file and line.
3. CI. With `review.ci` other than `off`, run `gh pr checks <n> --json name,state,bucket,link,workflow` on each task-result or PR-event wake. Current checks are the CI state. For each failing GitHub Actions check, save the last 400 lines from `gh run view --job <job-id> --log-failed`. The job id comes from its link. Use `<evidence>/ci-<slug>-<check>.log` with a safe check filename. For another CI system, save its link. With no checks, `check` reports `no CI checks`. `fix` runs the project's check command as `omt lock run check -- <command>` and treats a failure as a failing check. Check and coverage commands run one at a time, also without lock tools. While checks are pending, `watch_pull_request` is the last action before turn end. On the first turn, dispatch step 5 first. When no check is pending, unwatch before an owner wait or review end. An owner stop also unwatches. A missing watch tool is reported with the pending checks.
4. Coverage. With `review.crap: report`, find a `coverage` or `test:coverage` script, or a coverage step in CI. Run it once as `omt lock run coverage -- <command>`. Put lcov at `<evidence>/coverage-<slug>.lcov` through a supported output option or a copy after the run. With no coverage command, give reviewers no coverage file. `off` skips this step.
5. Round 1. Dispatch read-only review groups with the rules and coverage path. With `review.crap: report`, request calculations for each added or changed function. With `review.verify: changed-flows`, dispatch one `verify` task for changed screens, CLI commands, or API routes. Its task names the flows and project build and run commands. Name the PR's changed paths, excluding `docs/design/`, as the code under test in the `verify` task. It writes no tests or product files and reports a covering test file or `none` per flow. Only verify drives devices. A local-tool `INCONCLUSIVE` gets one retry on the next rung of another provider. Record all dispatches before the pending-CI watch and turn end. Collect all verdicts before step 6.
6. Merge and oracle. Merge duplicates and sort by severity. Keep failure scenarios for non-CRAP findings and all three CRAP values for CRAP findings. A verify flow with `NOT VERIFIED` becomes P1 with evidence. With `review.oracle: on`, the oracle confirms or refutes findings and adds confirmed misses. Keep confirmed rule citations and CRAP values.
7. CI fixes. `review.ci: check` reports failures without fix tasks. `fix` waits for all round-1 review and verify verdicts, then sends each failing check to an `execute` task under a distinct `F<k>`. Give it the log or link, a local reproduction command, and an explicit file scope. A failure that needs unavailable secrets or services returns `STATUS: BLOCKED`. Each fix gets one review under `F<k> --against auto`. Keep the changed paths. Repeated CI fixes stop at `maxReviewRounds`. Overlapping edit scopes run in sequence. Children leave changes uncommitted.
8. Guardrails. With `review.guardrails: propose`, dispatch one read-only `guardrail` task after the enabled oracle and CI fix reviews. Give it merged findings, CI failures, rule files, CRAP results, and existing `.omt/guardrails.md`. For each finding, choose the first applicable class: `check`, then `rule-fix`, then `new-rule`. A check names a tool, config change, and proof command that fails on the PR head and passes after the change. A rule fix cites and corrects an unclear or conflicting rule. A new rule states its text and destination. A judgment-only finding gets a reason and no proposal. Skip existing proposals. Run `omt init` before appending when `.omt/.gitignore` lacks `guardrails.md`. The conductor appends `- [ ] G<k> <date> PR #<n> <class>: <proposal>. Where: <file>. Proof: <command or none>.`. Each id is one above the highest existing id. The owner can turn proposals into separate-branch omt-ulw work. The guardrail child edits no file.
9. CRAP. With `review.crap: report`, collect the calculations requested in step 5. For each added or changed function, use `CRAP = complexity² × (1 − coverage)³ + complexity`. Complexity starts at 1. Add 1 for each `if`, `else if`, loop, `case`, `catch`, `&&`, `||`, `??`, and `?:`. Coverage is the fraction of function lines that lcov marks as hit. Without data, use 0 and state `no coverage data`. A CRAP value above 30 is P2 with complexity, coverage, and CRAP values. Include these findings before merge, oracle, and guardrails. With `review.guardrails: propose`, missing complexity lint or a coverage gate requires a check proposal in step 8. With guardrails off, report each missing check as a note.
10. Report. Write `<evidence>/review-<slug>-r<n>.md` in the review result format. Include verdict, findings by severity, applicable rule citations, CI state, reviewed CI fixes with paths, verify screenshots, and CRAP findings. List verified flows without tests and guardrail proposals. List design files for owner review. Show the current branch or detached commit and the return command. Use `git switch <original branch>` or `git switch --detach <original commit>`. If checks remain pending, report them and keep the watch. New failures on wake return to step 7 and update steps 8 to 10.
11. Offers. `review.fixLoop: offer` asks before each fix loop. `review.tests: offer` proposes one e2e test per verified flow without a covering test, with exact flow and file lines. Each qa task needs the owner's approval of those lines. Name the PR's changed paths, excluding `docs/design/`, as the code under test in the `qa` task. Qa writes only those tests and returns `INCONCLUSIVE` when no e2e framework exists. Review each qa change once. Product failures need an owner-approved fix loop. Before any approved edit, perform step 1's checkout procedure if the PR is not yet checked out. Report the branch and return command after a late checkout. Before finishing, call `list_thread_pull_requests` when available and link the PR if missing. Report linking failures. Commit and push need the owner's yes. Make one commit per fix or qa task, using only its changed paths. Combine changes to the same file into one commit. After push, watch only when CI is enabled and step 3 found checks, then end the turn immediately. Otherwise unwatch and end. Only `review.ci: fix` starts another CI fix round for a repeated failure.

Round-1 review and oracle tasks use the saved PR commits, with or without a PR checkout:

```sh
git diff <baseRefOid>...<headRefOid> -- <paths> ':(exclude)docs/design'
git show <headRefOid>:<path>
```

Each review gets only its group's paths. The oracle gets `.`. With no PR checkout, these tasks run no tests or builds on the working tree. Reviews of uncommitted CI fixes, fix-loop changes, and qa changes use `git diff HEAD -- <fix paths>` and read the working tree. An oracle after a fix loop also reads the working tree:

```sh
git status --porcelain -- <the round's fix paths>
git diff HEAD -- <the round's fix paths> ':(exclude)docs/design'
```

Every review round is a fresh delegated task. Prior findings and responses go in `--prior-file`. Design files remain excluded throughout.

### 15.5 Test policy

- Workers `execute`, `quick`, `deep`, `ui`, and `writing` add no test files or cases and make no failure proofs. They can update an existing test broken by their change and report that update under `NOTES`.
- Every plan has `## Tests`. The owner approves its lines with the plan. Each line is `- <layer> <unit>: <flow or case>. File: <path>. Reason: <why>.`. An empty section means no new tests. `build.qa: off` leaves the section empty.
- The planner proposes only `plan.testLayers` without a request. Other layers need a reason and owner approval. Proposals start with e2e main flows of each vertical slice that verify can also run. Integration cases cover what e2e skips, followed by unit cases. Other test kinds require an owner request. Use one e2e test per main flow, without edge cases as e2e lines.
- `verify` runs verify commands, existing suites, and main flows against the running artifact. It writes no tests. `qa` follows verification and writes only the approved lines, in e2e, integration, then unit order. It leaves product code unchanged. Each new test file or case maps to a task line. An unlisted test goes to a qa fix task. A planned test that exposes a product failure returns `NOT VERIFIED` for a product fix.
- With `build.failureProofs: on`, qa proves that each new test fails when the tested product behavior is broken. It uses a private copy of tracked and untracked working-tree files, not `HEAD`. It never changes the shared checkout for a failure proof. It breaks product behavior, not a fixture, mock, or helper. The copy is removed on every exit path. With `off`, qa skips proofs. An unavailable required test or proof gives `INCONCLUSIVE`. A test failure or a proof that fails to show failure gives `NOT VERIFIED`.
- A missing test is a review finding only when the plan or task names it. The relevance check drops other missing-test findings. It still keeps missing real-data checks for code that reads outside data. PR review reports uncovered verified flows and requested CRAP findings, and offers exact test lines under `review.tests`.

## 16. Tests

Each module has tests in `test/`. Use `test/helpers.ts` to make temp directories and a fake `CliContext` that records stdout and stderr. Tests never read or write the real home directory.

Required coverage:

- JSONC: comments, comment markers inside strings, trailing commas, a byte order mark, and error positions.
- Profiles: `test/config/profiles.test.ts` checks presets, sparse overrides, code-point limits, per-key pruning, profile removal, legacy `roles.test` warnings, and merged-layer inheritance errors. `test/profile/resolve.test.ts` checks precedence, root-to-child application, limits, roles, models, implicit normal inheritance, cycles, depth, and non-mutation. `test/profile/profile.test.ts` runs custom-profile selection, plan switches, profile limits, output sources, and errors through the CLI.
- Locks: `test/lock/lock.test.ts` checks real process contention, wrapper SIGKILL, inherited background holders, Node child waits, failure and signal release, wait output, holder metadata, inode preservation, no-tool fallback, argument errors, and help. It also checks shared ignored locks across linked worktrees, nested projects, separate Git directories, and trailing-space paths.
- Fast mode: `test/routing/fast.test.ts` uses `test/fixtures/capabilities-live.json` for advertised options, unsupported models, false overrides, precedence, raw options, and unverified mapping. The older `capabilities.json` fixture still checks fallback when Haiku is absent.
- Config: defaults pass validation, the exact default chains and `crossFamily` flags, layering order, `null` removal, chain replacement, new-role defaults, `crossFamily` kept, set, and overridden by a layer, every validation error class (including a non-boolean `crossFamily`), and a syntax error that skips one file.
- Routing: a fixture with Claude, Codex, Pi, and Cursor enabled and Grok disabled. Cover a resolved role, fallback past a disabled provider, a missing model, effort mapping for each driver, nearest-value mapping, invalid raw options, driver-only rungs, unverified mode, and the MCP content wrapper.
- Routing also covers both mode ceilings, the inherited-instance preference for driver-only rungs, and a rung whose provider instance is not registered: with a `driver` it runs on an instance of that driver with its note, and without a `driver` it fails.
- Cross-family routing: the reorder for `--against claudeAgent` and `--against codex` on `review`, a role without `crossFamily` that ignores `--against` with its note, a chain with only same-family rungs that keeps its order with the same-family note, a provider instance id that maps to its driver kind with capabilities and through a configured rung without capabilities, a worker family that matches no rung with its note, and an unavailable other-family rung that falls back to the same family with the note.
- Cross-family routing also covers a rung that names only a provider. A configured rung maps that provider to its driver, the same way as the `--against` value. The rung is in the worker's family for the reorder and for each note, through `--against <provider>` and through `--against auto`. `workerFamily` and `rungFamily` give the same family for the same provider id.
- `pickWorker`: `--unit` takes the last worker entry of the unit, the plan-wide majority, the tie rule with replaced entries, entries without a unit, an invalid provider with its warning, no worker entries, and roles with result `review` or `test` that do not count as workers. A mixed-provider review plan gives each fix unit `F<k>` a reviewer from the family other than its fix worker's. `--against auto` without `--plan` is a usage error (exit 2).
- Defaults: unverified default targets name `providerInstanceId`, and a user rung with only a `driver` still gives a `driverKind` target.
- Brief: every section, omitted sections, access and delegation lines, plan mode, per-role test policy, CLI and shared-build lines, template lookup, title, and JSON payload. Also cover saved bytes, request-id and hash paths, the short pointer, complete ledger command, unavailable-route writes, profile flags with missing plan files, and failure-proof values.
- Plan: the template with `## Tests`, every checkbox state, counts, next unit, `complete`, profile headers, plan profile switches, and effective status output.
- Ledger: append, list, stats, a malformed line, and `requestId` sanitizing with round and attempt.
- Hook: a detection matrix (inside a code block, inside quotes, `ulwx`, `$ulw`, `ULTRAWORK`, a prompt with `<!-- omt-brief`, a prompt that starts with `Act as the `, a prompt that starts with `/omt-ulw`, a prompt that starts with `<task-notification>`, negated keywords and the two-word window, a 200,000-character negated prompt), invalid JSON, and the output shape.
- Install: create, idempotent rerun, conflict without and with `--force`, a locally modified managed skill, backups outside the skill roots, `--dry-run` and a declined prompt write nothing, non-TTY without `--yes`, roots that resolve to the same directory, hook add and update that keep other settings, an unchanged hook writes nothing, a symlinked `settings.json` stays a symlink, `--hooks` refused for a temp `cliPath`, uninstall removes only managed paths, and `--purge`.
- Project install: the files of section 14.8, an idempotent rerun, `--dry-run`, the exclude file for a `.git` directory and a worktree `.git` file, block replacement, no `.git`, `--no-git-exclude` (also on a reinstall, and its `.omt/.gitignore` restore), the conditional `.omt` and `settings.local.json` lines, the hook in `settings.local.json`, uninstall with a locally modified skill and `--purge`, `--targets gemini` (exit 2), a temp `cliPath`, and the shim conflict and update. Also: a copied project, a moved clone round trip, a tracked manifest with paths outside the root, a symlinked path to the root, the home directory as the root (exit 2), a dangling settings symlink, a failed scratch delete, glob characters in a package path, worktrees, a block whose root is gone, the exact bytes of the exclude file, a kept created `settings.local.json`, and a kept ledger. Also: a reinstall that appends `plans/`, `locks/`, and `guardrails.md` to an unedited `.omt/.gitignore` that an earlier install created, and one that leaves an edited file alone. Also: uninstall, reinstall, and a second uninstall after each kind of kept created file, each with an empty `git status`; an uninstall that fails midway; a symlinked exclude file and `.omt/.gitignore`; a crafted tracked manifest that names project files; a package copied inside the same repository; and the exact paths that stay after a failed install and its uninstall.
- Doctor: each status that the table in section 14.7 defines, with `nodeVersion` injected through the context.
- Worktree setup: `test/commands/worktree-setup.test.ts` covers the cases in section 5.12: init, `install --project --dry-run`, setup dry run and apply, check, and `doctor --project` from a linked worktree (shared `.omt`, setup files in the worktree); a Bun and a pnpm runner with controlled executables (versions, flags, environment, lockfiles, failure exit codes, a failed linker query, CI warning); existing, invalid, and partial `t3.json`, ambiguous and unsupported managers, linker settings with TOML comments, each persistent-store status with the created, kept, and incomplete `pnpm-workspace.yaml`, symlinked and dangling `.t3` folders and runners, a home-directory alias, conflicting output paths, idempotency, and a dry run that writes nothing; and `launchSpec` for Windows. Tests never start a real package manager.
- Skills: `test/skills/*.test.ts` replaces `test/skills.test.ts`. `common` checks frontmatter and links. `personas` checks role and result files, test policy, CRAP, and guardrails. `plan-design` checks profile selection, planned test lines, shared-build rules, budgets, review modes, and variant counts. `ulw` checks dispatch, profile reloads, check-ins, verify then qa, locks, heartbeat retention, and loop waits. `review` checks each PR step, commit-based round-1 reads, working-tree fix reviews, offers, linking, and watches.
- Visual: spec errors with JSON paths, unknown keys, escaping of every text field (also an SVG label `<script>alert(1)</script>`), inline markup, byte-identical output, back edges, no edge that crosses a node on any fixture flow, label sides at a shared stub, row centering with and without a pinned column, the transitive reduction, the 6 layers of a plan shaped like `workflow-profiles`, non-unit dependency tokens, a plan with no `## Summary`, and the command: `--out -`, `--json`, the default paths, a plan file path, and the usage errors.
- Schema: the committed schema equals the generated one, and it allows the same keys as the validator.
- CLI: `--help`, `--version`, an unknown command (exit 2), and an unknown flag (exit 2), run as a child process.
- Commands: `roles`, `route`, `brief`, and `doctor` in `test/commands/`, including the `brief --json` payload fields, the title rule, `brief --json --against` with its target and fallbacks, `route --against auto` against a ledger, and the `CROSS` column and `crossFamily` field of `omt roles`.
- End to end: one child-process flow in a temp `HOME` (`test/e2e.test.ts`) runs `install`, `doctor`, `roles`, `route`, `init`, `plan`, `profile`, `brief`, `ledger`, `hook`, and `uninstall` in a temp git project. It runs the CLI with `process.execPath`, because a version-manager `node` shim can fail when `HOME` is a temp directory. A second flow runs `install --project --hooks --yes` in a temp git project, runs `.omt/bin/omt`, checks that `git status --porcelain` is empty, and uninstalls.
