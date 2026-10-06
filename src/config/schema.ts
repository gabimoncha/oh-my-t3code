import { EFFORT_LADDER } from "../types.ts";
import { SCHEMA_URL } from "./starter.ts";
import {
  ACCESS_VALUES,
  CHAIN_MAX,
  CHAIN_MIN,
  DESCRIPTION_MAX,
  INTERACTION_MODE_VALUES,
  LIMIT_RANGES,
  MODEL_MAX,
  PROVIDER_PATTERN,
  RESULT_VALUES,
  ROLE_NAME_PATTERN,
  RUNTIME_MODE_VALUES,
  T3_ROLE_VALUES,
} from "./validate.ts";

function limit(name: keyof typeof LIMIT_RANGES, description: string) {
  const [minimum, maximum] = LIMIT_RANGES[name];
  return { type: "integer", minimum, maximum, description };
}

export const CONFIG_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: SCHEMA_URL,
  title: "oh-my-t3code config",
  description: "A user (~/.config/oh-my-t3code/config.jsonc) or project (.omt/config.jsonc) config layer.",
  type: "object",
  additionalProperties: false,
  properties: {
    $schema: { type: "string" },
    version: { const: 1 },
    roles: {
      type: "object",
      description: "Role overrides and new roles. Set a role to null to remove it.",
      propertyNames: { pattern: ROLE_NAME_PATTERN },
      additionalProperties: {
        oneOf: [{ type: "null" }, { $ref: "#/$defs/role" }],
      },
    },
    limits: {
      type: "object",
      additionalProperties: false,
      properties: {
        maxParallel: limit("maxParallel", "Most child tasks that run at the same time."),
        maxTasksPerRun: limit("maxTasksPerRun", "Most child tasks in one run."),
        maxDepth: limit("maxDepth", "Most levels of delegation below the main thread."),
        maxReviewRounds: limit("maxReviewRounds", "Most review rounds for one unit."),
      },
    },
  },
  $defs: {
    role: {
      type: "object",
      additionalProperties: false,
      properties: {
        description: { type: "string", minLength: 1, maxLength: DESCRIPTION_MAX },
        access: { enum: [...ACCESS_VALUES] },
        result: { enum: [...RESULT_VALUES] },
        t3Role: { enum: [...T3_ROLE_VALUES] },
        interactionMode: { enum: [...INTERACTION_MODE_VALUES] },
        runtimeMode: { enum: [...RUNTIME_MODE_VALUES] },
        crossFamily: {
          type: "boolean",
          description: "With --against, try the rungs outside the worker's family first.",
        },
        chain: {
          type: "array",
          minItems: CHAIN_MIN,
          maxItems: CHAIN_MAX,
          items: { $ref: "#/$defs/rung" },
        },
      },
    },
    rung: {
      type: "object",
      additionalProperties: false,
      required: ["model"],
      anyOf: [{ required: ["provider"] }, { required: ["driver"] }],
      properties: {
        provider: { type: "string", pattern: PROVIDER_PATTERN, description: "T3 provider instance id." },
        driver: { type: "string", pattern: PROVIDER_PATTERN, description: "T3 driver kind." },
        model: { type: "string", minLength: 1, maxLength: MODEL_MAX },
        effort: { enum: [...EFFORT_LADDER] },
        options: {
          type: "object",
          additionalProperties: { type: ["string", "boolean"] },
        },
      },
    },
  },
};
