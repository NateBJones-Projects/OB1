import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || "";
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-brain-key",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

const thoughtSelect =
  "id, content, metadata, created_at, updated_at, type, source_type, importance, quality_score, sensitivity_tier, status, status_updated_at";

type DbThought = {
  id: string;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at?: string | null;
  type?: string | null;
  source_type?: string | null;
  importance?: number | string | null;
  quality_score?: number | string | null;
  sensitivity_tier?: string | null;
  status?: string | null;
  status_updated_at?: string | null;
};

type NormalizedThought = {
  id: string;
  uuid: string;
  content: string;
  type: string;
  source_type: string;
  importance: number;
  quality_score: number;
  sensitivity_tier: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  status: string | null;
  status_updated_at: string | null;
};

const captureSchema = z.object({
  content: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  type: z.string().optional(),
  source_type: z.string().optional(),
  importance: z.number().min(0).max(100).optional(),
  quality_score: z.number().min(0).max(100).optional(),
  sensitivity_tier: z.string().optional(),
  status: z.string().nullable().optional(),
});

const updateSchema = z.object({
  content: z.string().min(1).optional(),
  type: z.string().optional(),
  importance: z.number().min(0).max(100).optional(),
  quality_score: z.number().min(0).max(100).optional(),
  sensitivity_tier: z.string().optional(),
  status: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const searchSchema = z.object({
  query: z.string().min(1),
  mode: z.enum(["semantic", "text"]).default("semantic"),
  limit: z.number().int().min(1).max(100).default(25),
  page: z.number().int().min(1).default(1),
  threshold: z.number().min(0).max(1).default(0.35),
  exclude_restricted: z.boolean().default(true),
});

const reflectionSchema = z.object({
  trigger_context: z.string().optional().default(""),
  options: z.array(z.unknown()).optional().default([]),
  factors: z.array(z.unknown()).optional().default([]),
  conclusion: z.string().optional().default(""),
  confidence: z.number().min(0).max(1).optional().default(0.75),
  reflection_type: z.string().optional().default("reflection"),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

function auth(c: { req: { header: (name: string) => string | undefined; url: string } }) {
  const provided = c.req.header("x-brain-key") || new URL(c.req.url).searchParams.get("key");
  return Boolean(provided && provided === MCP_ACCESS_KEY);
}

function intParam(value: string | null, fallback: number, min = 0, max = 1000) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function numberValue(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function metadataOf(row: Pick<DbThought, "metadata">): Record<string, unknown> {
  return row.metadata && typeof row.metadata === "object" ? row.metadata : {};
}

function normalizeThought(row: DbThought, extra: Record<string, unknown> = {}): NormalizedThought & Record<string, unknown> {
  const metadata = metadataOf(row);
  const type = row.type || stringMeta(metadata, "type") || "observation";
  const sourceType = row.source_type || stringMeta(metadata, "source") || stringMeta(metadata, "source_type") || "unknown";
  const sensitivity = row.sensitivity_tier || stringMeta(metadata, "sensitivity_tier") || "standard";

  return {
    id: row.id,
    uuid: row.id,
    content: row.content,
    type,
    source_type: sourceType,
    importance: numberValue(row.importance, numberValue(metadata.importance, 50)),
    quality_score: numberValue(row.quality_score, numberValue(metadata.quality_score, 50)),
    sensitivity_tier: sensitivity,
    metadata: {
      ...metadata,
      type,
      source: sourceType,
    },
    created_at: row.created_at,
    updated_at: row.updated_at || row.created_at,
    status: row.status ?? null,
    status_updated_at: row.status_updated_at ?? null,
    ...extra,
  };
}

function stringMeta(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function isRestricted(row: DbThought | NormalizedThought) {
  const metadata = "metadata" in row ? row.metadata || {} : {};
  return row.sensitivity_tier === "restricted" || stringMeta(metadata, "sensitivity_tier") === "restricted";
}

function applyThoughtFilters(query: ReturnType<typeof supabase.from> extends { select: (...args: unknown[]) => infer Q } ? Q : any, url: URL) {
  const excludeRestricted = url.searchParams.get("exclude_restricted") !== "false";
  const type = url.searchParams.get("type");
  const sourceType = url.searchParams.get("source_type");
  const status = url.searchParams.get("status");
  const importanceMin = url.searchParams.get("importance_min");
  const qualityMax = url.searchParams.get("quality_score_max");

  let q = query;
  if (excludeRestricted) q = q.neq("sensitivity_tier", "restricted");
  if (type) q = q.eq("type", type);
  if (sourceType) q = q.eq("source_type", sourceType);
  if (status) {
    const statuses = status.split(",").map((s) => s.trim()).filter(Boolean);
    if (statuses.length > 1) q = q.in("status", statuses);
    else if (statuses.length === 1) q = q.eq("status", statuses[0]);
  }
  if (importanceMin !== null) q = q.gte("importance", Number(importanceMin));
  if (qualityMax !== null) q = q.lte("quality_score", Number(qualityMax));
  return q;
}

function applySort(query: ReturnType<typeof supabase.from> extends { select: (...args: unknown[]) => infer Q } ? Q : any, url: URL) {
  const requested = url.searchParams.get("sort") || "created_at";
  const allowed = new Set(["created_at", "updated_at", "importance", "quality_score", "type", "source_type", "status"]);
  const sort = allowed.has(requested) ? requested : "created_at";
  const ascending = url.searchParams.get("order") === "asc";
  return query.order(sort, { ascending, nullsFirst: false });
}

async function getEmbedding(text: string): Promise<number[]> {
  if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not configured");
  const response = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
    }),
  });
  if (!response.ok) throw new Error(`OpenRouter embeddings failed: ${response.status} ${await response.text()}`);
  const data = await response.json();
  return data.data[0].embedding;
}

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  if (!OPENROUTER_API_KEY) return fallbackMetadata(text);
  const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'Extract metadata from this Open Brain thought. Return JSON with "people", "topics", "action_items", "dates_mentioned", and "type". Type must be one of observation, task, idea, reference, person_note, decision, lesson, meeting, journal. Only extract what is explicit.',
        },
        { role: "user", content: text },
      ],
    }),
  });
  if (!response.ok) return fallbackMetadata(text);
  const data = await response.json();
  try {
    return JSON.parse(data.choices[0].message.content);
  } catch {
    return fallbackMetadata(text);
  }
}

function fallbackMetadata(text: string): Record<string, unknown> {
  const lower = text.toLowerCase();
  const type = /\b(todo|next step|ship|implement|fix|review|publish)\b/.test(lower)
    ? "task"
    : /\b(decided|decision|must|should)\b/.test(lower)
      ? "decision"
      : /\b(recipe|docs|reference|guide|url|http)\b/.test(lower)
        ? "reference"
        : "observation";
  const topics = [
    lower.includes("openclaw") ? "OpenClaw" : null,
    lower.includes("agent memory") ? "agent memory" : null,
    lower.includes("dashboard") ? "dashboard" : null,
    lower.includes("nate") ? "Nate Jones" : null,
  ].filter(Boolean);
  return { type, topics: topics.length ? topics : ["open brain"], people: [], action_items: [], dates_mentioned: [] };
}

async function getStructuredRows(ids: string[]) {
  if (ids.length === 0) return new Map<string, DbThought>();
  const { data, error } = await supabase.from("thoughts").select(thoughtSelect).in("id", ids);
  if (error) throw new Error(error.message);
  return new Map((data || []).map((row) => [(row as DbThought).id, row as DbThought]));
}

function tokenSimilarity(a: string, b: string) {
  const aTokens = new Set(a.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
  const bTokens = new Set(b.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of aTokens) if (bTokens.has(token)) intersection += 1;
  const union = new Set([...aTokens, ...bTokens]).size;
  return intersection / union;
}

function compactFingerprint(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").replace(/[^\w\s]/g, "").trim();
}

async function listThoughts(url: URL) {
  const page = intParam(url.searchParams.get("page"), 1, 1, 100000);
  const perPage = intParam(url.searchParams.get("per_page"), 25, 1, 100);
  const offset = (page - 1) * perPage;
  let query = supabase.from("thoughts").select(thoughtSelect, { count: "exact" });
  query = applySort(applyThoughtFilters(query, url), url);
  const { data, error, count } = await query.range(offset, offset + perPage - 1);
  if (error) throw new Error(error.message);
  return {
    data: (data || []).map((row) => normalizeThought(row as DbThought)),
    total: count || 0,
    page,
    per_page: perPage,
  };
}

async function stats(url: URL) {
  const days = intParam(url.searchParams.get("days"), 0, 0, 3650);
  const excludeRestricted = url.searchParams.get("exclude_restricted") !== "false";
  const { data, error } = await supabase.rpc("brain_stats_aggregate", {
    p_since_days: days,
    p_exclude_restricted: excludeRestricted,
  });

  if (!error && data) {
    const typeEntries = Array.isArray(data.top_types) ? data.top_types : [];
    return {
      total_thoughts: Number(data.total || 0),
      window_days: days || "all",
      types: Object.fromEntries(typeEntries.map((item: { type: string; count: number }) => [item.type || "unknown", Number(item.count || 0)])),
      top_topics: Array.isArray(data.top_topics) ? data.top_topics : [],
    };
  }

  const allUrl = new URL(url);
  allUrl.searchParams.delete("page");
  allUrl.searchParams.set("per_page", "100");
  const fallback = await listThoughts(allUrl);
  const types: Record<string, number> = {};
  const topics: Record<string, number> = {};
  for (const thought of fallback.data) {
    types[thought.type] = (types[thought.type] || 0) + 1;
    for (const topic of Array.isArray(thought.metadata.topics) ? thought.metadata.topics as string[] : []) {
      topics[topic] = (topics[topic] || 0) + 1;
    }
  }
  return {
    total_thoughts: fallback.total,
    window_days: days || "all",
    types,
    top_topics: Object.entries(topics).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([topic, count]) => ({ topic, count })),
  };
}

async function semanticSearch(body: z.infer<typeof searchSchema>) {
  const embedding = await getEmbedding(body.query);
  const matchCount = Math.min(100, Math.max(body.limit * body.page * 3, body.limit));
  const { data, error } = await supabase.rpc("match_thoughts", {
    query_embedding: embedding,
    match_threshold: body.threshold,
    match_count: matchCount,
    filter: {},
  });
  if (error) throw new Error(error.message);

  const matches = (data || []) as Array<{ id: string; similarity: number }>;
  const rows = await getStructuredRows(matches.map((match) => match.id));
  const ordered = matches
    .map((match) => ({ match, row: rows.get(match.id) }))
    .filter((item): item is { match: { id: string; similarity: number }; row: DbThought } => Boolean(item.row))
    .filter((item) => !body.exclude_restricted || !isRestricted(item.row))
    .map((item, index) => normalizeThought(item.row, { similarity: item.match.similarity, rank: index + 1 }));

  const offset = (body.page - 1) * body.limit;
  return {
    results: ordered.slice(offset, offset + body.limit),
    count: Math.min(body.limit, Math.max(0, ordered.length - offset)),
    total: ordered.length,
    page: body.page,
    per_page: body.limit,
    total_pages: Math.max(1, Math.ceil(ordered.length / body.limit)),
    mode: "semantic",
  };
}

async function textSearch(body: z.infer<typeof searchSchema>) {
  const offset = (body.page - 1) * body.limit;
  const { data, error } = await supabase.rpc("search_thoughts_text", {
    p_query: body.query,
    p_limit: body.limit,
    p_filter: {},
    p_offset: offset,
  });

  if (!error && data) {
    const rows = ((data || []) as Array<DbThought & { rank: number; total_count: number }>)
      .filter((row) => !body.exclude_restricted || !isRestricted(row))
      .map((row) => normalizeThought(row, { rank: row.rank }));
    const total = Number((data || [])[0]?.total_count || rows.length);
    return {
      results: rows,
      count: rows.length,
      total,
      page: body.page,
      per_page: body.limit,
      total_pages: Math.max(1, Math.ceil(total / body.limit)),
      mode: "text",
    };
  }

  let query = supabase.from("thoughts").select(thoughtSelect, { count: "exact" }).ilike("content", `%${body.query}%`);
  if (body.exclude_restricted) query = query.neq("sensitivity_tier", "restricted");
  const { data: fallback, error: fallbackError, count } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + body.limit - 1);
  if (fallbackError) throw new Error(fallbackError.message);
  return {
    results: (fallback || []).map((row, index) => normalizeThought(row as DbThought, { rank: offset + index + 1 })),
    count: (fallback || []).length,
    total: count || 0,
    page: body.page,
    per_page: body.limit,
    total_pages: Math.max(1, Math.ceil((count || 0) / body.limit)),
    mode: "text",
  };
}

async function createThought(body: z.infer<typeof captureSchema>) {
  const content = body.content.trim();
  const extracted = body.metadata ? body.metadata : await extractMetadata(content);
  const type = body.type || stringMeta(extracted, "type") || "observation";
  const sourceType = body.source_type || stringMeta(extracted, "source") || "dashboard";
  const metadata = {
    ...extracted,
    type,
    source: sourceType,
    source_type: sourceType,
  };

  const [embedding, upsert] = await Promise.all([
    getEmbedding(content),
    supabase.rpc("upsert_thought", {
      p_content: content,
      p_payload: { metadata },
    }),
  ]);
  if (upsert.error) throw new Error(upsert.error.message);

  const thoughtId = String(upsert.data?.id || "");
  if (!thoughtId) throw new Error("upsert_thought did not return an id");

  const status = body.status !== undefined
    ? body.status
    : ["task", "idea"].includes(type)
      ? "new"
      : null;

  const update = {
    embedding,
    metadata,
    type,
    source_type: sourceType,
    importance: body.importance ?? numberValue(extracted.importance, 50),
    quality_score: body.quality_score ?? numberValue(extracted.quality_score, 70),
    sensitivity_tier: body.sensitivity_tier || stringMeta(extracted, "sensitivity_tier") || "standard",
    status,
    status_updated_at: status ? new Date().toISOString() : null,
  };

  const { error } = await supabase.from("thoughts").update(update).eq("id", thoughtId);
  if (error) throw new Error(error.message);

  return {
    thought_id: thoughtId,
    action: "created_or_updated",
    type,
    sensitivity_tier: update.sensitivity_tier,
    content_fingerprint: String(upsert.data?.fingerprint || ""),
    message: "Thought captured",
  };
}

const app = new Hono();

app.options("*", (c) => c.text("ok", 200, corsHeaders));

app.use("*", async (c, next) => {
  if (!auth(c)) return c.json({ error: "Invalid or missing access key" }, 401, corsHeaders);
  await next();
});

app.get("/health", (c) => c.json({ ok: true, status: "ok", service: "open-brain-rest", version: "0.1.0" }, 200, corsHeaders));

app.get("/stats", async (c) => {
  try {
    return c.json(await stats(new URL(c.req.url)), 200, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Failed to load stats" }, 500, corsHeaders);
  }
});

app.get("/thoughts", async (c) => {
  try {
    return c.json(await listThoughts(new URL(c.req.url)), 200, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Failed to load thoughts" }, 500, corsHeaders);
  }
});

app.get("/thought/:id", async (c) => {
  const excludeRestricted = new URL(c.req.url).searchParams.get("exclude_restricted") !== "false";
  const { data, error } = await supabase.from("thoughts").select(thoughtSelect).eq("id", c.req.param("id")).single();
  if (error) return c.json({ error: error.message }, 404, corsHeaders);
  if (excludeRestricted && isRestricted(data as DbThought)) return c.json({ error: "Restricted thought" }, 403, corsHeaders);
  return c.json(normalizeThought(data as DbThought), 200, corsHeaders);
});

app.put("/thought/:id", async (c) => {
  try {
    const parsed = updateSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "Invalid update payload", details: parsed.error.flatten() }, 400, corsHeaders);

    const id = c.req.param("id");
    const { data: existing, error: existingError } = await supabase.from("thoughts").select(thoughtSelect).eq("id", id).single();
    if (existingError) return c.json({ error: existingError.message }, 404, corsHeaders);

    const metadata = {
      ...metadataOf(existing as DbThought),
      ...(parsed.data.metadata || {}),
    };
    if (parsed.data.type) metadata.type = parsed.data.type;

    const update: Record<string, unknown> = { metadata };
    if (parsed.data.content !== undefined) {
      update.content = parsed.data.content;
      update.embedding = await getEmbedding(parsed.data.content);
    }
    if (parsed.data.type !== undefined) update.type = parsed.data.type;
    if (parsed.data.importance !== undefined) update.importance = parsed.data.importance;
    if (parsed.data.quality_score !== undefined) update.quality_score = parsed.data.quality_score;
    if (parsed.data.sensitivity_tier !== undefined) update.sensitivity_tier = parsed.data.sensitivity_tier;
    if (parsed.data.status !== undefined) {
      update.status = parsed.data.status;
      update.status_updated_at = new Date().toISOString();
    }

    const { error } = await supabase.from("thoughts").update(update).eq("id", id);
    if (error) return c.json({ error: error.message }, 500, corsHeaders);
    return c.json({ id, action: "updated", message: "Thought updated" }, 200, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Update failed" }, 500, corsHeaders);
  }
});

app.delete("/thought/:id", async (c) => {
  const id = c.req.param("id");
  const { error } = await supabase.from("thoughts").delete().eq("id", id);
  if (error) return c.json({ error: error.message }, 500, corsHeaders);
  return c.json({ id, action: "deleted", message: "Thought deleted" }, 200, corsHeaders);
});

app.post("/capture", async (c) => {
  try {
    const parsed = captureSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "Invalid capture payload", details: parsed.error.flatten() }, 400, corsHeaders);
    return c.json(await createThought(parsed.data), 200, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Capture failed" }, 500, corsHeaders);
  }
});

app.post("/search", async (c) => {
  try {
    const parsed = searchSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "Invalid search payload", details: parsed.error.flatten() }, 400, corsHeaders);
    const data = parsed.data.mode === "text" ? await textSearch(parsed.data) : await semanticSearch(parsed.data);
    return c.json(data, 200, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Search failed" }, 500, corsHeaders);
  }
});

app.get("/duplicates", async (c) => {
  try {
    const url = new URL(c.req.url);
    const threshold = Number(url.searchParams.get("threshold") || 0.85);
    const limit = intParam(url.searchParams.get("limit"), 50, 1, 100);
    const offset = intParam(url.searchParams.get("offset"), 0, 0, 10000);
    const listUrl = new URL(url);
    listUrl.searchParams.set("per_page", "250");
    listUrl.searchParams.set("page", "1");
    listUrl.searchParams.delete("quality_score_max");
    const thoughts = (await listThoughts(listUrl)).data;
    const pairs = [];

    for (let i = 0; i < thoughts.length; i += 1) {
      for (let j = i + 1; j < thoughts.length; j += 1) {
        const a = thoughts[i];
        const b = thoughts[j];
        const exact = compactFingerprint(a.content) === compactFingerprint(b.content);
        const similarity = exact ? 1 : tokenSimilarity(a.content, b.content);
        if (similarity >= threshold) {
          pairs.push({
            thought_id_a: a.id,
            thought_id_b: b.id,
            similarity,
            content_a: a.content,
            content_b: b.content,
            type_a: a.type,
            type_b: b.type,
            quality_a: a.quality_score,
            quality_b: b.quality_score,
            created_a: a.created_at,
            created_b: b.created_at,
          });
        }
      }
    }

    pairs.sort((a, b) => b.similarity - a.similarity || b.quality_a + b.quality_b - (a.quality_a + a.quality_b));
    return c.json({ pairs: pairs.slice(offset, offset + limit), threshold, limit, offset }, 200, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Duplicate scan failed" }, 500, corsHeaders);
  }
});

app.get("/thought/:id/connections", async (c) => {
  const id = c.req.param("id");
  const url = new URL(c.req.url);
  const limit = intParam(url.searchParams.get("limit"), 20, 1, 50);
  const excludeRestricted = url.searchParams.get("exclude_restricted") !== "false";
  const { data, error } = await supabase.rpc("get_thought_connections", {
    p_thought_id: id,
    p_limit: limit,
    p_exclude_restricted: excludeRestricted,
  });
  if (!error && data) return c.json({ connections: data }, 200, corsHeaders);
  return c.json({ connections: [] }, 200, corsHeaders);
});

app.get("/thought/:id/reflection", async (c) => {
  const { data, error } = await supabase
    .from("reflections")
    .select("*")
    .eq("thought_id", c.req.param("id"))
    .order("created_at", { ascending: false });
  if (error) return c.json({ reflections: [] }, 200, corsHeaders);
  return c.json({ reflections: data || [] }, 200, corsHeaders);
});

app.post("/thought/:id/reflection", async (c) => {
  const parsed = reflectionSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Invalid reflection payload", details: parsed.error.flatten() }, 400, corsHeaders);
  const payload = { ...parsed.data, thought_id: c.req.param("id") };
  const { data, error } = await supabase.from("reflections").insert(payload).select("*").single();
  if (error) return c.json({ error: error.message }, 501, corsHeaders);
  return c.json(data, 200, corsHeaders);
});

app.get("/ingestion-jobs", (c) => c.json({ jobs: [], count: 0 }, 200, corsHeaders));
app.get("/ingestion-jobs/:id", (c) => c.json({ job: null, items: [] }, 200, corsHeaders));
app.post("/ingestion-jobs/:id/execute", (c) => c.json({ job_id: c.req.param("id"), status: "not_configured" }, 200, corsHeaders));
app.post("/ingest", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const text = String(body.text || "").trim();
  if (!text) return c.json({ error: "text is required" }, 400, corsHeaders);
  const result = await createThought({ content: text, source_type: "dashboard_ingest" });
  return c.json({ job_id: 0, status: "complete", extracted_count: 1, thought_id: result.thought_id }, 200, corsHeaders);
});

Deno.serve((req) => {
  const url = new URL(req.url);
  if (url.pathname === "/open-brain-rest") {
    url.pathname = "/";
  } else if (url.pathname.startsWith("/open-brain-rest/")) {
    url.pathname = url.pathname.slice("/open-brain-rest".length);
  }
  return app.fetch(new Request(url, req));
});
