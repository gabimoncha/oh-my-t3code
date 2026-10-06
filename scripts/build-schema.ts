import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_SCHEMA } from "../src/config/schema.ts";
import { writeFileAtomic } from "../src/util/fs.ts";
import { formatJson } from "../src/util/output.ts";

const target = join(dirname(dirname(fileURLToPath(import.meta.url))), "schema", "omt.schema.json");
await writeFileAtomic(target, formatJson(CONFIG_SCHEMA));
process.stdout.write(`wrote ${target}\n`);
