#!/usr/bin/env node
/**
 * atomize-packs.mjs — Detect compound (multi-topic) memories in JSON pack
 * files and split them into atomic single-topic memories via an LLM.
 *
 * Works on local JSON "pack" files (arrays of memory objects) exported from
 * any capture source before they are loaded into Open Brain. Each pack is a
 * JSON file whose memory array is either the top-level array, or nested
 * under `memories` or `safe_memories`.
 *
 * WARNING: When using provider='claude-cli', this script must be run from a
 * STANDALONE terminal, NOT from within a Claude Code session. The claude
 * CLI fails with nested-detection / OAuth errors when called from inside
 * a Claude Code agent session. Workarounds: use provider='codex' (delegated
 * via `codex exec`) or provider='anthropic' / 'openrouter' (HTTP APIs).
 *
 * Usage:
 *   node atomize-packs.mjs --source <name>              Process one source
 *   node atomize-packs.mjs --all                        Process all sources
 *   node atomize-packs.mjs --source <name> --dry-run    Detect only
 *   node atomize-packs.mjs --concurrency 4              Parallel LLM calls
 *   node atomize-packs.mjs --data-dir <path>            Override pack root
 *   node atomize-packs.mjs --provider <name>            Override provider
 *   node atomize-packs.mjs --help                       Show usage
 *
 * Env:
 *   OPENROUTER_API_KEY   Required when --provider openrouter
 *   ANTHROPIC_API_KEY    Required when --provider anthropic
 *   CLAUDE_CLI_PATH      Optional path to `claude` binary
 *   CODEX_CLI_PATH       Optional path to `codex` binary
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { atomizeText } from "./lib/atomize-text.mjs";

// ── Paths & constants ───────────────────────────────────────────────────────

// Default pack root follows the convention used by several OB1 recipes
// (daily-digest, panning-for-gold, etc.): a `data/atomic-memories/standard/`
// tree where each source has its own sub-folder full of pack JSON files.
const DEFAULT_DATA_ROOT = path.join(process.cwd(), "data", "atomic-memories");

const KNOWN_SOURCES = [
  "instagram", "grok", "x-twitter", "claude", "journals",
  "gemini", "google-activity", "limitless", "chatgpt",
];

const MAX_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 30_000;
const FAILURE_RATE_WINDOW = 100;
const FAILURE_RATE_THRESHOLD = 0.02; // 2%

// ── CLI argument parsing (early — we need --data-dir before computing paths)─

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    source: null,
    all: false,
    dryRun: false,
    concurrency: 1,
    dataDir: null,
    provider: null,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--source":
        opts.source = args[++i];
        break;
      case "--all":
        opts.all = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--concurrency":
        opts.concurrency = Math.min(Math.max(parseInt(args[++i], 10) || 1, 1), MAX_CONCURRENCY);
        break;
      case "--data-dir":
        opts.dataDir = args[++i];
        break;
      case "--provider":
        opts.provider = args[++i];
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
      default:
        console.error(`Unknown flag: ${args[i]}`);
        process.exit(1);
    }
  }

  return opts;
}

// ── Fingerprint ─────────────────────────────────────────────────────────────

function fingerprint(text) {
  const normalized = text.toLowerCase().trim().replace(/\s+/g, " ");
  return createHash("sha256").update(normalized).digest("hex");
}

// ── Compound detection heuristics ───────────────────────────────────────────

function countSentences(text) {
  const parts = text.split(/[.!?]+/).filter((s) => s.trim().length >= 10);
  return parts.length;
}

function hasEnumerationPatterns(text) {
  const numberedPattern = /(?:^|\n)\s*\d+\.\s/;
  const bulletPattern = /(?:^|\n)\s*[-•*]\s/;
  return numberedPattern.test(text) || bulletPattern.test(text);
}

function countSemicolonClauses(text) {
  return (text.match(/;/g) || []).length;
}

function hasHighConjunctionDensity(text) {
  const conjunctions = [" and ", " but ", " however ", " also ", " additionally "];
  let count = 0;
  const lower = text.toLowerCase();
  for (const c of conjunctions) {
    count += lower.split(c).length - 1;
  }
  return count >= 3;
}

function isCompound(text) {
  if (!text || typeof text !== "string") return false;
  if (countSentences(text) >= 3) return true;
  if (hasEnumerationPatterns(text)) return true;
  if (countSemicolonClauses(text) >= 2) return true;
  if (hasHighConjunctionDensity(text)) return true;
  return false;
}

// ── Child memory creation ───────────────────────────────────────────────────

function createChildMemories(parent, atomicTexts, providerName) {
  return atomicTexts.map((text, index) => ({
    memoryId: `${parent.memoryId}-split-${index}`,
    text,
    fingerprint: fingerprint(text),
    importance: parent.importance,
    type: parent.type,
    tags: Array.isArray(parent.tags) ? [...parent.tags] : [],
    context: parent.context || "",
    sensitive: parent.sensitive || false,
    sensitivity: parent.sensitivity || "standard",
    metadata: {
      ...(parent.metadata || {}),
      atomization: {
        parent_id: parent.memoryId,
        split_index: index,
        split_total: atomicTexts.length,
        provider: providerName,
      },
    },
  }));
}

// ── Pack file I/O ───────────────────────────────────────────────────────────

function readPackFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writePackFile(filePath, data) {
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, filePath);
}

function getPackFiles(sourceDir) {
  if (!fs.existsSync(sourceDir)) return [];
  return fs.readdirSync(sourceDir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("atomization-") && f !== "manifest.json")
    .map((f) => path.join(sourceDir, f));
}

function getMemories(pack) {
  if (Array.isArray(pack)) return pack;
  if (Array.isArray(pack.safe_memories)) return pack.safe_memories;
  if (Array.isArray(pack.memories)) return pack.memories;
  return [];
}

function setMemories(pack, memories) {
  if (Array.isArray(pack)) return memories;
  if (Array.isArray(pack.safe_memories)) {
    pack.safe_memories = memories;
    return pack;
  }
  if (Array.isArray(pack.memories)) {
    pack.memories = memories;
    return pack;
  }
  return memories;
}

// ── Concurrency helper ──────────────────────────────────────────────────────

async function processInBatches(items, batchSize, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

// ── Provider config ─────────────────────────────────────────────────────────

function resolveProviderConfig(opts) {
  // Explicit CLI flag wins; otherwise let atomize-text.mjs auto-detect.
  const provider = opts.provider || null;

  const atomizeOpts = {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    minAtoms: 1,
  };
  if (provider) atomizeOpts.provider = provider;

  if (provider === "anthropic") {
    atomizeOpts.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    if (!atomizeOpts.anthropicApiKey) {
      throw new Error("--provider anthropic requires ANTHROPIC_API_KEY in env");
    }
  } else if (provider === "openrouter") {
    atomizeOpts.openrouterApiKey = process.env.OPENROUTER_API_KEY;
    if (!atomizeOpts.openrouterApiKey) {
      throw new Error("--provider openrouter requires OPENROUTER_API_KEY in env");
    }
  }

  const effective = provider || (process.env.CODEX_THREAD_ID ? "codex" : "claude-cli");
  return { atomizeOpts, providerName: effective };
}

// ── Process a single source ─────────────────────────────────────────────────

async function processSource(source, options, atomicDir) {
  const { dryRun, concurrency, atomizeOpts, providerName } = options;
  const sourceDir = path.join(atomicDir, source);
  const packFiles = getPackFiles(sourceDir);

  if (packFiles.length === 0) {
    console.log(`[${source}] No pack files found in ${sourceDir}`);
    return null;
  }

  console.log(`[${source}] Found ${packFiles.length} pack file(s)`);

  // Phase 1: Scan all memories and detect compounds
  let totalMemories = 0;
  const compounds = [];

  for (const packFile of packFiles) {
    const pack = readPackFile(packFile);
    const memories = getMemories(pack);
    for (let i = 0; i < memories.length; i++) {
      totalMemories++;
      const mem = memories[i];
      if (isCompound(mem.text)) {
        compounds.push({ packFile, memoryIndex: i, memory: mem });
      }
    }
  }

  console.log(`[${source}] ${compounds.length}/${totalMemories} compound detected`);

  if (compounds.length === 0 || dryRun) {
    const report = {
      source,
      total_memories: totalMemories,
      compound_detected: compounds.length,
      splits_generated: 0,
      net_change: 0,
      errors: 0,
      timestamp: new Date().toISOString(),
    };
    if (dryRun) {
      console.log(`[${source}] Dry run — no splitting performed`);
      if (compounds.length > 0) {
        console.log(`[${source}] Sample compounds:`);
        for (const c of compounds.slice(0, 3)) {
          const preview = c.memory.text.substring(0, 120).replace(/\n/g, " ");
          console.log(`  - [${c.memory.memoryId}] ${preview}...`);
        }
      }
    }
    writeReport(sourceDir, report);
    return report;
  }

  // Phase 2: Split compounds with the chosen provider
  console.log(`[${source}] Splitting ${compounds.length} compounds (concurrency: ${concurrency}, provider: ${providerName})...`);

  let splitsGenerated = 0;
  let errorCount = 0;
  let processed = 0;
  const errors = [];
  const splitResults = new Map();
  const recentResults = [];

  const splitOne = async (compound) => {
    const { packFile, memoryIndex, memory } = compound;
    try {
      const atoms = await atomizeText(memory.text, atomizeOpts);
      const children = createChildMemories(memory, atoms, providerName);

      if (!splitResults.has(packFile)) {
        splitResults.set(packFile, new Map());
      }
      splitResults.get(packFile).set(memoryIndex, children);

      splitsGenerated += children.length;
      processed++;
      recentResults.push(true);

      if (processed % 5 === 0 || processed === compounds.length) {
        console.log(`[${source}] [${processed}/${compounds.length} done] ${children.length} atoms from "${memory.text.substring(0, 60).replace(/\n/g, " ")}..."`);
      }

      return { success: true, children };
    } catch (err) {
      errorCount++;
      processed++;
      recentResults.push(false);
      errors.push({
        memoryId: memory.memoryId,
        text: memory.text,
        error: err.message,
        packFile: path.basename(packFile),
      });
      console.error(`[${source}] Error splitting ${memory.memoryId}: ${err.message}`);

      if (recentResults.length >= FAILURE_RATE_WINDOW) {
        const windowSlice = recentResults.slice(-FAILURE_RATE_WINDOW);
        const failureRate = windowSlice.filter((r) => !r).length / windowSlice.length;
        if (failureRate > FAILURE_RATE_THRESHOLD) {
          const msg = `[${source}] HALTING: failure rate ${(failureRate * 100).toFixed(1)}% exceeds ${FAILURE_RATE_THRESHOLD * 100}% threshold in last ${FAILURE_RATE_WINDOW} memories`;
          console.error(msg);
          throw new Error(msg);
        }
      }

      return { success: false };
    }
  };

  try {
    await processInBatches(compounds, concurrency, splitOne);
  } catch (err) {
    console.error(`[${source}] Processing halted early: ${err.message}`);
  }

  // Phase 3: Rewrite pack files with atomized memories
  console.log(`[${source}] Rewriting pack files...`);

  for (const packFile of packFiles) {
    const replacements = splitResults.get(packFile);
    if (!replacements || replacements.size === 0) continue;

    const pack = readPackFile(packFile);
    const memories = getMemories(pack);
    const newMemories = [];

    for (let i = 0; i < memories.length; i++) {
      if (replacements.has(i)) {
        newMemories.push(...replacements.get(i));
      } else {
        newMemories.push(memories[i]);
      }
    }

    const updatedPack = setMemories(pack, newMemories);
    writePackFile(packFile, updatedPack);
    console.log(`[${source}] Rewrote ${path.basename(packFile)}: ${memories.length} -> ${newMemories.length} memories`);
  }

  // Phase 4: Write reports
  const netChange = splitsGenerated - compounds.length + errorCount;
  const report = {
    source,
    total_memories: totalMemories,
    compound_detected: compounds.length,
    splits_generated: splitsGenerated,
    net_change: netChange,
    errors: errorCount,
    timestamp: new Date().toISOString(),
  };

  writeReport(sourceDir, report);

  if (errors.length > 0) {
    const errPath = path.join(sourceDir, "atomization-errors.json");
    writePackFile(errPath, errors);
    console.log(`[${source}] Wrote ${errors.length} errors to ${path.basename(errPath)}`);
  }

  console.log(`[${source}] Done: ${compounds.length} compounds -> ${splitsGenerated} atoms (${errorCount} errors)`);
  return report;
}

function writeReport(sourceDir, report) {
  const reportPath = path.join(sourceDir, "atomization-report.json");
  if (!fs.existsSync(sourceDir)) fs.mkdirSync(sourceDir, { recursive: true });
  writePackFile(reportPath, report);
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function printHelp(atomicDir) {
  console.log(`
atomize-packs.mjs — Split compound memories into atomic single-topic thoughts

Usage:
  node atomize-packs.mjs --source <name>          Process one source
  node atomize-packs.mjs --all                    Process all sources
  node atomize-packs.mjs --source <name> --dry-run  Detect only, no splitting
  node atomize-packs.mjs --concurrency <N>        Parallel LLM calls (default: 1, max: ${MAX_CONCURRENCY})
  node atomize-packs.mjs --data-dir <path>        Override atomic-memories root
  node atomize-packs.mjs --provider <name>        Override LLM provider
  node atomize-packs.mjs --help                   Show this help

Providers:
  claude-cli   Shell out to local \`claude\` binary (requires standalone terminal)
  codex        Shell out to local \`codex\` binary (safe to nest inside Claude Code)
  anthropic    Anthropic API (requires ANTHROPIC_API_KEY)
  openrouter   OpenRouter API (requires OPENROUTER_API_KEY)

Known sources: ${KNOWN_SOURCES.join(", ")}

Pack file directory: ${atomicDir}
`);
}

async function main() {
  const opts = parseArgs();
  const atomicDir = path.join(
    opts.dataDir ? path.resolve(opts.dataDir) : DEFAULT_DATA_ROOT,
    "standard",
  );

  if (opts.help || (!opts.source && !opts.all)) {
    printHelp(atomicDir);
    process.exit(opts.help ? 0 : 1);
  }

  if (opts.source && !KNOWN_SOURCES.includes(opts.source)) {
    console.error(`Unknown source: "${opts.source}". Known: ${KNOWN_SOURCES.join(", ")}`);
    process.exit(1);
  }

  const { atomizeOpts, providerName } = resolveProviderConfig(opts);

  const sources = opts.all ? KNOWN_SOURCES : [opts.source];

  console.log(`\natomize-packs — ${opts.dryRun ? "DRY RUN" : "LIVE"} mode, concurrency: ${opts.concurrency}, provider: ${providerName}`);
  console.log(`Sources: ${sources.join(", ")}\n`);

  if (!opts.dryRun && providerName === "claude-cli") {
    console.log("NOTE: provider=claude-cli must be run from a STANDALONE terminal, not inside Claude Code.\n");
  }

  const reports = [];
  for (const source of sources) {
    const report = await processSource(source, {
      dryRun: opts.dryRun,
      concurrency: opts.concurrency,
      atomizeOpts,
      providerName,
    }, atomicDir);
    if (report) reports.push(report);
  }

  if (reports.length > 0) {
    console.log("\n=== Summary ===");
    console.log(`${"Source".padEnd(18)} ${"Total".padStart(7)} ${"Compound".padStart(9)} ${"Splits".padStart(7)} ${"Net D".padStart(7)} ${"Errors".padStart(7)}`);
    console.log("-".repeat(58));
    for (const r of reports) {
      console.log(
        `${r.source.padEnd(18)} ${String(r.total_memories).padStart(7)} ${String(r.compound_detected).padStart(9)} ${String(r.splits_generated).padStart(7)} ${String(r.net_change > 0 ? "+" + r.net_change : r.net_change).padStart(7)} ${String(r.errors).padStart(7)}`,
      );
    }
    const totals = reports.reduce((acc, r) => ({
      total: acc.total + r.total_memories,
      compound: acc.compound + r.compound_detected,
      splits: acc.splits + r.splits_generated,
      net: acc.net + r.net_change,
      errors: acc.errors + r.errors,
    }), { total: 0, compound: 0, splits: 0, net: 0, errors: 0 });
    console.log("-".repeat(58));
    console.log(
      `${"TOTAL".padEnd(18)} ${String(totals.total).padStart(7)} ${String(totals.compound).padStart(9)} ${String(totals.splits).padStart(7)} ${String(totals.net > 0 ? "+" + totals.net : totals.net).padStart(7)} ${String(totals.errors).padStart(7)}`,
    );
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
