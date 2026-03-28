/**
 * Compile sensitivity patterns from the shared JSON config.
 * Single source of truth: config/sensitivity-patterns.json
 */

import patternsJson from "./sensitivity-patterns.json" with { type: "json" };

interface PatternDef {
  pattern: string;
  flags: string;
  label: string;
}

function compile(defs: PatternDef[]): [RegExp, string][] {
  return defs.map((d) => [new RegExp(d.pattern, d.flags), d.label]);
}

export const RESTRICTED_PATTERNS: [RegExp, string][] = compile(patternsJson.restricted);
export const PERSONAL_PATTERNS: [RegExp, string][] = compile(patternsJson.personal);
