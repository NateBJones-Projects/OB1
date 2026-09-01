import { Hono } from "hono";
import type { Env } from "../lib/types";
import { supabaseFor } from "../lib/supabase";
import { boolParam, fail, fromError, intParam } from "../lib/responses";

// Whitelist of columns the client is allowed to sort by. We pass `sort`
// straight to PostgREST .order(); without a whitelist a malicious client
// could pass arbitrary column names and probe the schema (low-risk under
// service-role + RLS, but still — minimum-privilege applied to inputs).
const SORTABLE_COLUMNS = new Set([
  "created_at",
  "updated_at",
  "importance",
  "quality_score",
  "type",
  "source_type",
  "status",
]);

// PostgREST reserves a special value 'restricted' for the sensitivity_tier
// column (defined in schemas/enhanced-thoughts). exclude_restricted=true is
// the default; the dashboard sets it to false only when a session has
// unlocked the restricted view via passphrase.
const RESTRICTED_TIER = "restricted";

export const thoughts = new Hono<{ Bindings: Env }>();

// GET /thoughts — paginated list with filters. Matches dashboards/.../lib/api.ts
// fetchThoughts(): page, per_page, type, source_type, importance_min,
// quality_score_max, sort, order, exclude_restricted. Also accepts `status`
// for the kanban view (added by fetchKanbanThoughts).
thoughts.get("/thoughts", async (c) => {
  try {
    const sb = supabaseFor(c.env);
    const q = c.req.query();

    const page = Math.max(1, intParam(q.page, 1));
    const perPage = intParam(q.per_page, 25, 100);
    const sort = q.sort && SORTABLE_COLUMNS.has(q.sort) ? q.sort : "created_at";
    const order = q.order === "asc" ? "asc" : "desc";
    const excludeRestricted = boolParam(q.exclude_restricted, true);

    let query = sb
      .from("thoughts")
      .select("*", { count: "exact" })
      .order(sort, { ascending: order === "asc" })
      .range((page - 1) * perPage, page * perPage - 1);

    if (q.type) query = query.eq("type", q.type);
    if (q.source_type) query = query.eq("source_type", q.source_type);
    if (q.status) query = query.eq("status", q.status);
    if (q.importance_min) {
      const n = Number(q.importance_min);
      if (Number.isFinite(n)) query = query.gte("importance", n);
    }
    if (q.quality_score_max !== undefined && q.quality_score_max !== "") {
      const n = Number(q.quality_score_max);
      if (Number.isFinite(n)) query = query.lte("quality_score", n);
    }
    if (excludeRestricted) query = query.neq("sensitivity_tier", RESTRICTED_TIER);

    const { data, error, count } = await query;
    if (error) return fail(c, 500, error.message);

    return c.json({
      data: data ?? [],
      total: count ?? 0,
      page,
      per_page: perPage,
    });
  } catch (err) {
    return fromError(c, err);
  }
});

// GET /thought/:id — single row. Returns 404 if the row doesn't exist OR if
// it's restricted and the caller didn't opt in to including restricted rows.
thoughts.get("/thought/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const excludeRestricted = boolParam(c.req.query("exclude_restricted"), true);
    const sb = supabaseFor(c.env);

    let query = sb.from("thoughts").select("*").eq("id", id);
    if (excludeRestricted) query = query.neq("sensitivity_tier", RESTRICTED_TIER);

    const { data, error } = await query.maybeSingle();
    if (error) return fail(c, 500, error.message);
    if (!data) return fail(c, 404, "Thought not found");

    return c.json(data);
  } catch (err) {
    return fromError(c, err);
  }
});

// PUT /thought/:id — partial update. The dashboard sends any subset of
// content/type/importance/status. Anything else in the body is ignored
// (defense against accidental schema bleed from the client).
thoughts.put("/thought/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const update: Record<string, unknown> = {};
    if (typeof body.content === "string") update.content = body.content;
    if (typeof body.type === "string") update.type = body.type;
    if (typeof body.importance === "number") update.importance = body.importance;
    // status: nullable — the dashboard sends `null` to clear the kanban status
    if (body.status === null || typeof body.status === "string") {
      update.status = body.status;
      update.status_updated_at = new Date().toISOString();
    }

    if (Object.keys(update).length === 0) {
      return fail(c, 400, "No updatable fields provided");
    }

    const sb = supabaseFor(c.env);
    const { data, error } = await sb
      .from("thoughts")
      .update(update)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) return fail(c, 500, error.message);
    if (!data) return fail(c, 404, "Thought not found");

    return c.json({
      id: data.id,
      action: "updated",
      message: `Updated fields: ${Object.keys(update).join(", ")}`,
    });
  } catch (err) {
    return fromError(c, err);
  }
});

// DELETE /thought/:id — hard delete. The dashboard's audit/duplicates pages
// rely on this. No soft-delete column exists in the schema; if we wanted
// soft deletes we'd add a column rather than fake them here.
thoughts.delete("/thought/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const sb = supabaseFor(c.env);
    const { error, count } = await sb
      .from("thoughts")
      .delete({ count: "exact" })
      .eq("id", id);
    if (error) return fail(c, 500, error.message);
    if ((count ?? 0) === 0) return fail(c, 404, "Thought not found");
    return c.body(null, 204);
  } catch (err) {
    return fromError(c, err);
  }
});
