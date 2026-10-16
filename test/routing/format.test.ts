import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import { formatRolesTable, formatTarget } from "../../src/routing/format.ts";
import { resolveAll } from "../../src/routing/resolve.ts";
import type { OmtConfig } from "../../src/types.ts";
import { caps } from "./shared.ts";

test("formatTarget prints instance and driver targets with sorted options", () => {
  assert.equal(formatTarget({ providerInstanceId: "codex", model: "gpt-6-astra" }), "codex/gpt-6-astra");
  assert.equal(
    formatTarget({
      providerInstanceId: "claudeAgent",
      model: "claude-opus-5-5",
      options: { fastMode: true, effort: "high", contextWindow: "1m" },
    }),
    "claudeAgent/claude-opus-5-5 contextWindow=1m effort=high fastMode=true",
  );
  assert.equal(
    formatTarget({ driverKind: "codex", model: "gpt-6.1-sol", options: { reasoningEffort: "medium" } }),
    "codex(driver)/gpt-6.1-sol reasoningEffort=medium",
  );
});

test("formatRolesTable matches the section 5.3 layout", () => {
  const base = DEFAULT_CONFIG.roles;
  const config: OmtConfig = {
    ...DEFAULT_CONFIG,
    roles: {
      execute: base.execute!,
      review: base.review!,
      oracle: { ...base.oracle!, chain: [{ driver: "grok", model: "grok-build", effort: "high" }] },
    },
  };
  assert.equal(
    formatRolesTable(resolveAll(config, caps())),
    [
      "ROLE         STATUS      TARGET                                         ACCESS     MODE     CROSS",
      "execute      resolved    claudeAgent/claude-opus-5-5 effort=medium      edit       default  no",
      "review       resolved    codex/gpt-6-astra reasoningEffort=high         read-only  plan     yes",
      "oracle       unavailable -                                              read-only  plan     yes",
      "  rung 1 grok/grok-build: provider grok cannot run child tasks: Provider instance is disabled.; Provider executable is not installed.",
      "",
      "verified against orchestrator_capabilities",
      "",
    ].join("\n"),
  );
});

test("formatRolesTable shows skipped rungs and the chosen rung's notes, not later rungs", () => {
  const config: OmtConfig = {
    ...DEFAULT_CONFIG,
    roles: {
      deep: {
        ...DEFAULT_CONFIG.roles.deep!,
        chain: [
          { driver: "grok", model: "grok-build" },
          { driver: "codex", model: "gpt-6-luna", effort: "max" },
          { driver: "codex", model: "gpt-9" },
        ],
      },
    },
  };
  const lines = formatRolesTable(resolveAll(config, caps())).split("\n");
  assert.equal(lines[1], "deep         resolved    codex/gpt-6-luna reasoningEffort=xhigh         edit       default  no");
  assert.deepEqual(lines.slice(2, 4), [
    "  rung 1 grok/grok-build: provider grok cannot run child tasks: Provider instance is disabled.; Provider executable is not installed.",
    "  rung 2 codex/gpt-6-luna: effort max mapped to xhigh for option reasoningEffort",
  ]);
  assert.equal(lines[4], "");
});

test("formatRolesTable widens columns and prints the unverified footer", () => {
  const output = formatRolesTable(resolveAll(DEFAULT_CONFIG));
  const lines = output.split("\n");
  assert.ok(output.endsWith("\nunverified: pass --capabilities <file> to check the chains against T3\n"));
  assert.equal(lines.length, 1 + Object.keys(DEFAULT_CONFIG.roles).length + 3);
  const planReview = lines.find((line) => line.startsWith("plan-review"));
  assert.equal(
    planReview,
    "plan-review  unverified  codex/gpt-6-astra reasoningEffort=high         read-only  plan     yes",
  );
  const long: OmtConfig = {
    ...DEFAULT_CONFIG,
    roles: {
      "a-very-long-role-name": {
        ...DEFAULT_CONFIG.roles.review!,
        chain: [{ provider: "claudeAgent", model: "claude-opus-5-5", options: { contextWindow: "1m", fastMode: true } }],
      },
    },
  };
  const longLines = formatRolesTable(resolveAll(long, caps())).split("\n");
  assert.equal(
    longLines[0],
    "ROLE                   STATUS      TARGET                                                      ACCESS     MODE     CROSS",
  );
  assert.equal(
    longLines[1],
    "a-very-long-role-name  resolved    claudeAgent/claude-opus-5-5 contextWindow=1m fastMode=true  read-only  plan     yes",
  );
});

test("formatRolesTable takes MODE from the role's interactionMode, also when unavailable", () => {
  const config: OmtConfig = {
    ...DEFAULT_CONFIG,
    roles: {
      odd: {
        ...DEFAULT_CONFIG.roles.execute!,
        interactionMode: "inherit",
        chain: [{ driver: "grok", model: "grok-build" }],
      },
    },
  };
  const lines = formatRolesTable(resolveAll(config, caps())).split("\n");
  assert.match(lines[1] ?? "", /^odd\s+unavailable\s+-\s+edit\s+inherit\s+no$/);
});
