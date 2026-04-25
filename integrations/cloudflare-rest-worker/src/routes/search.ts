import { Hono } from "hono";
import type { Env } from "../lib/types";
import { supabaseFor } from "../lib/supabase";
import { fail, fromError } from "../lib/responses";
import { generateEmbedding } from "../lib/embedding";

// match_thoughts (defined in docs/01-getting-started.md Step 2.3) returns the
// minimum vector-similarity payload — id, content, metadata, similarity,
// created_at — but NOT sensitivity_tier or the other enhanced columns the
// dashboard's Thought type expects. So semantic mode does two queries:
//   1. match_thoughts(emb, threshold, count, filter) → candidate IDs +
//      similarity scores
//   2. SELECT * FROM thoughts WHERE id IN (...) [AND sensitivity_tier !=
//      'restricted'] → full row payloads
// Then we stitch similarity back onto the rows by id and order.

const RESTRICTED_TIER = "restricted";

// We over-fetch from match_thoughts so post-filtering restricted rows still
// leaves enough survivors to return `limit` results. 3x is generous for typical
// "10% restricted" data; users with very high restricted ratios may see fewer
// results than `limit` — not incorrect, just lossy. Acceptable for v1.
const SEMANTIC_OVERFETCH = 3;
const MATCH_THRESHOLD = 0.5;

interface SearchBody {
  query?: string;
  mode?: "semantic" | "text";
  limit?: number;
  page?: number;
  exclude_restricted?: boolean;
}

export const search = new Hono<{ Bindings: Env }>();

search.post("/search", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as SearchBody;
    const query = (body.query ?? "").trim();
    if (!query) return fail(c, 400, "query is required");

    const mode = body.mode === "text" ? "text" : "semantic";
    const limit = clampInt(body.limit, 25, 1, 100);
    const page = Math.max(1, Math.floor(body.page ?? 1));
    const excludeRestricted = body.exclude_restricted !== false;
    const offset = (page - 1) * limit;
    const sb = supabaseFor(c.env);

    if (mode === "text") {
      // Over-fetch when restricted-filtering so we don't end up short. Cap at 200
      // to keep the GIN scan bounded.
      const fetchLimit = excludeRestricted
        ? Math.min(limit * SEMANTIC_OVERFETCH, 200)
        : limit;
      const { data, error } = await sb.rpc("search_thoughts_text", {
        p_query: query,
        p_limit: fetchLimit,
        p_filter: {},
        p_offset: offset,
      });
      if (error) return fail(c, 500, error.message);

      type Row = Record<string, unknown> & {
        sensitivity_tier?: string;
        rank?: number;
        total_count?: number;
      };
      const rows = (data ?? []) as Row[];
      const filtered = excludeRestricted
        ? rows.filter((r) => r.sensitivity_tier !== RESTRICTED_TIER)
        : rows;
      const sliced = filtered.slice(0, limit);
      // search_thoughts_text returns total_count on each row (denormalized).
      // Pull it from the first row; fall back to filtered length if absent.
      const total = Number(rows[0]?.total_count ?? filtered.length);
      const results = sliced.map(({ total_count: _t, ...rest }) => rest);

      return c.json({
        results,
        count: results.length,
        total,
        page,
        per_page: limit,
        total_pages: Math.max(1, Math.ceil(total / limit)),
        mode,
      });
    }

    // Semantic mode: embed → match_thoughts → fetch full rows → stitch.
    const embedding = await generateEmbedding(c.env, query);
    const { data: matches, error: matchErr } = await sb.rpc("match_thoughts", {
      query_embedding: embedding,
      match_threshold: MATCH_THRESHOLD,
      match_count: limit * SEMANTIC_OVERFETCH,
      filter: {},
    });
    if (matchErr) return fail(c, 500, matchErr.message);

    const candidates = (matches ?? []) as Array<{ id: string; similarity: number }>;
    if (candidates.length === 0) {
      return c.json({
        results: [],
        count: 0,
        total: 0,
        page,
        per_page: limit,
        total_pages: 0,
        mode,
      });
    }

    const ids = candidates.map((m) => m.id);
    let fullQuery = sb.from("thoughts").select("*").in("id", ids);
    if (excludeRestricted) fullQuery = fullQuery.neq("sensitivity_tier", RESTRICTED_TIER);
    const { data: fullRows, error: fullErr } = await fullQuery;
    if (fullErr) return fail(c, 500, fullErr.message);

    // Stitch similarity scores back, preserving match_thoughts order (most
    // similar first). Drop rows that didn't survive the restricted filter.
    const fullById = new Map<string, Record<string, unknown>>();
    for (const r of fullRows ?? []) fullById.set(r.id, r);
    const stitched: Array<Record<string, unknown> & { similarity: number }> = [];
    for (const m of candidates) {
      const row = fullById.get(m.id);
      if (!row) continue; // restricted, or deleted between calls
      stitched.push({ ...row, similarity: m.similarity });
      if (stitched.length >= limit) break;
    }

    // We don't know the absolute total without a second count query — and
    // counting "all thoughts above the cosine threshold" is what match_thoughts
    // already truncated. Report the candidate count as an approximation; for
    // pagination the dashboard mainly uses page/per_page anyway.
    const total = candidates.length;

    return c.json({
      results: stitched,
      count: stitched.length,
      total,
      page,
      per_page: limit,
      total_pages: Math.max(1, Math.ceil(total / limit)),
      mode,
    });
  } catch (err) {
    return fromError(c, err);
  }
});

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
