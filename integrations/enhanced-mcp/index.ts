import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

import {
  embedText,
  extractMetadata,
  detectSensitivity,
  resolveSensitivityTier,
  computeContentFingerprint,
  prepareThoughtPayload,
  applyEvergreenTag,
  normalizeStringArray,
  safeEmbedding,
  tableExists,
  escapeLikePattern,
  asString,
  asNumber,
  asInteger,
  asBoolean,
  asOptionalInteger,
  isRecord,
} from "./_shared/helpers.ts";

// ── Environment ───────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── Types ─────────────────────────────────────────────────────────────────

type ThoughtRow = {
  id: string;
  content: string;
  content_fingerprint?: string | null;
  type: string;
  sensitivity_tier: string;
  importance: number;
  quality_score: number;
  source_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
  similarity?: number;
  rank?: number;
};

// The base upsert_thought RPC (schemas/enhanced-thoughts) returns this shape.
// It is NOT { thought_id, action } — read `id` / `fingerprint` accordingly.
type UpsertThoughtResult = {
  id: string;
  fingerprint: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────

function toolSuccess(text: string, payload: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: payload,
  };
}

function toolFailure(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

function truncateContent(content: string, maxLen: number): string {
  if (!content || content.length <= maxLen) return content;
  return content.slice(0, maxLen) + "...";
}

// Citation helpers for the ChatGPT-compatible `search` / `fetch` tools.
// Connector surfaces (ChatGPT deep research, company knowledge) expect a
// read-only `search` returning {id,title,url} and a `fetch` returning the
// full document, so enhanced-mcp exposes both by those exact names.
const CITATION_BASE_URL =
  Deno.env.get("OPEN_BRAIN_CITATION_BASE_URL") || "https://openbrain.local/thoughts";

function thoughtTitle(content: string, createdAt?: string): string {
  const firstLine = content.replace(/\s+/g, " ").trim().slice(0, 80);
  const datePrefix = createdAt ? new Date(createdAt).toLocaleDateString() : "Open Brain";
  return firstLine ? `${datePrefix} - ${firstLine}` : `${datePrefix} thought`;
}

function thoughtUrl(id: string): string {
  return `${CITATION_BASE_URL.replace(/\/$/, "")}/${id}`;
}

// ── MCP Server ────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "open-brain-enhanced",
  version: "1.0.0",
});

// ── 1. brain_search_thoughts ────────────────────────────────────────────

server.registerTool(
  "brain_search_thoughts",
  {
    title: "Search Thoughts (Enhanced)",
    description:
      "Search over your stored thoughts. Supports semantic (vector) and text (full-text) modes. Namespaced with brain_ prefix to avoid collision with the stock search_thoughts tool when both MCP servers are connected.",
    inputSchema: z.object({
      query: z.string().min(2).describe("Search query"),
      mode: z
        .enum(["semantic", "text"])
        .default("semantic")
        .optional()
        .describe("Search mode: semantic (vector similarity) or text (full-text search)"),
      limit: z.number().int().min(1).max(50).default(8).optional(),
      offset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .optional()
        .describe("Pagination offset (text mode only)"),
      min_similarity: z
        .number()
        .min(0)
        .max(1)
        .default(0.3)
        .optional()
        .describe("Minimum similarity threshold (semantic mode only)"),
      start_date: z
        .string()
        .optional()
        .describe("ISO 8601 start date filter on created_at"),
      end_date: z
        .string()
        .optional()
        .describe("ISO 8601 end date filter on created_at"),
      metadata_filter: z.record(z.string(), z.unknown()).optional(),
    }),
  },
  async (params) => {
    try {
      const raw = params as Record<string, unknown>;
      const query = asString(raw.query, "").trim();
      const mode = asString(raw.mode, "semantic");
      const limit = asInteger(raw.limit, 8, 1, 50);
      const offset = asInteger(raw.offset, 0, 0, Number.MAX_SAFE_INTEGER);
      const minSimilarity = asNumber(raw.min_similarity, 0.3, 0, 1);
      const startDate = raw.start_date
        ? asString(raw.start_date, "").trim()
        : null;
      const endDate = raw.end_date
        ? asString(raw.end_date, "").trim()
        : null;
      const metadataFilter = isRecord(raw.metadata_filter)
        ? raw.metadata_filter
        : {};

      if (query.length < 2) {
        return toolFailure("query must be at least 2 characters");
      }

      if (mode === "text") {
        // search_thoughts_text applies `metadata @> p_filter` (same
        // containment semantics as match_thoughts), so synthetic directives
        // like exclude_restricted or date bounds would match zero rows. Pass
        // ONLY a genuine user metadata filter; enforce sensitivity + date
        // filtering client-side below (this RPC returns sensitivity_tier and
        // created_at, so both are available).
        const { data, error } = await supabase.rpc("search_thoughts_text", {
          p_query: query,
          p_limit: limit,
          p_filter: metadataFilter,
          p_offset: offset,
        });

        if (error) {
          throw new Error(`search_thoughts_text failed: ${error.message}`);
        }

        const allRows = (data ?? []) as ThoughtRow[];
        const totalCount =
          allRows.length > 0
            ? Number(
                (allRows[0] as Record<string, unknown>).total_count ??
                  allRows.length,
              )
            : 0;

        const rows = allRows
          .filter((row) => row.sensitivity_tier !== "restricted")
          .filter((row) => !startDate || row.created_at >= startDate)
          .filter((row) => !endDate || row.created_at <= endDate);

        if (rows.length === 0) {
          return toolSuccess("No matches found.", {
            results: [],
            pagination: {
              total: 0,
              offset,
              limit,
              has_more: false,
            },
          });
        }

        const lines = rows.map((row, index) => {
          const score = Number(row.rank ?? 0).toFixed(3);
          return `${offset + index + 1}. [${score}] (${row.type}) #${row.id} ${truncateContent(row.content, 500)}`;
        });

        return toolSuccess(lines.join("\n"), {
          results: rows,
          pagination: {
            total: totalCount,
            offset,
            limit,
            has_more: offset + rows.length < totalCount,
          },
        });
      }

      // Semantic search (default)
      //
      // The deployed match_thoughts RPC treats its `filter` argument as a
      // Postgres `metadata @> filter` containment test. Injecting synthetic
      // directives like {exclude_restricted:true} or date bounds therefore
      // makes it match ZERO rows — no thought's metadata contains those keys.
      // We pass ONLY a genuine user-supplied metadata filter to the RPC and
      // enforce sensitivity + date filtering client-side below.
      const dateFilterActive = !!(startDate || endDate);

      // Over-fetch when a date filter is active so the client-side post-filter
      // has headroom. 3x the requested limit is a reasonable compromise
      // between cost and correctness for dense recent brains.
      const fetchCount = dateFilterActive
        ? Math.min(Math.max(limit * 3, 50), 500)
        : Math.min(limit + 20, 200);

      const queryEmbedding = await embedText(query);
      const { data, error } = await supabase.rpc("match_thoughts", {
        query_embedding: queryEmbedding,
        match_count: fetchCount,
        match_threshold: minSimilarity,
        filter: metadataFilter,
      });

      if (error) {
        throw new Error(`match_thoughts failed: ${error.message}`);
      }

      const allRows = (data ?? []) as ThoughtRow[];

      // match_thoughts does not return sensitivity_tier, so restricted rows
      // cannot be filtered from its output directly. Look up the tiers for the
      // candidate ids and drop restricted thoughts before returning — the same
      // sensitivity guarantee the other read tools enforce. The lookup is
      // usually empty (restricted content is blocked from cloud capture).
      const candidateIds = allRows.map((row) => row.id);
      const restrictedIds = new Set<string>();
      if (candidateIds.length > 0) {
        const { data: tierRows } = await supabase
          .from("thoughts")
          .select("id")
          .in("id", candidateIds)
          .eq("sensitivity_tier", "restricted");
        for (const r of (tierRows ?? []) as { id: string }[]) {
          restrictedIds.add(r.id);
        }
      }

      const rows = allRows
        .filter((row) => !restrictedIds.has(row.id))
        .filter((row) => !startDate || row.created_at >= startDate)
        .filter((row) => !endDate || row.created_at <= endDate)
        .slice(0, limit);

      if (rows.length === 0) {
        return toolSuccess("No matches found.", { results: [] });
      }

      const lines = rows.map((row, index) => {
        const score = Number(row.similarity ?? 0).toFixed(3);
        const type = asString(row.metadata?.type, row.type ?? "unknown");
        return `${index + 1}. [${score}] (${type}) #${row.id} ${truncateContent(row.content, 500)}`;
      });

      return toolSuccess(lines.join("\n"), { results: rows });
    } catch (error) {
      console.error("brain_search_thoughts failed", error);
      return toolFailure(String(error));
    }
  },
);

// ── 2. brain_list_thoughts ──────────────────────────────────────────────

server.registerTool(
  "brain_list_thoughts",
  {
    title: "List Thoughts (Enhanced)",
    description:
      "Enhanced listing of thoughts with filters, sorting, and pagination. Namespaced with brain_ prefix to avoid collision with the stock list_thoughts tool when both MCP servers are connected.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(100).default(20).optional(),
      offset: z.number().int().min(0).default(0).optional(),
      type: z
        .string()
        .optional()
        .describe(
          "Filter by thought type (e.g. idea, decision, lesson, task)",
        ),
      source_type: z
        .string()
        .optional()
        .describe("Filter by source type (e.g. chatgpt_import, mcp)"),
      start_date: z
        .string()
        .optional()
        .describe("ISO 8601 start date filter on created_at"),
      end_date: z
        .string()
        .optional()
        .describe("ISO 8601 end date filter on created_at"),
      sort: z
        .enum(["created_at", "importance"])
        .default("created_at")
        .optional(),
      order: z.enum(["asc", "desc"]).default("desc").optional(),
    }),
  },
  async (params) => {
    try {
      const raw = params as Record<string, unknown>;
      const limit = asInteger(raw.limit, 20, 1, 100);
      const offset = asInteger(raw.offset, 0, 0, Number.MAX_SAFE_INTEGER);
      const type = raw.type ? asString(raw.type, "").trim() : null;
      const sourceType = raw.source_type
        ? asString(raw.source_type, "").trim()
        : null;
      const startDate = raw.start_date
        ? asString(raw.start_date, "").trim()
        : null;
      const endDate = raw.end_date
        ? asString(raw.end_date, "").trim()
        : null;
      const sort = asString(raw.sort, "created_at");
      const order = asString(raw.order, "desc");

      // Count query (parallel with data query)
      let countQuery = supabase
        .from("thoughts")
        .select("id", { count: "exact", head: true })
        .neq("sensitivity_tier", "restricted");
      if (type) countQuery = countQuery.eq("type", type);
      if (sourceType) countQuery = countQuery.eq("source_type", sourceType);
      if (startDate) countQuery = countQuery.gte("created_at", startDate);
      if (endDate) countQuery = countQuery.lte("created_at", endDate);

      // Data query
      let dataQuery = supabase
        .from("thoughts")
        .select(
          "id, content, type, source_type, importance, quality_score, sensitivity_tier, metadata, created_at, updated_at",
        )
        .neq("sensitivity_tier", "restricted")
        .order(sort, { ascending: order === "asc" })
        .range(offset, offset + limit - 1);

      if (type) dataQuery = dataQuery.eq("type", type);
      if (sourceType) dataQuery = dataQuery.eq("source_type", sourceType);
      if (startDate) dataQuery = dataQuery.gte("created_at", startDate);
      if (endDate) dataQuery = dataQuery.lte("created_at", endDate);

      const [countRes, dataRes] = await Promise.all([countQuery, dataQuery]);

      if (dataRes.error) {
        throw new Error(
          `brain_list_thoughts query failed: ${dataRes.error.message}`,
        );
      }

      const rows = (dataRes.data ?? []) as ThoughtRow[];
      const total = countRes.count ?? 0;
      const hasMore = offset + rows.length < total;

      const text =
        rows.length === 0
          ? "No thoughts found matching filters."
          : rows
              .map(
                (row, i) =>
                  `${offset + i + 1}. (${row.type}) #${row.id} ${truncateContent(row.content, 500)}`,
              )
              .join("\n");

      return toolSuccess(text, {
        results: rows,
        pagination: { total, offset, limit, has_more: hasMore },
      });
    } catch (error) {
      console.error("brain_list_thoughts failed", error);
      return toolFailure(String(error));
    }
  },
);

// ── 3. get_thought ──────────────────────────────────────────────────────

server.registerTool(
  "get_thought",
  {
    title: "Get Thought",
    description:
      "Fetch a thought by ID with its full metadata and provenance.",
    inputSchema: z.object({
      id: z.string().min(1).describe("Thought ID (UUID)"),
    }),
  },
  async (params) => {
    try {
      const id = asString((params as Record<string, unknown>).id, "").trim();

      if (!id) {
        return toolFailure("id is required");
      }

      const { data, error } = await supabase
        .from("thoughts")
        .select(
          "id, content, content_fingerprint, type, sensitivity_tier, importance, quality_score, source_type, metadata, created_at, updated_at",
        )
        .eq("id", id)
        .single();

      if (error || !data) {
        return toolFailure(`Thought #${id} not found`);
      }

      const row = data as ThoughtRow;

      if (row.sensitivity_tier === "restricted") {
        return toolFailure("This thought is restricted.");
      }

      const lines = [
        `(${row.type}) #${row.id}`,
        row.content,
        `Importance: ${row.importance} | Quality: ${row.quality_score} | Sensitivity: ${row.sensitivity_tier}`,
        `Source: ${row.source_type || "unknown"} | Created: ${row.created_at}`,
      ];

      // Show provenance from metadata if available
      const sources = row.metadata?.sources_seen;
      const agents = row.metadata?.agents_seen;
      if (Array.isArray(sources) && sources.length > 0) {
        lines.push(`Sources seen: ${sources.join(", ")}`);
      }
      if (Array.isArray(agents) && agents.length > 0) {
        lines.push(`Agents seen: ${agents.join(", ")}`);
      }

      return toolSuccess(lines.join("\n"), { thought: row });
    } catch (error) {
      console.error("get_thought failed", error);
      return toolFailure(String(error));
    }
  },
);

// ── 4. update_thought ───────────────────────────────────────────────────

server.registerTool(
  "update_thought",
  {
    title: "Update Thought",
    description:
      "Update the content of an existing thought. Re-generates embedding and metadata.",
    inputSchema: z.object({
      id: z.string().min(1).describe("Thought ID to update (UUID)"),
      content: z
        .string()
        .min(1)
        .describe("New content for the thought"),
    }),
  },
  async (params) => {
    try {
      const id = asString((params as Record<string, unknown>).id, "").trim();
      const content = asString(
        (params as Record<string, unknown>).content,
        "",
      ).trim();

      if (!id) {
        return toolFailure("id is required");
      }
      if (!content) {
        return toolFailure("content is required");
      }

      const { data: existing, error: fetchError } = await supabase
        .from("thoughts")
        .select("id, content, type, sensitivity_tier, importance, metadata")
        .eq("id", id)
        .single();

      if (fetchError || !existing) {
        return toolFailure(`Thought #${id} not found`);
      }

      if (existing.sensitivity_tier === "restricted") {
        return toolFailure("Cannot update restricted thought");
      }

      const oldType =
        existing.type ??
        asString(
          (existing.metadata as Record<string, unknown>)?.type,
          "unknown",
        );

      // Detect sensitivity on the NEW content first so we can reject
      // restricted updates before paying for embedding + classification.
      const sensitivity = detectSensitivity(content);
      if (sensitivity.tier === "restricted") {
        const reasons =
          sensitivity.reasons.length > 0
            ? ` Reasons: ${sensitivity.reasons.join(", ")}.`
            : "";
        return toolFailure(
          "Updated content contains restricted patterns (SSN, credit card, " +
            "API key, etc). Restricted content is local-only and cannot be " +
            "stored in cloud MCP." +
            reasons,
        );
      }

      const [embedding, extracted] = await Promise.all([
        embedText(content),
        extractMetadata(content),
      ]);

      const oldMetadata = isRecord(existing.metadata)
        ? existing.metadata
        : {};
      const fingerprint = await computeContentFingerprint(content);

      // Escalation-only tier resolution — never downgrade the stored tier.
      // If an existing `personal` thought is edited to remove the sensitive
      // phrasing, the row stays `personal` rather than silently becoming
      // `standard` and leaking into broad list/search responses. This
      // matches the invariant enforced in brain_capture_thought's pipeline
      // via resolveSensitivityTier (existing tier acts as the floor).
      const resolvedTier = resolveSensitivityTier(
        sensitivity.tier,
        existing.sensitivity_tier ?? undefined,
      );

      const metadata = {
        ...oldMetadata,
        type: extracted.type,
        summary: extracted.summary,
        topics: extracted.topics,
        tags: extracted.tags,
        people: extracted.people,
        action_items: extracted.action_items,
        confidence: extracted.confidence,
        sensitivity_reasons: sensitivity.reasons,
      };

      const finalizedMetadata = applyEvergreenTag(content, metadata);

      const { error: updateError } = await supabase
        .from("thoughts")
        .update({
          content,
          content_fingerprint: fingerprint,
          embedding,
          type: extracted.type,
          sensitivity_tier: resolvedTier,
          importance: existing.importance ?? 3,
          metadata: finalizedMetadata,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (updateError) {
        throw new Error(`update_thought failed: ${updateError.message}`);
      }

      const newType = asString(
        (finalizedMetadata as Record<string, unknown>).type,
        "unknown",
      );
      return toolSuccess(
        `Updated thought #${id}. Type: ${oldType} \u2192 ${newType}.`,
        { id, old_type: oldType, new_type: newType },
      );
    } catch (error) {
      console.error("update_thought failed", error);
      return toolFailure(String(error));
    }
  },
);

// ── 5. brain_capture_thought ────────────────────────────────────────────
//
// NOTE: `delete_thought` is intentionally not shipped in this initial PR.
// Hard `DELETE FROM thoughts WHERE id = ?` is irreversible and the
// companion schema (`schemas/enhanced-thoughts`) has no `deleted_at`
// tombstone column, so there is no safe soft-delete path today.
//
// The upstream maintainer's guidance on PR #127 was "depreciate and
// version rather than delete" — we will honour that in a follow-up
// once `deleted_at` + a `restore_thought` flow lands in the schema.
// See the README "Intentionally excluded" section for user-facing text.


server.registerTool(
  "brain_capture_thought",
  {
    title: "Capture Thought (Enhanced)",
    description:
      "Capture a new thought with automatic dedup by content fingerprint. Runs full enrichment pipeline including sensitivity detection, LLM-powered classification, and structured-capture parsing. Namespaced with brain_ prefix to avoid collision with the stock capture_thought tool when both MCP servers are connected.",
    inputSchema: z.object({
      content: z.string().min(1),
      source: z.string().default("mcp").optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }),
  },
  async (params) => {
    try {
      const raw = params as Record<string, unknown>;
      const content = asString(raw.content, "").trim();
      const source = asString(raw.source, "mcp").trim() || "mcp";
      const extraMetadata = isRecord(raw.metadata) ? raw.metadata : {};

      if (!content) {
        return toolFailure("content is required");
      }

      // Pre-flight sensitivity check — restricted content blocked from cloud
      const sensitivity = detectSensitivity(content);
      if (sensitivity.tier === "restricted") {
        return toolFailure(
          "Restricted thoughts are local-only and cannot be captured through cloud MCP.",
        );
      }

      // Fingerprint-first dedup: if the exact content was already captured,
      // short-circuit BEFORE paying for LLM classification + embedding.
      // The upsert_thought RPC also dedups, but it runs after we've already
      // spent a full enrichment cycle — this saves the cost entirely.
      const preFingerprint = await computeContentFingerprint(content);
      if (preFingerprint) {
        const { data: existing, error: existingError } = await supabase
          .from("thoughts")
          .select(
            "id, type, sensitivity_tier, importance, quality_score, source_type, metadata, content_fingerprint",
          )
          .eq("content_fingerprint", preFingerprint)
          .maybeSingle();

        if (!existingError && existing) {
          return toolSuccess(
            `Duplicate of thought #${existing.id} (${existing.type}). No new capture.`,
            {
              thought_id: existing.id,
              action: "deduplicated",
              content_fingerprint: existing.content_fingerprint,
              type: existing.type,
              sensitivity_tier: existing.sensitivity_tier,
              metadata: existing.metadata,
            },
          );
        }
      }

      // Use canonical pipeline with live LLM classification
      const prepared = await prepareThoughtPayload(content, {
        source,
        source_type: asString(extraMetadata.source_type, source),
        metadata: extraMetadata,
      });

      const { data, error } = await supabase.rpc("upsert_thought", {
        p_content: prepared.content,
        p_payload: {
          metadata: prepared.metadata,
          created_at: new Date().toISOString(),
        },
      });

      if (error) {
        throw new Error(`upsert_thought failed: ${error.message}`);
      }

      // The base upsert_thought RPC returns { id, fingerprint } and only
      // persists content, fingerprint, and metadata — it does NOT return
      // thought_id/action, nor does it write the structured columns or the
      // embedding. Read the real shape here, then populate type / source_type
      // / importance / quality_score / sensitivity_tier / embedding in a
      // follow-up update so this server is self-sufficient regardless of
      // which upsert_thought version is deployed. Without the embedding
      // write, brain_search_thoughts (semantic) would never match a
      // freshly captured thought — there is no async embedding backfill.
      const result = data as UpsertThoughtResult | null;
      if (!result?.id) {
        throw new Error("upsert_thought returned no id");
      }
      const thoughtId = result.id;

      const structuredUpdate: Record<string, unknown> = {
        type: prepared.type,
        source_type: prepared.source_type,
        importance: prepared.importance,
        quality_score: prepared.quality_score,
        sensitivity_tier: prepared.sensitivity_tier,
      };
      if (safeEmbedding(prepared.embedding)) {
        structuredUpdate.embedding = prepared.embedding;
      }

      const { error: enrichError } = await supabase
        .from("thoughts")
        .update(structuredUpdate)
        .eq("id", thoughtId);
      if (enrichError) {
        console.error("capture enrichment update failed", enrichError);
      }

      return toolSuccess(
        `Captured thought #${thoughtId} as ${prepared.type}.`,
        {
          thought_id: thoughtId,
          content_fingerprint: result.fingerprint,
          type: prepared.type,
          sensitivity_tier: prepared.sensitivity_tier,
          metadata: prepared.metadata,
        },
      );
    } catch (error) {
      console.error("brain_capture_thought failed", error);
      return toolFailure(String(error));
    }
  },
);

// ── 6. brain_thought_stats ──────────────────────────────────────────────

server.registerTool(
  "brain_thought_stats",
  {
    title: "Thought Statistics (Enhanced)",
    description:
      "Summaries of thought type/topic activity. Uses server-side aggregation for accurate counts across entire brain. Namespaced with brain_ prefix to avoid collision with the stock thought_stats tool when both MCP servers are connected.",
    inputSchema: z.object({
      since_days: z
        .number()
        .int()
        .min(0)
        .max(3650)
        .default(0)
        .optional(),
    }),
  },
  async (params) => {
    try {
      const sinceDays = asInteger(
        (params as Record<string, unknown>).since_days,
        0,
        0,
        3650,
      );

      const { data, error } = await supabase.rpc("brain_stats_aggregate", {
        p_since_days: sinceDays,
      });

      if (error) {
        throw new Error(`brain_stats query failed: ${error.message}`);
      }

      const aggregate = (data ?? {}) as Record<string, unknown>;
      const total =
        typeof aggregate.total === "number" ? aggregate.total : 0;
      const topTypes = Array.isArray(aggregate.top_types)
        ? (aggregate.top_types as Array<{ type: string; count: number }>)
        : [];
      const topTopics = Array.isArray(aggregate.top_topics)
        ? (aggregate.top_topics as Array<{ topic: string; count: number }>)
        : [];

      const windowLabel =
        sinceDays === 0 ? "all time" : `last ${sinceDays} day(s)`;
      const summary = [
        `Window: ${windowLabel}`,
        `Total thoughts: ${total}`,
        `Top types: ${topTypes.map((t) => `${t.type}=${t.count}`).join(", ") || "none"}`,
        `Top topics: ${topTopics.map((t) => `${t.topic}=${t.count}`).join(", ") || "none"}`,
      ].join("\n");

      return toolSuccess(summary, {
        total,
        top_types: topTypes,
        top_topics: topTopics,
      });
    } catch (error) {
      console.error("brain_thought_stats failed", error);
      return toolFailure(String(error));
    }
  },
);

// ── 7. search_thoughts_text ─────────────────────────────────────────────

server.registerTool(
  "search_thoughts_text",
  {
    title: "Full-Text Search",
    description:
      "Direct full-text search over thoughts. Simpler than search_thoughts for text-only queries.",
    inputSchema: z.object({
      query: z.string().min(2).describe("Search query"),
      limit: z.number().int().min(1).max(50).default(8).optional(),
      offset: z.number().int().min(0).default(0).optional(),
    }),
  },
  async (params) => {
    try {
      const raw = params as Record<string, unknown>;
      const query = asString(raw.query, "").trim();
      const limit = asInteger(raw.limit, 8, 1, 50);
      const offset = asInteger(raw.offset, 0, 0, Number.MAX_SAFE_INTEGER);

      if (query.length < 2) {
        return toolFailure("query must be at least 2 characters");
      }

      const { data, error } = await supabase.rpc("search_thoughts_text", {
        p_query: query,
        p_limit: limit,
        p_filter: {},
        p_offset: offset,
      });

      if (error) {
        throw new Error(`search_thoughts_text failed: ${error.message}`);
      }

      // The RPC's p_filter is a `metadata @> filter` containment test and
      // cannot express "exclude restricted", so filter it client-side using
      // the sensitivity_tier the RPC returns.
      const rows = ((data ?? []) as ThoughtRow[]).filter(
        (row) => row.sensitivity_tier !== "restricted",
      );

      if (rows.length === 0) {
        return toolSuccess("No matches found.", { results: [] });
      }

      const lines = rows.map((row, index) => {
        const score = Number(row.rank ?? 0).toFixed(3);
        return `${offset + index + 1}. [${score}] (${row.type}) #${row.id} ${truncateContent(row.content, 500)}`;
      });

      return toolSuccess(lines.join("\n"), { results: rows });
    } catch (error) {
      console.error("search_thoughts_text failed", error);
      return toolFailure(String(error));
    }
  },
);

// ── 8. count_thoughts ───────────────────────────────────────────────────

server.registerTool(
  "count_thoughts",
  {
    title: "Count Thoughts",
    description:
      "Count thoughts matching optional filters. Fast metadata query without returning content.",
    inputSchema: z.object({
      type: z.string().optional().describe("Filter by thought type"),
      source_type: z
        .string()
        .optional()
        .describe("Filter by source type"),
      start_date: z
        .string()
        .optional()
        .describe("ISO 8601 start date filter on created_at"),
      end_date: z
        .string()
        .optional()
        .describe("ISO 8601 end date filter on created_at"),
    }),
  },
  async (params) => {
    try {
      const raw = params as Record<string, unknown>;
      const type = raw.type ? asString(raw.type, "").trim() : null;
      const sourceType = raw.source_type
        ? asString(raw.source_type, "").trim()
        : null;
      const startDate = raw.start_date
        ? asString(raw.start_date, "").trim()
        : null;
      const endDate = raw.end_date
        ? asString(raw.end_date, "").trim()
        : null;

      let query = supabase
        .from("thoughts")
        .select("id", { count: "exact", head: true })
        .neq("sensitivity_tier", "restricted");
      if (type) query = query.eq("type", type);
      if (sourceType) query = query.eq("source_type", sourceType);
      if (startDate) query = query.gte("created_at", startDate);
      if (endDate) query = query.lte("created_at", endDate);

      const { count, error } = await query;
      if (error) {
        throw new Error(`count_thoughts query failed: ${error.message}`);
      }

      const filters: Record<string, string> = {};
      if (type) filters.type = type;
      if (sourceType) filters.source_type = sourceType;
      if (startDate) filters.start_date = startDate;
      if (endDate) filters.end_date = endDate;

      const filterDesc =
        Object.keys(filters).length > 0
          ? ` (filters: ${Object.entries(filters).map(([k, v]) => `${k}=${v}`).join(", ")})`
          : "";

      return toolSuccess(`Count: ${count ?? 0}${filterDesc}`, {
        count: count ?? 0,
        filters,
      });
    } catch (error) {
      console.error("count_thoughts failed", error);
      return toolFailure(String(error));
    }
  },
);

// ── 9. related_thoughts ─────────────────────────────────────────────────

server.registerTool(
  "related_thoughts",
  {
    title: "Related Thoughts",
    description:
      "Find thoughts related to a given thought via the knowledge graph connections.",
    inputSchema: z.object({
      thought_id: z
        .string()
        .min(1)
        .describe("Thought ID (UUID) to find connections for"),
      limit: z.number().int().min(1).max(20).default(10).optional(),
    }),
  },
  async (params) => {
    try {
      const raw = params as Record<string, unknown>;
      const thoughtId = asString(raw.thought_id, "").trim();
      const limit = asInteger(raw.limit, 10, 1, 20);

      if (!thoughtId) {
        return toolFailure("thought_id is required");
      }

      const { data, error } = await supabase.rpc(
        "get_thought_connections",
        {
          p_thought_id: thoughtId,
          p_limit: limit,
        },
      );

      if (error) {
        // Graceful degradation if the RPC doesn't exist
        if (
          error.message.includes("function") &&
          error.message.includes("does not exist")
        ) {
          return toolSuccess(
            "The get_thought_connections RPC is not available. " +
              "Install schemas/knowledge-graph to enable related thought discovery.",
            { available: false },
          );
        }
        throw new Error(
          `get_thought_connections failed: ${error.message}`,
        );
      }

      const rows = (data ?? []) as Record<string, unknown>[];

      if (rows.length === 0) {
        return toolSuccess(
          `No related thoughts found for #${thoughtId}.`,
          { results: [], thought_id: thoughtId },
        );
      }

      const lines = rows.map(
        (row, index) =>
          `${index + 1}. #${row.id} (${row.type}) ${truncateContent(asString(row.content, ""), 300)}`,
      );

      return toolSuccess(
        `Found ${rows.length} related thought(s) for #${thoughtId}:\n${lines.join("\n")}`,
        { results: rows, thought_id: thoughtId },
      );
    } catch (error) {
      console.error("related_thoughts failed", error);
      return toolFailure(String(error));
    }
  },
);

// ── 10. ops_capture_status (schema-backed: needs Smart Ingest Pipeline) ─

server.registerTool(
  "ops_capture_status",
  {
    title: "Ops Capture Status",
    description:
      "Operational health checks for ingestion jobs. Requires the Smart Ingest Pipeline schema.",
    inputSchema: z.object({
      sample_limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .optional(),
      include_samples: z.boolean().default(true).optional(),
    }),
  },
  async (params) => {
    try {
      const raw = params as Record<string, unknown>;
      const sampleLimit = asInteger(raw.sample_limit, 20, 1, 100);
      const includeSamples = asBoolean(raw.include_samples, true);

      // Schema guard: check if ingestion_jobs table exists
      const hasTable = await tableExists(supabase, "ingestion_jobs");
      if (!hasTable) {
        return toolSuccess(
          "This tool requires the Smart Ingest Pipeline schema. " +
            "Install schemas/smart-ingest to enable operational monitoring of ingestion jobs.",
          { available: false },
        );
      }

      // Parallel queries: recent jobs + count by status
      const [recentRes, totalCountRes, completedCountRes, errorCountRes] =
        await Promise.all([
          supabase
            .from("ingestion_jobs")
            .select(
              "id, source_label, status, extracted_count, added_count, skipped_count, created_at, completed_at",
            )
            .order("created_at", { ascending: false })
            .limit(sampleLimit),
          supabase
            .from("ingestion_jobs")
            .select("id", { count: "exact", head: true }),
          supabase
            .from("ingestion_jobs")
            .select("id", { count: "exact", head: true })
            .eq("status", "complete"),
          supabase
            .from("ingestion_jobs")
            .select("id", { count: "exact", head: true })
            .eq("status", "error"),
        ]);

      if (recentRes.error) {
        throw new Error(
          `ingestion_jobs query failed: ${recentRes.error.message}`,
        );
      }

      const jobs = (recentRes.data ?? []) as Record<string, unknown>[];
      const totalJobs = totalCountRes.count ?? 0;
      const completedJobs = completedCountRes.count ?? 0;
      const errorJobs = errorCountRes.count ?? 0;

      const statusSummary = [
        `Ingestion Job Status`,
        `Total jobs: ${totalJobs}`,
        `Completed: ${completedJobs}`,
        `Errors: ${errorJobs}`,
        `Recent samples: ${jobs.length}`,
      ];

      const payload: Record<string, unknown> = {
        available: true,
        total_jobs: totalJobs,
        completed_jobs: completedJobs,
        error_jobs: errorJobs,
      };

      if (includeSamples) {
        payload.recent_jobs = jobs;
      }

      return toolSuccess(statusSummary.join("\n"), payload);
    } catch (error) {
      console.error("ops_capture_status failed", error);
      return toolFailure(String(error));
    }
  },
);

// ── 11. graph_search (schema-backed: needs Knowledge Graph) ─────────────

server.registerTool(
  "graph_search",
  {
    title: "Graph Search",
    description:
      "Search entities by name or type. Returns entities from the knowledge graph with their thought counts.",
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .describe("Search term for entity name"),
      entity_type: z
        .string()
        .optional()
        .describe(
          "Filter: person, project, topic, tool, organization, place",
        ),
      limit: z.number().int().min(1).max(50).default(20).optional(),
    }),
  },
  async (params) => {
    try {
      const raw = params as Record<string, unknown>;
      const query = asString(raw.query, "").trim();
      const entityType = raw.entity_type
        ? asString(raw.entity_type, "").trim()
        : null;
      const limit = asInteger(raw.limit, 20, 1, 50);

      if (!query) {
        return toolFailure("query is required");
      }

      // Schema guard: check if entities table exists
      const hasTable = await tableExists(supabase, "entities");
      if (!hasTable) {
        return toolSuccess(
          "This tool requires the Knowledge Graph schema. " +
            "Install schemas/knowledge-graph to enable entity search and graph exploration.",
          { available: false },
        );
      }

      // Escape LIKE wildcards in the user query — unescaped `%` or `_` turns
      // a search for "100%" into the ILIKE pattern `%100%%`, matching every
      // entity whose name contains "100" instead of the literal substring.
      const safeQuery = escapeLikePattern(query);
      let q = supabase
        .from("entities")
        .select(
          "id, entity_type, canonical_name, aliases, metadata, first_seen_at, last_seen_at",
        )
        .ilike("canonical_name", `%${safeQuery}%`)
        .order("last_seen_at", { ascending: false })
        .limit(limit);

      if (entityType) {
        q = q.eq("entity_type", entityType);
      }

      const { data: entities, error } = await q;
      if (error) {
        throw new Error(`graph_search failed: ${error.message}`);
      }

      if (!entities || entities.length === 0) {
        return toolSuccess("No entities found.", {
          results: [],
          total: 0,
        });
      }

      // Get thought counts for each entity, excluding restricted thoughts
      const entityIds = entities.map(
        (e: Record<string, unknown>) => e.id as number,
      );
      const { data: countRows, error: countError } = await supabase
        .from("thought_entities")
        .select("entity_id, thoughts!inner(sensitivity_tier)")
        .in("entity_id", entityIds)
        .neq("thoughts.sensitivity_tier", "restricted");

      if (countError) {
        console.error("thought count query failed", countError);
      }

      const countMap = new Map<number, number>();
      if (countRows) {
        for (const row of countRows) {
          const eid = (row as Record<string, unknown>).entity_id as number;
          countMap.set(eid, (countMap.get(eid) ?? 0) + 1);
        }
      }

      const results = entities.map((e: Record<string, unknown>) => ({
        ...e,
        thought_count: countMap.get(e.id as number) ?? 0,
      }));

      const lines = results.map(
        (e: Record<string, unknown>) =>
          `#${e.id} [${e.entity_type}] ${e.canonical_name} (${e.thought_count} thoughts, last seen ${e.last_seen_at})`,
      );

      return toolSuccess(
        `Found ${results.length} entities:\n${lines.join("\n")}`,
        { results, total: results.length },
      );
    } catch (error) {
      console.error("graph_search failed", error);
      return toolFailure(String(error));
    }
  },
);

// ── 12. entity_detail (schema-backed: needs Knowledge Graph) ────────────

server.registerTool(
  "entity_detail",
  {
    title: "Entity Detail",
    description:
      "Get full entity info with connected thoughts and edges from the knowledge graph.",
    inputSchema: z.object({
      entity_id: z.number().int().min(1).describe("Entity ID"),
    }),
  },
  async (params) => {
    try {
      const raw = params as Record<string, unknown>;
      const entityId = asInteger(
        raw.entity_id,
        0,
        1,
        Number.MAX_SAFE_INTEGER,
      );

      if (!entityId) {
        return toolFailure("entity_id is required");
      }

      // Schema guard
      const hasTable = await tableExists(supabase, "entities");
      if (!hasTable) {
        return toolSuccess(
          "This tool requires the Knowledge Graph schema. " +
            "Install schemas/knowledge-graph to enable entity detail views.",
          { available: false },
        );
      }

      // Fetch entity
      const { data: entity, error: entityError } = await supabase
        .from("entities")
        .select("*")
        .eq("id", entityId)
        .maybeSingle();

      if (entityError) {
        throw new Error(`entity fetch failed: ${entityError.message}`);
      }
      if (!entity) {
        return toolFailure(`Entity #${entityId} not found`);
      }

      // Fetch linked thoughts (excluding restricted), limit 20 most recent
      const { data: thoughtLinks, error: tlError } = await supabase
        .from("thought_entities")
        .select("thought_id, mention_role, confidence")
        .eq("entity_id", entityId)
        .limit(100);

      if (tlError) {
        throw new Error(
          `thought_entities fetch failed: ${tlError.message}`,
        );
      }

      let thoughts: Record<string, unknown>[] = [];
      if (thoughtLinks && thoughtLinks.length > 0) {
        const thoughtIds = (
          thoughtLinks as Record<string, unknown>[]
        ).map((tl) => tl.thought_id as number);
        const { data: thoughtRows, error: tError } = await supabase
          .from("thoughts")
          .select("id, content, type, created_at, sensitivity_tier")
          .in("id", thoughtIds)
          .neq("sensitivity_tier", "restricted")
          .order("created_at", { ascending: false })
          .limit(20);

        if (tError) {
          console.error("thoughts fetch failed", tError);
        } else if (thoughtRows) {
          const roleMap = new Map<number, string>();
          for (const tl of thoughtLinks as Record<string, unknown>[]) {
            roleMap.set(
              tl.thought_id as number,
              tl.mention_role as string,
            );
          }
          thoughts = (thoughtRows as Record<string, unknown>[]).map(
            (t) => ({
              id: t.id,
              content: truncateContent(asString(t.content, ""), 300),
              type: t.type,
              created_at: t.created_at,
              mention_role:
                roleMap.get(t.id as number) ?? "mentioned",
            }),
          );
        }
      }

      // Fetch edges (both directions)
      const { data: edgesFrom, error: efError } = await supabase
        .from("edges")
        .select("id, to_entity_id, relation, support_count, confidence")
        .eq("from_entity_id", entityId);

      const { data: edgesTo, error: etError } = await supabase
        .from("edges")
        .select(
          "id, from_entity_id, relation, support_count, confidence",
        )
        .eq("to_entity_id", entityId);

      if (efError) console.error("edges from fetch failed", efError);
      if (etError) console.error("edges to fetch failed", etError);

      // Collect all connected entity IDs to resolve names
      const connectedIds = new Set<number>();
      for (const e of (edgesFrom ?? []) as Record<string, unknown>[]) {
        connectedIds.add(e.to_entity_id as number);
      }
      for (const e of (edgesTo ?? []) as Record<string, unknown>[]) {
        connectedIds.add(e.from_entity_id as number);
      }

      const nameMap = new Map<number, { name: string; type: string }>();
      if (connectedIds.size > 0) {
        const { data: connEntities } = await supabase
          .from("entities")
          .select("id, canonical_name, entity_type")
          .in("id", Array.from(connectedIds));
        if (connEntities) {
          for (const ce of connEntities as Record<string, unknown>[]) {
            nameMap.set(ce.id as number, {
              name: ce.canonical_name as string,
              type: ce.entity_type as string,
            });
          }
        }
      }

      const edges = [
        ...((edgesFrom ?? []) as Record<string, unknown>[]).map((e) => ({
          edge_id: e.id,
          direction: "outgoing",
          relation: e.relation,
          other_entity_id: e.to_entity_id,
          other_entity_name:
            nameMap.get(e.to_entity_id as number)?.name ?? "unknown",
          other_entity_type:
            nameMap.get(e.to_entity_id as number)?.type ?? "unknown",
          support_count: e.support_count,
          confidence: e.confidence,
        })),
        ...((edgesTo ?? []) as Record<string, unknown>[]).map((e) => ({
          edge_id: e.id,
          direction: "incoming",
          relation: e.relation,
          other_entity_id: e.from_entity_id,
          other_entity_name:
            nameMap.get(e.from_entity_id as number)?.name ?? "unknown",
          other_entity_type:
            nameMap.get(e.from_entity_id as number)?.type ?? "unknown",
          support_count: e.support_count,
          confidence: e.confidence,
        })),
      ];

      const entityData = entity as Record<string, unknown>;
      const summary = [
        `Entity #${entityData.id}: ${entityData.canonical_name} [${entityData.entity_type}]`,
        `Aliases: ${JSON.stringify(entityData.aliases)}`,
        `First seen: ${entityData.first_seen_at}, Last seen: ${entityData.last_seen_at}`,
        `Connected thoughts: ${thoughts.length}`,
        `Edges: ${edges.length}`,
      ];

      if (edges.length > 0) {
        summary.push("Connections:");
        for (const edge of edges) {
          summary.push(
            `  ${edge.direction === "outgoing" ? "\u2192" : "\u2190"} ${edge.relation} \u2192 ${edge.other_entity_name} [${edge.other_entity_type}] (support: ${edge.support_count})`,
          );
        }
      }

      return toolSuccess(summary.join("\n"), {
        entity: entityData,
        thoughts,
        edges,
      });
    } catch (error) {
      console.error("entity_detail failed", error);
      return toolFailure(String(error));
    }
  },
);

// ── 13. ops_source_monitor (schema-backed: needs ops views) ────────────

server.registerTool(
  "ops_source_monitor",
  {
    title: "Ops Source Monitor",
    description:
      "Per-source ingestion counts, errors, and recent failures. Requires operational monitoring views.",
    inputSchema: z.object({
      sample_limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(25)
        .optional(),
    }),
  },
  async (params) => {
    try {
      const raw = params as Record<string, unknown>;
      const sampleLimit = asInteger(raw.sample_limit, 25, 1, 100);

      // Schema guard: check that one of the views this tool actually reads
      // exists. The previous guard checked `ops_source_volume_24h`, a view
      // name that exists in neither this repo nor the brain-health-monitoring
      // recipe — so once the recipe WAS installed, this tool still returned
      // "install required views". Use the real view name.
      const hasView = await tableExists(
        supabase,
        "ops_source_ingestion_24h",
      );
      if (!hasView) {
        return toolSuccess(
          "This tool requires operational monitoring views. " +
            "Install the brain-health-monitoring recipe to enable per-source monitoring.",
          { available: false },
        );
      }

      const [
        sourceIngestionResponse,
        sourceErrorsResponse,
        sourceFailuresResponse,
      ] = await Promise.all([
        supabase
          .from("ops_source_ingestion_24h")
          .select("source, status, events_24h")
          .order("source", { ascending: true })
          .limit(250),
        supabase
          .from("ops_source_errors_24h")
          .select("source, error_events_24h")
          .order("source", { ascending: true })
          .limit(100),
        supabase
          .from("ops_source_recent_failures")
          .select(
            "id, source, status, reason, source_event_id, metadata, created_at",
          )
          .order("created_at", { ascending: false })
          .limit(sampleLimit),
      ]);

      // If one of the individual views is missing (partial install), fall
      // back to a graceful "not fully installed" response rather than
      // raising — the tool should light up in best-effort mode.
      const viewMissing = (err: { message?: string } | null | undefined) =>
        !!err?.message &&
        /(does not exist|not found|relation .* does not exist)/i.test(err.message);

      if (
        viewMissing(sourceIngestionResponse.error) ||
        viewMissing(sourceErrorsResponse.error) ||
        viewMissing(sourceFailuresResponse.error)
      ) {
        return toolSuccess(
          "Ops monitoring views are only partially installed. " +
            "Verify the brain-health-monitoring recipe has been applied in full.",
          {
            available: false,
            ingestion_ok: !viewMissing(sourceIngestionResponse.error),
            errors_ok: !viewMissing(sourceErrorsResponse.error),
            failures_ok: !viewMissing(sourceFailuresResponse.error),
          },
        );
      }

      if (sourceIngestionResponse.error) {
        throw new Error(
          `ops_source_ingestion_24h query failed: ${sourceIngestionResponse.error.message}`,
        );
      }
      if (sourceErrorsResponse.error) {
        throw new Error(
          `ops_source_errors_24h query failed: ${sourceErrorsResponse.error.message}`,
        );
      }
      if (sourceFailuresResponse.error) {
        throw new Error(
          `ops_source_recent_failures query failed: ${sourceFailuresResponse.error.message}`,
        );
      }

      type SourceIngestionRow = {
        source: string;
        status: string;
        events_24h: number;
      };
      type SourceErrorRow = {
        source: string;
        error_events_24h: number;
      };

      const sourceIngestionRows = (sourceIngestionResponse.data ??
        []) as SourceIngestionRow[];
      const sourceErrorRows = (sourceErrorsResponse.data ??
        []) as SourceErrorRow[];
      const sourceFailureRows = (sourceFailuresResponse.data ??
        []) as Record<string, unknown>[];

      const statusBySource = new Map<string, string>();
      for (const row of sourceIngestionRows) {
        if (!statusBySource.has(row.source)) {
          statusBySource.set(row.source, "PASS");
        }
      }
      for (const row of sourceErrorRows) {
        if (Number(row.error_events_24h) > 0) {
          statusBySource.set(row.source, "ATTN");
        }
      }

      const sourceStatuses = [...statusBySource.entries()]
        .map(([source, status]) => ({ source, status }))
        .sort((a, b) => a.source.localeCompare(b.source));

      const summaryLines = [
        "Per-Source Monitor (24h)",
        ...sourceStatuses.map((row) => `${row.source}: ${row.status}`),
        `Recent failure samples: ${sourceFailureRows.length}`,
      ];

      return toolSuccess(summaryLines.join("\n"), {
        available: true,
        source_statuses: sourceStatuses,
        source_ingestion_24h: sourceIngestionRows,
        source_errors_24h: sourceErrorRows,
        source_recent_failures: sourceFailureRows,
      });
    } catch (error) {
      console.error("ops_source_monitor failed", error);
      return toolFailure(String(error));
    }
  },
);

// ── 14. search (ChatGPT/connector compatibility) ────────────────────────

server.registerTool(
  "search",
  {
    title: "Search Open Brain",
    description:
      "Search Open Brain memories by meaning. Read-only compatibility tool for connector surfaces (e.g. ChatGPT deep research / company knowledge) that expect a `search` tool returning {id, title, url}.",
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      query: z.string().describe("The search query to run against Open Brain thoughts"),
    }),
  },
  async (params) => {
    try {
      const query = asString((params as Record<string, unknown>).query, "").trim();
      if (!query) return toolFailure("query is required");

      const qEmb = await embedText(query);
      const { data, error } = await supabase.rpc("match_thoughts", {
        query_embedding: qEmb,
        match_threshold: 0.5,
        match_count: 10,
        filter: {},
      });
      if (error) return toolFailure(`Search error: ${error.message}`);

      const results = ((data ?? []) as ThoughtRow[]).map((t) => ({
        id: t.id,
        title: thoughtTitle(t.content, t.created_at),
        url: thoughtUrl(t.id),
      }));

      // ChatGPT expects the results serialized as JSON in the text block.
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ results }) }],
        structuredContent: { results },
      };
    } catch (error) {
      console.error("search failed", error);
      return toolFailure(String(error));
    }
  },
);

// ── 15. fetch (ChatGPT/connector compatibility) ─────────────────────────

server.registerTool(
  "fetch",
  {
    title: "Fetch Open Brain Thought",
    description:
      "Fetch one Open Brain thought by ID (use after `search`). Read-only compatibility tool returning {id, title, text, url, metadata} for citation. Restricted thoughts are not returned.",
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      id: z.string().describe("The Open Brain thought ID returned by the search tool"),
    }),
  },
  async (params) => {
    try {
      const id = asString((params as Record<string, unknown>).id, "").trim();
      if (!id) return toolFailure("id is required");

      const { data, error } = await supabase
        .from("thoughts")
        .select("id, content, metadata, sensitivity_tier, created_at, updated_at")
        .eq("id", id)
        .single();
      if (error || !data) {
        return toolFailure(`Fetch error: ${error?.message ?? "thought not found"}`);
      }

      const thought = data as ThoughtRow & { updated_at?: string | null };
      if (thought.sensitivity_tier === "restricted") {
        return toolFailure("This thought is restricted.");
      }

      const document = {
        id: thought.id,
        title: thoughtTitle(thought.content, thought.created_at),
        text: thought.content,
        url: thoughtUrl(thought.id),
        metadata: {
          ...thought.metadata,
          created_at: thought.created_at,
          updated_at: thought.updated_at,
        },
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(document) }],
        structuredContent: document,
      };
    } catch (error) {
      console.error("fetch failed", error);
      return toolFailure(String(error));
    }
  },
);

// ── 16. capture_derived_thought (provenance write) ──────────────────────
//
// Separate from brain_capture_thought so the everyday capture hot path is
// never touched. Runs the same enhanced pipeline (sensitivity block +
// classification + structured columns + embedding) and additionally writes
// the top-level provenance columns (derived_from / derivation_* / supersedes)
// that upsert_thought does not persist.

server.registerTool(
  "capture_derived_thought",
  {
    title: "Capture Derived Thought",
    description:
      "Save a synthesized/derived artifact (digest, wiki, research summary, report) to Open Brain WITH its provenance. Use instead of brain_capture_thought ONLY when the artifact was derived from other thoughts already in the brain. Records parent thought IDs so 'why do I believe this?' and 'what uses this?' stay answerable.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: z.object({
      content: z.string().min(1).describe(
        "The derived artifact text — a clear, standalone statement that will make sense when retrieved later"),
      derived_from: z.array(z.string()).optional().describe(
        "Parent thought UUIDs this artifact was synthesized from. Non-UUID refs are moved to metadata.provenance.unresolved_refs rather than rejected"),
      derivation_layer: z.enum(["primary", "derived"]).optional().describe(
        "'derived' for a synthesized artifact (default when derived_from is provided)"),
      derivation_method: z.enum(["synthesis"]).optional().describe(
        "How it was produced. Defaults to 'synthesis' when derived_from is provided"),
      supersedes: z.string().uuid().optional().describe(
        "UUID of a prior thought this one replaces (e.g. a regenerated digest)"),
    }),
  },
  async (params) => {
    try {
      const raw = params as Record<string, unknown>;
      const content = asString(raw.content, "").trim();
      if (!content) return toolFailure("content is required");

      // Restricted content is local-only — block before any write.
      if (detectSensitivity(content).tier === "restricted") {
        return toolFailure(
          "Restricted thoughts are local-only and cannot be captured through cloud MCP.",
        );
      }

      // Partition derived_from into valid UUID parents vs. unresolved refs so
      // a single legacy ref (e.g. "#412") never rejects the whole capture —
      // trace_provenance casts each element ::uuid and would raise on non-UUID.
      const UUID_RE =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const rawRefs = Array.isArray(raw.derived_from)
        ? (raw.derived_from as unknown[]).map((r) => String(r).trim())
        : [];
      const derivedFrom = rawRefs.filter((r) => UUID_RE.test(r));
      const unresolvedRefs = rawRefs.filter((r) => !UUID_RE.test(r));

      const layer = (raw.derivation_layer as string | undefined) ??
        (derivedFrom.length > 0 ? "derived" : undefined);
      const method = (raw.derivation_method as string | undefined) ??
        (derivedFrom.length > 0 ? "synthesis" : undefined);
      const supersedes = raw.supersedes as string | undefined;

      const hasProvenance =
        derivedFrom.length > 0 || unresolvedRefs.length > 0 ||
        layer !== undefined || method !== undefined || supersedes !== undefined;

      // Fold a provenance mirror into metadata so it survives upsert_thought's
      // conflict-time `metadata || EXCLUDED.metadata` merge on re-capture; the
      // top-level columns are (over)written in the follow-up update below.
      const provenanceMeta: Record<string, unknown> = hasProvenance
        ? {
            provenance: {
              ...(derivedFrom.length ? { derived_from: derivedFrom } : {}),
              ...(layer ? { derivation_layer: layer } : {}),
              ...(method ? { derivation_method: method } : {}),
              ...(supersedes ? { supersedes } : {}),
              ...(unresolvedRefs.length ? { unresolved_refs: unresolvedRefs } : {}),
            },
          }
        : {};

      const prepared = await prepareThoughtPayload(content, {
        source: "mcp",
        metadata: provenanceMeta,
      });

      const { data, error } = await supabase.rpc("upsert_thought", {
        p_content: prepared.content,
        p_payload: {
          metadata: prepared.metadata,
          created_at: new Date().toISOString(),
        },
      });
      if (error) throw new Error(`upsert_thought failed: ${error.message}`);
      const result = data as UpsertThoughtResult | null;
      if (!result?.id) throw new Error("upsert_thought returned no id");
      const thoughtId = result.id;

      // Single follow-up update: structured columns + embedding (upsert_thought
      // writes none of them) AND the top-level provenance columns.
      const patch: Record<string, unknown> = {
        type: prepared.type,
        source_type: prepared.source_type,
        importance: prepared.importance,
        quality_score: prepared.quality_score,
        sensitivity_tier: prepared.sensitivity_tier,
      };
      if (safeEmbedding(prepared.embedding)) patch.embedding = prepared.embedding;
      if (derivedFrom.length) patch.derived_from = derivedFrom;
      if (layer) patch.derivation_layer = layer;
      if (method) patch.derivation_method = method;
      if (supersedes) patch.supersedes = supersedes;

      const { error: patchError } = await supabase
        .from("thoughts")
        .update(patch)
        .eq("id", thoughtId);
      if (patchError) {
        return toolFailure(
          `Captured thought ${thoughtId}, but failed to write provenance/embedding: ${patchError.message}`,
        );
      }

      const parts = [`Captured derived thought #${thoughtId} as ${prepared.type}`];
      if (derivedFrom.length) parts.push(`from ${derivedFrom.length} parent(s)`);
      if (layer) parts.push(`[layer=${layer}${method ? `, method=${method}` : ""}]`);
      if (supersedes) parts.push(`supersedes ${supersedes}`);
      if (unresolvedRefs.length) {
        parts.push(
          `— ${unresolvedRefs.length} non-UUID ref(s) moved to ` +
          `metadata.provenance.unresolved_refs: ${unresolvedRefs.join(", ")}`);
      }
      return toolSuccess(parts.join(" "), {
        thought_id: thoughtId,
        type: prepared.type,
        derived_from: derivedFrom,
        derivation_layer: layer ?? null,
        derivation_method: method ?? null,
        supersedes: supersedes ?? null,
        unresolved_refs: unresolvedRefs,
      });
    } catch (error) {
      console.error("capture_derived_thought failed", error);
      return toolFailure(String(error));
    }
  },
);

// ── 17. trace_provenance ────────────────────────────────────────────────
//   Walk derived_from upward and return the ancestor tree.

server.registerTool(
  "trace_provenance",
  {
    title: "Trace Provenance",
    description:
      "Walk a thought's derivation chain upward — show the atomic thoughts that fed this derived thought. Returns a tree. Restricted ancestors are redacted.",
    inputSchema: z.object({
      thought_id: z.string().uuid().describe("UUID of the thought to trace"),
      depth: z.number().int().min(1).max(10).optional()
        .describe("Max ancestor levels to walk (default 3, max 10)"),
    }),
  },
  async (params) => {
    try {
      const raw = params as Record<string, unknown>;
      const rootId = String(raw.thought_id ?? "").trim();
      const maxDepth = Math.min(Math.max(1, Number(raw.depth ?? 3) || 3), 10);
      const NODE_CAP = 250;

      if (!rootId) return toolFailure("thought_id is required");

      // Over-fetch by one so truncation can be detected exactly.
      const { data, error } = await supabase.rpc("trace_provenance", {
        p_thought_id: rootId,
        p_max_depth: maxDepth,
        p_node_cap: NODE_CAP + 1,
      });
      if (error) return toolFailure(`trace_provenance failed: ${error.message}`);

      type TraceRow = {
        thought_id: string;
        depth: number;
        parent_id: string | null;
        content: string | null;
        type: string | null;
        source_type: string | null;
        derivation_method: string | null;
        derivation_layer: string | null;
        sensitivity_tier: string | null;
        created_at: string;
        cycle: boolean;
        restricted: boolean;
      };

      const rawRows = (data ?? []) as TraceRow[];
      const truncated = rawRows.length > NODE_CAP;
      const rows = truncated ? rawRows.slice(0, NODE_CAP) : rawRows;

      type Node = {
        thought_id: string;
        depth?: number;
        cycle?: boolean;
        restricted?: boolean;
        type?: string | null;
        source_type?: string | null;
        derivation_method?: string | null;
        derivation_layer?: string | null;
        created_at?: string;
        content_preview?: string | null;
        parents?: Node[];
      };

      // SQL contract: anchor row has parent_id = NULL; each step row encodes
      // the edge "parent_id (child) ← thought_id (parent)". Index child→parent
      // ROWS so per-path depth/metadata is preserved in a DAG.
      const anchorRow = rows.find((r) => r.thought_id === rootId && r.parent_id === null);
      const parentRowsByChild = new Map<string, TraceRow[]>();
      for (const r of rows) {
        if (r.parent_id) {
          const arr = parentRowsByChild.get(r.parent_id) ?? [];
          arr.push(r);
          parentRowsByChild.set(r.parent_id, arr);
        }
      }

      if (!anchorRow) return toolFailure(`Thought ${rootId} not found`);

      function buildFromRow(r: TraceRow, ancestors: Set<string>): Node {
        const nextAncestors = new Set(ancestors);
        nextAncestors.add(r.thought_id);
        const parentRows = parentRowsByChild.get(r.thought_id) ?? [];
        const parents = parentRows.map((pr) => {
          // Ancestor-path cycle: emit a stub without recursing.
          if (nextAncestors.has(pr.thought_id)) {
            return { thought_id: pr.thought_id, cycle: true } as Node;
          }
          return buildFromRow(pr, nextAncestors);
        });
        return {
          thought_id: r.thought_id,
          depth: r.depth,
          cycle: r.cycle,
          restricted: r.restricted,
          type: r.type,
          source_type: r.source_type,
          derivation_method: r.derivation_method,
          derivation_layer: r.derivation_layer,
          created_at: r.created_at,
          content_preview: r.content ? r.content.slice(0, 200) : null,
          parents,
        };
      }

      const root = buildFromRow(anchorRow, new Set<string>());
      const nodeCount = rows.length;
      const summary =
        `Traced provenance of ${rootId} (depth=${maxDepth}, ${nodeCount} nodes visited` +
        (truncated ? `, truncated at node_cap=${NODE_CAP}` : "") + `).`;

      let payloadText: string;
      try {
        payloadText = JSON.stringify({
          tree: root,
          node_count: nodeCount,
          depth_limit: maxDepth,
          node_cap: NODE_CAP,
          truncated,
        }, null, 2);
      } catch (stringifyErr) {
        console.error("trace_provenance: JSON.stringify failed", stringifyErr);
        return toolFailure(
          `trace_provenance: failed to serialize tree for ${rootId} ` +
          `(${String(stringifyErr)}). The provenance graph may contain a cycle ` +
          `the detector missed — re-run with a smaller depth or file a bug.`,
        );
      }

      return toolSuccess(`${summary}\n\n${payloadText}`, {
        tree: root,
        node_count: nodeCount,
        depth_limit: maxDepth,
        node_cap: NODE_CAP,
        truncated,
      });
    } catch (error) {
      console.error("trace_provenance failed", error);
      return toolFailure(String(error));
    }
  },
);

// ── 18. find_derivatives ────────────────────────────────────────────────
//   Single-level reverse lookup — "what downstream thoughts cite this one?"

server.registerTool(
  "find_derivatives",
  {
    title: "Find Derivatives",
    description:
      "Find all thoughts derived from this one (single-level reverse lookup). Answers 'what uses this thought?'. Restricted-tier derivatives are always hidden.",
    inputSchema: z.object({
      thought_id: z.string().uuid().describe("UUID of the thought whose derivatives to find"),
      limit: z.number().int().min(1).max(500).optional()
        .describe("Max rows to return (default 100, max 500)"),
    }),
  },
  async (params) => {
    try {
      const raw = params as Record<string, unknown>;
      const id = String(raw.thought_id ?? "").trim();
      const limit = Math.min(Math.max(1, Number(raw.limit ?? 100) || 100), 500);

      if (!id) return toolFailure("thought_id is required");

      const { data, error } = await supabase.rpc("find_derivatives", {
        p_thought_id: id,
        p_limit: limit,
      });
      if (error) return toolFailure(`find_derivatives failed: ${error.message}`);

      type DerivativeRow = {
        id: string;
        content: string | null;
        type: string | null;
        source_type: string | null;
        derivation_method: string | null;
        derivation_layer: string | null;
        sensitivity_tier: string | null;
        created_at: string;
      };

      const rows = (data ?? []) as DerivativeRow[];
      const summary = rows.length === 0
        ? `No derivatives found for ${id}.`
        : `Found ${rows.length} derivative(s) of ${id}:\n` +
          rows.slice(0, 10).map((r) =>
            `  ${r.id} [${r.source_type ?? "?"}] ${String(r.content ?? "").slice(0, 100)}`
          ).join("\n");

      return toolSuccess(
        `${summary}\n\n${JSON.stringify({ derivatives: rows, count: rows.length }, null, 2)}`,
        { derivatives: rows, count: rows.length },
      );
    } catch (error) {
      console.error("find_derivatives failed", error);
      return toolFailure(String(error));
    }
  },
);

// ── Hono App with Auth + CORS ─────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-brain-key, accept, mcp-session-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
};

const app = new Hono();

/**
 * Constant-time compare for the MCP access key. Uses
 * `crypto.subtle.timingSafeEqual` where available (Deno >= 1.41), falling
 * back to a manual XOR loop on older runtimes. Both paths short-circuit
 * on length mismatch — for fixed-length 32-char keys this is acceptable;
 * a variable-length key deployment should prefer the SubtleCrypto path
 * which operates on equal-length Uint8Array buffers.
 */
function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const enc = new TextEncoder();
  const aBuf = enc.encode(a);
  const bBuf = enc.encode(b);
  const subtle = (crypto as unknown as {
    subtle?: { timingSafeEqual?: (x: ArrayBufferView, y: ArrayBufferView) => boolean };
  }).subtle;
  if (typeof subtle?.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(aBuf, bBuf);
  }
  // Fallback: manual XOR loop — constant-time across equal-length inputs.
  let diff = 0;
  for (let i = 0; i < aBuf.length; i++) diff |= aBuf[i] ^ bBuf[i];
  return diff === 0;
}

// CORS preflight -- required for browser/Electron-based clients (Claude Desktop, claude.ai)
app.options("*", (c) => {
  return c.text("ok", 200, corsHeaders);
});

app.all("*", async (c) => {
  // Reject non-POST requests up front. This server is stateless over
  // streamable HTTP: there is no standalone SSE stream (GET) or session
  // termination (DELETE) to serve. Without this guard a GET falls through to
  // StreamableHTTPTransport.handleRequest, which parks it on an SSE stream
  // that never emits and never closes. mcp-remote always sends a GET probe
  // (OAuth discovery) before its initialize POST, so that probe hangs and
  // the MCP handshake times out at the client with no error server-side.
  if (c.req.method !== "POST") {
    return c.json({ error: "Method not allowed" }, 405, { ...corsHeaders, Allow: "POST, OPTIONS" });
  }

  // Header-only auth: `x-brain-key: <key>` or `Authorization: Bearer <key>`.
  // We do NOT accept the key via a `?key=` query parameter — URL query
  // strings end up in Supabase/CDN/proxy access logs, which leaks the
  // credential into places that don't get rotated with the secret itself.
  const headerKey = c.req.header("x-brain-key");
  const authHeader = c.req.header("authorization") ?? c.req.header("Authorization");
  const bearerKey = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
  const provided = headerKey ?? bearerKey;
  if (!provided || !timingSafeEqualStrings(provided, MCP_ACCESS_KEY)) {
    return c.json(
      { error: "Invalid or missing access key" },
      401,
      corsHeaders,
    );
  }

  // Fix: Claude Desktop connectors don't send the Accept header that
  // StreamableHTTPTransport requires. Build a patched request if missing.
  if (!c.req.header("accept")?.includes("text/event-stream")) {
    const headers = new Headers(c.req.raw.headers);
    headers.set("Accept", "application/json, text/event-stream");
    const patched = new Request(c.req.raw.url, {
      method: c.req.raw.method,
      headers,
      body: c.req.raw.body,
      // @ts-ignore -- duplex required for streaming body in Deno
      duplex: "half",
    });
    Object.defineProperty(c.req, "raw", {
      value: patched,
      writable: true,
    });
  }

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

Deno.serve(app.fetch);
