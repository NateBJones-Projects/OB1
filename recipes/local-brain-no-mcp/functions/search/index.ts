// POST /functions/v1/search
//
// Body:
//   { query: string, match_threshold?: number, match_count?: number, filter?: object }
//
// Embeds the query server-side, then calls match_thoughts() over the
// thoughts table. Returns rows ordered by descending cosine similarity.
//
// Defaults mirror the canonical match_thoughts(): threshold 0.7, count 10.

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { embed, EmbedError } from "../_shared/embed.ts";
import { db } from "../_shared/db.ts";

interface SearchBody {
  query?: unknown;
  match_threshold?: unknown;
  match_count?: unknown;
  filter?: unknown;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method not allowed" }, 405);
  }

  let body: SearchBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "body must be valid JSON" }, 400);
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    return jsonResponse({ error: "query is required (non-empty string)" }, 400);
  }

  const match_threshold =
    typeof body.match_threshold === "number" ? body.match_threshold : 0.7;
  const match_count =
    typeof body.match_count === "number" ? Math.min(Math.max(1, body.match_count | 0), 100) : 10;
  const filter =
    body.filter && typeof body.filter === "object" && !Array.isArray(body.filter)
      ? body.filter
      : {};

  let vec: number[];
  try {
    vec = await embed(query);
  } catch (e) {
    if (e instanceof EmbedError) return jsonResponse({ error: e.message }, 502);
    throw e;
  }

  const { data, error } = await db.rpc("match_thoughts", {
    query_embedding: vec,
    match_threshold,
    match_count,
    filter,
  });

  if (error) {
    return jsonResponse(
      { error: `match_thoughts failed: ${error.message}`, details: error.details ?? null },
      500,
    );
  }

  return jsonResponse({ ok: true, query, count: (data ?? []).length, results: data ?? [] }, 200);
});
