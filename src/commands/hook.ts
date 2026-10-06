import { runUserPromptSubmitHook } from "../hooks/userPromptSubmit.ts";
import type { CommandRun } from "../types.ts";
import { usageError } from "../util/errors.ts";

export const summary = "Run an agent hook handler.";

export const usage = `Usage: omt hook user-prompt-submit

Read Claude Code UserPromptSubmit hook input from stdin. When the prompt
asks for ultrawork, print additional context that loads the omt-ulw skill.
Ignores extra arguments and always exits 0.

Options:
  -h, --help        print this help
`;

// The hook runs inside Claude Code, so after the hook name it ignores every argument and never fails.
export const run: CommandRun = async (ctx) => {
  const name = ctx.argv.find((arg) => !arg.startsWith("-"));
  if (name === undefined) throw usageError("hook needs a hook name: user-prompt-submit");
  if (name !== "user-prompt-submit") throw usageError(`unknown hook "${name}"`, "the only hook is user-prompt-submit");
  return runUserPromptSubmitHook(ctx);
};
