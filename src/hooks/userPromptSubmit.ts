import type { CliContext } from "../types.ts";

const WORD_RE = /(?<![\p{L}\p{N}_\-/$])(?:ulw|ultrawork)(?![\p{L}\p{N}_\-/$])/iu;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

function stripIgnored(prompt: string): string {
  const kept: string[] = [];
  let fence: string | undefined;
  for (const line of prompt.split(/\r?\n/)) {
    const marker = FENCE_RE.exec(line)?.[1];
    if (fence !== undefined) {
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (marker !== undefined) {
      fence = marker;
      continue;
    }
    if (/^\s*>/.test(line)) continue;
    kept.push(line);
  }
  return kept
    .join("\n")
    .replace(/(`+)[\s\S]*?\1/g, " ")
    .replace(/"[^"\n]*"/g, " ")
    .replace(/“[^”\n]*”/g, " ");
}

export function detectUltrawork(prompt: string): boolean {
  if (prompt.includes("<!-- omt-brief")) return false;
  const start = prompt.trimStart();
  if (start.startsWith("Act as the ")) return false;
  if (start.startsWith("/omt-ulw")) return false;
  return WORD_RE.test(stripIgnored(prompt));
}

export function ultraworkContext(): string {
  return [
    "omt ultrawork is on for this request.",
    "Before anything else, load the omt-ulw skill and follow it from step 1.",
    "Do not answer or start the work until the skill is loaded.",
    "Done needs evidence: report done only after the checks ran and passed, and quote their output.",
  ].join(" ");
}

export async function runUserPromptSubmitHook(ctx: CliContext): Promise<number> {
  try {
    const input = await ctx.readStdin();
    if (input.trim() === "") return 0;
    const parsed: unknown = JSON.parse(input);
    if (typeof parsed !== "object" || parsed === null) return 0;
    const prompt = (parsed as { prompt?: unknown }).prompt;
    if (typeof prompt !== "string" || !detectUltrawork(prompt)) return 0;
    const output = {
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: ultraworkContext() },
    };
    ctx.stdout(`${JSON.stringify(output)}\n`);
  } catch {
    // A hook failure must never block the user's prompt.
  }
  return 0;
}
