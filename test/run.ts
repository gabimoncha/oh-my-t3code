import assert from "node:assert/strict";
import type { DoctorCheck, DoctorReport } from "../src/install/doctor.ts";
import { main } from "../src/main.ts";
import { fakeContext } from "./helpers.ts";
import type { FakeContextOptions } from "./helpers.ts";

export async function runMain(argv: string[], options: FakeContextOptions = {}) {
  const ctx = fakeContext(options);
  const code = await main(argv, ctx);
  return { code, ctx };
}

export async function runOk(argv: string[], options: FakeContextOptions = {}, message?: string) {
  const { code, ctx } = await runMain(argv, options);
  assert.equal(code, 0, message ?? ctx.err());
  return { ctx };
}

export async function doctor(runner: { run: typeof runMain }, argv: string[] = [], options: FakeContextOptions = {}) {
  const { code, ctx } = await runner.run(["doctor", "--json", ...argv], options);
  const report = JSON.parse(ctx.out()) as DoctorReport;
  const byId = new Map(report.checks.map((check) => [check.id, check]));
  const get = (id: string): DoctorCheck => {
    const found = byId.get(id);
    assert.ok(found, id);
    return found;
  };
  return { code, report, get };
}
