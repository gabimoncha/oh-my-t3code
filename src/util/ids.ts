import { usageError } from "./errors.ts";

export const PLAN_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const UNIT_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

export function checkPlanSlug(slug: string, flag = "plan slug"): string {
  if (!PLAN_SLUG_RE.test(slug)) {
    throw usageError(`invalid ${flag} "${slug}"`, "a plan slug matches ^[a-z0-9][a-z0-9-]{0,63}$");
  }
  return slug;
}

export function checkUnitId(unit: string): string {
  if (!UNIT_ID_RE.test(unit)) throw usageError(`invalid --unit "${unit}"`, "a unit id matches ^[A-Za-z0-9._-]{1,64}$");
  return unit;
}
