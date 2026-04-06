/**
 * rest-api — REST API gateway for Open Brain.
 *
 * Provides simple REST endpoints for non-MCP clients (ChatGPT Actions,
 * Gemini extensions, dashboards, webhooks, and custom integrations).
 *
 * Routes:
 *   POST /search              — search thoughts (semantic or text)
 *   POST /capture             — capture a new thought
 *   GET  /recent              — recent thoughts (paginated)
 *   GET  /thoughts            — browse thoughts with filters
 *   GET  /thought/:id         — get single thought
 *   PUT  /thought/:id         — update thought content
 *   PATCH /thought/:id/enrich — re-enrich thought
 *   DELETE /thought/:id       — delete thought
 *   GET  /thought/:id/connections — related thoughts
 *   GET  /count               — count thoughts with filters
 *   GET  /stats               — brain stats summary
 *   POST /ingest              — proxy to smart-ingest function
 *   GET  /ingestion-jobs      — list ingestion jobs
 *   GET  /ingestion-jobs/:id  — get job detail
 *   POST /ingestion-jobs/:id/execute — execute a dry-run job
 *   GET  /duplicates          — find near-duplicate pairs
 *   POST /duplicates/resolve  — merge and resolve a duplicate pair
 *   GET  /entities            — browse/search entities
 *   GET  /entities/:id        — entity detail with thoughts and edges
 *   GET  /health              — health check
 *
 * Auth: ?key= query param, x-brain-key header, or Authorization: Bearer <key>
 *
 * Dependencies:
 *   - Enhanced thoughts schema (schemas/enhanced-thoughts)
 *   - Optional: Smart ingest tables (schemas/smart-ingest-tables) for /ingest routes
 *   - Optional: Knowledge graph schema (schemas/knowledge-graph) for /entities routes
 */

import { createClient } from "@supabase/supabase-js";
import {
  embedText,
  extractMetadata,
  fallbackMetadata,
  detectSensitivity,
  resolveSensitivityTier,
  mergeUniqueStrings,
  normalizeStringArray,
  prepareThoughtPayload,
  computeContentFingerprint,
  isRecord,
  asString,
  safeEmbedding,
} from "./_shared/helpers.ts";
import {
  SENSITIVITY_TIERS,
  ALLOWED_TYPES,
} from "./_shared/config.ts";

// ── Environment ─────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── CORS ────────────────────────────────────────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-brain-key",
  "Content-Type": "application/json",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), { status, headers: CORS_HEADERS });
}

// ── Auth ────────────────────────────────────────────────────────────────────

function isAuthorized(req: Request): boolean {
  const url = new URL(req.url);
  const key =
    req.headers.get("x-brain-key")?.trim() ||
    url.searchParams.get("key")?.trim() ||
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  return key === MCP_ACCESS_KEY;
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
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!isRecord(entry)) return null;
      const key = String(entry[keyName] ?? "").trim();
      const count = Number(entry.count ?? 0);
      if (!key || !Number.isFinite(count)) return null;
      return { key, count };
    })
    .filter((entry): entry is { key: string; count: number } => entry !== null)
    .sort((left, right) => right.count - left.count);
}

// ── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (!MCP_ACCESS_KEY) {
    console.warn("MCP_ACCESS_KEY is not set — all requests will be rejected.");
    return json({ error: "Service misconfigured: auth key not set" }, 503);
  }
  if (!isAuthorized(req)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = new URL(req.url);
  const path = url.pathname
    .replace(/^\/rest-api/, "")
    .replace(/\/+$/, "") || "/";

  try {
    if (path === "/health" || path === "/healthz" || path === "/") {
      return json({ ok: true, service: "open-brain-rest", timestamp: new Date().toISOString() });
    }

    if (path === "/search" && req.method === "POST") return await handleSearch(req);
    if (path === "/capture" && req.method === "POST") return await handleCapture(req);
    if (path === "/recent" && req.method === "GET") return await handleRecent(url);
    if (path === "/thoughts" && req.method === "GET") return await handleBrowseThoughts(url);
    if (path === "/count" && req.method === "GET") return await handleCount(url);
    if (path === "/stats") return await handleStats(url);

    // /thought/:id routes
    const thoughtMatch = path.match(/^\/thought\/(\d+)$/);
    if (thoughtMatch) {
      const id = Number(thoughtMatch[1]);
      if (req.method === "GET") return await handleGetThought(id, url.searchParams.get("exclude_restricted") !== "false");
      if (req.method === "PUT") return await handleUpdateThought(id, req);
      if (req.method === "DELETE") return await handleDeleteThought(id);
    }

    const connectionsMatch = path.match(/^\/thought\/(\d+)\/connections$/);
    if (connectionsMatch && req.method === "GET") {
      return await handleGetConnections(Number(connectionsMatch[1]), url);
    }

    const enrichMatch = path.match(/^\/thought\/(\d+)\/enrich$/);
    if (enrichMatch && req.method === "PATCH") {
      return await handleEnrichThought(Number(enrichMatch[1]), url);
    }

    // Smart ingest proxy routes
    if (path === "/ingest" && req.method === "POST") return await handleIngest(req);
    if (path === "/ingestion-jobs" && req.method === "GET") return await handleListJobs(url);

    const executeMatch = path.match(/^\/ingestion-jobs\/(\d+)\/execute$/);
    if (executeMatch && req.method === "POST") return await handleExecuteJob(Number(executeMatch[1]));

    const jobDetailMatch = path.match(/^\/ingestion-jobs\/(\d+)$/);
    if (jobDetailMatch && req.method === "GET") return await handleGetJob(Number(jobDetailMatch[1]));

    // Duplicates
    if (path === "/duplicates" && req.method === "GET") return await handleFindDuplicates(url);
    if (path === "/duplicates/resolve" && req.method === "POST") return await handleDuplicateResolve(req);

    // Entity routes (knowledge graph)
    if (path === "/entities" && req.method === "GET") return await handleEntities(url);
    const entityMatch = path.match(/^\/entities\/(\d+)$/);
    if (entityMatch && req.method === "GET") return await handleEntityDetail(Number(entityMatch[1]));

    return json({
      error: "Not found",
      routes: ["/search", "/capture", "/recent", "/thoughts", "/thought/:id", "/thought/:id/connections",
        "/thought/:id/enrich", "/ingest", "/ingestion-jobs", "/ingestion-jobs/:id",
        "/ingestion-jobs/:id/execute", "/count", "/duplicates", "/duplicates/resolve",
        "/stats", "/entities", "/entities/:id", "/health"],
    }, 404);
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: "Invalid JSON in request body" }, 400);
    console.error("rest-api error", error);
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
  const excludeRestricted = body.exclude_restricted !== false;
  const startDate = body.start_date ? String(body.start_date).trim() : null;
  const endDate = body.end_date ? String(body.end_date).trim() : null;

  if (query.length < 2) return json({ error: "query must be at least 2 characters" }, 400);

  if (mode === "text") {
    const filter: Record<string, unknown> = {};
    if (excludeRestricted) filter.exclude_restricted = true;
    const { data, error } = await supabase.rpc("search_thoughts_text", {
      p_query: query, p_limit: limit, p_filter: filter, p_offset: offset,
    });
    if (error) throw new Error(`search failed: ${error.message}`);

    const rows = data ?? [];
    const totalCount = rows.length > 0 ? Number((rows[0] as Record<string, unknown>).total_count) : 0;
    const results = rows.map((row: Record<string, unknown>) => ({
      id: row.id, content: row.content, type: row.type, source_type: row.source_type,
      importance: row.importance, metadata: row.metadata, created_at: row.created_at, rank: row.rank,
    }));

    return json({ results, count: results.length, total: totalCount, page, per_page: limit,
      total_pages: Math.ceil(totalCount / limit), mode: "text" });
  }

  // Semantic search (default)
  const dateFilterActive = !!(startDate || endDate);
  const fetchCount = (excludeRestricted || dateFilterActive) ? Math.min(limit + (dateFilterActive ? 50 : 20), 200) : limit;
  const { data, error } = await supabase.rpc("match_thoughts", {
    query_embedding: await embedText(query), match_count: fetchCount, match_threshold: minSimilarity, filter: {},
  });
  if (error) throw new Error(`search failed: ${error.message}`);

  let semanticRows = data ?? [];
  if (excludeRestricted) semanticRows = semanticRows.filter((r: Record<string, unknown>) => r.sensitivity_tier !== "restricted");
  if (startDate) semanticRows = semanticRows.filter((r: Record<string, unknown>) => String(r.created_at) >= startDate);
  if (endDate) semanticRows = semanticRows.filter((r: Record<string, unknown>) => String(r.created_at) <= endDate);
  semanticRows = semanticRows.slice(0, limit);

  const results = semanticRows.map((row: Record<string, unknown>) => ({
    id: row.id, content: row.content, type: (row.metadata as Record<string, unknown>)?.type ?? row.type,
    similarity: row.similarity, source_type: row.source_type, created_at: row.created_at,
  }));

  return json({ results, count: results.length, total: results.length, page: 1, per_page: limit, total_pages: 1, mode: "semantic" });
}

// ── Capture ─────────────────────────────────────────────────────────────────

async function handleCapture(req: Request): Promise<Response> {
  const body = await req.json() as Record<string, unknown>;
  const content = String(body.content ?? "").trim();
  const source = String(body.source ?? "rest_api").trim();
  const sourceType = String(body.source_type ?? "").trim() || source;

  if (!content) return json({ error: "content is required" }, 400);

  const detectedSensitivity = detectSensitivity(content);
  if (detectedSensitivity.tier === "restricted") {
    return json({ error: "Restricted content cannot be captured through cloud API" }, 403);
  }

  const bodyMetadata = isRecord(body.metadata) ? body.metadata : {};
  const metadataOverrides: Record<string, unknown> = {};
  if (body.type) metadataOverrides.type = body.type;
  if (body.importance !== undefined) metadataOverrides.importance = body.importance;
  if (body.topics) metadataOverrides.topics = body.topics;
  if (body.tags) metadataOverrides.tags = body.tags;
  if (body.quality_score !== undefined) metadataOverrides.quality_score = body.quality_score;

  const prepared = await prepareThoughtPayload(content, {
    source, source_type: sourceType,
    metadata: { ...bodyMetadata, ...metadataOverrides },
    skip_classification: body.skip_classification === true,
  });

  const { data, error } = await supabase.rpc("upsert_thought", {
    p_content: prepared.content,
    p_payload: {
      type: prepared.type, sensitivity_tier: prepared.sensitivity_tier,
      importance: prepared.importance, quality_score: prepared.quality_score,
      source_type: prepared.source_type, metadata: prepared.metadata,
      created_at: new Date().toISOString(),
      ...(safeEmbedding(prepared.embedding) && { embedding: prepared.embedding }),
    },
  });

  if (error) throw new Error(`capture failed: ${error.message}`);
  const result = data as { thought_id: number; action: string; content_fingerprint: string } | null;
  if (!result?.thought_id) throw new Error("upsert_thought returned no result");

  return json({
    thought_id: result.thought_id, action: result.action, type: prepared.type,
    sensitivity_tier: prepared.sensitivity_tier, content_fingerprint: result.content_fingerprint,
    message: `${result.action === "inserted" ? "Captured new" : "Updated"} thought #${result.thought_id} as ${prepared.type}`,
  });
}

// ── Recent ──────────────────────────────────────────────────────────────────

async function handleRecent(url: URL): Promise<Response> {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 100);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
  const source = url.searchParams.get("source")?.trim() || null;
  const type = url.searchParams.get("type")?.trim() || null;
  const topic = url.searchParams.get("topic")?.trim() || null;

  let query = supabase.from("thoughts")
    .select("id, content, type, source_type, importance, metadata, created_at, updated_at")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (source) query = query.eq("source_type", source);
  if (type) query = query.eq("type", type);
  if (topic) query = query.contains("metadata", { topics: [topic] });

  const { data, error } = await query;
  if (error) throw new Error(`recent query failed: ${error.message}`);
  return json({ results: data ?? [], count: (data ?? []).length, offset, limit, filters: { source, type, topic } });
}

// ── Get / Update / Delete Thought ───────────────────────────────────────────

async function handleGetThought(id: number, excludeRestricted: boolean): Promise<Response> {
  const { data, error } = await supabase.from("thoughts")
    .select("id, content, type, source_type, importance, quality_score, sensitivity_tier, metadata, created_at, updated_at")
    .eq("id", id).single();
  if (error || !data) return json({ error: `Thought #${id} not found` }, 404);
  if (excludeRestricted && data.sensitivity_tier === "restricted") return json({ error: "restricted" }, 403);
  return json(data);
}

async function handleUpdateThought(id: number, req: Request): Promise<Response> {
  const body = await req.json() as Record<string, unknown>;
  const content = String(body.content ?? "").trim();
  if (!content) return json({ error: "content is required" }, 400);

  const { data: existing, error: fetchErr } = await supabase.from("thoughts").select("id").eq("id", id).single();
  if (fetchErr || !existing) return json({ error: `Thought #${id} not found` }, 404);

  let embedding = null;
  try { embedding = await embedText(content); } catch { /* continue */ }

  const updates: Record<string, unknown> = { content, updated_at: new Date().toISOString() };
  if (embedding) updates.embedding = embedding;
  if (body.type) updates.type = sanitizeType(String(body.type));
  if (body.importance !== undefined) {
    const rawImp = Number(body.importance);
    updates.importance = Math.min(Math.max(Number.isFinite(rawImp) ? rawImp : 3, 0), 6);
  }

  const { error: updateErr } = await supabase.from("thoughts").update(updates).eq("id", id);
  if (updateErr) throw new Error(`update failed: ${updateErr.message}`);
  return json({ id, action: "updated", message: `Thought #${id} updated` });
}

async function handleDeleteThought(id: number): Promise<Response> {
  const { data: existing, error: fetchErr } = await supabase.from("thoughts").select("id").eq("id", id).single();
  if (fetchErr || !existing) return json({ error: `Thought #${id} not found` }, 404);
  const { error: deleteErr } = await supabase.from("thoughts").delete().eq("id", id);
  if (deleteErr) throw new Error(`delete failed: ${deleteErr.message}`);
  return json({ id, action: "deleted", message: `Thought #${id} deleted` });
}

// ── Stats ───────────────────────────────────────────────────────────────────

async function handleStats(url: URL): Promise<Response> {
  const daysParam = url.searchParams.get("days");
  const excludeRestricted = url.searchParams.get("exclude_restricted") !== "false";
  const allTime = !daysParam;
  const sinceDays = allTime ? 0 : Math.max(Number(daysParam) || 30, 1);
  const since = allTime ? null : new Date(Date.now() - (sinceDays * 86_400_000)).toISOString();

  let countQuery = supabase.from("thoughts").select("id", { count: "exact", head: true });
  if (since) countQuery = countQuery.gte("created_at", since);
  if (excludeRestricted) countQuery = countQuery.neq("sensitivity_tier", "restricted");

  const [{ count: totalThoughts, error: countErr }, { data: aggregateData, error: aggregateErr }] =
    await Promise.all([
      countQuery,
      supabase.rpc("brain_stats_aggregate", { p_since_days: sinceDays, p_exclude_restricted: excludeRestricted }),
    ]);

  if (countErr) throw new Error(`stats count failed: ${countErr.message}`);
  if (aggregateErr) throw new Error(`stats aggregate failed: ${aggregateErr.message}`);

  const aggregate = isRecord(aggregateData) ? aggregateData : {};
  const typeCounts = Object.fromEntries(parseAggregateCounts(aggregate.top_types, "type").map(({ key, count }) => [key, count]));
  const topTopics = parseAggregateCounts(aggregate.top_topics, "topic").slice(0, 15).map(({ key, count }) => ({ topic: key, count }));

  return json({ total_thoughts: totalThoughts ?? 0, window_days: allTime ? "all" : sinceDays, types: typeCounts, top_topics: topTopics });
}

// ── Browse Thoughts ─────────────────────────────────────────────────────────

async function handleBrowseThoughts(url: URL): Promise<Response> {
  const page = Math.max(Number(url.searchParams.get("page")) || 1, 1);
  const perPage = Math.min(Math.max(Number(url.searchParams.get("per_page") || url.searchParams.get("limit")) || 20, 1), 100);
  const type = url.searchParams.get("type")?.trim() || null;
  const sourceType = url.searchParams.get("source_type")?.trim() || null;
  const importanceMin = url.searchParams.get("importance_min") ? Number(url.searchParams.get("importance_min")) : null;
  const startDate = url.searchParams.get("start_date")?.trim() || null;
  const endDate = url.searchParams.get("end_date")?.trim() || null;
  const sort = url.searchParams.get("sort") || "created_at";
  const order = url.searchParams.get("order") === "asc";
  const excludeRestricted = url.searchParams.get("exclude_restricted") !== "false";
  const offset = (page - 1) * perPage;

  let countQuery = supabase.from("thoughts").select("id", { count: "exact", head: true });
  let dataQuery = supabase.from("thoughts")
    .select("id, content, type, source_type, importance, quality_score, sensitivity_tier, metadata, created_at, updated_at")
    .order(sort as string, { ascending: order })
    .range(offset, offset + perPage - 1);

  // Apply filters to both queries
  for (const q of [countQuery, dataQuery]) {
    if (type) q.eq("type", type);
    if (sourceType) q.eq("source_type", sourceType);
    if (importanceMin !== null) q.gte("importance", importanceMin);
    if (startDate) q.gte("created_at", startDate);
    if (endDate) q.lte("created_at", endDate);
    if (excludeRestricted) q.neq("sensitivity_tier", "restricted");
  }

  const [countRes, dataRes] = await Promise.all([countQuery, dataQuery]);
  if (dataRes.error) throw new Error(`browse failed: ${dataRes.error.message}`);
  return json({ data: dataRes.data ?? [], total: countRes.count ?? 0, page, per_page: perPage });
}

// ── Count ───────────────────────────────────────────────────────────────────

async function handleCount(url: URL): Promise<Response> {
  const type = url.searchParams.get("type")?.trim() || null;
  const sourceType = url.searchParams.get("source_type")?.trim() || null;
  const startDate = url.searchParams.get("start_date")?.trim() || null;
  const endDate = url.searchParams.get("end_date")?.trim() || null;
  const excludeRestricted = url.searchParams.get("exclude_restricted") !== "false";

  let query = supabase.from("thoughts").select("id", { count: "exact", head: true });
  if (type) query = query.eq("type", type);
  if (sourceType) query = query.eq("source_type", sourceType);
  if (startDate) query = query.gte("created_at", startDate);
  if (endDate) query = query.lte("created_at", endDate);
  if (excludeRestricted) query = query.neq("sensitivity_tier", "restricted");

  const { count, error } = await query;
  if (error) throw new Error(`count query failed: ${error.message}`);

  const filters: Record<string, string> = {};
  if (type) filters.type = type;
  if (sourceType) filters.source_type = sourceType;
  if (startDate) filters.start_date = startDate;
  if (endDate) filters.end_date = endDate;

  return json({ count: count ?? 0, filters });
}

// ── Connections ──────────────────────────────────────────────────────────────

async function handleGetConnections(thoughtId: number, url: URL): Promise<Response> {
  const excludeRestricted = url.searchParams.get("exclude_restricted") !== "false";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 50);

  const { data, error } = await supabase.rpc("get_thought_connections", {
    p_thought_id: thoughtId, p_limit: limit, p_exclude_restricted: excludeRestricted,
  });

  if (error) {
    console.error("get_thought_connections RPC error:", error);
    return json({ connections: [] });
  }

  const connections = (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id, type: row.type, importance: row.importance, preview: row.preview,
    created_at: row.created_at, shared_topics: row.shared_topics ?? [],
    shared_people: row.shared_people ?? [], overlap_count: row.overlap_count ?? 0,
  }));

  return json({ connections });
}

// ── Enrich Thought ──────────────────────────────────────────────────────────

const VALID_FILLS = new Set(["embedding", "classification", "sensitivity", "all"]);

async function handleEnrichThought(thoughtId: number, url: URL): Promise<Response> {
  const fill = url.searchParams.get("fill") || "all";
  const excludeRestricted = url.searchParams.get("exclude_restricted") !== "false";

  if (!VALID_FILLS.has(fill)) {
    return json({ error: `Invalid fill parameter: "${fill}". Must be one of: embedding, classification, sensitivity, all` }, 400);
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("thoughts").select("*").eq("id", thoughtId).single();
  if (fetchErr || !existing) return json({ error: `Thought #${thoughtId} not found` }, 404);
  if (excludeRestricted && existing.sensitivity_tier === "restricted") return json({ error: "restricted" }, 403);

  const content = String(existing.content ?? "");
  const existingMetadata: Record<string, unknown> = isRecord(existing.metadata) ? { ...existing.metadata as Record<string, unknown> } : {};
  const enriched: Record<string, unknown> = {};
  const fills: string[] = [];

  if (fill === "embedding" || fill === "all") {
    try {
      enriched.embedding = await embedText(content);
      fills.push("embedding");
    } catch (err) {
      console.warn(`Embedding failed for thought #${thoughtId}:`, err);
      enriched.embedding_error = String(err);
    }
  }

  if (fill === "classification" || fill === "all") {
    try {
      const extracted = await extractMetadata(content);
      existingMetadata.topics = mergeUniqueStrings(existingMetadata.topics, normalizeStringArray(extracted.topics));
      existingMetadata.tags = mergeUniqueStrings(existingMetadata.tags, normalizeStringArray(extracted.tags));
      existingMetadata.people = mergeUniqueStrings(existingMetadata.people, normalizeStringArray(extracted.people));
      existingMetadata.action_items = mergeUniqueStrings(existingMetadata.action_items, normalizeStringArray(extracted.action_items));

      const currentType = asString(existing.type, "");
      if (!currentType || currentType === "reference") {
        enriched.type = extracted.type;
        existingMetadata.type = extracted.type;
      }
      if (!asString(existingMetadata.summary, "")) existingMetadata.summary = extracted.summary;
      existingMetadata.confidence = extracted.confidence;
      existingMetadata.enrichment_attempted_at = new Date().toISOString();
      fills.push("classification");
    } catch (err) {
      console.warn(`Classification failed for thought #${thoughtId}:`, err);
      enriched.classification_error = String(err);
    }
  }

  if (fill === "sensitivity" || fill === "all") {
    const detected = detectSensitivity(content);
    const currentTier = asString(existing.sensitivity_tier, "standard") as typeof SENSITIVITY_TIERS[number];
    const newTier = resolveSensitivityTier(detected.tier, currentTier);
    if (SENSITIVITY_TIERS.indexOf(newTier) > SENSITIVITY_TIERS.indexOf(currentTier)) {
      enriched.sensitivity_tier = newTier;
      existingMetadata.sensitivity_reasons = detected.reasons;
    }
    fills.push("sensitivity");
  }

  existingMetadata.last_enriched_at = new Date().toISOString();
  existingMetadata.enrichment_fills = fills;

  const columnUpdates: Record<string, unknown> = { metadata: existingMetadata, updated_at: new Date().toISOString() };
  if (enriched.embedding) columnUpdates.embedding = enriched.embedding;
  if (enriched.type) columnUpdates.type = enriched.type;
  if (enriched.sensitivity_tier) columnUpdates.sensitivity_tier = enriched.sensitivity_tier;

  const { error: updateErr } = await supabase.from("thoughts").update(columnUpdates).eq("id", thoughtId);
  if (updateErr) throw new Error(`enrich update failed: ${updateErr.message}`);

  const { data: updated } = await supabase.from("thoughts")
    .select("id, content, type, source_type, importance, quality_score, sensitivity_tier, metadata, created_at, updated_at")
    .eq("id", thoughtId).single();

  return json({ ...(updated ?? { id: thoughtId }), action: "enriched", fills, message: `Thought #${thoughtId} enriched (${fills.join(", ")})` });
}

// ── Smart Ingest Proxy ──────────────────────────────────────────────────────

async function handleIngest(req: Request): Promise<Response> {
  const body = await req.json() as Record<string, unknown>;
  if (body.auto_execute) { body.dry_run = false; delete body.auto_execute; }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/smart-ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-brain-key": MCP_ACCESS_KEY },
    body: JSON.stringify(body),
  });
  return json(await response.json(), response.status);
}

async function handleExecuteJob(jobId: number): Promise<Response> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/smart-ingest/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-brain-key": MCP_ACCESS_KEY },
    body: JSON.stringify({ job_id: jobId }),
  });
  return json(await response.json(), response.status);
}

async function handleListJobs(url: URL): Promise<Response> {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 100);
  const status = url.searchParams.get("status")?.trim() || null;
  let query = supabase.from("ingestion_jobs")
    .select("id, source_label, status, extracted_count, added_count, skipped_count, appended_count, revised_count, created_at, completed_at")
    .order("created_at", { ascending: false }).limit(limit);
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

// ── Duplicates ──────────────────────────────────────────────────────────────

async function handleFindDuplicates(url: URL): Promise<Response> {
  const threshold = Math.min(Math.max(Number(url.searchParams.get("threshold")) || 0.85, 0.5), 0.99);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

  const { data, error } = await supabase.rpc("find_near_duplicates", { p_threshold: threshold, p_limit: limit, p_offset: offset });
  if (error) throw new Error(`find_near_duplicates failed: ${error.message}`);
  return json({ pairs: data ?? [], threshold, limit, offset });
}

async function handleDuplicateResolve(req: Request): Promise<Response> {
  const body = await req.json() as Record<string, unknown>;
  const thoughtIdA = Number(body.thought_id_a);
  const thoughtIdB = Number(body.thought_id_b);
  const action = String(body.action ?? "");

  if (!thoughtIdA || !thoughtIdB) return json({ error: "Both thought_id_a and thought_id_b are required" }, 400);
  if (!["keep_a", "keep_b", "keep_both"].includes(action)) return json({ error: "action must be keep_a, keep_b, or keep_both" }, 400);
  if (action === "keep_both") return json({ action, survivor_id: null, loser_id: null, reattached: { thought_entities: 0 } });

  const survivorId = action === "keep_a" ? thoughtIdA : thoughtIdB;
  const loserId = action === "keep_a" ? thoughtIdB : thoughtIdA;

  const [{ data: survivor, error: sErr }, { data: loser, error: lErr }] = await Promise.all([
    supabase.from("thoughts").select("id, metadata").eq("id", survivorId).single(),
    supabase.from("thoughts").select("id, metadata").eq("id", loserId).single(),
  ]);
  if (sErr || !survivor) return json({ error: `Survivor thought #${survivorId} not found` }, 404);
  if (lErr || !loser) return json({ error: `Loser thought #${loserId} not found` }, 404);

  // Reattach thought_entities
  let entitiesReattached = 0;
  const { data: loserEntities } = await supabase.from("thought_entities").select("thought_id, entity_id, mention_role").eq("thought_id", loserId);
  if (loserEntities) {
    for (const te of loserEntities) {
      const { error } = await supabase.from("thought_entities")
        .update({ thought_id: survivorId }).eq("thought_id", loserId).eq("entity_id", te.entity_id).eq("mention_role", te.mention_role);
      if (!error) entitiesReattached++;
    }
  }

  // Merge metadata arrays
  const survivorMeta = (isRecord(survivor.metadata) ? survivor.metadata : {}) as Record<string, unknown>;
  const loserMeta = (isRecord(loser.metadata) ? loser.metadata : {}) as Record<string, unknown>;
  const updatedMeta = {
    ...survivorMeta,
    tags: mergeUniqueStrings(normalizeStringArray(survivorMeta.tags), normalizeStringArray(loserMeta.tags)),
    topics: mergeUniqueStrings(normalizeStringArray(survivorMeta.topics), normalizeStringArray(loserMeta.topics)),
    people: mergeUniqueStrings(normalizeStringArray(survivorMeta.people), normalizeStringArray(loserMeta.people)),
  };

  await supabase.from("thoughts").update({ metadata: updatedMeta }).eq("id", survivorId);

  // Log to consolidation_log (best-effort)
  await supabase.from("consolidation_log").insert({
    operation: "dedup_merge", survivor_id: survivorId, loser_id: loserId,
    details: { action, entities_reattached: entitiesReattached },
  }).then(() => {}, () => {});

  // Delete loser
  const { error: deleteErr } = await supabase.from("thoughts").delete().eq("id", loserId);
  if (deleteErr) throw new Error(`delete failed: ${deleteErr.message}`);

  return json({ action, survivor_id: survivorId, loser_id: loserId, reattached: { thought_entities: entitiesReattached } });
}

// ── Entities (Knowledge Graph) ──────────────────────────────────────────────

async function handleEntities(url: URL): Promise<Response> {
  const searchQuery = url.searchParams.get("q")?.trim() || null;
  const entityType = url.searchParams.get("type")?.trim() || null;
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 50);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

  let q = supabase.from("entities")
    .select("id, entity_type, canonical_name, aliases, metadata, first_seen_at, last_seen_at", { count: "exact" })
    .order("last_seen_at", { ascending: false }).range(offset, offset + limit - 1);
  if (searchQuery) q = q.ilike("canonical_name", `%${searchQuery}%`);
  if (entityType) q = q.eq("entity_type", entityType);

  const { data: entities, count, error } = await q;
  if (error) throw new Error(`entities query failed: ${error.message}`);
  if (!entities || entities.length === 0) return json({ results: [], total: count ?? 0, limit, offset });

  const entityIds = entities.map((e: Record<string, unknown>) => e.id as number);
  const { data: countRows } = await supabase.from("thought_entities").select("entity_id").in("entity_id", entityIds);

  const countMap = new Map<number, number>();
  if (countRows) {
    for (const row of countRows) {
      const eid = (row as Record<string, unknown>).entity_id as number;
      countMap.set(eid, (countMap.get(eid) ?? 0) + 1);
    }
  }

  const results = entities.map((e: Record<string, unknown>) => ({ ...e, thought_count: countMap.get(e.id as number) ?? 0 }));
  return json({ results, total: count ?? 0, limit, offset });
}

async function handleEntityDetail(entityId: number): Promise<Response> {
  const { data: entity, error: entityError } = await supabase.from("entities").select("*").eq("id", entityId).maybeSingle();
  if (entityError) throw new Error(`entity fetch failed: ${entityError.message}`);
  if (!entity) return json({ error: "Entity not found" }, 404);

  // Fetch linked thoughts
  const { data: thoughtLinks } = await supabase.from("thought_entities")
    .select("thought_id, mention_role, confidence").eq("entity_id", entityId).limit(100);

  let thoughts: Record<string, unknown>[] = [];
  if (thoughtLinks && thoughtLinks.length > 0) {
    const thoughtIds = (thoughtLinks as Record<string, unknown>[]).map((tl) => tl.thought_id as number);
    const { data: thoughtRows } = await supabase.from("thoughts")
      .select("id, content, type, created_at, sensitivity_tier").in("id", thoughtIds)
      .neq("sensitivity_tier", "restricted").order("created_at", { ascending: false }).limit(20);

    if (thoughtRows) {
      const roleMap = new Map<number, string>();
      for (const tl of thoughtLinks as Record<string, unknown>[]) roleMap.set(tl.thought_id as number, tl.mention_role as string);
      thoughts = (thoughtRows as Record<string, unknown>[]).map((t) => ({
        id: t.id, content: (t.content as string)?.length > 500 ? (t.content as string).slice(0, 500) + "..." : t.content,
        type: t.type, created_at: t.created_at, mention_role: roleMap.get(t.id as number) ?? "mentioned",
      }));
    }
  }

  // Fetch edges (both directions)
  const [{ data: edgesFrom }, { data: edgesTo }] = await Promise.all([
    supabase.from("edges").select("id, to_entity_id, relation, support_count, confidence").eq("from_entity_id", entityId),
    supabase.from("edges").select("id, from_entity_id, relation, support_count, confidence").eq("to_entity_id", entityId),
  ]);

  // Resolve connected entity names
  const connectedIds = new Set<number>();
  for (const e of (edgesFrom ?? []) as Record<string, unknown>[]) connectedIds.add(e.to_entity_id as number);
  for (const e of (edgesTo ?? []) as Record<string, unknown>[]) connectedIds.add(e.from_entity_id as number);

  const nameMap = new Map<number, { name: string; type: string }>();
  if (connectedIds.size > 0) {
    const { data: connEntities } = await supabase.from("entities").select("id, canonical_name, entity_type").in("id", Array.from(connectedIds));
    if (connEntities) {
      for (const ce of connEntities as Record<string, unknown>[]) nameMap.set(ce.id as number, { name: ce.canonical_name as string, type: ce.entity_type as string });
    }
  }

  const edges = [
    ...((edgesFrom ?? []) as Record<string, unknown>[]).map((e) => ({
      edge_id: e.id, direction: "outgoing", relation: e.relation, other_entity_id: e.to_entity_id,
      other_entity_name: nameMap.get(e.to_entity_id as number)?.name ?? "unknown",
      other_entity_type: nameMap.get(e.to_entity_id as number)?.type ?? "unknown",
      support_count: e.support_count, confidence: e.confidence,
    })),
    ...((edgesTo ?? []) as Record<string, unknown>[]).map((e) => ({
      edge_id: e.id, direction: "incoming", relation: e.relation, other_entity_id: e.from_entity_id,
      other_entity_name: nameMap.get(e.from_entity_id as number)?.name ?? "unknown",
      other_entity_type: nameMap.get(e.from_entity_id as number)?.type ?? "unknown",
      support_count: e.support_count, confidence: e.confidence,
    })),
  ];

  return json({ entity, thoughts, edges });
}
