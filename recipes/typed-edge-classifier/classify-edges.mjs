#!/usr/bin/env node
/**
 * Typed Edge Classifier for Open Brain
 *
 * Populates `public.thought_edges` with semantic reasoning relations
 * between thoughts (supports, contradicts, evolved_into, supersedes,
 * depends_on, related_to).
 *
 * Strategy:
 *   1. Sample candidate thought pairs (either pairs that share an
 *      entity via `thought_entities`, or pairs explicitly passed in).
 *   2. Haiku does a fast, cheap candidate filter — "is there any
 *      relation worth investigating here, yes or no?"
 *   3. For pairs that pass Haiku's filter, Opus does the final
 *      classification with the full relation vocabulary.
 *   4. Insert the edge with confidence, classifier version, and
 *      temporal bounds if the model detected any.
 *
 * The hybrid filter+classify split is where the cost savings live:
 * Haiku is ~10-20x cheaper than Opus, and most candidate pairs have
 * no real relation beyond co-mention, so most of the work is
 * finished at the Haiku stage.
 *
 * COST BOUND
 *   - Haiku filter: ~300 in / 100 out tokens per pair. At Haiku 4.5
 *     pricing that's roughly $0.0005 per filtered pair.
 *   - Opus classify: ~800 in / 200 out tokens per pair. At Opus 4.7
 *     pricing that's roughly $0.018 per classified pair.
 *   - Typical filter pass rate is 20-40%.
 *
 *   Example: 500 candidate pairs, 30% pass filter =>
 *     500 * $0.0005 + 150 * $0.018  ~=  $0.25 + $2.70  ~=  $2.95
 *
 *   The `--max-cost-usd` flag caps total spend. The script tracks
 *   estimated spend as it runs and stops before exceeding the cap.
 *
 * REQUIRED ENV VARS
 *   OPEN_BRAIN_URL            e.g. https://YOUR-PROJECT.supabase.co
 *   OPEN_BRAIN_SERVICE_KEY    service_role key (server-side only!)
 *   ANTHROPIC_API_KEY         sk-ant-...
 *
 * USAGE
 *   node classify-edges.mjs --dry-run
 *   node classify-edges.mjs --limit 100 --max-cost-usd 2.00
 *   node classify-edges.mjs --pair <uuid-a>,<uuid-b>
 *   node classify-edges.mjs --model claude-opus-4-7 --no-hybrid
 *   node classify-edges.mjs --mirror-supersedes  # optional, OFF by default
 */

import process from "node:process";

// ── constants ──────────────────────────────────────────────────────────────

const CLASSIFIER_VERSION = "typed-edge-classifier-1.0.0";

// Must match the CHECK constraint in schemas/typed-reasoning-edges/schema.sql
const TYPED_RELATIONS = new Set([
  "supports",
  "contradicts",
  "evolved_into",
  "supersedes",
  "depends_on",
  "related_to",
]);

// Rough per-1M-token pricing (USD). Used for the cost cap, not billing.
// Values are approximate and should be refreshed when Anthropic updates
// their public pricing page.
const PRICING = {
  "claude-haiku-4-5-20251001": { in: 1.0, out: 5.0 },
  "claude-haiku-4-5": { in: 1.0, out: 5.0 },
  "claude-opus-4-7": { in: 15.0, out: 75.0 },
  "claude-opus-4-6": { in: 15.0, out: 75.0 },
  "o4-mini": { in: 1.10, out: 4.40 },
  "o3": { in: 2.0, out: 8.0 },
  "gpt-4o-mini": { in: 0.15, out: 0.60 },
};

// Tracks which unknown models we've already warned about so the log
// isn't spammed on every call. The actual "refuse to run" gate for
// unknown pricing + --max-cost-usd is in assertPricingKnown at startup;
// this is just a belt-and-braces WARN for any path that sneaks a new
// model in after startup.
const _warnedUnknownPricing = new Set();

function estimateCost(model, inTokens, outTokens) {
  const p = PRICING[model];
  if (!p) {
    if (!_warnedUnknownPricing.has(model)) {
      _warnedUnknownPricing.add(model);
      console.warn(
        `[classify-edges] WARNING: no pricing info for model "${model}" in PRICING map. ` +
          `Cost estimates for this model are DISABLED (returning $0); --max-cost-usd ` +
          `cannot be enforced against it. Add it to PRICING in classify-edges.mjs or ` +
          `re-run with --no-cost-cap to acknowledge.`,
      );
    }
    return 0;
  }
  return (inTokens * p.in + outTokens * p.out) / 1_000_000;
}

/**
 * Gate: refuse to run with --max-cost-usd if any model we will actually
 * call has no pricing entry, unless the operator passes --no-cost-cap
 * to acknowledge.
 *
 * The cost cap is a HARD promise to the user. If we can't price the
 * expensive leg (usually Opus classify), the cap silently degrades to
 * no cap at all — which is exactly the pricing-drift failure mode that
 * WARN-1 in REVIEW.md calls out. Better to fail loudly at startup than
 * to under-report spend.
 */
function assertPricingKnown(args) {
  const used = new Set();
  if (args.hybrid) used.add(args.filterModel);
  used.add(args.singleModel || args.classifyModel);

  const unknown = [...used].filter((m) => !PRICING[m]);
  if (unknown.length === 0) return;

  if (args.noCostCap) {
    console.warn(
      `[classify-edges] --no-cost-cap acknowledged. Running with no cost cap on ` +
        `unknown-pricing model(s): ${unknown.join(", ")}. --max-cost-usd will NOT be enforced.`,
    );
    return;
  }

  throw new Error(
    `Refusing to run: no pricing info for model(s) ${unknown.join(", ")} and ` +
      `--max-cost-usd is set. Either add the model to PRICING in classify-edges.mjs ` +
      `or pass --no-cost-cap to acknowledge that the cap cannot be enforced.`,
  );
}

// Worst-case per-pair cost for hard-cap arithmetic in processInChunks.
//
// In hybrid mode a single pair can spend on BOTH the Haiku filter AND
// the Opus classify leg, so the worst case must include both. If we
// only budget the classify leg (as earlier versions did), the chunk
// clamp lets `parallelism` tasks launch whose combined Haiku spend
// overshoots the cap before the post-filter cap check trips. See
// REVIEW-CODEX-2 P2.
//
// Classify leg: 800 in / 512 out matches max_tokens=512 in classifyPair.
// Haiku filter leg: 500 in / 128 out matches max_tokens=128 in filterCandidate
// with generous headroom for the system + user prompt.
//
// Unknown models return 0 which correctly disables the proactive
// parallelism clamp (see estimateCost + WARN-1 refusal at startup).
function worstCasePerPair(args) {
  const classifyModel = args.singleModel || args.classifyModel;
  const classifyWorst = estimateCost(classifyModel, 800, 512);
  if (!args.hybrid) return classifyWorst;
  const haikuFilterWorst = estimateCost(args.filterModel, 500, 128);
  // If either leg prices to 0 (unknown model), the whole worst case is
  // 0 — which disables the proactive clamp. That matches the existing
  // contract: we only clamp when we can price the run.
  if (classifyWorst === 0 || haikuFilterWorst === 0) return 0;
  return haikuFilterWorst + classifyWorst;
}

// ── args + env ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    dryRun: false,
    limit: 20,
    minSupport: 2, // min shared-entity support to consider a pair
    minConfidence: 0.75,
    parallelism: 3,
    pair: null, // explicit [uuid, uuid]
    filterModel: "claude-haiku-4-5-20251001",
    classifyModel: "claude-opus-4-7",
    singleModel: null, // if set, skip hybrid and use this model end-to-end
    hybrid: true,
    maxCostUsd: 5.0,
    noCostCap: false,
    mirrorSupersedes: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--limit") args.limit = Number(argv[++i]) || 20;
    else if (a === "--min-support") args.minSupport = Number(argv[++i]) || 2;
    else if (a === "--min-confidence") args.minConfidence = Number(argv[++i]) || 0.75;
    else if (a === "--parallelism") args.parallelism = Number(argv[++i]) || 3;
    else if (a === "--pair") {
      args.pair = String(argv[++i]).split(",").map((s) => s.trim());
    } else if (a === "--model") {
      args.singleModel = argv[++i];
      args.hybrid = false;
    } else if (a === "--filter-model") args.filterModel = argv[++i];
    else if (a === "--classify-model") args.classifyModel = argv[++i];
    else if (a === "--no-hybrid") args.hybrid = false;
    else if (a === "--max-cost-usd") args.maxCostUsd = Number(argv[++i]) || 5.0;
    else if (a === "--no-cost-cap") args.noCostCap = true;
    else if (a === "--mirror-supersedes") args.mirrorSupersedes = true;
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  console.log(
    [
      "Typed Edge Classifier — Open Brain",
      "",
      "Usage: node classify-edges.mjs [flags]",
      "",
      "Candidate selection:",
      "  --limit N                Max candidate pairs to consider (default 20)",
      "  --min-support N          Min shared-entity count per pair (default 2)",
      "  --pair UUID_A,UUID_B     Classify one explicit pair; skips sampling",
      "",
      "Model selection:",
      "  --model MODEL            Use one model end-to-end; disables hybrid",
      "  --filter-model MODEL     Haiku model for candidate filter (default claude-haiku-4-5-20251001)",
      "  --classify-model MODEL   Opus model for final classification (default claude-opus-4-7)",
      "  --no-hybrid              Skip Haiku filter; run --classify-model on every pair",
      "",
      "Cost / safety:",
      "  --max-cost-usd N         Hard cap on estimated spend (default 5.00)",
      "  --no-cost-cap            Acknowledge that --max-cost-usd cannot be enforced",
      "                           when pricing is unknown for the selected model(s).",
      "  --dry-run                Classify but do not INSERT",
      "  --min-confidence N       Skip inserts below this confidence (default 0.75)",
      "  --parallelism N          Concurrent API calls (default 3)",
      "",
      "Provenance overlap:",
      "  --mirror-supersedes      Also set thoughts.supersedes on the newer thought",
      "                           (pointing at the older one) when a supersedes edge",
      "                           is classified. OFF by default (requires the",
      "                           provenance-chains schema).",
      "",
    ].join("\n"),
  );
}

function loadEnv() {
  const env = process.env;
  const missing = [];
  for (const k of ["OPEN_BRAIN_URL", "OPEN_BRAIN_SERVICE_KEY"]) {
    if (!env[k]) missing.push(k);
  }
  // Prefer OpenAI if available and valid; fall back to Anthropic
  const hasOpenAI = env.OPENAI_API_KEY && !env.OPENAI_API_KEY.startsWith("placeholder");
  const hasAnthropic = env.ANTHROPIC_API_KEY && !env.ANTHROPIC_API_KEY.startsWith("placeholder");
  let llmKey, provider;
  if (hasOpenAI) {
    llmKey = env.OPENAI_API_KEY;
    provider = "openai";
  } else if (hasAnthropic) {
    llmKey = env.ANTHROPIC_API_KEY;
    provider = "anthropic";
  } else {
    missing.push("OPENAI_API_KEY or ANTHROPIC_API_KEY (real key, not placeholder)");
  }
  if (missing.length > 0) {
    throw new Error(`Missing env vars: ${missing.join(", ")}`);
  }
  let base = String(env.OPEN_BRAIN_URL).replace(/\/+$/, "");
  base = base.replace(/\/rest\/v1$/, "");
  return {
    OPEN_BRAIN_URL: base,
    OPEN_BRAIN_SERVICE_KEY: env.OPEN_BRAIN_SERVICE_KEY,
    LLM_API_KEY: llmKey,
    LLM_PROVIDER: provider,
  };
}

// ── Supabase REST client ───────────────────────────────────────────────────

function sbClient(env) {
  const key = env.OPEN_BRAIN_SERVICE_KEY;
  const base = `${env.OPEN_BRAIN_URL}/rest/v1`;
  const headers = { apikey: key, authorization: `Bearer ${key}` };
  return {
    async get(path) {
      const r = await fetch(`${base}/${path}`, { headers });
      if (!r.ok) {
        const body = await r.text();
        throw new Error(`GET ${path}: ${r.status} ${body.slice(0, 400)}`);
      }
      return r.json();
    },
    async post(path, body, opts = {}) {
      const r = await fetch(`${base}/${path}`, {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
          prefer: opts.prefer || "return=representation",
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const text = await r.text();
        const err = new Error(`POST ${path}: ${r.status} ${text.slice(0, 400)}`);
        err.status = r.status;
        err.body = text;
        throw err;
      }
      return r.json();
    },
    async patch(path, body) {
      const r = await fetch(`${base}/${path}`, {
        method: "PATCH",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(`PATCH ${path}: ${r.status} ${text.slice(0, 400)}`);
      }
      // PATCH with no Prefer returns 204, can't .json() — guard
      const txt = await r.text();
      return txt ? JSON.parse(txt) : null;
    },
  };
}

// ── candidate sampling ─────────────────────────────────────────────────────

const HIGH_VALUE_SOURCES = new Set([
  "substack", "chatgpt_memory", "perplexity_memory", "mcp", "manual",
  "daily_digest", "google_drive",
]);
const OPERATIONAL_SOURCES = new Set(["gmail", "gmail_daily", "google_chat"]);

/**
 * Fetch the source_type for a set of thought IDs.
 * Returns Map<thought_id, source_type>.
 * Uses POST with body via Supabase RPC or falls back to batched GET.
 */
async function fetchThoughtSources(sb, thoughtIds) {
  if (thoughtIds.length === 0) return new Map();
  const result = new Map();
  // Batch in groups of 50 to stay within URL length limits
  const BATCH = 50;
  for (let i = 0; i < thoughtIds.length; i += BATCH) {
    const batch = thoughtIds.slice(i, i + BATCH);
    const filter = batch.map((id) => `id.eq.${id}`).join(",");
    const rows = await sb.get(
      `thoughts?select=id,source_type&or=(${filter})&limit=${BATCH}`,
    );
    for (const r of rows) result.set(r.id, r.source_type);
  }
  return result;
}

/**
 * Sample candidate thought pairs using source-aware stratified sampling.
 *
 * Problem: with 53K Gmail thoughts, entity co-occurrence is dominated by
 * operational data. Substack articles (140) almost never pair with each
 * other in the top-5000 entity rows.
 *
 * Solution: fetch ALL thought_entities for high-value sources, then sample
 * operational sources. Build three pair categories:
 *   1. HV↔HV  (substack↔substack, mcp↔mcp, etc.)
 *   2. HV↔OP  (substack↔gmail cross-pollination)
 *   3. OP↔OP  (gmail↔gmail, capped)
 *
 * Within each category, require entity overlap >= minSupport.
 */
async function sampleCandidatePairs(sb, minSupport, limit) {
  // Step 1: Fetch ALL thought_entities rows (paginate past Supabase's 1000-row default)
  let allRows = [];
  try {
    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const batch = await sb.get(
        `thought_entities?select=thought_id,entity_id&order=created_at.desc&offset=${offset}&limit=${pageSize}`,
      );
      allRows.push(...batch);
      if (batch.length < pageSize) break;
      offset += pageSize;
    }
  } catch (e) {
    if (String(e.message).includes("404") || String(e.message).includes("42P01")) {
      throw new Error(
        "Candidate sampling requires thought_entities (from schemas/entity-extraction/). " +
          "Apply that schema first, or pass an explicit --pair UUID_A,UUID_B.",
      );
    }
    throw e;
  }

  // Step 2: Build thought → [entity_ids] map
  const thoughtToEntities = new Map();
  for (const r of allRows) {
    const arr = thoughtToEntities.get(r.thought_id) || [];
    arr.push(r.entity_id);
    thoughtToEntities.set(r.thought_id, arr);
  }

  const allThoughtIds = [...thoughtToEntities.keys()];
  console.log(`[sample] ${allRows.length} thought_entities rows, ${allThoughtIds.length} unique thoughts`);

  // Step 3: Fetch source_type for all thoughts
  const thoughtSources = await fetchThoughtSources(sb, allThoughtIds);
  console.log(`[sample] Fetched source_type for ${thoughtSources.size} thoughts`);

  // Step 4: Partition thoughts by source category
  // null source_type thoughts are pre-import curated content (original ~1442)
  // that have entity extraction — treat as high-value.
  const hvThoughts = allThoughtIds.filter((id) => {
    const src = thoughtSources.get(id);
    return !src || HIGH_VALUE_SOURCES.has(src);
  });
  const opThoughts = allThoughtIds.filter((id) => {
    const src = thoughtSources.get(id);
    return src && OPERATIONAL_SOURCES.has(src);
  });
  const otherThoughts = allThoughtIds.filter((id) => {
    const src = thoughtSources.get(id);
    return src && !HIGH_VALUE_SOURCES.has(src) && !OPERATIONAL_SOURCES.has(src);
  });

  console.log(`[sample] HV: ${hvThoughts.length}, OP: ${opThoughts.length}, Other: ${otherThoughts.length}`);

  // Step 5: Sample candidate pairs with priority tiers
  const pairs = [];
  const seen = new Set();

  const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const tryAdd = (idA, idB) => {
    const key = pairKey(idA, idB);
    if (seen.has(key)) return;
    const entsA = new Set(thoughtToEntities.get(idA));
    const entsB = thoughtToEntities.get(idB);
    let overlap = 0;
    for (const e of entsB) {
      if (entsA.has(e)) overlap++;
      if (overlap >= minSupport) break;
    }
    if (overlap >= minSupport) {
      seen.add(key);
      pairs.push({ from_thought_id: idA, to_thought_id: idB, support: overlap });
    }
  };

  // Tier 1: HV ↔ HV (highest priority — analytical content paired together)
  for (let i = 0; i < hvThoughts.length; i++) {
    for (let j = i + 1; j < hvThoughts.length; j++) {
      tryAdd(hvThoughts[i], hvThoughts[j]);
    }
    if (pairs.length >= limit * 4) break;
  }
  console.log(`[sample] Tier 1 (HV↔HV): ${pairs.length} pairs`);

  // Tier 2: HV ↔ OP (cross-pollination — substack insights vs operational data)
  const tier1Count = pairs.length;
  // Limit OP thoughts sampled to avoid O(n*m) explosion
  const opSample = opThoughts.length > 500
    ? opThoughts.filter((_, i) => i % Math.ceil(opThoughts.length / 500) === 0)
    : opThoughts;
  for (const hvId of hvThoughts) {
    if (pairs.length >= limit * 4) break;
    for (const opId of opSample) {
      tryAdd(hvId, opId);
      if (pairs.length >= limit * 4) break;
    }
  }
  console.log(`[sample] Tier 2 (HV↔OP): +${pairs.length - tier1Count} pairs`);

  // Tier 3: OP ↔ OP (fill remaining budget, evenly sampled)
  const tier2Count = pairs.length;
  if (pairs.length < limit * 4) {
    // Sample a subset of OP thoughts for inter-pairing
    const opSubset = opSample.slice(0, 300);
    for (let i = 0; i < opSubset.length && pairs.length < limit * 4; i++) {
      for (let j = i + 1; j < opSubset.length && pairs.length < limit * 4; j++) {
        tryAdd(opSubset[i], opSubset[j]);
      }
    }
  }
  console.log(`[sample] Tier 3 (OP↔OP): +${pairs.length - tier2Count} pairs`);

  // Also include other/unknown thoughts in cross-pairs
  if (otherThoughts.length > 0 && pairs.length < limit * 4) {
    for (const oId of otherThoughts.slice(0, 200)) {
      for (const hvId of hvThoughts.slice(0, 100)) {
        tryAdd(oId, hvId);
        if (pairs.length >= limit * 4) break;
      }
      if (pairs.length >= limit * 4) break;
    }
  }

  // Sort by support desc, then trim to limit
  pairs.sort((a, b) => b.support - a.support);
  console.log(`[sample] Total: ${pairs.length} candidate pairs, returning top ${limit}`);
  return pairs.slice(0, limit);
}

async function fetchPairAlreadyClassified(sb, a, b) {
  // Any existing NON-related_to edge in either direction means we've
  // already classified this pair with a stronger label; skip it.
  //
  // Important: the query must filter `relation != 'related_to'` so that
  // a pair previously tagged with the fallback `related_to` label can
  // still be reclassified into a real relation on a later run. Without
  // this filter the classifier would permanently lock `related_to`
  // pairs out of reclassification. See README "Expected Outcome".
  const rows = await sb.get(
    `thought_edges?select=relation,from_thought_id,to_thought_id` +
      `&relation=neq.related_to` +
      `&or=(and(from_thought_id.eq.${a},to_thought_id.eq.${b}),and(from_thought_id.eq.${b},to_thought_id.eq.${a}))` +
      `&limit=1`,
  );
  return rows.length > 0;
}

async function fetchThoughts(sb, ids) {
  if (ids.length === 0) return [];
  // PostgREST `in.(...)` wants comma-separated, but UUIDs can contain no
  // commas so we can pass them raw.
  const idList = ids.join(",");
  return sb.get(
    `thoughts?select=id,content,created_at,metadata&id=in.(${idList})`,
  );
}

// ── Anthropic calls ────────────────────────────────────────────────────────

// Retry policy for Anthropic API calls. We retry on 429 (rate limit)
// and 5xx (transient server errors). Exponential backoff with jitter:
// base 1s, doubles each attempt, capped at 60s, 5 retries total.
// Other errors (400, 401, 403, 404 etc.) are real and surfaced immediately.
const ANTHROPIC_RETRY_MAX = 5;
const ANTHROPIC_RETRY_BASE_MS = 1000;
const ANTHROPIC_RETRY_CAP_MS = 60_000;

function shouldRetryAnthropicStatus(status) {
  return status === 429 || (status >= 500 && status < 600);
}

function backoffDelayMs(attempt) {
  // attempt starts at 0 → 1s, 2s, 4s, 8s, 16s ... capped at 60s,
  // with +/- 20% jitter so concurrent retries don't synchronize.
  const exp = Math.min(ANTHROPIC_RETRY_BASE_MS * 2 ** attempt, ANTHROPIC_RETRY_CAP_MS);
  const jitter = exp * (0.8 + Math.random() * 0.4);
  return Math.floor(jitter);
}

async function callAnthropicOnce(env, model, system, userMsg, maxTokens) {
  if (env.LLM_PROVIDER === "openai") {
    return await callOpenAI(env, model, system, userMsg, maxTokens);
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.LLM_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userMsg }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Anthropic ${model}: ${res.status} ${body.slice(0, 400)}`);
    err.status = res.status;
    err.retryable = shouldRetryAnthropicStatus(res.status);
    throw err;
  }
  const body = await res.json();
  const raw = body?.content?.[0]?.text?.trim() ?? "";
  const usage = body?.usage || {};
  return {
    raw,
    inTokens: usage.input_tokens || 0,
    outTokens: usage.output_tokens || 0,
  };
}

async function callOpenAI(env, model, system, userMsg, maxTokens) {
  // Map Anthropic model names to OpenAI equivalents
  // Use gpt-4o-mini for fast filter (not a reasoning model), o3 for classification
  const modelMap = {
    "claude-haiku-4-5-20251001": "gpt-4o-mini",
    "claude-opus-4-7": "o3",
  };
  const openaiModel = modelMap[model] || "o3";
  // Reasoning models need much higher token limits (thinking tokens count against the budget)
  const effectiveMaxTokens = openaiModel.startsWith("o") ? Math.max(maxTokens * 5, 2000) : maxTokens;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.LLM_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: openaiModel,
      max_completion_tokens: effectiveMaxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMsg },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`OpenAI ${openaiModel}: ${res.status} ${body.slice(0, 400)}`);
    err.status = res.status;
    err.retryable = shouldRetryAnthropicStatus(res.status);
    throw err;
  }
  const body = await res.json();
  const raw = body?.choices?.[0]?.message?.content?.trim() ?? "";
  const usage = body?.usage || {};
  return {
    raw,
    inTokens: usage.prompt_tokens || 0,
    outTokens: usage.completion_tokens || 0,
  };
}

async function callAnthropic(env, model, system, userMsg, maxTokens) {
  let lastErr;
  for (let attempt = 0; attempt <= ANTHROPIC_RETRY_MAX; attempt++) {
    try {
      return await callAnthropicOnce(env, model, system, userMsg, maxTokens);
    } catch (e) {
      lastErr = e;
      // Bail immediately on non-retryable errors (4xx except 429).
      if (!e.retryable || attempt === ANTHROPIC_RETRY_MAX) {
        throw e;
      }
      const delay = backoffDelayMs(attempt);
      console.warn(
        `[classify-edges] Anthropic ${model} ${e.status || "network"}: retry ${attempt + 1}/${ANTHROPIC_RETRY_MAX} in ${delay}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

function parseJsonStrict(raw) {
  const cleaned = raw.replace(/^```(?:json)?/m, "").replace(/```$/m, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`JSON parse failed: ${e.message}; raw=${raw.slice(0, 200)}`);
  }
}

// Haiku filter: fast yes/no on whether a pair deserves Opus attention.
async function filterCandidate(env, model, thoughtA, thoughtB) {
  const system =
    "You are a fast pre-filter for a reasoning-edge classifier. " +
    "Given two thoughts, answer whether there is ANY meaningful semantic relation " +
    "beyond simple co-mention (one of: supports, contradicts, evolved_into, " +
    "supersedes, depends_on). " +
    "Reply with strict JSON only, no markdown:\n" +
    '{"worth_classifying": true|false, "hunch": "<one-word relation or none>"}';
  const user =
    `Thought A (${thoughtA.id}, ${String(thoughtA.created_at || "").slice(0, 10)}):\n` +
    `${String(thoughtA.content || "").slice(0, 400)}\n\n` +
    `Thought B (${thoughtB.id}, ${String(thoughtB.created_at || "").slice(0, 10)}):\n` +
    `${String(thoughtB.content || "").slice(0, 400)}\n\n` +
    `Is there a meaningful relation? Return strict JSON.`;
  const { raw, inTokens, outTokens } = await callAnthropic(env, model, system, user, 128);
  const parsed = parseJsonStrict(raw);
  return {
    worthClassifying: Boolean(parsed.worth_classifying),
    hunch: parsed.hunch || "none",
    inTokens,
    outTokens,
  };
}

// Opus classify: full vocabulary with confidence + direction + temporal bounds.
async function classifyPair(env, model, thoughtA, thoughtB) {
  const system =
    "You classify the semantic relationship between two thoughts from someone's personal knowledge base.\n\n" +
    "ALLOWED RELATION TYPES (pick exactly one, or 'none'):\n\n" +
    "  supports      — A strengthens or provides evidence for B.\n" +
    "                  YES: 'slept 8h Tuesday' -> 'felt sharp Tuesday morning'\n" +
    "                  NO: generic topical overlap (use related_to or none).\n\n" +
    "  contradicts   — A disagrees with or disproves B.\n" +
    "                  YES: 'ran 5mi Tuesday' vs 'rested Tuesday'\n" +
    "                  Be rare with this label — only when the conflict is direct.\n\n" +
    "  evolved_into  — A was replaced by a refined/updated B over time.\n" +
    "                  YES: v1 design note -> v2 design note with explicit iteration\n" +
    "                  NO: same idea restated (use same-topic or none).\n\n" +
    "  supersedes    — A is the newer replacement for B for decisions or versions.\n" +
    "                  YES: 'switched to Supabase' -> supersedes -> 'decided on Firebase'\n" +
    "                  The subject is the newer/surviving thought.\n\n" +
    "  depends_on    — A is conditional on B being true or completing first.\n" +
    "                  YES: 'ship Friday' -> depends_on -> 'tests pass'\n\n" +
    "  related_to    — Generic association; no specific label fits.\n" +
    "                  Use sparingly. Prefer 'none' when in doubt.\n\n" +
    "RETURN 'none' WHEN:\n" +
    "  - the thoughts merely co-mention an entity without a directional relation\n" +
    "  - no specific label is clearly better than related_to\n" +
    "  - evidence is ambiguous or contradictory within the pair itself\n\n" +
    "DIRECTION: pick whichever makes the sentence true when you substitute:\n" +
    "  A <relation> B  (e.g. 'Tuesday sleep supports Tuesday sharpness')\n" +
    "  If direction should be flipped, set direction='B_to_A'.\n" +
    "  If the relation is inherently symmetric, set direction='symmetric'.\n\n" +
    "TEMPORALITY: if the relation has a clear start or end ('was true until Q4 2025'), " +
    "populate valid_from and/or valid_until as ISO YYYY-MM-DD; otherwise null.\n\n" +
    "OUTPUT strict valid JSON, no markdown, no commentary:\n" +
    '{"relation": "<type|none>", "direction": "A_to_B|B_to_A|symmetric", ' +
    '"confidence": 0.0-1.0, "rationale": "...", ' +
    '"valid_from": "YYYY-MM-DD|null", "valid_until": "YYYY-MM-DD|null"}';

  const user =
    `Thought A (id=${thoughtA.id}, date=${String(thoughtA.created_at || "").slice(0, 10)}):\n` +
    `${String(thoughtA.content || "").slice(0, 800)}\n\n` +
    `Thought B (id=${thoughtB.id}, date=${String(thoughtB.created_at || "").slice(0, 10)}):\n` +
    `${String(thoughtB.content || "").slice(0, 800)}\n\n` +
    `Classify the relationship.`;

  const { raw, inTokens, outTokens } = await callAnthropic(env, model, system, user, 512);
  const parsed = parseJsonStrict(raw);
  return { ...parsed, inTokens, outTokens };
}

// ── insert the typed edge ──────────────────────────────────────────────────

async function insertTypedEdge(sb, args, pair, thoughtA, thoughtB, cls, modelUsed) {
  let from, to;
  if (cls.direction === "B_to_A") {
    from = thoughtB.id;
    to = thoughtA.id;
  } else if (cls.direction === "symmetric") {
    // Stable ordering so (A,B) and (B,A) collide on the unique key
    [from, to] = [thoughtA.id, thoughtB.id].sort();
  } else {
    from = thoughtA.id;
    to = thoughtB.id;
  }

  const metadata = {
    classifier_model: modelUsed,
    rationale: cls.rationale,
    direction: cls.direction,
  };
  const validFrom = cls.valid_from && cls.valid_from !== "null" ? cls.valid_from : null;
  const validUntil = cls.valid_until && cls.valid_until !== "null" ? cls.valid_until : null;

  // Direct REST insert into thought_edges. Prefer the upsert RPC for
  // evidence accumulation, but fall back to plain POST if the RPC
  // has different parameter names on the deployed instance.
  const edgeRow = {
    from_thought_id: from,
    to_thought_id: to,
    relation: cls.relation,
    confidence: Math.round(cls.confidence * 100) / 100,
    support_count: pair.support || 1,
    classifier_version: CLASSIFIER_VERSION,
    valid_from: validFrom,
    valid_until: validUntil,
    metadata,
  };

  try {
    // Try upsert RPC first (atomic duplicate handling)
    let inserted;
    try {
      inserted = await sb.post("rpc/thought_edges_upsert", {
        p_from_thought_id: from,
        p_to_thought_id: to,
        p_relation: cls.relation,
        p_confidence: Math.round(cls.confidence * 100) / 100,
        p_support_count: pair.support || 1,
        p_classifier_version: CLASSIFIER_VERSION,
        p_valid_from: validFrom,
        p_valid_until: validUntil,
        p_metadata: metadata,
      });
    } catch (rpcErr) {
      // RPC parameter mismatch — fall back to direct REST insert
      if (String(rpcErr.message).includes("PGRST202") || String(rpcErr.message).includes("schema cache")) {
        inserted = await sb.post("thought_edges", edgeRow, { prefer: "return=representation" });
      } else {
        throw rpcErr;
      }
    }
    // RPC returning a composite type yields an object directly; if
    // PostgREST wraps it in an array for some versions, unwrap.
    const row = Array.isArray(inserted) ? inserted[0] : inserted;
    const edgeId = row?.id ?? null;

    // Optional: mirror supersedes onto public.thoughts.supersedes (see
    // the README "Design Tensions" section). This is off by default and
    // requires the provenance-chains schema to be installed.
    //
    // Direction per provenance-chains contract: the NEWER thought
    // carries the pointer to the PRIOR (older) thought it replaces.
    // Edge (from=A, to=B, relation='supersedes') means "A supersedes B",
    // so the mirror PATCH targets A (the FROM thought) with
    // supersedes = B (the TO thought). See the PATCH below.
    if (args.mirrorSupersedes && cls.relation === "supersedes") {
      try {
        // Edge direction: (from=A, to=B, relation='supersedes') means
        // "A supersedes B" — A is newer, B is older. Per the
        // provenance-chains contract (see
        // schemas/provenance-chains/schema.sql), thoughts.supersedes is
        // a pointer from the NEWER thought to the PRIOR thought it
        // replaces. So the mirror write is:
        //   A supersedes B  →  A.supersedes = B
        // i.e. PATCH the FROM thought with supersedes = TO.
        //
        // BEST-EFFORT, NOT ATOMIC: this PATCH is a second HTTP round-trip
        // after the edge INSERT. If the PATCH fails for any reason
        // (column missing because schemas/provenance-chains/ is not
        // applied, RLS, network, 5xx), we log a warning and continue —
        // the edge is the source of truth. Do NOT preflight via
        // information_schema: PostgREST does not expose that schema over
        // REST (https://docs.postgrest.org/en/latest/references/api/schemas.html).
        // True atomicity requires an RPC (future PR). Reruns will NOT
        // retry this PATCH — processPair short-circuits on existing
        // non-related_to edges via skip_already_classified, so this
        // branch is unreachable on a second pass. See README "Manual
        // mirror repair" for the SQL reconciliation command.
        await sb.patch(
          `thoughts?id=eq.${from}`,
          { supersedes: to },
        );
      } catch (e) {
        // Mirror to thoughts.supersedes failed. The edge is written, but
        // the denormalized pointer on public.thoughts is stale. Reruns
        // will NOT retry this — processPair short-circuits via
        // skip_already_classified once the edge exists. To repair
        // manually, see README "Manual mirror repair".
        console.warn(
          `  [warn] Mirror to thoughts.supersedes failed — column may not exist ` +
            `or permissions may be restricted. Edge inserted; manual reconciliation ` +
            `may be needed. See README. ${String(e.message).slice(0, 200)}`,
        );
      }
    }

    return { ok: true, id: edgeId };
  } catch (e) {
    // 409 = unique constraint violation = duplicate, treat as success
    if (e.status === 409 || String(e.message).includes("409") || String(e.message).includes("duplicate")) {
      return { ok: true, id: null };
    }
    return { ok: false, reason: e.message };
  }
}

// ── process one pair ───────────────────────────────────────────────────────

async function processPair(env, sb, args, pair, costState) {
  if (costState.spent >= args.maxCostUsd) {
    return { ...pair, status: "skip_cost_cap" };
  }

  const { from_thought_id: a, to_thought_id: b } = pair;

  const already = await fetchPairAlreadyClassified(sb, a, b);
  if (already) return { ...pair, status: "skip_already_classified" };

  // PostgREST `id=in.(A,B)` does NOT guarantee result order. Build a
  // Map<id, row> and look up by ID so A/B cannot silently swap — a
  // swap would corrupt edge direction (supersedes, depends_on, etc.)
  // and the supersedes mirror target.
  const rows = await fetchThoughts(sb, [a, b]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const thoughtA = byId.get(a);
  const thoughtB = byId.get(b);
  if (!thoughtA || !thoughtB) return { ...pair, status: "skip_missing_thought" };

  // Stage 1: Haiku filter (unless hybrid disabled).
  let filterModelUsed = null;
  if (args.hybrid) {
    let filt;
    try {
      filt = await filterCandidate(env, args.filterModel, thoughtA, thoughtB);
    } catch (e) {
      console.error(`[classify-edges] filter error for pair ${pair.a}/${pair.b}: ${e.message}`);
      return { ...pair, status: "filter_error", error: e.message };
    }
    filterModelUsed = args.filterModel;
    costState.spent += estimateCost(args.filterModel, filt.inTokens, filt.outTokens);
    if (costState.spent >= args.maxCostUsd) {
      return { ...pair, status: "skip_cost_cap_after_filter" };
    }
    if (!filt.worthClassifying) {
      return { ...pair, status: "filter_rejected", hunch: filt.hunch };
    }
  }

  // Stage 2: Opus (or single model) classification.
  const classifyModel = args.singleModel || args.classifyModel;
  let cls;
  try {
    cls = await classifyPair(env, classifyModel, thoughtA, thoughtB);
  } catch (e) {
    console.error(`[classify-edges] classify error for pair ${pair.a}/${pair.b}: ${e.message}`);
    return { ...pair, status: "classifier_error", error: e.message };
  }
  costState.spent += estimateCost(classifyModel, cls.inTokens, cls.outTokens);

  const label =
    cls.direction === "B_to_A"
      ? `${b} -[${cls.relation}]-> ${a}`
      : `${a} -[${cls.relation}]-> ${b}`;

  if (!TYPED_RELATIONS.has(cls.relation) || cls.relation === "none") {
    return {
      ...pair,
      status: "none",
      label,
      confidence: cls.confidence,
      rationale: cls.rationale,
      filterModel: filterModelUsed,
      classifyModel,
    };
  }
  if (cls.confidence < args.minConfidence) {
    return {
      ...pair,
      status: "below_confidence",
      label,
      confidence: cls.confidence,
      rationale: cls.rationale,
      filterModel: filterModelUsed,
      classifyModel,
    };
  }

  if (args.dryRun) {
    return {
      ...pair,
      status: "would_insert",
      label,
      confidence: cls.confidence,
      rationale: cls.rationale,
      filterModel: filterModelUsed,
      classifyModel,
      valid_from: cls.valid_from,
      valid_until: cls.valid_until,
    };
  }

  const result = await insertTypedEdge(sb, args, pair, thoughtA, thoughtB, cls, classifyModel);
  return result.ok
    ? {
        ...pair,
        status: "inserted",
        edge_id: result.id,
        label,
        confidence: cls.confidence,
        filterModel: filterModelUsed,
        classifyModel,
      }
    : {
        ...pair,
        status: "insert_failed",
        reason: result.reason,
        label,
        filterModel: filterModelUsed,
        classifyModel,
      };
}

// ── chunked runner ─────────────────────────────────────────────────────────

/**
 * Chunked parallel runner with a HARD cost-cap contract.
 *
 * The naive version (Promise.all across `parallelism` items with no
 * cap-awareness) can overshoot `--max-cost-usd` by up to
 * `(parallelism - 1) * worstCasePerPair` because all in-flight tasks
 * check `costState.spent` before any of them has resolved. With
 * Opus classify at ~$0.018/pair and parallelism=3, the overshoot can
 * reach ~$0.036 past the cap — not catastrophic, but the README
 * promises a hard cap.
 *
 * Fix: before each chunk, compute the remaining budget. If the
 * remaining budget is not large enough to absorb `parallelism` fresh
 * worst-case pairs, clamp the chunk size down — all the way to 1 if
 * we are inside one worst-case pair of the cap. Once spend meets or
 * exceeds the cap, stop scheduling entirely; `processPair` still
 * short-circuits with `skip_cost_cap` on any stragglers.
 *
 * This makes the cap a hard bound (modulo the cost of the single
 * in-flight task that discovers we've hit the cap, which is bounded
 * by `worstCasePerPair`).
 */
async function processInChunks(items, fn, parallelism, costState, maxCostUsd, worstCost) {
  const results = [];
  // If we cannot price a pair (unknown model), we cannot do the
  // proactive clamp — just fall back to the naive behavior. The
  // pricing-unknown warning / cost-cap refusal at startup is what
  // protects users in that case (see loadEnv + parseArgs).
  const canProactivelyClamp = typeof worstCost === "number" && worstCost > 0;

  for (let i = 0; i < items.length; ) {
    // Stop scheduling once the cap is reached. In-flight tasks cannot
    // exceed by more than `worstCost` because we clamp below.
    if (typeof maxCostUsd === "number" && costState.spent >= maxCostUsd) {
      // Drain remaining items as cap-skipped for reporting symmetry.
      for (; i < items.length; i++) {
        results.push(await fn(items[i]));
      }
      break;
    }

    let chunkSize = parallelism;
    if (canProactivelyClamp && typeof maxCostUsd === "number") {
      const remaining = maxCostUsd - costState.spent;
      // Only launch as many parallel tasks as the remaining budget can
      // absorb in the worst case. This clamps to 1 when we're close to
      // the cap and to 0 when we're already at it (handled above).
      const safe = Math.max(1, Math.floor(remaining / worstCost));
      chunkSize = Math.min(parallelism, safe);
    }

    const chunk = items.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map(fn));
    results.push(...chunkResults);
    i += chunkSize;
  }
  return results;
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Preflight: if any model we're about to call has no pricing entry,
  // refuse to run with --max-cost-usd unless --no-cost-cap is set. See
  // WARN-1 in REVIEW.md. This catches the "unknown model silently runs
  // uncapped" failure mode before any LLM spend.
  assertPricingKnown(args);

  const env = loadEnv();
  const sb = sbClient(env);

  let pairs;
  if (args.pair) {
    if (args.pair.length !== 2) {
      throw new Error("--pair expects two UUIDs separated by a comma");
    }
    pairs = [{ from_thought_id: args.pair[0], to_thought_id: args.pair[1], support: 1 }];
    console.log(`[classify-edges] single pair: ${args.pair[0]} + ${args.pair[1]}`);
  } else {
    console.log(
      `[classify-edges] sampling up to ${args.limit} candidate pairs ` +
        `(min shared-entity support = ${args.minSupport})`,
    );
    pairs = await sampleCandidatePairs(sb, args.minSupport, args.limit);
  }
  console.log(`[classify-edges] processing ${pairs.length} pairs${args.dryRun ? " (dry-run)" : ""}`);
  console.log(
    `[classify-edges] mode=${args.hybrid ? "hybrid(Haiku->Opus)" : args.singleModel || args.classifyModel}` +
      ` | max-cost=$${args.maxCostUsd.toFixed(2)}` +
      ` | mirror-supersedes=${args.mirrorSupersedes}`,
  );

  const costState = { spent: 0 };
  // Worst-case per-pair cost for the hard cost cap. In hybrid mode this
  // includes BOTH the Haiku filter leg AND the Opus classify leg so the
  // parallelism clamp reflects the true per-pair spend (see
  // REVIEW-CODEX-2 P2). Returns 0 for unknown models, which disables the
  // proactive parallelism clamp — the pricing-unknown refusal in
  // assertPricingKnown is what protects users in that case.
  const worstCost = worstCasePerPair(args);
  const results = await processInChunks(
    pairs,
    (p) => processPair(env, sb, args, p, costState),
    args.parallelism,
    costState,
    args.maxCostUsd,
    worstCost,
  );

  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  console.log("\n[classify-edges] status counts:", counts);
  console.log(`[classify-edges] estimated spend: $${costState.spent.toFixed(4)} of $${args.maxCostUsd.toFixed(2)} cap`);

  for (const r of results) {
    if (["inserted", "would_insert", "below_confidence", "none"].includes(r.status)) {
      const marker =
        r.status === "inserted"
          ? "[ok]"
          : r.status === "would_insert"
            ? "[dry]"
            : r.status === "below_confidence"
              ? "[low]"
              : "[---]";
      const conf = typeof r.confidence === "number" ? r.confidence.toFixed(2) : "?";
      console.log(`  ${marker} ${r.status.padEnd(18)} conf=${conf}  ${r.label}`);
      if (r.rationale) console.log(`        ${r.rationale.slice(0, 160)}`);
      if (r.valid_from || r.valid_until) {
        console.log(`        temporal: ${r.valid_from || "?"} -> ${r.valid_until || "?"}`);
      }
    }
  }
}

main().catch((err) => {
  console.error("[classify-edges] FAILED:", err.message);
  process.exit(1);
});
