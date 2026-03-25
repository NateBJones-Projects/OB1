/**
 * Sensitivity detection for Open Brain thoughts.
 *
 * Classifies content into three tiers based on regex pattern matching:
 *   - restricted: contains SSNs, passport numbers, API keys, passwords, credit cards, bank accounts
 *   - personal:   contains medication dosages, drug names, health measurements, financial details
 *   - standard:   everything else (default)
 *
 * Patterns are loaded from sensitivity-patterns.json (single source of truth).
 *
 * Usage (Deno):
 *   import patternsJson from "./sensitivity-patterns.json" with { type: "json" };
 *   import { detectSensitivity, compilePatterns } from "./detect-sensitivity.ts";
 *   const patterns = compilePatterns(patternsJson);
 *   const result = detectSensitivity("my SSN is 123-45-6789", patterns);
 *   // { tier: "restricted", reasons: ["ssn_pattern"] }
 *
 * Usage (Node.js):
 *   import { readFileSync } from "fs";
 *   const patternsJson = JSON.parse(readFileSync("./sensitivity-patterns.json", "utf-8"));
 *   // then same as above
 */

export type SensitivityTier = "standard" | "personal" | "restricted";

export interface SensitivityResult {
  tier: SensitivityTier;
  reasons: string[];
}

export interface PatternDef {
  pattern: string;
  flags: string;
  label: string;
}

export interface PatternsConfig {
  restricted: PatternDef[];
  personal: PatternDef[];
}

export interface CompiledPatterns {
  restricted: [RegExp, string][];
  personal: [RegExp, string][];
}

/** Compile raw pattern definitions from JSON into RegExp pairs. */
export function compilePatterns(config: PatternsConfig): CompiledPatterns {
  const compile = (defs: PatternDef[]): [RegExp, string][] =>
    defs.map((d) => [new RegExp(d.pattern, d.flags), d.label]);

  return {
    restricted: compile(config.restricted),
    personal: compile(config.personal),
  };
}

/**
 * Detect the sensitivity tier of a text string.
 *
 * Returns immediately on first restricted match (short-circuit).
 * Collects all personal matches before returning.
 * Returns "standard" if no patterns match.
 */
export function detectSensitivity(
  text: string,
  patterns: CompiledPatterns,
): SensitivityResult {
  const reasons: string[] = [];

  // Check restricted patterns first (highest priority, short-circuit)
  for (const [pattern, reason] of patterns.restricted) {
    if (pattern.test(text)) {
      return { tier: "restricted", reasons: [reason] };
    }
  }

  // Check personal patterns (collect all matches)
  for (const [pattern, reason] of patterns.personal) {
    if (pattern.test(text)) {
      reasons.push(reason);
    }
  }

  if (reasons.length > 0) {
    return { tier: "personal", reasons };
  }

  return { tier: "standard", reasons: [] };
}
