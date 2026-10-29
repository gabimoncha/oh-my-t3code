import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnOmt, tempDir } from "../helpers.ts";

test("dated default-set commands are no longer exposed", () => {
  const root = tempDir();
  for (const args of [["defaults", "list"], ["defaults", "use", "2026-12"]]) {
    const result = spawnOmt(args, { root });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /unknown command/);
  }
});
