/**
 * Compile sensitivity patterns from the shared JSON config.
 * Single source of truth: sensitivity-patterns.json
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const jsonPath = join(__dirname, "..", "sensitivity-patterns.json");
const patternsJson = JSON.parse(readFileSync(jsonPath, "utf-8"));

function compile(defs) {
  return defs.map((d) => [new RegExp(d.pattern, d.flags), d.label]);
}

export const RESTRICTED_PATTERNS = compile(patternsJson.restricted);
export const PERSONAL_PATTERNS = compile(patternsJson.personal);
