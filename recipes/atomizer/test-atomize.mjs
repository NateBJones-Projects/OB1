#!/usr/bin/env node
/**
 * test-atomize.mjs — Sanity test for the atomize-text.mjs provider wiring.
 *
 * Runs a deliberately-compound synthetic paragraph through the atomizer and
 * prints the atoms. Useful to verify your provider of choice (OpenRouter,
 * Anthropic, claude-cli, or codex) is reachable before running any of the
 * live scripts.
 *
 * Usage:
 *   # Auto-detect provider (codex if inside codex exec, claude-cli otherwise):
 *   node test-atomize.mjs
 *   # Force an HTTP provider:
 *   OPENROUTER_API_KEY=... node test-atomize.mjs --provider=openrouter
 *   ANTHROPIC_API_KEY=...  node test-atomize.mjs --provider=anthropic
 *
 * Env:
 *   OPENROUTER_API_KEY   required when --provider=openrouter
 *   ANTHROPIC_API_KEY    required when --provider=anthropic
 */

import { atomizeText } from "./lib/atomize-text.mjs";
import { loadEnv } from "./lib/entity-resolver.mjs";

const env = loadEnv(".env.local");

// Synthetic compound example — intentionally non-personal and non-sensitive.
const testText = `The CI pipeline failed last night because the Node version bumped to 22 in the base image. Separately, I also noticed the lint step is now running on the whole repo instead of just the diff, which doubles the job time. We should pin the Node version in the image tag and switch the lint step back to diff-only.`;

let provider = null;
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--provider=")) provider = a.slice("--provider=".length);
}

const atomizeOpts = { timeoutMs: 60_000 };
if (provider) atomizeOpts.provider = provider;
if (provider === "anthropic") {
  atomizeOpts.anthropicApiKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!atomizeOpts.anthropicApiKey) {
    console.error("--provider=anthropic requires ANTHROPIC_API_KEY");
    process.exit(1);
  }
}
if (provider === "openrouter") {
  atomizeOpts.openrouterApiKey = env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!atomizeOpts.openrouterApiKey) {
    console.error("--provider=openrouter requires OPENROUTER_API_KEY");
    process.exit(1);
  }
}

const detected = provider || (process.env.CODEX_THREAD_ID ? "codex" : "claude-cli");
console.log(`[test] provider: ${detected}`);
console.log(`[test] input text (${testText.length} chars): ${testText.slice(0, 100)}...`);

try {
  const atoms = await atomizeText(testText, atomizeOpts);
  console.log(`\n[test] PASS — got ${atoms.length} atoms:`);
  atoms.forEach((a, i) => console.log(`  ${i + 1}. ${a}`));
} catch (err) {
  console.error(`\n[test] FAIL: ${err.message}`);
  process.exit(1);
}
