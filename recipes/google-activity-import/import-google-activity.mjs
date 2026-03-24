#!/usr/bin/env node
/**
 * Open Brain — Google Activity Import
 *
 * Reads Google Takeout "My Activity" JSON files, filters noise, groups entries
 * by day, summarizes each day via LLM into 1-3 standalone thoughts, and loads
 * them into your Open Brain with vector embeddings and metadata.
 *
 * Usage:
 *   node import-google-activity.mjs ./Takeout/My\ Activity [options]
 *   node import-google-activity.mjs ./Takeout/My\ Activity --dry-run --limit 5
 *
 * Environment variables:
 *   SUPABASE_URL              Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY Supabase service role key
 *   OPENROUTER_API_KEY        OpenRouter API key (for summarization + embeddings)
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, basename } from "path";
import { createHash } from "crypto";

// ─── Configuration ──────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const SYNC_LOG_PATH = "google-activity-sync-log.json";

// Categories worth importing (skip low-signal ones like Ads, Assistant, etc.)
const HIGH_VALUE_CATEGORIES = new Set([
  "Search", "Gmail", "Maps", "YouTube", "Chrome", "Gemini Apps"
]);

// ─── Summarization Prompt ───────────────────────────────────────────────────

const SUMMARIZATION_PROMPT = `You are distilling a day of Google activity into standalone thoughts for a personal knowledge base. Your job is to be HIGHLY SELECTIVE — only extract knowledge that reveals interests, habits, decisions, or context worth retrieving later.

CAPTURE these (1-3 thoughts max per day):
- Research patterns: what topics were being explored and why
- Decisions reflected in searches (comparing products, services, locations)
- People or places searched for with context
- Navigation patterns that reveal habits or life events
- Email subjects that reveal projects, relationships, or commitments
- Recurring interests across multiple searches in one day

SKIP these entirely (return empty):
- Random one-off searches with no lasting significance
- Generic lookups (weather, time, spelling, unit conversions)
- Days with only 1-2 trivial searches
- YouTube video watching without a clear research pattern
- Routine navigation to familiar places

Each thought must be:
- A clear, standalone statement (makes sense without seeing the raw searches)
- Written in first person
- Anchored with dates and specific context
- 1-3 sentences

Return JSON: {"thoughts": ["thought1", "thought2"]}
If the day has nothing worth capturing, return {"thoughts": []}
Err on the side of returning empty — less is more.`;

// ─── CLI Parsing ────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    inputPath: null,
    dryRun: false,
    limit: 0,
    after: null,
    before: null,
    verbose: false,
    raw: false,
    categories: null,  // null = all high-value
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--dry-run":
        config.dryRun = true;
        break;
      case "--limit":
        config.limit = parseInt(args[++i], 10);
        break;
      case "--after":
        config.after = args[++i];
        break;
      case "--before":
        config.before = args[++i];
        break;
      case "--verbose":
        config.verbose = true;
        break;
      case "--raw":
        config.raw = true;
        break;
      case "--categories":
        config.categories = new Set(args[++i].split(",").map(s => s.trim()));
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      default:
        if (!args[i].startsWith("--") && !config.inputPath) {
          config.inputPath = args[i];
        } else {
          console.error(`Unknown option: ${args[i]}`);
          process.exit(1);
        }
    }
  }

  if (!config.inputPath) {
    printUsage();
    process.exit(1);
  }

  return config;
}

function printUsage() {
  console.log(`
Open Brain — Google Activity Import

Usage:
  node import-google-activity.mjs <takeout-path> [options]

Arguments:
  takeout-path           Path to your extracted Google Takeout "My Activity" folder

Options:
  --dry-run              Parse, filter, summarize — don't write to database
  --limit N              Max activity-days to process (0 = unlimited)
  --after YYYY-MM-DD     Only process activity after this date
  --before YYYY-MM-DD    Only process activity before this date
  --categories LIST      Comma-separated categories (default: Search,Gmail,Maps,YouTube,Chrome)
  --raw                  Skip LLM summarization, insert grouped entries as-is
  --verbose              Show full thought text during processing
  --help                 Show this message

Examples:
  node import-google-activity.mjs ./Takeout/My\\ Activity --dry-run --limit 5
  node import-google-activity.mjs ./Takeout/My\\ Activity --after 2024-01-01
  node import-google-activity.mjs ./Takeout/My\\ Activity --categories Search,Gmail
  `);
}

// ─── Sync Log ───────────────────────────────────────────────────────────────

function loadSyncLog() {
  try {
    return JSON.parse(readFileSync(SYNC_LOG_PATH, "utf8"));
  } catch {
    return { ingested_days: {}, last_sync: "" };
  }
}

function saveSyncLog(log) {
  log.last_sync = new Date().toISOString();
  writeFileSync(SYNC_LOG_PATH, JSON.stringify(log, null, 2));
}

// ─── HTTP Helpers ───────────────────────────────────────────────────────────

async function httpPost(url, headers, body, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (resp.status >= 500 && attempt < retries) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      return resp;
    } catch (err) {
      if (attempt < retries) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function hashText(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

// ─── Google Takeout Parsing ─────────────────────────────────────────────────

function findMyActivityFiles(dirPath) {
  const results = [];

  function walk(d, depth) {
    if (depth > 4) return;
    try {
      const entries = readdirSync(d, { withFileTypes: true });
      for (const e of entries) {
        const full = join(d, e.name);
        if (e.isFile() && e.name === "MyActivity.json") {
          results.push({ file: full, category: basename(d) });
        } else if (e.isDirectory() && !e.name.startsWith(".")) {
          walk(full, depth + 1);
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  walk(dirPath, 0);
  return results;
}

function filterActivities(activities, category) {
  return activities.filter(a => {
    const title = typeof a.title === "string" ? a.title : "";
    if (title.length < 10) return false;
    if (/^\d+ notification/.test(title)) return false;

    // Maps: only keep searches, directions, navigation — skip passive visits
    if (category === "Maps") {
      if (title.startsWith("Visited ")) return false;
      if (title.startsWith("Viewed ")) return false;
      if (title.startsWith("Used maps")) return false;
      if (title.startsWith("Opened ")) return false;
      if (
        !title.startsWith("Searched for") &&
        !title.startsWith("Direction") &&
        !title.startsWith("Navigat") &&
        title.length < 30
      ) return false;
    }

    // YouTube: skip passive watching, keep searches and longer watch sessions
    if (category === "YouTube") {
      if (title.startsWith("Watched ") && title.length < 40) return false;
      if (title.startsWith("Visited ")) return false;
    }

    // Chrome: skip very short page titles
    if (category === "Chrome") {
      if (title.length < 15) return false;
    }

    return true;
  });
}

function groupByDay(activities) {
  const byDay = {};
  for (const a of activities) {
    const time = typeof a.time === "string" ? a.time : "";
    const day = time.slice(0, 10) || "unknown";
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(typeof a.title === "string" ? a.title : String(a.title || ""));
  }
  return byDay;
}

// ─── LLM Summarization ─────────────────────────────────────────────────────

async function summarizeDay(category, day, entries) {
  const transcript = `Google ${category} activity for ${day}:\n\n${entries.join("\n")}`;
  const truncated = transcript.slice(0, 6000);

  const resp = await httpPost(
    `${OPENROUTER_BASE}/chat/completions`,
    {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    {
      model: "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SUMMARIZATION_PROMPT },
        { role: "user", content: truncated },
      ],
      temperature: 0,
    }
  );

  if (!resp || !resp.ok) {
    const status = resp ? resp.status : "no response";
    console.log(`   Warning: Summarization failed (${status}), skipping day.`);
    return [];
  }

  try {
    const data = await resp.json();
    const result = JSON.parse(data.choices[0].message.content);
    const thoughts = result.thoughts || [];
    return thoughts.filter(t => typeof t === "string" && t.trim());
  } catch (e) {
    console.log(`   Warning: Failed to parse summarization response: ${e.message}`);
    return [];
  }
}

// ─── Embedding Generation ───────────────────────────────────────────────────

async function generateEmbedding(text) {
  const truncated = text.slice(0, 8000);

  const resp = await httpPost(
    `${OPENROUTER_BASE}/embeddings`,
    {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    {
      model: "openai/text-embedding-3-small",
      input: truncated,
    }
  );

  if (!resp || !resp.ok) {
    const status = resp ? resp.status : "no response";
    console.log(`   Warning: Embedding generation failed (${status})`);
    return null;
  }

  try {
    const data = await resp.json();
    return data.data[0].embedding;
  } catch (e) {
    console.log(`   Warning: Failed to parse embedding response: ${e.message}`);
    return null;
  }
}

// ─── Ingestion ──────────────────────────────────────────────────────────────

async function ingestThought(content, metadata) {
  const embedding = await generateEmbedding(content);
  if (!embedding) {
    return { ok: false, error: "Failed to generate embedding" };
  }

  const resp = await httpPost(
    `${SUPABASE_URL}/rest/v1/thoughts`,
    {
      "Content-Type": "application/json",
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Prefer": "return=minimal",
    },
    {
      content,
      embedding,
      metadata,
    }
  );

  if (!resp) {
    return { ok: false, error: "No response from Supabase" };
  }

  if (resp.status !== 200 && resp.status !== 201) {
    let detail;
    try {
      detail = await resp.json();
    } catch {
      detail = await resp.text();
    }
    return { ok: false, error: `HTTP ${resp.status}: ${JSON.stringify(detail)}` };
  }

  return { ok: true };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs();

  // Validate input path
  if (!existsSync(config.inputPath)) {
    console.error(`Error: Path not found: ${config.inputPath}`);
    process.exit(1);
  }

  // Validate env vars for live mode
  if (!config.dryRun) {
    if (!SUPABASE_URL) {
      console.error("Error: SUPABASE_URL environment variable required.");
      console.error("Set it to your Supabase project URL (e.g., https://xxxxx.supabase.co)");
      process.exit(1);
    }
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      console.error("Error: SUPABASE_SERVICE_ROLE_KEY environment variable required.");
      process.exit(1);
    }
    if (!OPENROUTER_API_KEY) {
      console.error("Error: OPENROUTER_API_KEY required for embedding generation.");
      console.error("Get one at https://openrouter.ai/keys");
      process.exit(1);
    }
  }

  if (!config.raw && !OPENROUTER_API_KEY) {
    console.error("Error: OPENROUTER_API_KEY required for summarization.");
    console.error("Use --raw to skip summarization and insert grouped entries as-is.");
    process.exit(1);
  }

  // Find MyActivity.json files
  const activityFiles = findMyActivityFiles(config.inputPath);
  if (activityFiles.length === 0) {
    console.error("Error: No MyActivity.json files found.");
    console.error(`Searched in: ${config.inputPath}`);
    console.error("Expected folder structure: My Activity/Search/MyActivity.json, etc.");
    process.exit(1);
  }

  // Filter to high-value categories
  const allowedCategories = config.categories || HIGH_VALUE_CATEGORIES;
  const filtered = activityFiles.filter(af => allowedCategories.has(af.category));

  console.log(`\nFound ${activityFiles.length} MyActivity.json files.`);
  console.log(`Processing ${filtered.length} categories: ${filtered.map(f => f.category).join(", ")}\n`);

  // Display configuration
  const mode = config.dryRun ? "DRY RUN" : "LIVE";
  const summarizeMode = config.raw ? "raw (no summarization)" : "openrouter (gpt-4o-mini)";
  console.log(`  Mode:        ${mode}`);
  console.log(`  Summarizer:  ${summarizeMode}`);
  if (config.after) console.log(`  After:       ${config.after}`);
  if (config.before) console.log(`  Before:      ${config.before}`);
  if (config.limit) console.log(`  Limit:       ${config.limit}`);
  console.log();

  const syncLog = loadSyncLog();

  // Counters
  let totalEntries = 0;
  let meaningfulEntries = 0;
  let totalDays = 0;
  let skippedDays = 0;
  let processedDays = 0;
  let thoughtsGenerated = 0;
  let ingested = 0;
  let errors = 0;

  for (const { file: actFile, category } of filtered) {
    const fileSize = statSync(actFile).size;
    console.log(`\n── ${category} (${(fileSize / 1024 / 1024).toFixed(1)} MB) ──`);

    let activities;
    try {
      activities = JSON.parse(readFileSync(actFile, "utf8"));
    } catch {
      console.log(`   Failed to parse ${actFile}, skipping.`);
      continue;
    }

    if (!Array.isArray(activities)) {
      console.log(`   Not a JSON array, skipping.`);
      continue;
    }

    totalEntries += activities.length;

    // Filter noise
    const meaningful = filterActivities(activities, category);
    meaningfulEntries += meaningful.length;
    console.log(`   ${activities.length} entries → ${meaningful.length} after filtering`);

    // Group by day
    const byDay = groupByDay(meaningful);
    const days = Object.keys(byDay).sort();
    totalDays += days.length;

    for (const day of days) {
      // Respect limit
      if (config.limit && processedDays >= config.limit) break;

      // Date filtering
      if (config.after && day < config.after) { skippedDays++; continue; }
      if (config.before && day > config.before) { skippedDays++; continue; }

      let entries = byDay[day];
      if (entries.length === 0) continue;

      // Cap entries per day to avoid huge prompts
      const maxPerDay = category === "Maps" ? 30 : 100;
      if (entries.length > maxPerDay) {
        entries = entries.slice(0, maxPerDay);
      }

      // Check sync log (dedup by category+day)
      const dayKey = `${category.toLowerCase()}:${day}`;
      const dayHash = hashText(entries.join("\n"));
      if (syncLog.ingested_days[dayKey] === dayHash) {
        skippedDays++;
        continue;
      }

      processedDays++;
      console.log(`\n   ${processedDays}. ${category} — ${day} (${entries.length} entries)`);

      // Summarize or use raw
      let thoughts;
      if (config.raw) {
        const content = `Google ${category} activity for ${day}:\n\n${entries.join("\n")}`;
        thoughts = [content];
      } else {
        thoughts = await summarizeDay(category, day, entries);
      }

      thoughtsGenerated += thoughts.length;

      if (!thoughts.length) {
        console.log(`      -> No thoughts extracted (day was trivial)`);
        if (!config.dryRun) {
          syncLog.ingested_days[dayKey] = dayHash;
          saveSyncLog(syncLog);
        }
        continue;
      }

      if (config.verbose || config.dryRun) {
        for (let i = 0; i < thoughts.length; i++) {
          const preview = thoughts[i].length <= 200 ? thoughts[i] : thoughts[i].slice(0, 200) + "...";
          console.log(`      Thought ${i + 1}: ${preview}`);
        }
      }

      if (config.dryRun) continue;

      // Ingest each thought
      let allOk = true;
      for (let i = 0; i < thoughts.length; i++) {
        const content = `[Google ${category}: ${day}] ${thoughts[i]}`;
        const metadata = {
          source: "google_activity",
          google_category: category,
          google_date: day,
          entry_count: entries.length,
        };

        const result = await ingestThought(content, metadata);
        if (result.ok) {
          ingested++;
          console.log(`      -> Thought ${i + 1} ingested`);
        } else {
          errors++;
          allOk = false;
          console.log(`      -> ERROR (thought ${i + 1}): ${result.error}`);
        }

        await sleep(200); // Rate limit
      }

      if (allOk) {
        syncLog.ingested_days[dayKey] = dayHash;
        saveSyncLog(syncLog);
      }
    }

    if (config.limit && processedDays >= config.limit) {
      console.log(`\n   Limit reached (${config.limit} days).`);
      break;
    }
  }

  // ─── Summary ────────────────────────────────────────────────────────────

  console.log("\n" + "─".repeat(60));
  console.log("Summary:");
  console.log(`  Total activity entries:  ${totalEntries.toLocaleString()}`);
  console.log(`  After noise filtering:   ${meaningfulEntries.toLocaleString()}`);
  console.log(`  Activity-days found:     ${totalDays}`);
  if (skippedDays > 0) {
    console.log(`  Skipped (already done):  ${skippedDays}`);
  }
  console.log(`  Days processed:          ${processedDays}`);
  console.log(`  Thoughts generated:      ${thoughtsGenerated}`);
  if (!config.dryRun) {
    console.log(`  Ingested:                ${ingested}`);
    console.log(`  Errors:                  ${errors}`);
  }

  // Cost estimation
  let summarizeCost = 0;
  if (!config.raw && processedDays > 0) {
    // gpt-4o-mini via OpenRouter: ~$0.15/1M input, ~$0.60/1M output
    const estInputTokens = processedDays * 600;
    const estOutputTokens = processedDays * 150;
    summarizeCost = (estInputTokens * 0.15 / 1_000_000) + (estOutputTokens * 0.60 / 1_000_000);
  }
  const embeddingCost = thoughtsGenerated * 100 * 0.02 / 1_000_000;
  const totalCost = summarizeCost + embeddingCost;
  console.log(`  Est. API cost:           $${totalCost.toFixed(4)}`);
  if (summarizeCost > 0) console.log(`    Summarization:         $${summarizeCost.toFixed(4)}`);
  if (embeddingCost > 0) console.log(`    Embeddings:            $${embeddingCost.toFixed(4)}`);
  console.log("─".repeat(60));
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
