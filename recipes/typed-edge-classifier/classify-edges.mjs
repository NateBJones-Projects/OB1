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
};

function estimateCost(model, inTokens, outTokens) {
  const p = PRICING[model];
  if (!p) return 0; // unknown model — don't block, but don't count
  return (inTokens * p.in + outTokens * p.out) / 1_000_000;
}

// Worst-case per-pair cost for hard-cap arithmetic in processInChunks.
// Derived from the classify stage with the generous token budget the
// prompt could actually hit (800 in / 512 out matches max_tokens=512
// in classifyPair). Unknown models return 0 which correctly disables
// the proactive parallelism clamp (see estimateCost + WARN-1 refusal).
function worstCasePerPair(model) {
  return estimateCost(model, 800, 512);
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
      "  --dry-run                Classify but do not INSERT",
      "  --min-confidence N       Skip inserts below this confidence (default 0.75)",
      "  --parallelism N          Concurrent API calls (default 3)",
      "",
      "Provenance overlap:",
      "  --mirror-supersedes      Also set thoughts.supersedes on the older thought",
      "                           when a supersedes edge is classified. OFF by default",
      "                           (requires the provenance-chains schema).",
      "",
    ].join("\n"),
  );
}

function loadEnv() {
  const env = process.env;
  const missing = [];
  for (const k of ["OPEN_BRAIN_URL", "OPEN_BRAIN_SERVICE_KEY", "ANTHROPIC_API_KEY"]) {
    if (!env[k]) missing.push(k);
  }
  if (missing.length > 0) {
    throw new Error(`Missing env vars: ${missing.join(", ")}`);
  }
  // Normalize URL — allow OPEN_BRAIN_URL with or without trailing slash,
  // with or without /rest/v1. Store the base project URL.
  let base = String(env.OPEN_BRAIN_URL).replace(/\/+$/, "");
  base = base.replace(/\/rest\/v1$/, "");
  return {
    OPEN_BRAIN_URL: base,
    OPEN_BRAIN_SERVICE_KEY: env.OPEN_BRAIN_SERVICE_KEY,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
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

/**
 * Sample candidate thought pairs. Strategy: find pairs of thoughts that
 * share at least `minSupport` entities via `thought_entities`. These
 * are the pairs with the most signal for the classifier.
 *
 * If `thought_entities` is not installed (i.e. the caller hasn't set up
 * entity-extraction), fall back to nothing — force them to use --pair.
 */
async function sampleCandidatePairs(sb, minSupport, limit) {
  // Pull recent thought_entities rows, build a thought -> [entity_ids]
  // map in JS, then find pairs with overlap >= minSupport. We cap the
  // pull at 5000 rows to keep memory bounded.
  let rows;
  try {
    rows = await sb.get(
      `thought_entities?select=thought_id,entity_id&order=created_at.desc&limit=5000`,
    );
  } catch (e) {
    if (String(e.message).includes("404") || String(e.message).includes("42P01")) {
      throw new Error(
        "Candidate sampling requires thought_entities (from schemas/entity-extraction/). " +
          "Apply that schema first, or pass an explicit --pair UUID_A,UUID_B.",
      );
    }
    throw e;
  }

  const thoughtToEntities = new Map();
  for (const r of rows) {
    const arr = thoughtToEntities.get(r.thought_id) || [];
    arr.push(r.entity_id);
    thoughtToEntities.set(r.thought_id, arr);
  }

  const thoughtIds = [...thoughtToEntities.keys()];
  const pairs = [];
  for (let i = 0; i < thoughtIds.length; i++) {
    const entsA = new Set(thoughtToEntities.get(thoughtIds[i]));
    for (let j = i + 1; j < thoughtIds.length; j++) {
      const entsB = thoughtToEntities.get(thoughtIds[j]);
      let overlap = 0;
      for (const e of entsB) {
        if (entsA.has(e)) overlap++;
        if (overlap >= minSupport) break;
      }
      if (overlap >= minSupport) {
        pairs.push({
          from_thought_id: thoughtIds[i],
          to_thought_id: thoughtIds[j],
          support: overlap,
        });
      }
      if (pairs.length >= limit * 4) break;
    }
    if (pairs.length >= limit * 4) break;
  }

  // Sort by support desc, then trim to limit
  pairs.sort((a, b) => b.support - a.support);
  return pairs.slice(0, limit);
}

async function fetchPairAlreadyClassified(sb, a, b) {
  // Any existing non-related_to edge in either direction means we've
  // already classified this pair; skip it.
  const rows = await sb.get(
    `thought_edges?select=relation,from_thought_id,to_thought_id` +
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

/**
 * Preflight check for --mirror-supersedes.
 *
 * The mirror path is NOT atomic: the edge INSERT and the `thoughts.supersedes`
 * PATCH are two separate HTTP calls. If the PATCH fails because the column
 * doesn't exist, PostgREST returns 400 (NOT a no-op). That turns every
 * supersedes classification into a half-applied write.
 *
 * This preflight catches the common case — column missing because
 * `schemas/provenance-chains/` hasn't been applied — before any LLM
 * spend. Atomicity on transient PATCH failures (network, 5xx) still
 * requires an RPC; see CRIT-2 in REVIEW.md and the documented
 * reconciliation path in the README.
 */
async function assertMirrorColumnExists(sb) {
  const rows = await sb.get(
    `information_schema.columns?select=column_name` +
      `&table_schema=eq.public&table_name=eq.thoughts&column_name=eq.supersedes`,
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(
      "--mirror-supersedes requires public.thoughts.supersedes " +
        "(from schemas/provenance-chains/). Apply that schema first, " +
        "or drop the flag.",
    );
  }
}

// ── Anthropic calls ────────────────────────────────────────────────────────

async function callAnthropic(env, model, system, userMsg, maxTokens) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
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
    throw new Error(`Anthropic ${model}: ${res.status} ${body.slice(0, 400)}`);
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

  const row = {
    from_thought_id: from,
    to_thought_id: to,
    relation: cls.relation,
    confidence: Math.round(cls.confidence * 100) / 100,
    support_count: pair.support || 1,
    classifier_version: CLASSIFIER_VERSION,
    metadata: {
      classifier_model: modelUsed,
      rationale: cls.rationale,
      direction: cls.direction,
    },
  };
  if (cls.valid_from && cls.valid_from !== "null") row.valid_from = cls.valid_from;
  if (cls.valid_until && cls.valid_until !== "null") row.valid_until = cls.valid_until;

  try {
    const inserted = await sb.post("thought_edges", row);
    const edgeId = inserted?.[0]?.id ?? null;

    // Optional: mirror supersedes onto public.thoughts.supersedes (see
    // the README "Design Tensions" section). This is off by default and
    // requires the provenance-chains schema to be installed.
    if (args.mirrorSupersedes && cls.relation === "supersedes") {
      try {
        // The newer thought (the `from`) supersedes the older thought (the `to`).
        // Update thoughts.supersedes on the OLDER thought so "what replaced me?"
        // queries have a direct pointer.
        //
        // NOT ATOMIC: this PATCH is a second HTTP round-trip after the
        // edge INSERT. If the PATCH fails (network, 5xx, RLS), the edge
        // exists but `thoughts.supersedes` does not, leaving the
        // denormalized pointer out of sync. See CRIT-2 in REVIEW.md.
        // We preflight at startup (assertMirrorColumnExists) so a
        // MISSING column fails the run fast instead of silently here;
        // true atomicity requires an RPC (future PR). The mirror is
        // idempotent — re-running classification will re-apply it.
        await sb.patch(
          `thoughts?id=eq.${to}`,
          { supersedes: from },
        );
      } catch (e) {
        // Don't fail the edge insert if the mirror fails — the edge is
        // the source of truth. To reconcile, re-run the classifier on
        // the same pair; the edge will hit the unique constraint and
        // the mirror PATCH will be retried.
        console.warn(`  [warn] mirror supersedes failed (edge written, thoughts.supersedes NOT updated): ${String(e.message).slice(0, 200)}`);
      }
    }

    return { ok: true, id: edgeId };
  } catch (e) {
    if (String(e.body || e.message).toLowerCase().includes("duplicate")) {
      return { ok: false, reason: "duplicate" };
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
  const env = loadEnv();
  const sb = sbClient(env);

  // Preflight: if --mirror-supersedes is set, require public.thoughts.supersedes
  // up front so we fail before spending any LLM money. See CRIT-2 in REVIEW.md.
  if (args.mirrorSupersedes) {
    await assertMirrorColumnExists(sb);
  }

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
  // Worst-case per-pair cost for the hard cost cap. Uses the classify
  // model because that's the expensive leg. Returns 0 for unknown
  // models, which disables the proactive parallelism clamp — the
  // pricing-unknown refusal in parseArgs/loadEnv is what protects
  // users in that case.
  const classifyModel = args.singleModel || args.classifyModel;
  const worstCost = worstCasePerPair(classifyModel);
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
