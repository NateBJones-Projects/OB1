#!/usr/bin/env node
/**
 * enrich-thoughts.mjs
 *
 * Retroactively classifies thoughts via Anthropic API or OpenRouter.
 * Extracts: type, summary, topics, tags, people, action_items, confidence,
 *           importance, detected_source_type.
 * Updates the thought in-place via Supabase REST API.
 *
 * Usage:
 *   node enrich-thoughts.mjs --status
 *   node enrich-thoughts.mjs --dry-run --limit 10
 *   node enrich-thoughts.mjs --apply --concurrency 5
 *   node enrich-thoughts.mjs --apply --provider anthropic --concurrency 20
 *   node enrich-thoughts.mjs --apply --retry-failed
 *
 * Flags:
 *   --apply              Write enrichment results back to Supabase
 *   --dry-run             Preview classifications without writing
 *   --status              Show enrichment progress stats
 *   --provider <name>     openrouter (default) or anthropic
 *   --concurrency <n>     Parallel calls (default: 20)
 *   --limit <n>           Process at most N thoughts
 *   --skip <n>            Skip first N un-enriched thoughts
 *   --model <name>        Model override (default per provider)
 *   --retry-failed        Re-process previously failed thought IDs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_TYPES = new Set([
  "idea", "task", "person_note", "reference",
  "decision", "lesson", "meeting", "journal",
]);

const ALLOWED_SOURCE_TYPES = new Set([
  "limitless_import", "chatgpt_import", "gemini_import", "claude_import",
  "grok_import", "x_twitter_import", "instagram_import", "google_activity_import",
  "blogger_import", "telegram_import", "obsidian_import", "generic_import",
  "claude_code_import",
]);

const STATE_DIR = path.join(__dirname, "data");
const STATE_PATH = path.join(STATE_DIR, "enrichment-state.json");
const BATCH_SIZE = 50;

// --- Classification Prompt ---

const CLASSIFICATION_PROMPT = [
  "You classify personal notes for a second-brain system.",
  "Return STRICT JSON with keys: type, summary, topics, tags, people, action_items, confidence, importance, detected_source_type.",
  "",
  "type must be one of: idea, task, person_note, reference, decision, lesson, meeting, journal.",
  "summary: max 160 chars, capturing what this thought IS about personally.",
  "topics: 1-3 short lowercase tags. tags: additional freeform labels.",
  "people: names mentioned (empty array if none).",
  "action_items: implied to-dos (empty array if none).",
  "confidence: 0-1 (how confident you are this is genuinely personal content).",
  "importance: 1-5 integer.",
  "",
  "IMPORTANCE CALIBRATION (be strict — most should be 3):",
  "5: Life decisions, core beliefs, personal health data, financial commitments",
  "4: Specific preferences, project decisions, tools/products chosen",
  "3: Contextual project facts, minor preferences, techniques learned (DEFAULT)",
  "2: Low-signal but personal — filler, small talk, trivial observations",
  "1: Borderline — barely qualifies as personal memory",
  "",
  "CONFIDENCE CALIBRATION:",
  "0.9+: Clearly personal — user's own decision, preference, lesson, health data",
  "0.7-0.89: Probably personal but could be generic advice",
  "0.5-0.69: Borderline — reads more like general knowledge than personal context",
  "Below 0.5: Generic advice, encyclopedia-grade facts, or vague filler",
  "",
  "detected_source_type: Detect the likely origin based on content patterns. Must be one of:",
  "  limitless_import — speaker IDs like [1], [5], startMs/endMs timestamps, lifelog format",
  "  chatgpt_import — user/assistant conversation turns from ChatGPT",
  "  gemini_import — Gemini conversation format",
  "  claude_import — Claude export format",
  "  grok_import — Grok/xAI conversation format",
  "  x_twitter_import — tweets, @mentions, Twitter-style content",
  "  instagram_import — captions, comments, Instagram-style content",
  "  google_activity_import — search queries, URLs, browser history",
  "  blogger_import — blog post format, HTML/Atom content",
  "  telegram_import — short message captures",
  "  obsidian_import — markdown notes, wiki-links [[...]], frontmatter",
  "  generic_import — cannot determine source",
  "",
  "Examples:",
  "",
  'Input: "Met with Sarah about the API redesign. She wants GraphQL instead of REST."',
  'Output: {"type":"meeting","summary":"API redesign meeting with Sarah — GraphQL vs REST","topics":["api-design","graphql"],"tags":["architecture"],"people":["Sarah"],"action_items":["Prototype GraphQL API"],"confidence":0.95,"importance":4,"detected_source_type":"generic_import"}',
  "",
  'Input: "I\'m going to use Supabase instead of Firebase. Better SQL support and pgvector."',
  'Output: {"type":"decision","summary":"Chose Supabase over Firebase for SQL and pgvector support","topics":["database","infrastructure"],"tags":["architecture"],"people":[],"action_items":[],"confidence":0.92,"importance":4,"detected_source_type":"generic_import"}',
  "",
  'Input: "[1] So I was talking to Ahmed about the wedding plans [5] Yeah the venue in downtown..."',
  'Output: {"type":"meeting","summary":"Discussion with Ahmed about wedding venue plans","topics":["wedding","planning"],"tags":["personal"],"people":["Ahmed"],"action_items":[],"confidence":0.90,"importance":4,"detected_source_type":"limitless_import"}',
  "",
  "IMPORTANT: Return ONLY the JSON object, no markdown fences, no explanation.",
].join("\n");

const ENRICHED_VERSION = 1;

// --- LLM Provider Calls ---

async function callAnthropic(userInput, config) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": config.anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.anthropicModel,
      max_tokens: 1024,
      temperature: 0.1,
      system: CLASSIFICATION_PROMPT,
      messages: [{ role: "user", content: userInput }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic ${res.status}: ${body.substring(0, 300)}`);
  }

  const result = await res.json();
  return (result?.content?.[0]?.text || "").trim();
}

async function callOpenRouter(userInput, config) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openRouterApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.openRouterModel,
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
    throw new Error(`OpenRouter ${res.status}: ${body.substring(0, 300)}`);
  }

  const result = await res.json();
  return (result?.choices?.[0]?.message?.content || "").trim();
}

async function classifyWithProvider(userInput, config) {
  if (config.provider === "anthropic") return callAnthropic(userInput, config);
  return callOpenRouter(userInput, config);
}

async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err.message || "";
      const is429 = msg.includes("429");
      const is5xx = /\b5\d{2}\b/.test(msg);
      if (attempt === maxRetries || (!is429 && !is5xx)) throw err;
      const delay = is429
        ? Math.min(30000, 2000 * Math.pow(2, attempt))
        : 1000 * (attempt + 1);
      console.warn(`  Retry ${attempt + 1}/${maxRetries} after ${delay}ms (${msg.substring(0, 80)})`);
      await sleep(delay);
    }
  }
}

function resolveModelLabel(config) {
  if (config.provider === "anthropic") return config.anthropicModel;
  return config.openRouterModel;
}

// --- Entry Point ---

main().catch((err) => {
  console.error(err.stack || err.message || String(err));
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) { printUsage(); return; }

  const env = parseEnvFile(path.join(__dirname, ".env.local"));
  const config = buildConfig(args, env);

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

  // Validate provider config
  if (config.provider === "anthropic" && !config.anthropicApiKey) {
    console.error("ERROR: --provider anthropic requires ANTHROPIC_API_KEY in .env.local");
    process.exitCode = 1;
    return;
  }
  if (config.provider === "openrouter" && !config.openRouterApiKey) {
    console.error("ERROR: --provider openrouter requires OPENROUTER_API_KEY in .env.local");
    process.exitCode = 1;
    return;
  }

  console.log(`Provider: ${config.provider} (model: ${resolveModelLabel(config)})`);
  console.log(`Concurrency: ${config.concurrency}`);
  console.log(`Mode: ${config.dryRun ? "DRY RUN" : "APPLY"}${config.retryFailed ? " (retry-failed)" : ""}`);
  console.log(`Skip: ${config.skip}, Limit: ${config.limit || "none"}`);
  console.log();

  const state = loadState();
  let processed = 0;
  let enriched = 0;
  let failed = 0;

  // -- Retry-failed mode: process only previously failed IDs --
  if (config.retryFailed) {
    const failedIds = [...state.failedIds];
    if (failedIds.length === 0) {
      console.log("No failed IDs to retry.");
      return;
    }
    console.log(`Retrying ${failedIds.length} previously failed thoughts...`);
    console.log();

    for (let i = 0; i < failedIds.length; i += BATCH_SIZE) {
      if (config.limit && processed >= config.limit) break;
      const batchIds = failedIds.slice(i, i + Math.min(BATCH_SIZE, (config.limit || Infinity) - processed));
      const thoughts = await fetchByIds(config, batchIds);
      if (thoughts.length === 0) continue;

      for (let j = 0; j < thoughts.length; j += config.concurrency) {
        const chunk = thoughts.slice(j, j + config.concurrency);
        const results = await Promise.allSettled(
          chunk.map((t) => classifyAndUpdate(t, config))
        );
        for (let k = 0; k < results.length; k++) {
          processed++;
          const t = chunk[k];
          if (results[k].status === "fulfilled") {
            enriched++;
            if (!config.dryRun) {
              state.totalProcessed++;
              state.lastProcessedId = t.id;
              removeFailedId(state, t.id);
            }
            const label = results[k].value?.type || "?";
            console.log(`  OK retry #${t.id} -> ${label}`);
          } else {
            failed++;
            if (!config.dryRun) {
              state.lastProcessedId = t.id;
            }
            console.error(`  FAIL retry #${t.id}: ${results[k].reason?.message || results[k].reason}`);
          }
        }

        if (!config.dryRun) checkpointState(state);
      }
      console.log(`Retry progress: ${processed} processed, ${enriched} fixed, ${failed} still failing`);
      console.log();
    }

    if (!config.dryRun) checkpointState(state);
    console.log();
    console.log("=== RETRY COMPLETE ===");
    console.log(`Processed: ${processed}, Fixed: ${enriched}, Still failing: ${failed}`);
    return;
  }

  // -- Normal enrichment mode --
  let fetchCursor = {
    afterId: null,
    offset: config.skip,
  };

  while (true) {
    if (config.limit && processed >= config.limit) break;

    const fetchSize = config.limit ? Math.min(BATCH_SIZE, config.limit - processed) : BATCH_SIZE;
    const thoughts = await fetchUnenriched(config, fetchCursor, fetchSize);
    if (thoughts.length === 0) {
      console.log("No more un-enriched thoughts returned from Supabase.");
      break;
    }

    // API mode: one thought per call, high concurrency
    for (let i = 0; i < thoughts.length; i += config.concurrency) {
      const chunk = thoughts.slice(i, i + config.concurrency);

      const results = await Promise.allSettled(
        chunk.map((t) => classifyAndUpdate(t, config))
      );

      for (let j = 0; j < results.length; j++) {
        processed++;
        const t = chunk[j];
        if (results[j].status === "fulfilled") {
          enriched++;
          if (!config.dryRun) {
            state.totalProcessed++;
            state.lastProcessedId = t.id;
            removeFailedId(state, t.id);
          }
          if (results[j].value) {
            const label = results[j].value.type || "?";
            const src = results[j].value.detected_source_type || "?";
            console.log(`  OK #${t.id} -> ${label} (source: ${src}, imp: ${results[j].value.importance})`);
          }
        } else {
          failed++;
          if (!config.dryRun) {
            state.totalFailed++;
            state.lastProcessedId = t.id;
            addFailedId(state, t.id);
          }
          console.error(`  FAIL #${t.id}: ${results[j].reason?.message || results[j].reason}`);
        }
      }

      if (!config.dryRun) checkpointState(state);
    }

    fetchCursor = nextFetchCursor(fetchCursor, thoughts);

    const pct = config.limit
      ? ((processed / config.limit) * 100).toFixed(1)
      : "?";
    console.log(`Progress: ${processed} processed, ${enriched} enriched, ${failed} failed (${pct}%)`);
    console.log();
  }

  if (!config.dryRun) checkpointState(state);
  console.log();
  console.log("=== ENRICHMENT COMPLETE ===");
  console.log(`Processed: ${processed}`);
  console.log(`Enriched:  ${enriched}`);
  console.log(`Failed:    ${failed}`);
}

// --- Classification ---

async function classifyAndUpdate(thought, config) {
  const content = thought.content || "";
  if (!content.trim()) {
    if (!config.dryRun) {
      await patchThought(thought.id, { enriched: true }, config);
    }
    return { type: "reference", importance: 1, detected_source_type: "generic_import" };
  }

  // Build prompt input with source context
  const existingSource = thought.source_type || thought.metadata?.source || "";
  const inputLines = [];
  if (existingSource) inputLines.push(`Existing source_type: ${existingSource}`);
  inputLines.push(`Content:\n${content.substring(0, 4000)}`);
  const userInput = inputLines.join("\n\n");

  // Call LLM via selected provider (with retry for transient errors)
  let raw = await withRetry(() => classifyWithProvider(userInput, config));

  // Strip markdown fences if present
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

  let classified;
  try {
    classified = JSON.parse(raw);
  } catch {
    throw new Error(`JSON parse failed. Raw output: ${raw.substring(0, 300)}`);
  }

  // Validate and sanitize
  if (!ALLOWED_TYPES.has(classified.type)) {
    classified.type = "reference";
  }
  classified.importance = clampInt(classified.importance, 1, 5, 3);
  classified.confidence = clampFloat(classified.confidence, 0, 1, 0.5);
  if (!ALLOWED_SOURCE_TYPES.has(classified.detected_source_type)) {
    classified.detected_source_type = existingSource || "generic_import";
  }
  if (!Array.isArray(classified.topics)) classified.topics = [];
  if (!Array.isArray(classified.tags)) classified.tags = [];
  if (!Array.isArray(classified.people)) classified.people = [];
  if (!Array.isArray(classified.action_items)) classified.action_items = [];
  if (typeof classified.summary !== "string") classified.summary = "";

  if (config.dryRun) {
    console.log(`  [DRY] #${thought.id}: ${JSON.stringify(classified)}`);
    return classified;
  }

  // Build update payload
  const existingMetadata = thought.metadata || {};
  const patch = {
    type: classified.type,
    importance: classified.importance,
    source_type: classified.detected_source_type,
    enriched: true,
    metadata: {
      ...existingMetadata,
      type: classified.type,
      summary: classified.summary,
      topics: classified.topics,
      tags: classified.tags,
      people: classified.people,
      action_items: classified.action_items,
      confidence: classified.confidence,
      enriched_version: ENRICHED_VERSION,
      enriched_at: new Date().toISOString(),
      enriched_model: resolveModelLabel(config),
    },
  };

  await patchThought(thought.id, patch, config);
  return classified;
}

// --- Supabase Operations ---

async function fetchUnenriched(config, cursor, limit) {
  const url = new URL(`${config.supabaseUrl}/rest/v1/thoughts`);
  url.searchParams.set("select", "id,content,source_type,metadata");
  url.searchParams.set("enriched", "eq.false");
  url.searchParams.set("order", "id.asc");
  url.searchParams.set("limit", String(limit));

  if (cursor?.afterId != null) {
    url.searchParams.set("id", `gt.${cursor.afterId}`);
  } else if (cursor?.offset) {
    url.searchParams.set("offset", String(cursor.offset));
  }

  const res = await fetch(url, { headers: supabaseHeaders(config) });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Fetch un-enriched failed (${res.status}): ${body.substring(0, 300)}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

async function fetchByIds(config, ids) {
  if (ids.length === 0) return [];
  const idList = ids.join(",");
  const url = `${config.supabaseUrl}/rest/v1/thoughts?select=id,content,source_type,metadata&id=in.(${idList})`;
  const res = await fetch(url, { headers: supabaseHeaders(config) });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Fetch by IDs failed (${res.status}): ${body.substring(0, 300)}`);
  }
  return res.json();
}

async function patchThought(id, patch, config) {
  const url = `${config.supabaseUrl}/rest/v1/thoughts?id=eq.${id}`;
  const body = { ...patch };
  if (body.metadata) {
    body.metadata = JSON.stringify(body.metadata);
  }

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      ...supabaseHeaders(config),
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    // Retry once after 2s
    await sleep(2000);
    const res2 = await fetch(url, {
      method: "PATCH",
      headers: {
        ...supabaseHeaders(config),
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(body),
    });
    if (!res2.ok) {
      const text2 = await res2.text();
      throw new Error(`PATCH thought ${id} failed after retry (${res2.status}): ${text2.substring(0, 200)}`);
    }
  }
}

async function countByEnriched(config) {
  const countReq = async (enrichedVal) => {
    const res = await fetch(
      `${config.supabaseUrl}/rest/v1/thoughts?select=id&enriched=eq.${enrichedVal}`,
      {
        method: "HEAD",
        headers: { ...supabaseHeaders(config), Prefer: "count=exact" },
      }
    );
    const range = res.headers.get("content-range");
    const match = range?.match(/\/(\d+)/);
    return match ? parseInt(match[1], 10) : -1;
  };

  const [enrichedCount, unenrichedCount] = await Promise.all([
    countReq("true"),
    countReq("false"),
  ]);

  return { enrichedCount, unenrichedCount, total: enrichedCount + unenrichedCount };
}

function supabaseHeaders(config) {
  return {
    apikey: config.supabaseServiceRoleKey,
    Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
  };
}

// --- Status Display ---

async function showStatus(config) {
  const { enrichedCount, unenrichedCount, total } = await countByEnriched(config);
  const state = loadState();
  const pct = total > 0 ? ((enrichedCount / total) * 100).toFixed(1) : "0.0";

  console.log("=== Enrichment Status ===");
  console.log(`Total thoughts:     ${total.toLocaleString()}`);
  console.log(`Enriched:           ${enrichedCount.toLocaleString()} (${pct}%)`);
  console.log(`Remaining:          ${unenrichedCount.toLocaleString()}`);
  console.log(`Failed (lifetime):  ${state.totalFailed}`);
  console.log();

  if (state.startedAt && state.totalProcessed > 0) {
    const elapsed = (new Date(state.updatedAt) - new Date(state.startedAt)) / 60_000;
    if (elapsed > 0) {
      const rate = (state.totalProcessed / elapsed).toFixed(1);
      const etaMin = unenrichedCount / parseFloat(rate);
      const etaHrs = (etaMin / 60).toFixed(1);
      console.log(`Rate: ${rate} thoughts/min`);
      console.log(`ETA:  ~${etaHrs} hours remaining`);
    }
  }

  if (state.failedIds.length > 0) {
    console.log();
    console.log(`Failed IDs (last 10): ${state.failedIds.slice(-10).join(", ")}`);
  }
}

// --- State Management ---

function loadState() {
  if (fs.existsSync(STATE_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    } catch {
      console.warn("State file corrupt, starting fresh");
    }
  }
  return {
    totalProcessed: 0,
    totalFailed: 0,
    failedIds: [],
    lastProcessedId: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function saveState(state) {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmp = STATE_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, STATE_PATH);
}

function checkpointState(state) {
  state.updatedAt = new Date().toISOString();
  saveState(state);
}

function addFailedId(state, id) {
  if (!state.failedIds.includes(id)) state.failedIds.push(id);
}

function removeFailedId(state, id) {
  const idx = state.failedIds.indexOf(id);
  if (idx !== -1) state.failedIds.splice(idx, 1);
}

function nextFetchCursor(currentCursor, thoughts) {
  if (!Array.isArray(thoughts) || thoughts.length === 0) return currentCursor;
  return {
    afterId: thoughts[thoughts.length - 1].id,
    offset: 0,
  };
}

// --- Config & CLI ---

function buildConfig(args, env) {
  const provider = args.provider || env.ENRICH_PROVIDER || "openrouter";
  return {
    provider,
    concurrency: parseInt(args.concurrency || "20", 10),
    skip: parseInt(args.skip || "0", 10),
    limit: parseInt(args.limit || "0", 10) || 0,
    dryRun: !!args.dryRun,
    apply: !!args.apply,
    retryFailed: !!args.retryFailed,
    // Anthropic direct
    anthropicApiKey: env.ANTHROPIC_API_KEY || "",
    anthropicModel: args.model || env.ANTHROPIC_CLASSIFIER_MODEL || "claude-3-5-haiku-20241022",
    // OpenRouter
    openRouterApiKey: env.OPENROUTER_API_KEY || "",
    openRouterModel: args.model || env.OPENROUTER_CLASSIFIER_MODEL || "openai/gpt-4o-mini",
    // Supabase
    supabaseUrl: env.SUPABASE_URL || "",
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY || "",
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--apply") args.apply = true;
    else if (a === "--status") args.status = true;
    else if (a === "--concurrency" && argv[i + 1]) args.concurrency = argv[++i];
    else if (a === "--skip" && argv[i + 1]) args.skip = argv[++i];
    else if (a === "--limit" && argv[i + 1]) args.limit = argv[++i];
    else if (a === "--model" && argv[i + 1]) args.model = argv[++i];
    else if (a === "--provider" && argv[i + 1]) args.provider = argv[++i];
    else if (a === "--retry-failed") args.retryFailed = true;
  }
  return args;
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const idx = line.indexOf("=");
    if (idx > 0 && !line.startsWith("#")) {
      env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    }
  }
  return env;
}

function printUsage() {
  console.log(`
Usage:
  node enrich-thoughts.mjs --apply --concurrency 5
  node enrich-thoughts.mjs --apply --provider anthropic --concurrency 20
  node enrich-thoughts.mjs --dry-run --limit 10
  node enrich-thoughts.mjs --apply --retry-failed
  node enrich-thoughts.mjs --status

Options:
  --apply              Write enrichment results to Supabase
  --dry-run            Preview classifications without writing
  --status             Show enrichment progress stats
  --provider <name>    openrouter (default) or anthropic
  --concurrency <n>    Parallel calls (default: 20)
  --limit <n>          Process at most N thoughts
  --skip <n>           Skip first N un-enriched thoughts
  --model <name>       Model override (provider-specific)
  --retry-failed       Re-process previously failed thought IDs
  --help               Show this help
`);
}

// --- Utilities ---

function clampInt(val, min, max, fallback) {
  const n = parseInt(val, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampFloat(val, min, max, fallback) {
  const n = parseFloat(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
