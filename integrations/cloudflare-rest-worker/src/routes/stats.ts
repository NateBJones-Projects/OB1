import { Hono } from "hono";
import type { Env } from "../lib/types";
import { supabaseFor } from "../lib/supabase";
import { boolParam, fail, fromError, intParam } from "../lib/responses";

// brain_stats_aggregate (defined in schemas/enhanced-thoughts) returns
// { total, top_types, top_topics } — the dashboard expects
// { total_thoughts, window_days, types, top_topics }. So this route
// reshapes the RPC payload into the dashboard's StatsResponse shape:
//   - total                                → total_thoughts
//   - top_types: [{ type, count }]         → types: { [type]: count }
//   - top_topics: [{ topic, count }]       → top_topics (passthrough)
//   - window_days: 0 → "all", else number  → window_days
export const stats = new Hono<{ Bindings: Env }>();

interface StatsRpc {
  total?: number;
  top_types?: Array<{ type: string; count: number }>;
  top_topics?: Array<{ topic: string; count: number }>;
}

stats.get("/stats", async (c) => {
  try {
    const days = intParam(c.req.query("days"), 30);
    const excludeRestricted = boolParam(c.req.query("exclude_restricted"), true);
    const sb = supabaseFor(c.env);

    const { data, error } = await sb.rpc("brain_stats_aggregate", {
      p_since_days: days,
      p_exclude_restricted: excludeRestricted,
    });
    if (error) return fail(c, 500, error.message);

    const payload = (data ?? {}) as StatsRpc;
    const types: Record<string, number> = {};
    for (const row of payload.top_types ?? []) {
      if (row?.type) types[row.type] = row.count ?? 0;
    }

    return c.json({
      total_thoughts: payload.total ?? 0,
      window_days: days === 0 ? "all" : days,
      types,
      top_topics: payload.top_topics ?? [],
    });
  } catch (err) {
    return fromError(c, err);
  }
});
