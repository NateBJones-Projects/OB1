import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const BRAIN_API_KEY = Deno.env.get("BRAIN_API_KEY")!;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- CORS headers (for Chrome Extension access) ---

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-brain-key",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

// --- Shared helpers ---

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: text }),
  });
  if (!r.ok) throw new Error(`Embedding failed: ${r.status}`);
  const d = await r.json();
  return d.data[0].embedding;
}

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
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
        { role: "user", content: text },
      ],
    }),
  });
  const d = await r.json();
  try {
    return JSON.parse(d.choices[0].message.content);
  } catch {
    return { topics: ["uncategorized"], type: "observation" };
  }
}

// --- Action handlers ---

async function handleSave(
  content: string,
  clientMetadata?: Record<string, unknown>
): Promise<Response> {
  if (!content || !content.trim()) {
    return errorResponse("Missing 'content' field");
  }

  const [embedding, aiMetadata] = await Promise.all([
    getEmbedding(content),
    extractMetadata(content),
  ]);

  const metadata = {
    ...aiMetadata,
    source: clientMetadata?.source || "browser",
    ...(clientMetadata?.url ? { url: clientMetadata.url } : {}),
    ...(clientMetadata?.title ? { title: clientMetadata.title } : {}),
  };

  const { error } = await supabase.from("thoughts").insert({
    content,
    embedding,
    metadata,
  });

  if (error) {
    return errorResponse(`Supabase insert failed: ${error.message}`, 500);
  }

  return jsonResponse({ ok: true, message: "Thought saved", metadata });
}

async function handleSearch(query: string, source?: string): Promise<Response> {
  if (!query || !query.trim()) {
    return errorResponse("Missing 'query' field");
  }

  const queryEmbedding = await getEmbedding(query);

  const { data, error } = await supabase.rpc("match_thoughts", {
    query_embedding: queryEmbedding,
    match_threshold: 0.3,
    match_count: 10,
    filter: source ? { source } : {},
  });

  if (error) {
    return errorResponse(`Search failed: ${error.message}`, 500);
  }

  const results = (data || []).map(
    (t: {
      id: string;
      content: string;
      metadata: Record<string, unknown>;
      similarity: number;
      created_at: string;
    }) => ({
      id: t.id,
      content: t.content,
      metadata: t.metadata,
      similarity: t.similarity,
      created_at: t.created_at,
      source: (t.metadata as Record<string, unknown>)?.source || "",
    })
  );

  return jsonResponse({ ok: true, results });
}

async function handleStats(): Promise<Response> {
  const { count } = await supabase
    .from("thoughts")
    .select("*", { count: "exact", head: true });

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { count: todayCount } = await supabase
    .from("thoughts")
    .select("*", { count: "exact", head: true })
    .gte("created_at", todayStart.toISOString());

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const { count: weekCount } = await supabase
    .from("thoughts")
    .select("*", { count: "exact", head: true })
    .gte("created_at", weekStart.toISOString());

  return jsonResponse({
    ok: true,
    total: count || 0,
    today: todayCount || 0,
    this_week: weekCount || 0,
  });
}

async function handleDelete(id?: string, content?: string): Promise<Response> {
  if (id) {
    const { error } = await supabase.from("thoughts").delete().eq("id", id);
    if (error) return errorResponse(`Delete failed: ${error.message}`, 500);
    return jsonResponse({ ok: true, message: "Thought deleted" });
  }

  if (!content || !content.trim()) {
    return errorResponse("Missing 'id' or 'content' field");
  }

  const { data, error: selectError } = await supabase
    .from("thoughts")
    .select("id")
    .eq("content", content)
    .limit(1)
    .maybeSingle();

  if (selectError) return errorResponse(`Lookup failed: ${selectError.message}`, 500);
  if (!data) return jsonResponse({ ok: false, error: "Thought not found" }, 404);

  const { error: deleteError } = await supabase
    .from("thoughts")
    .delete()
    .eq("id", data.id);

  if (deleteError) return errorResponse(`Delete failed: ${deleteError.message}`, 500);
  return jsonResponse({ ok: true, message: "Thought deleted" });
}

async function handleUpdateStatus(id: string, status: string): Promise<Response> {
  if (!id) return errorResponse("Missing 'id' field");
  if (!status) return errorResponse("Missing 'status' field");

  const { data: existing, error: fetchErr } = await supabase
    .from("thoughts")
    .select("metadata")
    .eq("id", id)
    .single();

  if (fetchErr || !existing) {
    return errorResponse("Thought not found", 404);
  }

  const updatedMetadata = {
    ...(existing.metadata as Record<string, unknown>),
    status,
  };

  const { error } = await supabase
    .from("thoughts")
    .update({ metadata: updatedMetadata })
    .eq("id", id);

  if (error) return errorResponse(`Update failed: ${error.message}`, 500);
  return jsonResponse({ ok: true, message: `Status updated to "${status}"` });
}

// --- Main handler ---

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const apiKey = req.headers.get("x-brain-key");
  if (!apiKey || apiKey !== BRAIN_API_KEY) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "save":
        return await handleSave(body.content, body.metadata);
      case "search":
        return await handleSearch(body.query, body.source);
      case "stats":
        return await handleStats();
      case "delete":
        return await handleDelete(body.id, body.content);
      case "update_status":
        return await handleUpdateStatus(body.id, body.status);
      default:
        return errorResponse(
          `Unknown action: ${action}. Valid: save, search, stats, delete, update_status`
        );
    }
  } catch (err) {
    console.error("brain-api error:", err);
    return errorResponse("Internal server error", 500);
  }
});
