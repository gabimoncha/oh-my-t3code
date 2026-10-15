import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_SCHEMA } from "../../src/config/schema.ts";
import { LIMIT_KEYS, LIMIT_RANGES, ROLE_KEYS, ROOT_KEYS, RUNG_KEYS, VISUALS_KEYS } from "../../src/config/validate.ts";
import { formatJson } from "../../src/util/output.ts";
import { EFFORT_LADDER } from "../../src/types.ts";
import { PACKAGE_ROOT } from "../helpers.ts";

const sorted = (keys: readonly string[]) => [...keys].sort();

test("the committed schema equals the generated output", () => {
  const committed = readFileSync(join(PACKAGE_ROOT, "schema", "omt.schema.json"), "utf8");
  assert.equal(committed, formatJson(CONFIG_SCHEMA), "run `pnpm schema` to regenerate schema/omt.schema.json");
});

test("the schema is draft 2020-12", () => {
  assert.equal(CONFIG_SCHEMA.$schema, "https://json-schema.org/draft/2020-12/schema");
});

test("the schema allows exactly the keys that validateLayer allows", () => {
  const s = CONFIG_SCHEMA;
  assert.deepEqual(sorted(Object.keys(s.properties)), sorted(ROOT_KEYS));
  assert.deepEqual(sorted(Object.keys(s.$defs.role.properties)), sorted(ROLE_KEYS));
  assert.deepEqual(sorted(Object.keys(s.$defs.rung.properties)), sorted(RUNG_KEYS));
  assert.deepEqual(sorted(Object.keys(s.properties.limits.properties)), sorted(LIMIT_KEYS));
  assert.deepEqual(sorted(Object.keys(s.properties.visuals.properties)), sorted(VISUALS_KEYS));
  assert.equal(s.properties.visuals.properties.plan.type, "boolean");
});

test("every object that the validator closes has additionalProperties false", () => {
  const s = CONFIG_SCHEMA;
  for (const node of [s, s.properties.limits, s.properties.visuals, s.$defs.role, s.$defs.rung]) {
    assert.equal(node.additionalProperties, false);
  }
});

test("the schema ranges and enums match the validator", () => {
  const s = CONFIG_SCHEMA;
  for (const key of LIMIT_KEYS) {
    const limit = s.properties.limits.properties[key as keyof typeof s.properties.limits.properties];
    assert.deepEqual([limit.minimum, limit.maximum], LIMIT_RANGES[key as keyof typeof LIMIT_RANGES]);
  }
  assert.deepEqual(s.$defs.rung.properties.effort.enum, [...EFFORT_LADDER]);
  assert.deepEqual(s.$defs.rung.required, ["model"]);
});
