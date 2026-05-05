import { createClient } from "@supabase/supabase-js";

const EMBEDDING_PROVIDER_URL = "https://openrouter.ai/api/v1/embeddings";
const EMBEDDING_MODEL = "openai/text-embedding-3-small";

export type SearchResult = {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
  created_at: string;
};

export type SearchResponse = {
  results: SearchResult[];
  elapsed_ms: number;
  error?: string;
};

// Default threshold tuned for text-embedding-3-small at our corpus scale
// (130–10k thoughts). Short single-word queries top out at ~0.30–0.35 cosine
// similarity, so a 0.4 default returns zero results for most one-word inputs.
// 0.2 keeps the long tail of weakly-related results visible — they sort to the
// bottom by similarity DESC anyway, and the user can ignore them.
//
// Sweep here only if MCP and dashboard search disagree on the same query.
const DEFAULT_THRESHOLD = 0.2;

/**
 * Core retrieval: embed query → match_thoughts RPC → return top-K rows.
 * Shared by Search-mode rendering and Ask-mode synthesis.
 */
export async function retrieveTopK(
  query: string,
  k: number,
  threshold = DEFAULT_THRESHOLD
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  if (trimmed.length > 2000) return [];
  const safeK = Math.min(50, Math.max(1, Math.floor(k)));
  const safeThreshold = Math.min(1, Math.max(0, threshold));

  const orKey = process.env.OPENROUTER_API_KEY;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!orKey || !url || !key) {
    throw new Error("Missing env config (OPENROUTER_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  }

  // Embed the query
  const embedRes = await fetch(EMBEDDING_PROVIDER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${orKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: trimmed }),
  });
  if (!embedRes.ok) {
    throw new Error(`Embedding API ${embedRes.status}`);
  }
  const embedJson = (await embedRes.json()) as { data?: Array<{ embedding: number[] }> };
  const embedding = embedJson.data?.[0]?.embedding;
  if (!embedding || !Array.isArray(embedding)) {
    throw new Error("Embedding response malformed");
  }

  // Match thoughts via Supabase RPC. The core RPC doesn't filter deleted_at,
  // so over-fetch and post-filter against a visible-id set.
  const supa = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const overFetch = Math.min(200, safeK * 4);
  const { data, error } = await supa.rpc("match_thoughts", {
    query_embedding: embedding as unknown as number[],
    match_threshold: safeThreshold,
    match_count: overFetch,
    filter: {},
  });
  if (error) {
    throw new Error(`match_thoughts: ${error.message}`);
  }
  const rows = (data ?? []) as SearchResult[];
  if (rows.length === 0) return rows;

  const ids = rows.map((r) => r.id);
  const { data: visible, error: visErr } = await supa
    .from("thoughts")
    .select("id")
    .in("id", ids)
    .is("deleted_at", null);
  if (visErr) {
    throw new Error(`match_thoughts visible: ${visErr.message}`);
  }
  const visibleSet = new Set((visible ?? []).map((r) => (r as { id: string }).id));
  return rows.filter((r) => visibleSet.has(r.id)).slice(0, safeK);
}

/**
 * Existing public API for Search-mode pages that want the full {results, elapsed_ms, error} shape.
 * Wraps retrieveTopK() with timing + error capture.
 */
export async function searchThoughts(
  query: string,
  k = 30,
  threshold = DEFAULT_THRESHOLD
): Promise<SearchResponse> {
  const start = Date.now();
  try {
    const results = await retrieveTopK(query, k, threshold);
    return { results, elapsed_ms: Date.now() - start };
  } catch (err) {
    return {
      results: [],
      elapsed_ms: Date.now() - start,
      error: (err as Error).message,
    };
  }
}
