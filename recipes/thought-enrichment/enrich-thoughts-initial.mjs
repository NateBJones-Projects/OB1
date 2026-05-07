#!/usr/bin/env node
/**
 * enrich-thoughts-initial.mjs - Initial enrichment for existing thoughts
 * Works with current schema without requiring the enhanced columns
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATE_DIR = path.join(__dirname, "data");
const STATE_PATH = path.join(STATE_DIR, "enrichment-state.json");

// Ensure data directory exists
if (!fs.existsSync(STATE_DIR)) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

// --- Classification Prompt ---

const CLASSIFICATION_PROMPT = [
  "You classify personal notes for a second-brain system.",
  "Return STRICT JSON with keys: type, summary, topics, tags, people, action_items, confidence, importance, detected_source_type.",
  "",
  "type must be one of: idea, task, person_note, reference, decision, lesson, meeting, journal.",
  "summary: max 160 chars, capturing what this thought IS about personally.",
  "topics: 3-5 keywords describing what this thought covers.",
  "tags: 3-7 tags categorizing this thought.",
  "people: array of names mentioned (only if named people appear).",
  "action_items: array of specific actions to take (only if actionable).",
  "confidence: 0.0-1.0 certainty in this classification.",
  "importance: 1-5 scale (5=critical/urgent).",
  "detected_source_type: how this entered the system (chatgpt_import, etc.).",
  "",
  "Examples:",
  'type: "idea", summary: "Build AI tool to automate personal knowledge management", topics: ["ai", "automation", "productivity"], tags: ["innovation", "future"], people: [], action_items: [], confidence: 0.9, importance: 4, detected_source_type: "chatgpt_import"',
  'type: "task", summary: "Review Q3 financial reports with team", topics: ["finance", "business"], tags: ["quarterly", "review"], people: ["Sarah", "Mike"], action_items: ["Prepare slides", "Schedule meeting"], confidence: 0.8, importance: 3, detected_source_type: "email_import"',
  "",
  "CLASSIFY:",
].join("\n");

// --- State Management ---

function loadState() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    return {
      lastId: state.lastId || null,
      processedIds: new Set(state.processedIds || []),
      failedIds: new Set(state.failedIds || []),
    };
  } catch {
    return {
      lastId: null,
      processedIds: new Set(),
      failedIds: new Set(),
    };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify({
    lastId: state.lastId,
    processedIds: [...state.processedIds],
    failedIds: [...state.failedIds],
  }, null, 2));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- CLI Args ---

function parseArgs(args) {
  const parsed = {
    help: false,
    dryRun: false,
    apply: false,
    status: false,
    provider: null,
    concurrency: 20,
    skip: 0,
    limit: 0,
    retryFailed: false,
  };

  for (const arg of args) {
    if (arg === "--help") parsed.help = true;
    else if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--apply") parsed.apply = true;
    else if (arg === "--status") parsed.status = true;
    else if (arg === "--retry-failed") parsed.retryFailed = true;
    else if (arg.startsWith("--provider=")) {
      parsed.provider = arg.split("=")[1];
    }
    else if (arg.startsWith("--concurrency=")) {
      parsed.concurrency = parseInt(arg.split("=")[1], 10);
    }
    else if (arg.startsWith("--skip=")) {
      parsed.skip = parseInt(arg.split("=")[1], 10);
    }
    else if (arg.startsWith("--limit=")) {
      parsed.limit = parseInt(arg.split("=")[1], 10);
    }
  }

  return parsed;
}

function printUsage() {
  console.log(`
Usage: node enrich-thoughts-initial.mjs [options]

Options:
  --help             Show this help
  --dry-run          Preview classifications without writing
  --apply            Write enrichment results back to Supabase
  --status           Show enrichment progress stats
  --provider <name>  openai (default)
  --concurrency <n>  Parallel calls (default: 20)
  --skip <n>         Skip first N thoughts
  --limit <n>        Process at most N thoughts
  --retry-failed     Re-process previously failed thought IDs

Environment variables (.env.local):
  SUPABASE_URL=your-supabase-url
  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
  OPENAI_API_KEY=your-openai-key

Examples:
  node enrich-thoughts-initial.mjs --dry-run --limit 10
  node enrich-thoughts-initial.mjs --apply --concurrency 5
  node enrich-thoughts-initial.mjs --status
  node enrich-thoughts-initial.mjs --apply --retry-failed
`);
}

// --- Configuration ---

function buildConfig(args, env) {
  const provider = args.provider || env.ENRICH_PROVIDER || "openai";
  return {
    provider,
    concurrency: parseInt(args.concurrency || "20", 10),
    skip: parseInt(args.skip || "0", 10),
    limit: parseInt(args.limit || "0", 10),
    dryRun: !!args.dryRun,
    apply: !!args.apply,
    retryFailed: !!args.retryFailed,
    // OpenAI direct
    openaiApiKey: env.OPENAI_API_KEY || "",
    openaiModel: args.model || env.OPENAI_CLASSIFIER_MODEL || "gpt-4o-mini",
    // Supabase
    supabaseUrl: env.SUPABASE_URL || "",
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY || "",
  };
}

function resolveModelLabel(config) {
  if (config.provider === "openai") return config.openaiModel;
  return config.openaiModel; // fallback
}

// --- LLM Calls ---

async function classifyWithProvider(userInput, config) {
  if (config.provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.openaiModel,
        max_tokens: 1024,
        temperature: 0.1,
        messages: [
          { role: "system", content: CLASSIFICATION_PROMPT },
          { role: "user", content: userInput },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI ${res.status}: ${body.substring(0, 300)}`);
    }

    const result = await res.json();
    return (result?.choices?.[0]?.message?.content || "").trim();
  }
  throw new Error(`Unsupported provider: ${config.provider}`);
}

async function classifyThought(content, config) {
  const userInput = content.substring(0, 1500); // Limit context
  const rawResponse = await classifyWithProvider(userInput, config);

  // Parse JSON response
  try {
    return JSON.parse(rawResponse);
  } catch {
    // Fallback: try to extract JSON from markdown
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error("Invalid JSON response from LLM");
  }
}

// --- Supabase Operations ---

function supabaseHeaders(config) {
  return {
    apikey: config.supabaseServiceRoleKey,
    Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
}

async function fetchThoughts(config, cursor, limit) {
  let url = `${config.supabaseUrl}/rest/v1/thoughts?select=id,content&order=id.asc&limit=${limit}`;

  if (cursor?.afterId != null) {
    url += `&id=gt.${cursor.afterId}`;
  } else if (cursor?.offset) {
    url += `&offset=${cursor.offset}`;
  }

  const response = await fetch(url, {
    headers: {
      apikey: config.supabaseServiceRoleKey,
      Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "count=exact"
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Fetch thoughts failed (${response.status}): ${body.substring(0, 300)}`);
  }

  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

async function patchThought(id, patch, config) {
  const url = `${config.supabaseUrl}/rest/v1/thoughts?id=eq.${id}`;
  const body = { ...patch };

  // Handle metadata JSONB conversion
  if (body.metadata && typeof body.metadata === 'object') {
    body.metadata = JSON.stringify(body.metadata);
  }

  // Filter out null values for existing columns
  const filteredBody = {};
  Object.keys(body).forEach(key => {
    if (body[key] !== null && body[key] !== undefined) {
      filteredBody[key] = body[key];
    }
  });

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: config.supabaseServiceRoleKey,
      Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(filteredBody),
  });

  if (!res.ok) {
    const text = await res.text();
    // Retry once after 2s
    await sleep(2000);
    const res2 = await fetch(url, {
      method: "PATCH",
      headers: {
        apikey: config.supabaseServiceRoleKey,
        Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(filteredBody),
    });
    if (!res2.ok) {
      const text2 = await res2.text();
      throw new Error(`PATCH thought ${id} failed after retry (${res2.status}): ${text2.substring(0, 200)}`);
    }
  }
}

// --- Main Logic ---

async function classifyAndPatchThought(thought, config, state) {
  const { content } = thought;

  try {
    const classified = await classifyThought(content, config);

    // Prepare patch object with current schema columns
    const patch = {
      type: classified.type || "reference",
      metadata: {
        ...thought.metadata,
        summary: classified.summary || content.substring(0, 160),
        topics: classified.topics || [],
        tags: classified.tags || [],
        people: classified.people || [],
        action_items: classified.action_items || [],
        confidence: classified.confidence || 0.8,
        importance: classified.importance || 3,
        detected_source_type: classified.detected_source_type || "manual",
        enriched_at: new Date().toISOString(),
        enriched_model: resolveModelLabel(config),
      },
    };

    if (config.apply) {
      await patchThought(thought.id, patch, config);
    }

    return classified;
  } catch (err) {
    console.error(`  ERROR classifying ${thought.id}: ${err.message}`);
    state.failedIds.add(thought.id);
    throw err;
  }
}

async function showStatus(config) {
  console.log("Status check requires enhanced schema columns.");
  console.log("Run the schema migration first via the Supabase dashboard.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) { printUsage(); return; }

  // Load environment
  const env = {};
  const envPath = path.join(__dirname, ".env.local");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const idx = line.indexOf("=");
      if (idx > 0 && !line.startsWith("#")) {
        env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
      }
    }
  }

  const config = buildConfig(args, env);

  // Validate provider config
  if (config.provider === "openai" && !config.openaiApiKey) {
    console.error("ERROR: --provider openai requires OPENAI_API_KEY in .env.local");
    process.exitCode = 1;
    return;
  }

  console.log(`Provider: ${config.provider} (model: ${resolveModelLabel(config)})`);
  console.log(`Concurrency: ${config.concurrency}`);
  console.log(`Mode: ${config.dryRun ? "DRY RUN" : "APPLY"}${config.retryFailed ? " (retry-failed)" : ""}`);
  console.log(`Skip: ${config.skip}, Limit: ${config.limit}`);
  console.log();

  if (args.status) {
    await showStatus(config);
    return;
  }

  if (!args.dryRun && !args.apply) {
    console.error("ERROR: Must specify --dry-run, --apply, or --status");
    printUsage();
    process.exitCode = 1;
    return;
  }

  const state = loadState();
  let processed = 0;
  let enriched = 0;
  let failed = 0;

  // -- Retry-failed mode: process only previously failed IDs --
  if (config.retryFailed) {
    const failedIds = [...state.failedIds];
    if (failedIds.length === 0) {
      console.log("No failed thoughts to retry");
      return;
    }

    console.log(`Retrying ${failedIds.length} failed thoughts...`);
    for (const id of failedIds) {
      if (config.limit && processed >= config.limit) break;

      const thoughts = await fetchThoughts(config, { afterId: state.lastId }, 1);
      if (thoughts.length === 0) break;

      const thought = thoughts[0];
      if (thought.id !== id) continue;

      try {
        await classifyAndPatchThought(thought, config, state);
        enriched++;
        state.processedIds.add(id);
        state.failedIds.delete(id);
      } catch {
        failed++;
      }

      processed++;
      state.lastId = id;
      saveState(state);

      if (processed % 10 === 0) {
        console.log(`Progress: ${processed} processed, ${enriched} enriched, ${failed} failed`);
      }
    }
  } else {
    // -- Normal mode: process thoughts in batches --
    while (true) {
      if (config.limit && processed >= config.limit) break;
      if (config.skip > 0 && processed < config.skip) {
        const skipCount = Math.min(config.skip - processed, config.concurrency);
        const cursor = state.lastId ? { afterId: state.lastId } : { offset: processed };
        const skipped = await fetchThoughts(config, cursor, skipCount);
        if (skipped.length < skipCount) break;
        state.lastId = skipped[skipped.length - 1].id;
        processed += skipped.length;
        continue;
      }

      const thoughts = await fetchThoughts(config, state.lastId ? { afterId: state.lastId } : null, config.concurrency);
      if (thoughts.length === 0) break;

      // Process with concurrency
      const promises = thoughts.map(async (thought) => {
        if (config.limit && processed >= config.limit) return;

        try {
          await classifyAndPatchThought(thought, config, state);
          enriched++;
          state.processedIds.add(thought.id);
        } catch {
          failed++;
        }

        processed++;
        state.lastId = thought.id;
        saveState(state);
      });

      await Promise.all(promises);

      if (processed % 20 === 0) {
        console.log(`Progress: ${processed} processed, ${enriched} enriched, ${failed} failed`);
      }
    }
  }

  console.log();
  console.log("=== ENRICHMENT COMPLETE ===");
  console.log(`Processed: ${processed}`);
  console.log(`Enriched:  ${enriched}`);
  console.log(`Failed:    ${failed}`);
  console.log(`Success:   ${((enriched / processed) * 100 || 0).toFixed(1)}%`);
}

// Execute main with error handling
main().catch(err => {
  console.error(err.stack || err.message || String(err));
  process.exitCode = 1;
});