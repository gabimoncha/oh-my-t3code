import type { OmtConfig } from "../types.ts";
import { DEFAULT_SETS, LATEST_DEFAULT_SET } from "./defaultSets.ts";

// The latest default set. A config selects another set with its "defaults" key.
export const DEFAULT_CONFIG: OmtConfig = DEFAULT_SETS[LATEST_DEFAULT_SET] as OmtConfig;
