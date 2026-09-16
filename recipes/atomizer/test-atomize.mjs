#!/usr/bin/env node
/**
 * test-atomize.mjs — Sanity test for the atomize-text.mjs provider wiring.
 *
 * Runs a deliberately-compound synthetic paragraph through the atomizer and
 * prints the atoms. Useful to verify your provider of choice (OpenRouter,
 * Anthropic, or claude-cli) is reachable before running any of the live
 * scripts.
 *
 * Usage:
 *   # Default provider (openrouter, reads OPENROUTER_API_KEY from .env.local):
 *   node test-atomize.mjs
 *   # Force a specific provider:
 *   node test-atomize.mjs --provider=openrouter
 *   node test-atomize.mjs --provider=anthropic
 *   node test-atomize.mjs --provider=claude-cli  (standalone terminal only)
 *
 * Env (from recipes/atomizer/.env.local or process.env):
 *   OPENROUTER_API_KEY   required for --provider=openrouter (default)
 *   ANTHROPIC_API_KEY    required for --provider=anthropic
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { atomizeText } from "./lib/atomize-text.mjs";
import { loadEnv } from "./lib/entity-resolver.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = loadEnv(path.join(__dirname, ".env.local"));

// Synthetic compound example — intentionally non-personal and non-sensitive.
const testText = `The CI pipeline failed last night because the Node version bumped to 22 in the base image. Separately, I also noticed the lint step is now running on the whole repo instead of just the diff, which doubles the job time. We should pin the Node version in the image tag and switch the lint step back to diff-only.`;

let provider = null;
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--provider=")) provider = a.slice("--provider=".length);
}

const atomizeOpts = { timeoutMs: 60_000 };
if (provider) atomizeOpts.provider = provider;

// For HTTP providers, pre-load the key so errors point at env, not at the
// underlying fetch call. Default provider is 'openrouter' when unset.
const effectiveProvider = provider || "openrouter";
if (effectiveProvider === "anthropic") {
  atomizeOpts.anthropicApiKey = env.ANTHROPIC_API_KEY;
  if (!atomizeOpts.anthropicApiKey) {
    console.error("--provider=anthropic requires ANTHROPIC_API_KEY in .env.local or process env");
    process.exit(1);
  }
} else if (effectiveProvider === "openrouter") {
  atomizeOpts.openrouterApiKey = env.OPENROUTER_API_KEY;
  if (!atomizeOpts.openrouterApiKey) {
    console.error("--provider=openrouter requires OPENROUTER_API_KEY in .env.local or process env");
    process.exit(1);
  }
}

console.log(`[test] provider: ${effectiveProvider}`);
console.log(`[test] input text (${testText.length} chars): ${testText.slice(0, 100)}...`);

try {
  const atoms = await atomizeText(testText, atomizeOpts);
  console.log(`\n[test] PASS — got ${atoms.length} atoms:`);
  atoms.forEach((a, i) => console.log(`  ${i + 1}. ${a}`));
} catch (err) {
  console.error(`\n[test] FAIL: ${err.message}`);
  process.exit(1);
}
