import type { Access, InteractionMode } from "../types.ts";

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
  unit?: string;
  access: Access;
  interactionMode: InteractionMode;
  evidenceDir?: string; // absolute; set for edit roles
}

const TITLE_MAX = 72;

function accessLine(access: Access, hasScope: boolean): string {
  if (access === "read-only") {
    return "Access: read-only. Change no files. Run only commands that leave the repository unchanged.";
  }
  return hasScope
    ? "Access: edit. Change only the files in Scope. If the task needs a change outside Scope, stop and report it under OPEN."
    : "Access: edit. Change only what the task needs.";
}

// Driving a device is slow, cheap work; every other role hands it to a test task, also at max depth.
function deviceLine(role: string, planMode: boolean, depth: number, maxDepth: number, configuredMaxDepth: number): string[] {
  if (role === "test") return [];
  // A plan-mode child cannot start a child with broader modes, so it hands the check to the conductor.
  if (planMode) return ["Devices: do not drive a device, Simulator UI, browser, or computer yourself (`agent-device`, `agent-browser`, computer use, UI flows); only the test role does that, on a cheap model. You run in plan mode and cannot start a `test` task, so list each device check with its steps and expected result under `OPEN` or `NOTES`, or before your result block when it has neither; the conductor sends it to a `test` task."];
  const command = `omt brief test --depth ${depth + 1}${maxDepth === configuredMaxDepth ? "" : ` --max-depth ${maxDepth}`}`;
  return [
    `Devices: do not drive a device, Simulator UI, browser, or computer yourself (\`agent-device\`, \`agent-browser\`, computer use, UI flows); only the test role does that, on a cheap model. For each device check, build a brief with \`${command}\` that gives the steps and the expected result, run it with \`delegate_task\` in \`mode: "wait"\`, and report its result. This delegation is allowed at any depth.`,
  ];
}


function delegationLine(role: string, planMode: boolean, depth: number, maxDepth: number, configuredMaxDepth: number): string {
  if (depth >= maxDepth) {
    const rest = role === "test" || planMode ? "Do all work yourself. Start no subagents and no delegated tasks." : "Do all work yourself. Start no subagents and no delegated tasks, except `test` tasks for device checks (see Devices).";
    return `Delegation: you are at depth ${depth} of ${maxDepth}. ${rest}`;
  }
  const start = `Delegation: you are at depth ${depth} of ${maxDepth}. You may delegate with the T3 delegate_task tool.`;
  if (maxDepth !== configuredMaxDepth) {
    return `${start} Give each child depth ${depth + 1}, and pass --max-depth ${maxDepth} to omt brief.`;
  }
  return `${start} Give each child depth ${depth + 1} in its brief.`;
}

function nonEmpty(items: string[] | undefined): string[] {
  return (items ?? []).map((item) => item.trim()).filter((item) => item !== "");
}

export function renderBrief(input: BriefInput, persona: string, contract: string): string {
  const scope = nonEmpty(input.scope);
  const done = nonEmpty(input.done);
  const verify = nonEmpty(input.verify);
  const context = input.context?.trim() ?? "";
  const prior = input.prior?.trim() ?? "";

  let header = `<!-- omt-brief v1 role=${input.role} round=${input.round} depth=${input.depth}/${input.maxDepth}`;
  if (input.plan !== undefined) header += ` plan=${input.plan}`;
  if (input.unit !== undefined) header += ` unit=${input.unit}`;
  header += " -->";

  const constraints = [
    accessLine(input.access, scope.length > 0),
    delegationLine(input.role, input.interactionMode === "plan", input.depth, input.maxDepth, input.configuredMaxDepth ?? input.maxDepth),
    ...(input.evidenceDir === undefined ? [] : [`Evidence: save command output and logs under ${input.evidenceDir}.`]),
    ...(input.interactionMode === "plan"
      ? [
          "Mode: you run in plan mode. Stay in it. Do not call ExitPlanMode and do not write a proposed plan. Put the result block in your final assistant message.",
        ]
      : []),
    "You do not see the parent conversation. This brief is your full context. If you need something that is missing, say so in your final message.",
    "Other agents may edit other files in this repository at the same time. Leave changes outside your scope alone. Do not commit, push, or create branches.",
    "Processes: do not run `pkill`, `killall`, or another kill by name, because it can stop your own run. Stop only a process that you started, by its PID. Give each command that can run long a time limit, for example `timeout 900 <command>`.",
    "Shared files: never break and restore files in the shared checkout, for example to prove that a test can fail. The test role makes that proof in a private copy.",
    ...deviceLine(input.role, input.interactionMode === "plan", input.depth, input.maxDepth, input.configuredMaxDepth ?? input.maxDepth),
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
