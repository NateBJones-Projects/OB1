import type { Hono, Context } from "hono";
import { getEmbedding } from "../bedrock.js";
import { searchPoints, scrollPoints } from "../qdrant.js";
import type { QdrantFilter } from "../qdrant.js";
import { buildAclFilter } from "../acl.js";
import { getIdentity } from "../identity.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-brain-key, accept, mcp-session-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(value);
  return !isNaN(d.getTime());
}

export function mountSearchExternal(app: Hono): void {
  app.post("/search-external", async (c: Context) => {
    try {
      const identity = getIdentity(c);

      let body: {
        query?: string;
        tag?: string;
        type?: string;
        source?: string;
        date?: string;
        since?: string;
        until?: string;
        limit?: number;
        threshold?: number;
      };

      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON body" }, 400, corsHeaders);
      }

      // At least one filter field required
      if (
        !body.query &&
        !body.tag &&
        !body.type &&
        !body.source &&
        !body.date &&
        !body.since &&
        !body.until
      ) {
        return c.json(
          {
            error:
              "query, tag, type, source, date, since, or until is required",
          },
          400,
          corsHeaders,
        );
      }

      // Validate date fields
      if (body.date && !isValidDate(body.date)) {
        return c.json(
          { error: "date must be in YYYY-MM-DD format" },
          400,
          corsHeaders,
        );
      }
      if (body.since && !isValidDate(body.since)) {
        return c.json(
          { error: "since must be in YYYY-MM-DD format" },
          400,
          corsHeaders,
        );
      }
      if (body.until && !isValidDate(body.until)) {
        return c.json(
          { error: "until must be in YYYY-MM-DD format" },
          400,
          corsHeaders,
        );
      }

      // Browse mode — triggered by any non-query filter
      if (body.tag || body.type || body.source || body.date || body.since || body.until) {
        const conditions: unknown[] = [];

        if (body.tag) {
          conditions.push({ key: "topics", match: { value: body.tag } });
        }
        if (body.type) {
          conditions.push({ key: "type", match: { value: body.type } });
        }
        if (body.source) {
          conditions.push({ key: "source", match: { value: body.source } });
        }
        if (body.date) {
          conditions.push({
            key: "created_at",
            range: {
              gte: `${body.date}T00:00:00Z`,
              lte: `${body.date}T23:59:59Z`,
            },
          });
        } else {
          if (body.since) {
            conditions.push({
              key: "created_at",
              range: { gte: `${body.since}T00:00:00Z` },
            });
          }
          if (body.until) {
            conditions.push({
              key: "created_at",
              range: { lte: `${body.until}T23:59:59Z` },
            });
          }
        }

        const userFilter: QdrantFilter = { must: conditions };
        const filter = buildAclFilter(identity, userFilter);

        const hits = await scrollPoints({
          filter,
          limit: body.limit ?? 50,
          order_by: { key: "created_at", direction: "desc" },
        });

        const results = hits.map((hit) => ({
          id: hit.id,
          content: (hit.payload.content as string) ?? "",
          similarity: null,
          type: (hit.payload.type as string) ?? "",
          topics: (hit.payload.topics as string[]) ?? [],
          source: (hit.payload.source as string | null) ?? null,
          created_at: (hit.payload.created_at as string) ?? "",
        }));

        return c.json({ results, mode: "browse" }, 200, corsHeaders);
      }

      // Semantic search mode
      const vector = await getEmbedding(body.query!.trim());
      const filter = buildAclFilter(identity);

      const hits = await searchPoints({
        vector,
        filter,
        limit: body.limit ?? 10,
        score_threshold: body.threshold ?? 0.25,
      });

      const results = hits.map((hit) => ({
        id: hit.id,
        content: (hit.payload.content as string) ?? "",
        similarity: Math.round(hit.score * 100),
        type: (hit.payload.type as string) ?? "",
        topics: (hit.payload.topics as string[]) ?? [],
        source: (hit.payload.source as string | null) ?? null,
        created_at: (hit.payload.created_at as string) ?? "",
      }));

      return c.json({ results, mode: "search" }, 200, corsHeaders);
    } catch (err) {
      console.error("[search-external] error:", err);
      return c.json({ error: "Internal server error" }, 500, corsHeaders);
    }
  });
}
