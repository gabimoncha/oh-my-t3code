import type { Access, InteractionMode, Workflow } from "../types.ts";

export interface BriefInput {
  role: string;
  task: string;
  context?: string;
  scope?: string[];
  done?: string[];
  verify?: string[];
  prior?: string;
  round: number;
  depth: number;
  maxDepth: number;
  configuredMaxDepth?: number; // limits.maxDepth; the child needs --max-depth when it differs from maxDepth
  plan?: string;
  profile?: string;
  unit?: string;
  access: Access;
  interactionMode: InteractionMode;
  evidenceDir?: string; // absolute; set for edit roles
  cliCommand?: string;
  failureProofs?: Workflow["build"]["failureProofs"];
}

export const TITLE_MAX = 72;

function accessLine(access: Access, hasScope: boolean): string {
  if (access === "read-only") {
    return "Access: read-only. Change no files. Run only commands that leave the repository unchanged.";
  }
  return hasScope
    ? "Access: edit. Change only the files in Scope. If the task needs a change outside Scope, stop and report it under OPEN."
    : "Access: edit. Change only what the task needs.";
}

// A device check can use a verify child at any depth.
function deviceLine(role: string, planMode: boolean, depth: number, maxDepth: number, configuredMaxDepth: number, selection: string): string[] {
  if (role === "verify") return [];
  // A plan-mode child cannot start a child with broader modes, so it hands the check to the conductor.
  if (planMode) return ["Devices: do not drive a device, Simulator UI, browser, or computer yourself (`agent-device`, `agent-browser`, computer use, UI flows); only the verify role does that, on a cheap model. You run in plan mode and cannot start a `verify` task, so list each device check with its steps and expected result under `OPEN` or `NOTES`, or before your result block when it has neither; the conductor sends it to a `verify` task."];
  const command = `omt brief verify --depth ${depth + 1}${selection === "" ? "" : ` ${selection}`}${maxDepth === configuredMaxDepth ? "" : ` --max-depth ${maxDepth}`} --json`;
  return [
    `Devices: do not drive a device, Simulator UI, browser, or computer yourself (\`agent-device\`, \`agent-browser\`, computer use, UI flows); only the verify role does that, on a cheap model. For each device check, build a brief with \`${command}\` that gives the steps and the expected result, pass its \`delegateTask\` object to \`delegate_task\` with \`mode: "wait"\` (keep its routed target), and report its result. This delegation is allowed at any depth.`,
  ];
}


// A finished child stays loaded until it is settled or T3's 30-minute idle release, and Codex native subagents stay until a settle.
function childrenLine(role: string, planMode: boolean, depth: number, maxDepth: number): string[] {
  if (depth >= maxDepth && (role === "verify" || planMode)) return [];
  return [
    "Children: after you read a child's result, settle the child with the T3 `t3_thread_organize` tool, with `action: \"settle\"` and the child's `childThreadId`, never the `taskId`. Skip a child that still runs or waits for an answer. Settle nothing when `git rev-parse --git-dir --git-common-dir` prints two different paths, because then you work in a git worktree. A settle error is not a failure of your task.",
  ];
}

function delegationLine(role: string, planMode: boolean, depth: number, maxDepth: number, configuredMaxDepth: number, selection: string): string {
  if (depth >= maxDepth) {
    const rest = role === "verify" || planMode ? "Do all work yourself. Start no subagents and no delegated tasks." : "Do all work yourself. Start no subagents and no delegated tasks, except `verify` tasks for device checks (see Devices).";
    const deviceSelection = selection === "" || role === "verify" || planMode ? "" : ` For device checks, pass ${selection} to omt brief.`;
    return `Delegation: you are at depth ${depth} of ${maxDepth}. ${rest}${deviceSelection}`;
  }
  const start = `Delegation: you are at depth ${depth} of ${maxDepth}. You may delegate with the T3 delegate_task tool.`;
  if (selection !== "") {
    const maxDepthFlag = maxDepth === configuredMaxDepth ? "" : ` --max-depth ${maxDepth}`;
    return `${start} For each child, pass ${selection} --depth ${depth + 1}${maxDepthFlag} to omt brief.`;
  }
  if (maxDepth !== configuredMaxDepth) {
    return `${start} Give each child depth ${depth + 1}, and pass --max-depth ${maxDepth} to omt brief.`;
  }
  return `${start} Give each child depth ${depth + 1} in its brief.`;
}

function nonEmpty(items: string[] | undefined): string[] {
  return (items ?? []).map((item) => item.trim()).filter((item) => item !== "");
}

function testsLine(role: string, failureProofs: Workflow["build"]["failureProofs"]): string {
  if (["execute", "quick", "deep", "ui", "writing"].includes(role)) {
    return "Tests: write no new test file and no new test case, and do not prove that tests can fail. Update an existing test only when your change breaks it, and say so under NOTES.";
  }
  if (role === "qa") return `Tests: write only the test lines in the task, top-down; failureProofs: ${failureProofs}`;
  if (role === "review" || role === "oracle") {
    return "Tests: a missing test is a finding only when the plan or the task names that test.";
  }
  return "Tests: write no tests.";
}

export function renderBrief(input: BriefInput, persona: string, contract: string): string {
  const scope = nonEmpty(input.scope);
  const done = nonEmpty(input.done);
  const verify = nonEmpty(input.verify);
  const context = input.context?.trim() ?? "";
  const prior = input.prior?.trim() ?? "";
  const selection = [
    ...(input.plan === undefined ? [] : [`--plan ${input.plan}`]),
    ...(input.profile === undefined ? [] : [`--profile ${input.profile}`]),
  ].join(" ");

  let header = `<!-- omt-brief v1 role=${input.role} round=${input.round} depth=${input.depth}/${input.maxDepth}`;
  if (input.plan !== undefined) header += ` plan=${input.plan}`;
  if (input.unit !== undefined) header += ` unit=${input.unit}`;
  header += " -->";

  const constraints = [
    accessLine(input.access, scope.length > 0),
    delegationLine(input.role, input.interactionMode === "plan", input.depth, input.maxDepth, input.configuredMaxDepth ?? input.maxDepth, selection),
    ...(input.evidenceDir === undefined ? [] : [`Evidence: save command output and logs under ${input.evidenceDir}.`]),
    ...(input.interactionMode === "plan"
      ? [
          "Mode: you run in plan mode. Stay in it. Do not call ExitPlanMode and do not write a proposed plan. Put the result block in your final assistant message.",
        ]
      : []),
    ...childrenLine(input.role, input.interactionMode === "plan", input.depth, input.maxDepth),
    `CLI: Run omt as ${input.cliCommand ?? "omt"}.`,
    testsLine(input.role, input.failureProofs ?? "on"),
    "You do not see the parent conversation. This brief is your full context. If you need something that is missing, say so in your final message.",
    "Other agents may edit other files in this repository at the same time. Leave changes outside your scope alone. Do not commit, push, or create branches.",
    "Processes: do not run `pkill`, `killall`, or another kill by name, because it can stop your own run. Stop only a process that you started, by its PID. Give each command that can run long a time limit, for example `timeout 900 <command>`. Close each device or browser session that you or your script opens on every exit path, for example `trap '<close command>' EXIT`.",
    "Shared files: never break and restore files in the shared checkout, for example to prove that a test can fail. The qa role makes that proof in a private copy.",
    "Shared builds: run a command that the task wraps in `omt lock run` exactly as written. Retry a failed build or test only when the file is outside your scope and outside the task's named code under test. The file is the one where the error occurs, such as a file with a compile or load error, also when a test in your scope loads it. Wait 60 seconds and run the command once more. When it fails there again, report the command, the outside-scope file, and the message as another unit's state. For a failure in your scope or the named code under test, follow your result block. For `test` results, return `VERDICT: NOT VERIFIED` for that failure. When `omt lock run` exits 75, report the command, the lock name, and its message. Leave the lock to the conductor. For both reports: in `work` results, keep the `STATUS` that your own work earns and put the report under `OPEN`. For `test` results, including `verify` and `qa`, return `VERDICT: INCONCLUSIVE` and put the report under `FAILURES`. For other results, put the report under `NOTES`, or before the result block when it has no `NOTES`.",
    ...deviceLine(input.role, input.interactionMode === "plan", input.depth, input.maxDepth, input.configuredMaxDepth ?? input.maxDepth, selection),
  ];

  const blocks: string[] = [header, `# Role: ${input.role}`];
  const trimmedPersona = persona.trim();
  if (trimmedPersona !== "") blocks.push(trimmedPersona);
  blocks.push("# Task", input.task.trim());
  if (context !== "") blocks.push("# Context", context);
  if (scope.length > 0) blocks.push("# Scope", scope.map((path) => `- \`${path}\``).join("\n"));
  blocks.push("# Constraints", constraints.map((line) => `- ${line}`).join("\n"));
  if (done.length > 0) blocks.push("# Done when", done.map((item) => `- ${item}`).join("\n"));
  if (verify.length > 0) blocks.push("# Verify", verify.map((command) => `- \`${command}\``).join("\n"));
  if (prior !== "") blocks.push("# Prior rounds", prior);
  blocks.push(
    "# Final message",
    "End your work with the block below as your final message. Keep it under 60 lines and put nothing after it.",
    contract.trim(),
  );
  return `${blocks.join("\n\n")}\n`;
}

export function briefTitle(role: string, task: string, unit?: string, round = 1): string {
  const firstLine = task.split(/\r?\n/).find((line) => line.trim() !== "")?.trim() ?? "";
  let prefix = role;
  if (unit !== undefined && unit !== "") prefix += ` ${unit}`;
  if (round > 1) prefix += ` r${round}`;
  return `${prefix}: ${firstLine}`.slice(0, TITLE_MAX);
}
