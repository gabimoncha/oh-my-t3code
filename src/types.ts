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
  t3Role: T3Role;
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
  ledger?: { dispatched: string };
}

export type LedgerStatus =
  | "dispatched"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "verified"
  | "rejected";

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
  active: number; // dispatched entries that no terminal entry closes (see ledger closes())
  terminal: number; // entries with a terminal status: every status except "dispatched"
  limits: { maxParallel: number; maxTasksPerRun: number };
  planMaxParallel?: number; // the plan header max-parallel; set only when the plan has one
  planMaxTasks?: number; // the plan header max-tasks; set only when the plan has one
  canDispatch: boolean; // active < maxParallel && dispatched < maxTasksPerRun
}

// How the CLI runs: the TypeScript sources with Bun, the JavaScript bundle dist/cli.js, or a compiled binary.
export type CliBuild = "source" | "bundle" | "binary";

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
  packageRoot: string; // directory that holds skills/: the package root, or the embedded root of a binary
  cliPath: string; // absolute path of src/cli.ts, dist/cli.js, or the binary
  build: CliBuild; // set at build time; "source" when the sources run
  runtimePath?: string; // process.execPath in source and bundle mode; unset in binary mode
  runtimeName: "node" | "bun";
  runtimeVersion: string; // process.versions.bun or process.versions.node, injectable for tests
  version: string; // package.json version
}

export type CommandRun = (ctx: CliContext) => Promise<number>;
