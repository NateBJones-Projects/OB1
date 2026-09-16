// GET /functions/v1/list?limit=20&offset=0
//
// Returns most-recent thoughts (id, content, metadata, created_at) for
// browsing and for follow-on skills like ob1-digest. No embedding involved.

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { db } from "../_shared/db.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return jsonResponse({ error: "method not allowed" }, 405);
  }

  const url = new URL(req.url);
  const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit") ?? 20) | 0), 200);
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) | 0);

  const { data, error, count } = await db
    .from("thoughts")
    .select("id, content, metadata, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return jsonResponse({ error: `list failed: ${error.message}` }, 500);
  }

  return jsonResponse(
    { ok: true, limit, offset, total: count ?? null, results: data ?? [] },
    200,
  );
});
