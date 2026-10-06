import type { CliContext } from "../types.ts";

// Returns true when the plan may be applied. Prints the reason when it may not.
export async function confirmApply(ctx: CliContext, yes: boolean): Promise<boolean> {
  if (yes) return true;
  if (!ctx.isTTY) {
    ctx.stderr("Re-run with --yes to apply.\n");
    return false;
  }
  const answer = (await ctx.prompt("Apply this plan? [y/N] ")).trim().toLowerCase();
  if (answer === "y" || answer === "yes") return true;
  ctx.stdout("Nothing was changed.\n");
  return false;
}
