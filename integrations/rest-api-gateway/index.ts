/**
 * open-brain-rest — REST API gateway for Open Brain
 *
 * Provides standard REST endpoints for non-MCP clients.
 * Auth: ?key= query param, x-brain-key header, or Authorization: Bearer <key>
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── Embedding helper (same as MCP server) ────────────────────────────────────

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";

async function embedText(text: string): Promise<number[]> {
  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text.slice(0, 8000),
    }),
  });
  if (!res.ok) throw new Error(`Embedding failed: ${res.status}`);
  const json = await res.json();
  return json.data[0].embedding;
}

// ── Metadata extraction helper ───────────────────────────────────────────────

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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
            content: `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what's explicitly there.`,
          },
          { role: "user", content: text.slice(0, 4000) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Metadata extraction failed: ${res.status}`);
    const json = await res.json();
    return JSON.parse(json.choices[0].message.content);
  } catch {
    return { topics: ["uncategorized"], type: "observation" };
  }
}

// ── CORS headers ─────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-brain-key",
  "Content-Type": "application/json",
};

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (MCP_ACCESS_KEY && !isAuthorized(req)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = new URL(req.url);
  const path =
    url.pathname.replace(/^\/open-brain-rest/, "").replace(/\/+$/, "") || "/";

  try {
    if (path === "/health" || path === "/healthz" || path === "/") {
      return json({
        ok: true,
        service: "open-brain-rest",
        timestamp: new Date().toISOString(),
      });
    }

    if (path === "/search" && req.method === "POST") {
      return await handleSearch(req);
    }

    if (path === "/capture" && req.method === "POST") {
      return await handleCapture(req);
    }

    if (path === "/recent" && req.method === "GET") {
      return await handleRecent(url);
    }

    const thoughtMatch = path.match(/^\/thought\/([a-f0-9-]+)$/i);
    if (thoughtMatch) {
      const id = thoughtMatch[1];
      if (req.method === "GET") return await handleGetThought(id);
      if (req.method === "PUT") return await handleUpdateThought(id, req);
      if (req.method === "DELETE") return await handleDeleteThought(id);
    }

    if (path === "/stats") {
      return await handleStats(url);
    }

    return json(
      {
        error: "Not found",
        routes: [
          "/search",
          "/capture",
          "/recent",
          "/thought/:id",
          "/stats",
          "/health",
        ],
      },
      404
    );
  } catch (error) {
    console.error("open-brain-rest error", error);
    return json({ error: String(error) }, 500);
  }
});

// ── Search ───────────────────────────────────────────────────────────────────

async function handleSearch(req: Request): Promise<Response> {
  const body = (await req.json()) as Record<string, unknown>;
  const query = String(body.query ?? "").trim();
  const limit = Math.min(Math.max(Number(body.limit) || 10, 1), 50);
  const threshold = Math.min(
    Math.max(Number(body.threshold ?? body.min_similarity) || 0.5, 0),
    1
  );

  if (query.length < 2) {
    return json({ error: "query must be at least 2 characters" }, 400);
  }

  const queryEmbedding = await embedText(query);
  const { data, error } = await supabase.rpc("match_thoughts", {
    query_embedding: queryEmbedding,
    match_count: limit,
    match_threshold: threshold,
    filter: {},
  });

  if (error) throw new Error(`search failed: ${error.message}`);

  const results = (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id,
    content: row.content,
    similarity: row.similarity,
    metadata: row.metadata,
    created_at: row.created_at,
  }));

  return json({ results, count: results.length });
}

// ── Capture ──────────────────────────────────────────────────────────────────

async function handleCapture(req: Request): Promise<Response> {
  const body = (await req.json()) as Record<string, unknown>;
  const content = String(body.content ?? "").trim();

  if (!content) {
    return json({ error: "content is required" }, 400);
  }

  // Embed + extract metadata in parallel
  let embedding: number[] | null = null;
  let metadata: Record<string, unknown> = {
    topics: ["uncategorized"],
    type: "observation",
  };

  try {
    const [emb, meta] = await Promise.all([
      embedText(content),
      extractMetadata(content),
    ]);
    embedding = emb;
    metadata = meta;
  } catch (enrichError) {
    console.warn("Enrichment failed, continuing without:", enrichError);
  }

  // Add source info
  metadata.source = String(body.source ?? "rest_api");

  const insertData: Record<string, unknown> = {
    content,
    metadata,
  };

  if (embedding) {
    insertData.embedding = JSON.stringify(embedding);
  }

  const { data, error } = await supabase
    .from("thoughts")
    .insert(insertData)
    .select("id")
    .single();

  if (error) throw new Error(`capture failed: ${error.message}`);

  const thoughtType = String(metadata.type ?? "observation");

  return json({
    thought_id: data.id,
    action: "inserted",
    type: thoughtType,
    topics: metadata.topics ?? [],
    message: `Captured new thought as ${thoughtType}`,
  });
}

// ── Recent ───────────────────────────────────────────────────────────────────

async function handleRecent(url: URL): Promise<Response> {
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit")) || 20, 1),
    100
  );
  const type = url.searchParams.get("type")?.trim() || null;
  const topic = url.searchParams.get("topic")?.trim() || null;
  const days = Number(url.searchParams.get("days")) || null;

  let query = supabase
    .from("thoughts")
    .select("id, content, metadata, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (type) {
    query = query.contains("metadata", { type });
  }
  if (topic) {
    query = query.contains("metadata", { topics: [topic] });
  }
  if (days && days > 0) {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    query = query.gte("created_at", since);
  }

  const { data, error } = await query;
  if (error) throw new Error(`recent query failed: ${error.message}`);

  return json({ results: data ?? [], count: (data ?? []).length });
}

// ── Get Thought ──────────────────────────────────────────────────────────────

async function handleGetThought(id: string): Promise<Response> {
  const { data, error } = await supabase
    .from("thoughts")
    .select("id, content, metadata, created_at, updated_at")
    .eq("id", id)
    .single();

  if (error || !data) {
    return json({ error: `Thought ${id} not found` }, 404);
  }

  return json(data);
}

// ── Update Thought ───────────────────────────────────────────────────────────

async function handleUpdateThought(
  id: string,
  req: Request
): Promise<Response> {
  const body = (await req.json()) as Record<string, unknown>;
  const content = String(body.content ?? "").trim();

  if (!content) {
    return json({ error: "content is required" }, 400);
  }

  // Re-embed + re-extract metadata
  let embedding: number[] | null = null;
  let metadata: Record<string, unknown> | null = null;

  try {
    const [emb, meta] = await Promise.all([
      embedText(content),
      extractMetadata(content),
    ]);
    embedding = emb;
    metadata = meta;
  } catch {
    // Continue without — update content only
  }

  const updates: Record<string, unknown> = {
    content,
    updated_at: new Date().toISOString(),
  };

  if (embedding) {
    updates.embedding = JSON.stringify(embedding);
  }
  if (metadata) {
    updates.metadata = metadata;
  }

  const { error } = await supabase.from("thoughts").update(updates).eq("id", id);

  if (error) throw new Error(`update failed: ${error.message}`);

  return json({ id, action: "updated", message: `Thought ${id} updated` });
}

// ── Delete Thought ───────────────────────────────────────────────────────────

async function handleDeleteThought(id: string): Promise<Response> {
  const { data: existing, error: fetchErr } = await supabase
    .from("thoughts")
    .select("id")
    .eq("id", id)
    .single();

  if (fetchErr || !existing) {
    return json({ error: `Thought ${id} not found` }, 404);
  }

  const { error } = await supabase.from("thoughts").delete().eq("id", id);

  if (error) throw new Error(`delete failed: ${error.message}`);

  return json({ id, action: "deleted", message: `Thought ${id} deleted` });
}

// ── Stats ────────────────────────────────────────────────────────────────────

async function handleStats(url: URL): Promise<Response> {
  const days = Math.min(
    Math.max(Number(url.searchParams.get("days")) || 30, 1),
    365
  );
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from("thoughts")
    .select("metadata")
    .gte("created_at", since)
    .limit(5000);

  if (error) throw new Error(`stats query failed: ${error.message}`);

  const typeCounts: Record<string, number> = {};
  const topicCounts: Record<string, number> = {};

  for (const row of data ?? []) {
    const meta = (row as { metadata: Record<string, unknown> }).metadata ?? {};
    const type = String(meta.type ?? "unknown");
    typeCounts[type] = (typeCounts[type] ?? 0) + 1;

    const topics = Array.isArray(meta.topics) ? meta.topics : [];
    for (const t of topics) {
      const topic = String(t).trim().toLowerCase();
      if (topic) topicCounts[topic] = (topicCounts[topic] ?? 0) + 1;
    }
  }

  return json({
    total_thoughts: (data ?? []).length,
    window_days: days,
    types: typeCounts,
    top_topics: Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([topic, count]) => ({ topic, count })),
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isAuthorized(req: Request): boolean {
  const url = new URL(req.url);
  const key =
    req.headers.get("x-brain-key")?.trim() ||
    url.searchParams.get("key")?.trim() ||
    (req.headers.get("authorization") ?? "")
      .replace(/^Bearer\s+/i, "")
      .trim();
  return key === MCP_ACCESS_KEY;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: CORS_HEADERS,
  });
}
