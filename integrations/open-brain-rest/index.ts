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

  // When upsert_thought resolved the row via the original-fingerprint fallback,
  // `content`/`embedding` here were computed from the OLD pre-correction text
  // (a reimport of the original source). The matched row is the CORRECTED one,
  // so overwriting its embedding with the stale-text vector would silently
  // desync it from its corrected content. Skip the embedding overwrite on that
  // path — the RPC already merged metadata and left content untouched, so this
  // becomes a pure dedup hit.
  const matchedViaOriginalFingerprint =
    upsert.data?.matched_via === "original_fingerprint";

  const update: Record<string, unknown> = {
    metadata,
    type,
    source_type: sourceType,
    importance: body.importance ?? numberValue(extracted.importance, 50),
    quality_score: body.quality_score ?? numberValue(extracted.quality_score, 70),
    sensitivity_tier: body.sensitivity_tier || stringMeta(extracted, "sensitivity_tier") || "standard",
    status,
    status_updated_at: status ? new Date().toISOString() : null,
  };
  if (!matchedViaOriginalFingerprint) {
    update.embedding = embedding;
  }

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

// ─── CRM (optional) ─────────────────────────────────────────────────────────
// Exposes the crm-core / crm-engagement RPCs as REST, and keeps each contact's
// searchable "card" thought in sync. All routes are already behind the
// x-brain-key middleware below. Requires the crm-core schema; on a brain
// without it, these routes surface the RPC's "function does not exist" error
// and the dashboard hides the section via feature detection.

const crmCreateSchema = z.object({
  display_name: z.string().min(1),
  canonical_email: z.string().optional(),
  organization_name: z.string().optional(),
  job_title: z.string().optional(),
  actor: z.string().optional(),
});

const crmPatchSchema = z.object({
  patch: z.record(z.string(), z.unknown()),
  actor: z.string().optional(),
  origin: z.enum(["manual", "import", "extraction", "projection"]).optional(),
  run_id: z.string().nullable().optional(),
  expected_updated_at: z.string().nullable().optional(),
});

type CrmContactRecord = {
  id: string;
  display_name: string;
  organization_name: string | null;
  job_title: string | null;
  location: string | null;
  relationship_note: string | null;
  lifecycle_status: string;
  privacy_tier: string;
  card_thought_id: string | null;
  updated_at: string;
} & Record<string, unknown>;

type CrmContactBundle = {
  record: CrmContactRecord;
  methods: Array<Record<string, unknown>>;
  aliases: Array<Record<string, unknown>>;
};

// PostgREST `.or()` takes a filter STRING, so raw user input could inject filter
// structure (commas/parens). Strip the structural characters before building an
// ilike pattern; the wildcards are added by us.
function sanitizeIlike(value: string): string {
  return value.replace(/[,()*:%\\]/g, " ").replace(/\s+/g, " ").trim();
}

async function crmGetContact(contactId: string): Promise<CrmContactBundle | null> {
  const { data, error } = await supabase.rpc("crm_get_contact", { p_contact_id: contactId });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as
    | { record?: CrmContactRecord; methods?: unknown; aliases?: unknown }
    | null;
  if (!row || !row.record) return null;
  return {
    record: row.record,
    methods: Array.isArray(row.methods) ? (row.methods as Array<Record<string, unknown>>) : [],
    aliases: Array.isArray(row.aliases) ? (row.aliases as Array<Record<string, unknown>>) : [],
  };
}

function buildCardContent(record: CrmContactRecord, methods: Array<Record<string, unknown>>): string {
  const lines = [`Contact: ${record.display_name}`];
  if (record.organization_name) lines.push(`Organization: ${record.organization_name}`);
  if (record.job_title) lines.push(`Title: ${record.job_title}`);
  if (record.location) lines.push(`Location: ${record.location}`);
  if (record.relationship_note) lines.push(`Note: ${record.relationship_note}`);
  for (const method of methods) {
    const type = typeof method.method_type === "string" ? method.method_type : "contact";
    const value = typeof method.value === "string" ? method.value : "";
    if (value) lines.push(`${type}: ${value}`);
  }
  return lines.join("\n");
}

// Keep the contact's searchable card thought in sync. The card carries
// metadata.generated_by='crm-write-back', so entity extraction skips it. Re-embed
// when a key is present; degrade to a text-searchable (no-embed) card otherwise.
async function syncContactCard(contactId: string, actor = "crm-write-back"): Promise<string | null> {
  const contact = await crmGetContact(contactId);
  if (!contact) return null;
  const { record, methods } = contact;

  // Archived contacts carry no live card (mirrors the schema's ON DELETE note).
  if (record.lifecycle_status === "archived") {
    if (record.card_thought_id) {
      await supabase.from("crm_contacts").update({ card_thought_id: null }).eq("id", record.id);
    }
    return null;
  }

  const content = buildCardContent(record, methods);
  const metadata = {
    source_type: "crm_contact_card",
    source: "crm_contact_card",
    generated_by: "crm-write-back",
    crm_contact_id: record.id,
    sensitivity_tier: record.privacy_tier,
  };

  const upsert = await supabase.rpc("upsert_thought", { p_content: content, p_payload: { metadata } });
  if (upsert.error) throw new Error(upsert.error.message);
  const thoughtId = String(upsert.data?.id || "");
  if (!thoughtId) throw new Error("upsert_thought did not return an id");

  // Skip the embed overwrite when upsert resolved via the original-fingerprint
  // path (the matched row is a corrected thought, not our card text).
  const matchedViaOriginalFingerprint = upsert.data?.matched_via === "original_fingerprint";
  const update: Record<string, unknown> = {
    metadata,
    source_type: "crm_contact_card",
    sensitivity_tier: record.privacy_tier,
  };
  if (OPENROUTER_API_KEY && !matchedViaOriginalFingerprint) {
    try {
      update.embedding = await getEmbedding(content);
    } catch (error) {
      // No-embed fallback: the card is still text-searchable; do not fail the write.
      console.error("crm card embedding skipped:", error instanceof Error ? error.message : error);
    }
  }
  const { error: thoughtError } = await supabase.from("thoughts").update(update).eq("id", thoughtId);
  if (thoughtError) throw new Error(thoughtError.message);

  if (record.card_thought_id !== thoughtId) {
    const { error: bindError } = await supabase
      .from("crm_contacts")
      .update({ card_thought_id: thoughtId })
      .eq("id", record.id);
    if (bindError) throw new Error(bindError.message);
  }
  return thoughtId;
}

// Best-effort wrapper: a write-back failure must never fail the contact write
// that triggered it.
async function syncContactCardSafe(contactId: string, actor?: string): Promise<string | null> {
  try {
    return await syncContactCard(contactId, actor);
  } catch (error) {
    console.error("crm card write-back failed (non-fatal):", error instanceof Error ? error.message : error);
    return null;
  }
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

// ─── CRM routes ─────────────────────────────────────────────────────────────

const CRM_CONTACT_COLUMNS =
  "id, display_name, canonical_email, organization_name, job_title, location, relationship_note, lifecycle_status, privacy_tier, owner_label, card_thought_id, created_at, updated_at";

app.get("/crm/contacts", async (c) => {
  try {
    const url = new URL(c.req.url);
    const page = intParam(url.searchParams.get("page"), 1, 1, 100000);
    const perPage = intParam(url.searchParams.get("per_page"), 25, 1, 100);
    const offset = (page - 1) * perPage;
    const q = sanitizeIlike(url.searchParams.get("q") || url.searchParams.get("search") || "");
    const tier = url.searchParams.get("privacy_tier");
    const lifecycle = url.searchParams.get("lifecycle_status") || "active";
    const excludeRestricted = url.searchParams.get("exclude_restricted") !== "false";

    let query = supabase.from("crm_contacts").select(CRM_CONTACT_COLUMNS, { count: "exact" });
    if (lifecycle && lifecycle !== "all") query = query.eq("lifecycle_status", lifecycle);
    if (tier) query = query.eq("privacy_tier", tier);
    if (excludeRestricted) query = query.neq("privacy_tier", "restricted");
    if (q) {
      query = query.or(
        `display_name.ilike.%${q}%,organization_name.ilike.%${q}%,canonical_email.ilike.%${q}%`,
      );
    }

    const { data, error, count } = await query
      .order("display_name", { ascending: true })
      .range(offset, offset + perPage - 1);
    if (error) throw new Error(error.message);
    return c.json({ data: data || [], total: count || 0, page, per_page: perPage }, 200, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Failed to list contacts" }, 500, corsHeaders);
  }
});

app.post("/crm/contacts", async (c) => {
  try {
    const parsed = crmCreateSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "Invalid contact payload", details: parsed.error.flatten() }, 400, corsHeaders);
    const body = parsed.data;
    const actor = body.actor || "dashboard";
    const { data, error } = await supabase.rpc("crm_create_contact", {
      p_display_name: body.display_name,
      p_canonical_email: body.canonical_email ?? null,
      p_organization_name: body.organization_name ?? null,
      p_job_title: body.job_title ?? null,
      p_actor: actor,
    });
    if (error) return c.json({ error: error.message }, 500, corsHeaders);
    const contactId = String(data || "");
    if (!contactId) return c.json({ error: "crm_create_contact did not return an id" }, 500, corsHeaders);
    await syncContactCardSafe(contactId, "crm-write-back");
    const contact = await crmGetContact(contactId);
    return c.json({ contact_id: contactId, ...(contact || {}) }, 201, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Create failed" }, 500, corsHeaders);
  }
});

app.get("/crm/contacts/:id", async (c) => {
  try {
    const excludeRestricted = new URL(c.req.url).searchParams.get("exclude_restricted") !== "false";
    const contact = await crmGetContact(c.req.param("id"));
    if (!contact) return c.json({ error: "Contact not found" }, 404, corsHeaders);
    if (excludeRestricted && contact.record.privacy_tier === "restricted") {
      return c.json({ error: "Restricted contact" }, 403, corsHeaders);
    }
    return c.json(contact, 200, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Failed to load contact" }, 500, corsHeaders);
  }
});

app.patch("/crm/contacts/:id", async (c) => {
  try {
    const parsed = crmPatchSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "Invalid patch payload", details: parsed.error.flatten() }, 400, corsHeaders);
    const body = parsed.data;
    const id = c.req.param("id");
    const { data, error } = await supabase.rpc("crm_patch_contact_record", {
      p_contact_id: id,
      p_patch: body.patch,
      p_actor: body.actor || "dashboard",
      p_origin: body.origin || "manual",
      p_run_id: body.run_id ?? null,
      p_expected_updated_at: body.expected_updated_at ?? null,
    });
    if (error) {
      const message = error.message || "Patch failed";
      if (message.includes("crm_contact_stale_write")) {
        return c.json({ error: "The contact changed since you loaded it; reload and retry.", code: "stale_write" }, 409, corsHeaders);
      }
      if (message.includes("not found")) return c.json({ error: message }, 404, corsHeaders);
      return c.json({ error: message }, 500, corsHeaders);
    }
    const result = (data || {}) as { applied?: unknown } & Record<string, unknown>;
    // Refresh the card only when a canonical field actually changed.
    if (Array.isArray(result.applied) && result.applied.length > 0) {
      await syncContactCardSafe(id, body.actor || "crm-write-back");
    }
    return c.json(result, 200, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Patch failed" }, 500, corsHeaders);
  }
});

const crmResolveSchema = z.object({
  decision: z.enum(["accept", "reject"]),
  actor: z.string().optional(),
});

const crmResolveRunSchema = z.object({
  run_id: z.string().min(1),
  decision: z.enum(["accept", "reject"]),
  actor: z.string().optional(),
});

const crmEvidenceSchema = z.object({
  field_key: z.string().min(1),
  thought_id: z.string().min(1),
  role: z.enum(["supports", "contradicts", "source", "correction"]).optional(),
  target_kind: z.enum(["contact_field", "contact_method", "alias", "proposal"]).optional(),
  target_id: z.string().nullable().optional(),
  note: z.string().optional(),
  actor: z.string().optional(),
});

const crmLockSchema = z.object({
  field_key: z.string().min(1),
  locked: z.boolean(),
  actor: z.string().optional(),
});

const crmMethodSchema = z.object({
  method_type: z.enum(["email", "phone", "url", "social", "address", "other"]),
  value: z.string().min(1),
  label: z.string().optional(),
  is_primary: z.boolean().optional(),
  actor: z.string().optional(),
  source: z.string().optional(),
});

async function proposalContactId(proposalId: string): Promise<string | null> {
  const { data } = await supabase.from("crm_field_proposals").select("contact_id").eq("id", proposalId).single();
  return (data?.contact_id as string) || null;
}

app.get("/crm/proposals", async (c) => {
  try {
    const url = new URL(c.req.url);
    const page = intParam(url.searchParams.get("page"), 1, 1, 100000);
    const perPage = intParam(url.searchParams.get("per_page"), 25, 1, 100);
    const offset = (page - 1) * perPage;
    const status = url.searchParams.get("status") || "open";
    const contactId = url.searchParams.get("contact_id");
    const runId = url.searchParams.get("run_id");

    let query = supabase.from("crm_field_proposals").select("*", { count: "exact" });
    if (status && status !== "all") query = query.eq("status", status);
    if (contactId) query = query.eq("contact_id", contactId);
    if (runId) query = query.eq("origin_ref->>run_id", runId);

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + perPage - 1);
    if (error) throw new Error(error.message);
    return c.json({ data: data || [], total: count || 0, page, per_page: perPage }, 200, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Failed to list proposals" }, 500, corsHeaders);
  }
});

app.get("/crm/proposals/count", async (c) => {
  try {
    const contactId = new URL(c.req.url).searchParams.get("contact_id");
    let query = supabase.from("crm_field_proposals").select("id", { count: "exact", head: true }).eq("status", "open");
    if (contactId) query = query.eq("contact_id", contactId);
    const { count, error } = await query;
    if (error) throw new Error(error.message);
    return c.json({ open: count || 0 }, 200, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Failed to count proposals" }, 500, corsHeaders);
  }
});

app.post("/crm/proposals/:id/resolve", async (c) => {
  try {
    const parsed = crmResolveSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "Invalid resolve payload", details: parsed.error.flatten() }, 400, corsHeaders);
    const proposalId = c.req.param("id");
    const contactId = await proposalContactId(proposalId);
    const { data, error } = await supabase.rpc("crm_resolve_field_proposal", {
      p_proposal_id: proposalId,
      p_decision: parsed.data.decision,
      p_actor: parsed.data.actor || "dashboard",
    });
    if (error) {
      const message = error.message || "Resolve failed";
      if (message.includes("locked")) return c.json({ error: message, code: "field_locked" }, 409, corsHeaders);
      if (message.includes("not found")) return c.json({ error: message }, 404, corsHeaders);
      return c.json({ error: message }, 500, corsHeaders);
    }
    const result = (data || {}) as { changed?: boolean } & Record<string, unknown>;
    if (parsed.data.decision === "accept" && result.changed && contactId) {
      await syncContactCardSafe(contactId, parsed.data.actor || "crm-write-back");
    }
    return c.json(result, 200, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Resolve failed" }, 500, corsHeaders);
  }
});

app.post("/crm/proposals/resolve-run", async (c) => {
  try {
    const parsed = crmResolveRunSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "Invalid resolve-run payload", details: parsed.error.flatten() }, 400, corsHeaders);
    const { data, error } = await supabase.rpc("crm_resolve_field_proposals_by_run", {
      p_run_id: parsed.data.run_id,
      p_decision: parsed.data.decision,
      p_actor: parsed.data.actor || "dashboard",
    });
    if (error) return c.json({ error: error.message }, 500, corsHeaders);
    // Best-effort write-back for every contact touched by an accepted run.
    if (parsed.data.decision === "accept") {
      const { data: touched } = await supabase
        .from("crm_field_proposals")
        .select("contact_id")
        .eq("origin_ref->>run_id", parsed.data.run_id)
        .eq("status", "accepted");
      const ids = [...new Set((touched || []).map((row) => row.contact_id as string).filter(Boolean))];
      for (const id of ids) await syncContactCardSafe(id, parsed.data.actor || "crm-write-back");
    }
    return c.json(data || {}, 200, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Resolve-run failed" }, 500, corsHeaders);
  }
});

app.get("/crm/contacts/:id/field-evidence", async (c) => {
  try {
    const url = new URL(c.req.url);
    const { data, error } = await supabase.rpc("crm_contact_field_evidence", {
      p_contact_id: c.req.param("id"),
      p_field_key: url.searchParams.get("field_key"),
      p_exclude_restricted: url.searchParams.get("exclude_restricted") !== "false",
      p_limit: intParam(url.searchParams.get("limit"), 100, 1, 500),
    });
    if (error) throw new Error(error.message);
    return c.json({ evidence: data || [] }, 200, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Failed to load evidence" }, 500, corsHeaders);
  }
});

app.post("/crm/contacts/:id/field-evidence", async (c) => {
  try {
    const parsed = crmEvidenceSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "Invalid evidence payload", details: parsed.error.flatten() }, 400, corsHeaders);
    const body = parsed.data;
    const { data, error } = await supabase.rpc("crm_add_field_evidence", {
      p_contact_id: c.req.param("id"),
      p_field_key: body.field_key,
      p_thought_id: body.thought_id,
      p_role: body.role || "supports",
      p_target_kind: body.target_kind || "contact_field",
      p_target_id: body.target_id ?? null,
      p_note: body.note ?? null,
      p_actor: body.actor || "dashboard",
    });
    if (error) return c.json({ error: error.message }, 500, corsHeaders);
    return c.json({ evidence_id: data }, 201, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Add evidence failed" }, 500, corsHeaders);
  }
});

app.post("/crm/contacts/:id/field-lock", async (c) => {
  try {
    const parsed = crmLockSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "Invalid field-lock payload", details: parsed.error.flatten() }, 400, corsHeaders);
    const body = parsed.data;
    const { data, error } = await supabase.rpc("crm_set_field_lock", {
      p_contact_id: c.req.param("id"),
      p_field_key: body.field_key,
      p_locked: body.locked,
      p_actor: body.actor || "dashboard",
    });
    if (error) {
      const message = error.message || "Field-lock failed";
      if (message.includes("not found")) return c.json({ error: message }, 404, corsHeaders);
      if (message.includes("unknown contact field")) return c.json({ error: message }, 400, corsHeaders);
      return c.json({ error: message }, 500, corsHeaders);
    }
    return c.json(data || {}, 200, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Field-lock failed" }, 500, corsHeaders);
  }
});

app.post("/crm/contacts/:id/methods", async (c) => {
  try {
    const parsed = crmMethodSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "Invalid method payload", details: parsed.error.flatten() }, 400, corsHeaders);
    const body = parsed.data;
    const id = c.req.param("id");
    const { data, error } = await supabase.rpc("crm_add_contact_method", {
      p_contact_id: id,
      p_method_type: body.method_type,
      p_value: body.value,
      p_label: body.label ?? null,
      p_is_primary: body.is_primary ?? false,
      p_actor: body.actor || "dashboard",
      p_source: body.source || "manual",
    });
    if (error) {
      const message = error.message || "Add method failed";
      if (message.includes("not found")) return c.json({ error: message }, 404, corsHeaders);
      if (message.includes("invalid contact method")) return c.json({ error: message }, 400, corsHeaders);
      return c.json({ error: message }, 500, corsHeaders);
    }
    await syncContactCardSafe(id, body.actor || "crm-write-back");
    return c.json({ method: data }, 201, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Add method failed" }, 500, corsHeaders);
  }
});

app.get("/crm/contacts/:id/history", async (c) => {
  try {
    const url = new URL(c.req.url);
    const page = intParam(url.searchParams.get("page"), 1, 1, 100000);
    const perPage = intParam(url.searchParams.get("per_page"), 50, 1, 200);
    const offset = (page - 1) * perPage;
    const { data, error, count } = await supabase
      .from("crm_contact_change_log")
      .select("*", { count: "exact" })
      .eq("contact_id", c.req.param("id"))
      .order("created_at", { ascending: false })
      .range(offset, offset + perPage - 1);
    if (error) throw new Error(error.message);
    return c.json({ history: data || [], total: count || 0, page, per_page: perPage }, 200, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Failed to load history" }, 500, corsHeaders);
  }
});

const PRIVACY_TIERS = ["standard", "sensitive", "restricted"] as const;

const crmNoteSchema = z.object({
  body: z.string().min(1),
  note_type: z.enum(["relationship_note", "private_note", "context"]).optional(),
  pinned: z.boolean().optional(),
  privacy_tier: z.enum(PRIVACY_TIERS).optional(),
  actor: z.string().optional(),
});

const crmNotePatchSchema = z.object({
  body: z.string().optional(),
  note_type: z.enum(["relationship_note", "private_note", "context"]).optional(),
  pinned: z.boolean().optional(),
  privacy_tier: z.enum(PRIVACY_TIERS).optional(),
  deleted: z.boolean().optional(),
  actor: z.string().optional(),
});

const crmTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  task_type: z.enum(["follow_up", "reminder", "todo"]).optional(),
  status: z.enum(["open", "completed", "snoozed", "archived"]).optional(),
  due_at: z.string().nullable().optional(),
  snoozed_until: z.string().nullable().optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  privacy_tier: z.enum(PRIVACY_TIERS).optional(),
  actor: z.string().optional(),
});

const crmTaskPatchSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  task_type: z.enum(["follow_up", "reminder", "todo"]).optional(),
  status: z.enum(["open", "completed", "snoozed", "archived"]).optional(),
  due_at: z.string().nullable().optional(),
  snoozed_until: z.string().nullable().optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  privacy_tier: z.enum(PRIVACY_TIERS).optional(),
  deleted: z.boolean().optional(),
  actor: z.string().optional(),
});

const crmDateSchema = z.object({
  label: z.string().min(1),
  date_value: z.string().min(1),
  date_kind: z.enum(["birthday", "anniversary", "work_anniversary", "other"]).optional(),
  recurrence: z.enum(["none", "annual"]).optional(),
  notes: z.string().optional(),
  privacy_tier: z.enum(PRIVACY_TIERS).optional(),
  actor: z.string().optional(),
});

const crmDatePatchSchema = z.object({
  label: z.string().optional(),
  date_value: z.string().optional(),
  date_kind: z.enum(["birthday", "anniversary", "work_anniversary", "other"]).optional(),
  recurrence: z.enum(["none", "annual"]).optional(),
  notes: z.string().optional(),
  privacy_tier: z.enum(PRIVACY_TIERS).optional(),
  deleted: z.boolean().optional(),
  actor: z.string().optional(),
});

const crmInteractionSchema = z.object({
  contact_ids: z.array(z.string().min(1)).min(1),
  kind: z.enum(["call", "meeting", "in_person", "message", "other"]),
  occurred_at: z.string().min(1),
  summary: z.string().min(1),
  duration_minutes: z.number().int().nullable().optional(),
  privacy_tier: z.enum(PRIVACY_TIERS).optional(),
  thought_id: z.string().nullable().optional(),
  actor: z.string().optional(),
});

const crmInteractionPatchSchema = z.object({
  summary: z.string().optional(),
  occurred_at: z.string().optional(),
  duration_minutes: z.number().int().nullable().optional(),
  privacy_tier: z.enum(PRIVACY_TIERS).optional(),
  deleted: z.boolean().optional(),
  actor: z.string().optional(),
});

// Compact error mapper for the engagement RPCs: zod already caught bad input, so
// the RPC exceptions we still see are "not found" (404) or the occasional guard.
function crmRpcErrorStatus(message: string): 404 | 409 | 400 | 500 {
  if (message.includes("not found")) return 404;
  if (message.includes("locked") || message.includes("stale_write")) return 409;
  if (/\b(invalid|required|must be|cannot)\b/.test(message)) return 400;
  return 500;
}

app.get("/crm/contacts/:id/relationship-items", async (c) => {
  try {
    const excludeRestricted = new URL(c.req.url).searchParams.get("exclude_restricted") !== "false";
    const { data, error } = await supabase.rpc("crm_contact_relationship_items", {
      p_contact_id: c.req.param("id"),
      p_exclude_restricted: excludeRestricted,
    });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) || { notes: [], tasks: [], important_dates: [] };
    return c.json(row, 200, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Failed to load relationship items" }, 500, corsHeaders);
  }
});

app.post("/crm/contacts/:id/notes", async (c) => {
  try {
    const parsed = crmNoteSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "Invalid note payload", details: parsed.error.flatten() }, 400, corsHeaders);
    const body = parsed.data;
    const { data, error } = await supabase.rpc("crm_add_contact_note", {
      p_contact_id: c.req.param("id"),
      p_body: body.body,
      p_note_type: body.note_type || "relationship_note",
      p_pinned: body.pinned ?? false,
      p_privacy_tier: body.privacy_tier || "standard",
      p_actor: body.actor || "dashboard",
    });
    if (error) return c.json({ error: error.message }, crmRpcErrorStatus(error.message || ""), corsHeaders);
    return c.json({ note: data }, 201, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Add note failed" }, 500, corsHeaders);
  }
});

app.patch("/crm/notes/:noteId", async (c) => {
  try {
    const parsed = crmNotePatchSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "Invalid note payload", details: parsed.error.flatten() }, 400, corsHeaders);
    const body = parsed.data;
    const { data, error } = await supabase.rpc("crm_update_contact_note", {
      p_note_id: c.req.param("noteId"),
      p_body: body.body ?? null,
      p_note_type: body.note_type ?? null,
      p_pinned: body.pinned ?? null,
      p_privacy_tier: body.privacy_tier ?? null,
      p_deleted: body.deleted ?? null,
      p_actor: body.actor || "dashboard",
    });
    if (error) return c.json({ error: error.message }, crmRpcErrorStatus(error.message || ""), corsHeaders);
    return c.json({ note: data }, 200, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Update note failed" }, 500, corsHeaders);
  }
});

app.post("/crm/contacts/:id/tasks", async (c) => {
  try {
    const parsed = crmTaskSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "Invalid task payload", details: parsed.error.flatten() }, 400, corsHeaders);
    const body = parsed.data;
    const { data, error } = await supabase.rpc("crm_add_contact_task", {
      p_contact_id: c.req.param("id"),
      p_title: body.title,
      p_description: body.description ?? null,
      p_task_type: body.task_type || "follow_up",
      p_status: body.status || "open",
      p_due_at: body.due_at ?? null,
      p_snoozed_until: body.snoozed_until ?? null,
      p_priority: body.priority || "normal",
      p_privacy_tier: body.privacy_tier || "standard",
      p_actor: body.actor || "dashboard",
    });
    if (error) return c.json({ error: error.message }, crmRpcErrorStatus(error.message || ""), corsHeaders);
    return c.json({ task: data }, 201, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Add task failed" }, 500, corsHeaders);
  }
});

app.patch("/crm/tasks/:taskId", async (c) => {
  try {
    const parsed = crmTaskPatchSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "Invalid task payload", details: parsed.error.flatten() }, 400, corsHeaders);
    const body = parsed.data;
    const { data, error } = await supabase.rpc("crm_update_contact_task", {
      p_task_id: c.req.param("taskId"),
      p_title: body.title ?? null,
      p_description: body.description ?? null,
      p_task_type: body.task_type ?? null,
      p_status: body.status ?? null,
      p_due_at: body.due_at ?? null,
      p_snoozed_until: body.snoozed_until ?? null,
      p_priority: body.priority ?? null,
      p_privacy_tier: body.privacy_tier ?? null,
      p_deleted: body.deleted ?? null,
      p_actor: body.actor || "dashboard",
    });
    if (error) return c.json({ error: error.message }, crmRpcErrorStatus(error.message || ""), corsHeaders);
    return c.json({ task: data }, 200, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Update task failed" }, 500, corsHeaders);
  }
});

app.post("/crm/contacts/:id/important-dates", async (c) => {
  try {
    const parsed = crmDateSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "Invalid date payload", details: parsed.error.flatten() }, 400, corsHeaders);
    const body = parsed.data;
    const { data, error } = await supabase.rpc("crm_add_contact_important_date", {
      p_contact_id: c.req.param("id"),
      p_label: body.label,
      p_date_value: body.date_value,
      p_date_kind: body.date_kind || "other",
      p_recurrence: body.recurrence || "annual",
      p_notes: body.notes ?? null,
      p_privacy_tier: body.privacy_tier || "standard",
      p_actor: body.actor || "dashboard",
    });
    if (error) return c.json({ error: error.message }, crmRpcErrorStatus(error.message || ""), corsHeaders);
    return c.json({ important_date: data }, 201, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Add important date failed" }, 500, corsHeaders);
  }
});

app.patch("/crm/important-dates/:dateId", async (c) => {
  try {
    const parsed = crmDatePatchSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "Invalid date payload", details: parsed.error.flatten() }, 400, corsHeaders);
    const body = parsed.data;
    const { data, error } = await supabase.rpc("crm_update_contact_important_date", {
      p_important_date_id: c.req.param("dateId"),
      p_label: body.label ?? null,
      p_date_value: body.date_value ?? null,
      p_date_kind: body.date_kind ?? null,
      p_recurrence: body.recurrence ?? null,
      p_notes: body.notes ?? null,
      p_privacy_tier: body.privacy_tier ?? null,
      p_deleted: body.deleted ?? null,
      p_actor: body.actor || "dashboard",
    });
    if (error) return c.json({ error: error.message }, crmRpcErrorStatus(error.message || ""), corsHeaders);
    return c.json({ important_date: data }, 200, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Update important date failed" }, 500, corsHeaders);
  }
});

app.get("/crm/contacts/:id/interactions", async (c) => {
  try {
    const url = new URL(c.req.url);
    const { data, error } = await supabase.rpc("crm_contact_interactions", {
      p_contact_id: c.req.param("id"),
      p_limit: intParam(url.searchParams.get("limit"), 50, 1, 200),
      p_offset: intParam(url.searchParams.get("offset"), 0, 0, 100000),
      p_exclude_restricted: url.searchParams.get("exclude_restricted") !== "false",
    });
    if (error) throw new Error(error.message);
    return c.json({ interactions: data || [] }, 200, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Failed to load interactions" }, 500, corsHeaders);
  }
});

app.post("/crm/interactions", async (c) => {
  try {
    const parsed = crmInteractionSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "Invalid interaction payload", details: parsed.error.flatten() }, 400, corsHeaders);
    const body = parsed.data;
    const { data, error } = await supabase.rpc("crm_log_interaction", {
      p_contact_ids: body.contact_ids,
      p_kind: body.kind,
      p_occurred_at: body.occurred_at,
      p_summary: body.summary,
      p_duration_minutes: body.duration_minutes ?? null,
      p_privacy_tier: body.privacy_tier || "standard",
      p_thought_id: body.thought_id ?? null,
      p_actor: body.actor || "dashboard",
    });
    if (error) return c.json({ error: error.message }, crmRpcErrorStatus(error.message || ""), corsHeaders);
    return c.json(data || {}, 201, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Log interaction failed" }, 500, corsHeaders);
  }
});

app.patch("/crm/interactions/:interactionId", async (c) => {
  try {
    const parsed = crmInteractionPatchSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "Invalid interaction payload", details: parsed.error.flatten() }, 400, corsHeaders);
    const body = parsed.data;
    const { data, error } = await supabase.rpc("crm_update_interaction", {
      p_interaction_id: c.req.param("interactionId"),
      p_summary: body.summary ?? null,
      p_occurred_at: body.occurred_at ?? null,
      p_duration_minutes: body.duration_minutes ?? null,
      p_privacy_tier: body.privacy_tier ?? null,
      p_deleted: body.deleted ?? null,
      p_actor: body.actor || "dashboard",
    });
    if (error) return c.json({ error: error.message }, crmRpcErrorStatus(error.message || ""), corsHeaders);
    return c.json(data || {}, 200, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Update interaction failed" }, 500, corsHeaders);
  }
});

app.get("/crm/contacts/:id/timeline", async (c) => {
  try {
    const url = new URL(c.req.url);
    const id = c.req.param("id");
    const excludeRestricted = url.searchParams.get("exclude_restricted") !== "false";
    const limit = intParam(url.searchParams.get("limit"), 50, 1, 200);

    const [history, interactions, evidence] = await Promise.all([
      supabase.from("crm_contact_change_log").select("*").eq("contact_id", id).order("created_at", { ascending: false }).limit(limit),
      supabase.rpc("crm_contact_interactions", { p_contact_id: id, p_limit: limit, p_offset: 0, p_exclude_restricted: excludeRestricted }),
      supabase.rpc("crm_contact_field_evidence", { p_contact_id: id, p_field_key: null, p_exclude_restricted: excludeRestricted, p_limit: limit }),
    ]);

    const events: Array<{ type: string; at: string; data: Record<string, unknown> }> = [];
    for (const row of (history.data || []) as Array<Record<string, unknown>>) {
      events.push({ type: "change", at: String(row.created_at ?? ""), data: row });
    }
    for (const row of (interactions.data || []) as Array<Record<string, unknown>>) {
      events.push({ type: "interaction", at: String(row.occurred_at ?? row.created_at ?? ""), data: row });
    }
    for (const row of (evidence.data || []) as Array<Record<string, unknown>>) {
      events.push({ type: "evidence", at: String(row.created_at ?? ""), data: row });
    }
    events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return c.json({ timeline: events.slice(0, limit) }, 200, corsHeaders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Failed to load timeline" }, 500, corsHeaders);
  }
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
