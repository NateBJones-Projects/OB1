/**
 * open-brain-rest — REST API for Open Brain
 *
 * Provides simple REST endpoints for non-MCP clients (ChatGPT Actions, Gemini, etc.)
 * Routes:
 *   POST /search       — search thoughts (semantic or text)
 *   POST /capture      — capture a new thought
 *   GET  /thought/:id  — get single thought
 *   PUT  /thought/:id  — update thought content
 *   DELETE /thought/:id — delete thought
 *   GET  /stats        — brain stats summary
 *   GET  /health       — health check
 *
 * Auth: ?key= query param, x-brain-key header, or Authorization: Bearer <key>
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  embedText,
  extractMetadata,
  fallbackMetadata,
  detectSensitivity,
  resolveSensitivityTier,
  applyEvergreenTag,
  parseStructuredCapture,
  mergeUniqueStrings,
  normalizeStringArray,
  prepareThoughtPayload,
  computeContentFingerprint,
  isRecord,
  asString,
  ALLOWED_TYPES,
  safeEmbedding,
} from "./utils/open-brain-utils.ts";

import { SENSITIVITY_TIERS } from "./utils/ingest-config.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY") ?? "";
const _SUPABASE_URL = SUPABASE_URL; // reference to suppress unused warning

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-brain-key",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Auth check
  if (MCP_ACCESS_KEY && !isAuthorized(req)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = new URL(req.url);
  // Strip the function name prefix from path for routing
  const path = url.pathname
    .replace(/^\/open-brain-rest/, "")
    .replace(/\/+$/, "") || "/";

  try {
    if (path === "/health" || path === "/healthz" || path === "/") {
      return json({ ok: true, service: "open-brain-rest", timestamp: new Date().toISOString() });
    }

    if (path === "/search" && req.method === "POST") {
      return await handleSearch(req);
    }

    if (path === "/capture" && req.method === "POST") {
      return await handleCapture(req);
    }

    // Paginated browse
    if (path === "/thoughts" && req.method === "GET") {
      return await handleBrowseThoughts(url);
    }

    // /thought/:id routes
    const thoughtMatch = path.match(/^\/thought\/(\d+)$/);
    if (thoughtMatch) {
      const id = Number(thoughtMatch[1]);
      if (req.method === "GET") {
        const excludeRestricted = url.searchParams.get("exclude_restricted") !== "false";
        return await handleGetThought(id, excludeRestricted);
      }
      if (req.method === "PUT") return await handleUpdateThought(id, req);
      if (req.method === "DELETE") return await handleDeleteThought(id);
    }

    // /thought/:id/connections route
    const connectionsMatch = path.match(/^\/thought\/(\d+)\/connections$/);
    if (connectionsMatch && req.method === "GET") {
      const thoughtId = Number(connectionsMatch[1]);
      const excludeRestricted = url.searchParams.get("exclude_restricted") !== "false";
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 50);
      return await handleGetConnections(thoughtId, limit, excludeRestricted);
    }

    // /thought/:id/reflection routes
    const reflectionMatch = path.match(/^\/thought\/(\d+)\/reflection$/);
    if (reflectionMatch) {
      const thoughtId = Number(reflectionMatch[1]);
      if (req.method === "GET") return await handleGetReflection(thoughtId);
      if (req.method === "POST") return await handleCaptureReflection(thoughtId, req);
    }

    // Smart ingest routes
    if (path === "/ingest" && req.method === "POST") {
      return await handleIngest(req);
    }

    const executeMatch = path.match(/^\/ingestion-jobs\/(\d+)\/execute$/);
    if (executeMatch && req.method === "POST") {
      return await handleExecuteJob(Number(executeMatch[1]));
    }

    if (path === "/ingestion-jobs" && req.method === "GET") {
      return await handleListJobs(url);
    }

    const jobDetailMatch = path.match(/^\/ingestion-jobs\/(\d+)$/);
    if (jobDetailMatch && req.method === "GET") {
      return await handleGetJob(Number(jobDetailMatch[1]));
    }

    if (path === "/duplicates" && req.method === "GET") {
      return await handleFindDuplicates(url);
    }

    if (path === "/stats") {
      return await handleStats(url);
    }

    return json({ error: "Not found", routes: ["/search", "/capture", "/thoughts", "/thought/:id", "/thought/:id/connections", "/thought/:id/reflection", "/ingest", "/ingestion-jobs", "/ingestion-jobs/:id", "/ingestion-jobs/:id/execute", "/duplicates", "/stats", "/health"] }, 404);
  } catch (error) {
    console.error("open-brain-rest error", error);
    return json({ error: String(error) }, 500);
  }
});

// ── Search ──────────────────────────────────────────────────────────────────

async function handleSearch(req: Request): Promise<Response> {
  const body = await req.json() as Record<string, unknown>;
  const query = String(body.query ?? "").trim();
  const mode = String(body.mode ?? "semantic");
  const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 100);
  const page = Math.max(Number(body.page) || 1, 1);
  const offset = (page - 1) * limit;
  const minSimilarity = Math.min(Math.max(Number(body.min_similarity) || 0.3, 0), 1);
  const excludeRestricted = body.exclude_restricted !== false; // default true

  if (query.length < 2) {
    return json({ error: "query must be at least 2 characters" }, 400);
  }

  if (mode === "text") {
    // Use search_thoughts_text RPC which supports tsvector + boolean operators
    // PostgreSQL websearch_to_tsquery handles: "quoted phrases", AND, OR, -NOT
    const filter: Record<string, unknown> = {};
    if (excludeRestricted) filter.exclude_restricted = true;
    const { data, error } = await supabase.rpc("search_thoughts_text", {
      p_query: query,
      p_limit: limit,
      p_filter: filter,
      p_offset: offset,
    });

    if (error) throw new Error(`search failed: ${error.message}`);

    const rows = data ?? [];
    const totalCount = rows.length > 0 ? Number((rows[0] as Record<string, unknown>).total_count) : 0;

    const results = rows.map((row: Record<string, unknown>) => ({
      id: row.id,
      content: row.content,
      type: row.type,
      source_type: row.source_type,
      importance: row.importance,
      metadata: row.metadata,
      created_at: row.created_at,
      rank: row.rank,
    }));

    return json({
      results,
      count: results.length,
      total: totalCount,
      page,
      per_page: limit,
      total_pages: Math.ceil(totalCount / limit),
      mode: "text",
    });
  }

  // Semantic search (default) — no pagination, returns top N by similarity
  // Request extra rows when filtering restricted to ensure we return enough results
  const fetchCount = excludeRestricted ? Math.min(limit + 20, 200) : limit;
  const { data, error } = await supabase.rpc("match_thoughts", {
    query_embedding: await embedText(query),
    match_count: fetchCount,
    match_threshold: minSimilarity,
    filter: {},
  });

  if (error) throw new Error(`search failed: ${error.message}`);

  let semanticRows = data ?? [];
  if (excludeRestricted) {
    semanticRows = semanticRows.filter((r: Record<string, unknown>) => r.sensitivity_tier !== "restricted");
  }
  semanticRows = semanticRows.slice(0, limit);

  const results = semanticRows.map((row: Record<string, unknown>) => ({
    id: row.id,
    content: row.content,
    type: (row.metadata as Record<string, unknown>)?.type ?? row.type,
    similarity: row.similarity,
    source_type: row.source_type,
    created_at: row.created_at,
  }));

  return json({ results, count: results.length, total: results.length, page: 1, per_page: limit, total_pages: 1, mode: "semantic" });
}

// ── Capture ─────────────────────────────────────────────────────────────────

/**
 * POST /capture — Create a new thought via the canonical pipeline.
 *
 * Body fields:
 *   content        (string, required)  — The thought text.
 *   source         (string, optional)  — Capture source label (default: "rest_api").
 *   source_type    (string, optional)  — Stored on the thought row; defaults to `source`.
 *   metadata       (object, optional)  — Arbitrary JSON merged into the thought's metadata.
 *                    Nested objects (e.g. { provenance: { source: "..." } }) are preserved
 *                    as-is through prepareThoughtPayload → upsert_thought.
 *   skip_classification (boolean, default false)
 *       When true:  Skips the LLM-based metadata extraction step (type, summary,
 *                   topics, tags, people, action_items). The embedding is still
 *                   computed. Use this when the caller already provides pre-classified
 *                   metadata in the `metadata` field.
 *       When false: The full canonical enrichment pipeline runs — an LLM call
 *                   extracts type, summary, topics, tags, people, and action_items
 *                   from the content.
 *   type, importance, topics, tags, sensitivity, quality_score
 *       Legacy top-level overrides — mapped into metadata and take precedence
 *       over body.metadata equivalents for backward compatibility.
 */
async function handleCapture(req: Request): Promise<Response> {
  const body = await req.json() as Record<string, unknown>;
  const content = String(body.content ?? "").trim();
  const source = String(body.source ?? "rest_api").trim();
  const sourceType = String(body.source_type ?? "").trim() || source;

  if (!content) {
    return json({ error: "content is required" }, 400);
  }

  // Pre-flight sensitivity check (restricted content blocked from cloud)
  const detectedSensitivity = detectSensitivity(content);
  if (detectedSensitivity.tier === "restricted") {
    return json({ error: "Restricted content cannot be captured through cloud API" }, 403);
  }

  // Accept caller-supplied metadata (e.g. aboutness, provenance from Drive pipeline)
  const bodyMetadata = isRecord(body.metadata) ? body.metadata : {};

  // Map legacy top-level fields into metadata overrides for the canonical pipeline
  // These win over body.metadata to preserve backward compatibility
  const metadataOverrides: Record<string, unknown> = {};
  if (body.type) metadataOverrides.type = body.type;
  if (body.importance !== undefined) metadataOverrides.importance = body.importance;
  if (body.topics) metadataOverrides.topics = body.topics;
  if (body.tags) metadataOverrides.tags = body.tags;
  if (body.sensitivity !== undefined) {
    // Legacy numeric sensitivity → tier mapping
    const numSens = Number(body.sensitivity) || 1;
    if (numSens >= 3) metadataOverrides.sensitivity_tier = "restricted";
    else if (numSens >= 2) metadataOverrides.sensitivity_tier = "personal";
  }
  if (body.quality_score !== undefined) metadataOverrides.quality_score = body.quality_score;

  // Use canonical pipeline; skip LLM classification if caller already scored the content
  const prepared = await prepareThoughtPayload(content, {
    source,
    source_type: sourceType,
    metadata: { ...bodyMetadata, ...metadataOverrides },
    skip_classification: body.skip_classification === true,
  });

  const { data, error } = await supabase.rpc("upsert_thought", {
    p_content: prepared.content,
    p_payload: {
      type: prepared.type,
      sensitivity_tier: prepared.sensitivity_tier,
      importance: prepared.importance,
      quality_score: prepared.quality_score,
      source_type: prepared.source_type,
      metadata: prepared.metadata,
      created_at: new Date().toISOString(),
      ...(safeEmbedding(prepared.embedding) && { embedding: prepared.embedding }),
    },
  });

  if (error) throw new Error(`capture failed: ${error.message}`);

  const result = data as { thought_id: number; action: string; content_fingerprint: string } | null;
  if (!result?.thought_id) {
    throw new Error("upsert_thought returned no result");
  }

  return json({
    thought_id: result.thought_id,
    action: result.action,
    type: prepared.type,
    sensitivity_tier: prepared.sensitivity_tier,
    content_fingerprint: result.content_fingerprint,
    message: `${result.action === "inserted" ? "Captured new" : "Updated"} thought #${result.thought_id} as ${prepared.type}`,
  });
}

// ── Get Thought ─────────────────────────────────────────────────────────────

async function handleGetThought(id: number, excludeRestricted: boolean): Promise<Response> {
  const { data, error } = await supabase
    .from("thoughts")
    .select("serial_id, content, type, source_type, importance, quality_score, sensitivity_tier, metadata, created_at, updated_at")
    .eq("serial_id", id)
    .single();

  if (error || !data) {
    return json({ error: `Thought #${id} not found` }, 404);
  }

  if (excludeRestricted && data.sensitivity_tier === "restricted") {
    return json({ error: "restricted" }, 403);
  }

  return json({ ...data, id: data.serial_id });
}

// ── Update Thought ──────────────────────────────────────────────────────────

async function handleUpdateThought(id: number, req: Request): Promise<Response> {
  const body = await req.json() as Record<string, unknown>;
  const content = String(body.content ?? "").trim();

  if (!content) {
    return json({ error: "content is required" }, 400);
  }

  // Verify thought exists
  const { data: existing, error: fetchErr } = await supabase
    .from("thoughts")
    .select("serial_id")
    .eq("serial_id", id)
    .single();

  if (fetchErr || !existing) {
    return json({ error: `Thought #${id} not found` }, 404);
  }

  // Re-embed the updated content
  let embedding = null;
  try {
    embedding = await embedText(content);
  } catch (_) {
    // Continue without embedding — it can be backfilled later
  }

  const updates: Record<string, unknown> = {
    content,
    updated_at: new Date().toISOString(),
  };

  if (embedding) {
    updates.embedding = embedding;
  }

  // Update optional fields if provided
  if (body.type) {
    const t = sanitizeType(String(body.type));
    updates.type = t;
  }
  if (body.importance !== undefined) {
    updates.importance = Math.min(Math.max(Number(body.importance) || 3, 1), 5);
  }

  const { error: updateErr } = await supabase
    .from("thoughts")
    .update(updates)
    .eq("serial_id", id);

  if (updateErr) throw new Error(`update failed: ${updateErr.message}`);

  return json({ id, action: "updated", message: `Thought #${id} updated` });
}

// ── Delete Thought ──────────────────────────────────────────────────────────

async function handleDeleteThought(id: number): Promise<Response> {
  const { data: existing, error: fetchErr } = await supabase
    .from("thoughts")
    .select("serial_id")
    .eq("serial_id", id)
    .single();

  if (fetchErr || !existing) {
    return json({ error: `Thought #${id} not found` }, 404);
  }

  const { error: deleteErr } = await supabase
    .from("thoughts")
    .delete()
    .eq("serial_id", id);

  if (deleteErr) throw new Error(`delete failed: ${deleteErr.message}`);

  return json({ id, action: "deleted", message: `Thought #${id} deleted` });
}

// ── Stats ───────────────────────────────────────────────────────────────────

async function handleStats(url: URL): Promise<Response> {
  const daysParam = url.searchParams.get("days");
  const excludeRestricted = url.searchParams.get("exclude_restricted") !== "false";
  // If no days param, show all-time stats
  const allTime = !daysParam;
  const sinceDays = allTime ? 0 : Math.max(Number(daysParam) || 30, 1);
  const since = allTime ? null : new Date(Date.now() - (sinceDays * 86_400_000)).toISOString();

  // Keep total counts exact and let the RPC handle full-dataset aggregates.
  let countQuery = supabase.from("thoughts").select("serial_id", { count: "exact", head: true });
  if (since) countQuery = countQuery.gte("created_at", since);
  if (excludeRestricted) countQuery = countQuery.neq("sensitivity_tier", "restricted");
  const [{ count: totalThoughts, error: countErr }, { data: aggregateData, error: aggregateErr }] =
    await Promise.all([
      countQuery,
      supabase.rpc("brain_stats_aggregate", {
        p_since_days: sinceDays,
        p_exclude_restricted: excludeRestricted,
      }),
    ]);

  if (countErr) throw new Error(`stats count failed: ${countErr.message}`);
  if (aggregateErr) throw new Error(`stats aggregate failed: ${aggregateErr.message}`);

  // Query 1: type counts (lightweight — no metadata, paginate to cover all rows)
  const aggregate = isRecord(aggregateData) ? aggregateData : {};
  const typeCounts = Object.fromEntries(
    parseAggregateCounts(aggregate.top_types, "type").map(({ key, count }) => [key, count]),
  );

  // Build the returned topic list from the RPC aggregate payload.
  const topTopics = parseAggregateCounts(aggregate.top_topics, "topic")
    .slice(0, 15)
    .map(({ key, count }) => ({ topic: key, count }));

  return json({
    total_thoughts: totalThoughts ?? 0,
    window_days: allTime ? "all" : sinceDays,
    types: typeCounts,
    top_topics: topTopics,
  });
}

// ── Paginated Browse ─────────────────────────────────────────────────────────

async function handleBrowseThoughts(url: URL): Promise<Response> {
  const page = Math.max(Number(url.searchParams.get("page")) || 1, 1);
  const perPage = Math.min(Math.max(Number(url.searchParams.get("per_page")) || 20, 1), 100);
  const type = url.searchParams.get("type")?.trim() || null;
  const sourceType = url.searchParams.get("source_type")?.trim() || null;
  const importanceMin = url.searchParams.get("importance_min") ? Number(url.searchParams.get("importance_min")) : null;
  const qualityScoreMax = url.searchParams.get("quality_score_max") ? Number(url.searchParams.get("quality_score_max")) : null;
  const sort = url.searchParams.get("sort") || "created_at";
  const order = url.searchParams.get("order") === "asc" ? true : false;
  const excludeRestricted = url.searchParams.get("exclude_restricted") !== "false"; // default true

  const offset = (page - 1) * perPage;

  // Count query
  let countQuery = supabase.from("thoughts").select("serial_id", { count: "exact", head: true });
  if (type) countQuery = countQuery.eq("type", type);
  if (sourceType) countQuery = countQuery.eq("source_type", sourceType);
  if (importanceMin !== null) countQuery = countQuery.gte("importance", importanceMin);
  if (qualityScoreMax !== null) countQuery = countQuery.lte("quality_score", qualityScoreMax);
  if (excludeRestricted) countQuery = countQuery.neq("sensitivity_tier", "restricted");

  // Data query
  let dataQuery = supabase
    .from("thoughts")
    .select("serial_id, content, type, source_type, importance, quality_score, sensitivity_tier, metadata, created_at, updated_at")
    .order(sort as string, { ascending: order })
    .range(offset, offset + perPage - 1);

  if (type) dataQuery = dataQuery.eq("type", type);
  if (sourceType) dataQuery = dataQuery.eq("source_type", sourceType);
  if (importanceMin !== null) dataQuery = dataQuery.gte("importance", importanceMin);
  if (qualityScoreMax !== null) dataQuery = dataQuery.lte("quality_score", qualityScoreMax);
  if (excludeRestricted) dataQuery = dataQuery.neq("sensitivity_tier", "restricted");

  const [countRes, dataRes] = await Promise.all([countQuery, dataQuery]);

  if (dataRes.error) throw new Error(`browse failed: ${dataRes.error.message}`);

  // Map serial_id to id in response
  const rows = (dataRes.data ?? []).map((row: Record<string, unknown>) => ({
    ...row,
    id: row.serial_id,
  }));

  return json({
    data: rows,
    total: countRes.count ?? 0,
    page,
    per_page: perPage,
  });
}

// ── Near-Duplicates ─────────────────────────────────────────────────────────

async function handleFindDuplicates(url: URL): Promise<Response> {
  const threshold = Math.min(Math.max(Number(url.searchParams.get("threshold")) || 0.85, 0.5), 0.99);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

  const { data, error } = await supabase.rpc("find_near_duplicates", {
    p_threshold: threshold,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) throw new Error(`find_near_duplicates failed: ${error.message}`);

  return json({
    pairs: data ?? [],
    threshold,
    limit,
    offset,
  });
}

// ── Smart Ingest ─────────────────────────────────────────────────────────────

async function handleIngest(req: Request): Promise<Response> {
  const body = await req.json() as Record<string, unknown>;

  // auto_execute overrides dry_run for one-step ingest
  if (body.auto_execute) {
    body.dry_run = false;
    delete body.auto_execute;
  }

  const SMART_INGEST_URL = `${SUPABASE_URL}/functions/v1/smart-ingest`;

  const response = await fetch(SMART_INGEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-brain-key": MCP_ACCESS_KEY,
    },
    body: JSON.stringify(body),
  });

  const result = await response.json();
  return json(result, response.status);
}

async function handleExecuteJob(jobId: number): Promise<Response> {
  const SMART_INGEST_URL = `${SUPABASE_URL}/functions/v1/smart-ingest`;

  const response = await fetch(`${SMART_INGEST_URL}/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-brain-key": MCP_ACCESS_KEY,
    },
    body: JSON.stringify({ job_id: jobId }),
  });

  const result = await response.json();
  return json(result, response.status);
}

async function handleListJobs(url: URL): Promise<Response> {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 100);
  const status = url.searchParams.get("status")?.trim() || null;

  let query = supabase
    .from("ingestion_jobs")
    .select("id, source_label, status, extracted_count, added_count, skipped_count, appended_count, revised_count, created_at, completed_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw new Error(`list_ingestion_jobs failed: ${error.message}`);

  return json({ jobs: data ?? [], count: (data ?? []).length });
}

async function handleGetJob(jobId: number): Promise<Response> {
  const [jobRes, itemsRes] = await Promise.all([
    supabase.from("ingestion_jobs").select("*").eq("id", jobId).single(),
    supabase.from("ingestion_items").select("*").eq("job_id", jobId).order("id"),
  ]);

  if (jobRes.error || !jobRes.data) return json({ error: `Job #${jobId} not found` }, 404);

  return json({ job: jobRes.data, items: itemsRes.data ?? [] });
}

// ── Connections ──────────────────────────────────────────────────────────────

async function handleGetConnections(thoughtId: number, limit: number, excludeRestricted: boolean): Promise<Response> {
  const { data, error } = await supabase.rpc("get_thought_connections", {
    p_thought_id: thoughtId,
    p_limit: limit,
    p_exclude_restricted: excludeRestricted,
  });

  if (error) {
    console.error("get_thought_connections RPC error:", error);
    return json({ connections: [] });
  }

  const connections = (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id,
    type: row.type,
    importance: row.importance,
    preview: row.preview,
    created_at: row.created_at,
    shared_topics: row.shared_topics ?? [],
    shared_people: row.shared_people ?? [],
    overlap_count: row.overlap_count ?? 0,
    score: row.score,
    overlap_type: row.overlap_type,
  }));

  return json({ connections });
}

// ── Reflections ──────────────────────────────────────────────────────────────

async function handleGetReflection(thoughtId: number): Promise<Response> {
  const { data, error } = await supabase
    .from("reflections")
    .select("id, thought_id, trigger_context, options, factors, conclusion, confidence, reflection_type, metadata, created_at, updated_at")
    .eq("thought_id", thoughtId);

  if (error) throw new Error(`get_reflection failed: ${error.message}`);
  if (!data || data.length === 0) {
    return json({ error: `No reflections found for thought #${thoughtId}` }, 404);
  }

  return json({ reflections: data });
}

async function handleCaptureReflection(thoughtId: number, req: Request): Promise<Response> {
  const body = await req.json() as Record<string, unknown>;
  const triggerContext = String(body.trigger_context ?? "").trim() || null;
  const conclusion = String(body.conclusion ?? "").trim() || null;
  const reflectionType = String(body.reflection_type ?? "decision_trace").trim();
  const options = body.options ?? [];
  const factors = body.factors ?? [];

  // Compute embedding for semantic search
  const embeddingText = `${triggerContext ?? ""} ${conclusion ?? ""}`.trim().slice(0, 8000);
  let embedding: number[] | null = null;
  if (embeddingText) {
    try { embedding = await embedText(embeddingText); } catch (_) { /* continue */ }
  }

  const { data, error } = await supabase.rpc("upsert_reflection", {
    p_thought_id: thoughtId,
    p_trigger_context: triggerContext,
    p_options: options,
    p_factors: factors,
    p_conclusion: conclusion,
    p_embedding: embedding,
    p_reflection_type: reflectionType,
    p_metadata: body.metadata ?? {},
  });

  if (error) throw new Error(`upsert_reflection failed: ${error.message}`);
  const result = data as { reflection_id: number; action: string };

  return json({
    reflection_id: result.reflection_id,
    thought_id: thoughtId,
    action: result.action,
    message: `${result.action === "inserted" ? "Captured" : "Updated"} reflection #${result.reflection_id}`,
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sanitizeType(value: string): string {
  const normalized = value.trim().toLowerCase();
  return ALLOWED_TYPES.has(normalized) ? normalized : "idea";
}

function parseAggregateCounts(
  value: unknown,
  keyName: "type" | "topic",
): Array<{ key: string; count: number }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }

      const key = String(entry[keyName] ?? "").trim();
      const count = Number(entry.count ?? 0);
      if (!key || !Number.isFinite(count)) {
        return null;
      }

      return { key, count };
    })
    .filter((entry): entry is { key: string; count: number } => entry !== null)
    .sort((left, right) => right.count - left.count);
}

function isAuthorized(req: Request): boolean {
  const url = new URL(req.url);
  const key =
    req.headers.get("x-brain-key")?.trim() ||
    url.searchParams.get("key")?.trim() ||
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  return key === MCP_ACCESS_KEY;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), { status, headers: CORS_HEADERS });
}
