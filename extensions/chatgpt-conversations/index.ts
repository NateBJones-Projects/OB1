/**
 * Extension: ChatGPT Conversation History MCP Server
 *
 * Provides tools for querying imported ChatGPT conversation history:
 * - list_conversations: Browse by date, type, topic with progressive disclosure
 * - search_conversations: Semantic search over 128w summary embeddings
 */

import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

async function getEmbedding(text: string): Promise<number[]> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");

  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
    }),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`OpenRouter embeddings failed: ${r.status} ${msg}`);
  }
  const d = await r.json();
  return d.data[0].embedding;
}

/** Map detail level to the corresponding summary column name */
function summaryColumn(detail: string): string {
  const valid = ["8w", "16w", "32w", "64w", "128w"];
  if (!valid.includes(detail)) return "summary_32w";
  return `summary_${detail}`;
}

const app = new Hono();

app.post("*", async (c) => {
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
    Object.defineProperty(c.req, "raw", { value: patched, writable: true });
  }

  const key = c.req.query("key") || c.req.header("x-access-key");
  const expected = Deno.env.get("MCP_ACCESS_KEY");
  if (!key || key !== expected) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const userId = Deno.env.get("DEFAULT_USER_ID") || null;

  const server = new McpServer(
    { name: "chatgpt-conversations", version: "1.0.0" },
  );

  // -------------------------------------------------------
  // Tool 1: list_conversations
  // Browse conversations by date, type, topic with pyramid summaries
  // -------------------------------------------------------
  server.tool(
    "list_conversations",
    "Browse imported ChatGPT conversations by date range, type, or topic. Returns pyramid summaries at the requested detail level. Use for temporal queries like 'what was I working on in October?' or 'show my strategy conversations'.",
    {
      after: z.string().optional().describe("Show conversations after this date (ISO 8601, e.g. '2025-10-01')"),
      before: z.string().optional().describe("Show conversations before this date (ISO 8601, e.g. '2025-11-01')"),
      type: z.string().optional().describe("Filter by conversation_type (e.g. 'product_research', 'technical_architecture', 'business_strategy')"),
      topic: z.string().optional().describe("Filter by key_topics array contains (e.g. 'database', 'architecture')"),
      limit: z.number().optional().default(20).describe("Max results (default 20)"),
      detail: z.enum(["8w", "16w", "32w", "64w", "128w"]).optional().default("32w").describe("Pyramid summary level: 8w=label, 16w=sentence, 32w=card, 64w=paragraph, 128w=full"),
    },
    async ({ after, before, type, topic, limit, detail }) => {
      try {
        const col = summaryColumn(detail);

        // Select only the columns we need, including the requested summary level
        let queryBuilder = supabase
          .from("chatgpt_conversations")
          .select(`title, create_time, conversation_type, ${col}, key_topics, conversation_url`);

        // Filter by user_id if set — use .or() to also match NULL user_id rows
        // (rows imported without USER_ID env var set)
        if (userId) {
          queryBuilder = queryBuilder.or(`user_id.eq.${userId},user_id.is.null`);
        }

        if (after) {
          queryBuilder = queryBuilder.gte("create_time", after);
        }
        if (before) {
          queryBuilder = queryBuilder.lt("create_time", before);
        }
        if (type) {
          queryBuilder = queryBuilder.eq("conversation_type", type);
        }
        if (topic) {
          queryBuilder = queryBuilder.contains("key_topics", [topic]);
        }

        const { data, error } = await queryBuilder
          .order("create_time", { ascending: false })
          .limit(limit);

        if (error) {
          throw new Error(`Failed to list conversations: ${error.message}`);
        }

        if (!data || data.length === 0) {
          const filters = [];
          if (after) filters.push(`after ${after}`);
          if (before) filters.push(`before ${before}`);
          if (type) filters.push(`type=${type}`);
          if (topic) filters.push(`topic=${topic}`);
          const filterDesc = filters.length ? ` (${filters.join(", ")})` : "";
          return {
            content: [{ type: "text", text: `No conversations found${filterDesc}.` }],
          };
        }

        const results = data.map((conv: Record<string, unknown>, i: number) => {
          const date = conv.create_time
            ? new Date(conv.create_time as string).toLocaleDateString()
            : "unknown date";
          const summary = conv[col] || "(no summary at this detail level)";
          const topics = Array.isArray(conv.key_topics) && conv.key_topics.length
            ? `Topics: ${(conv.key_topics as string[]).join(", ")}`
            : "";

          const parts = [
            `--- ${i + 1}. ${conv.title || "Untitled"} ---`,
            `Date: ${date}`,
            `Type: ${conv.conversation_type || "unknown"}`,
          ];
          if (topics) parts.push(topics);
          parts.push(`Summary (${detail}): ${summary}`);
          if (conv.conversation_url) parts.push(`URL: ${conv.conversation_url}`);
          return parts.join("\n");
        });

        return {
          content: [{
            type: "text",
            text: `Found ${data.length} conversation(s):\n\n${results.join("\n\n")}`,
          }],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: errorMessage }) }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------
  // Tool 2: search_conversations
  // Semantic search over 128w summary embeddings
  // -------------------------------------------------------
  server.tool(
    "search_conversations",
    "Semantic search over conversation history using 128w summary embeddings. Returns conversations ranked by relevance with pyramid summaries at the requested detail level. Use for queries like 'find conversations about database migration' or 'architecture discussions'.",
    {
      query: z.string().describe("What to search for (natural language query)"),
      limit: z.number().optional().default(10).describe("Max results (default 10)"),
      threshold: z.number().optional().default(0.5).describe("Similarity cutoff 0-1 (default 0.5)"),
      detail: z.enum(["8w", "16w", "32w", "64w", "128w"]).optional().default("64w").describe("Pyramid summary level: 8w=label, 16w=sentence, 32w=card, 64w=paragraph, 128w=full"),
    },
    async ({ query, limit, threshold, detail }) => {
      try {
        const qEmb = await getEmbedding(query);
        const { data, error } = await supabase.rpc("match_conversations", {
          query_embedding: qEmb,
          match_threshold: threshold,
          match_count: limit,
          p_user_id: null, // NULL matches all rows; RLS handles multi-tenant isolation
        });

        if (error) {
          return {
            content: [{ type: "text", text: `Search error: ${error.message}` }],
            isError: true,
          };
        }

        if (!data || data.length === 0) {
          return {
            content: [{ type: "text", text: `No conversations found matching "${query}".` }],
          };
        }

        const col = summaryColumn(detail);

        const results = data.map(
          (
            conv: {
              title: string;
              create_time: string;
              conversation_type: string;
              summary_8w: string;
              summary_16w: string;
              summary_32w: string;
              summary_64w: string;
              summary_128w: string;
              key_topics: string[];
              people_mentioned: string[];
              conversation_url: string;
              similarity: number;
            },
            i: number,
          ) => {
            const date = conv.create_time
              ? new Date(conv.create_time).toLocaleDateString()
              : "unknown date";
            const summary = (conv as Record<string, unknown>)[col] || conv.summary_64w || "(no summary)";
            const topics = Array.isArray(conv.key_topics) && conv.key_topics.length
              ? `Topics: ${conv.key_topics.join(", ")}`
              : "";
            const people = Array.isArray(conv.people_mentioned) && conv.people_mentioned.length
              ? `People: ${conv.people_mentioned.join(", ")}`
              : "";

            const parts = [
              `--- Result ${i + 1} (${(conv.similarity * 100).toFixed(1)}% match) ---`,
              `Title: ${conv.title || "Untitled"}`,
              `Date: ${date}`,
              `Type: ${conv.conversation_type || "unknown"}`,
            ];
            if (topics) parts.push(topics);
            if (people) parts.push(people);
            parts.push(`Summary (${detail}): ${summary}`);
            if (conv.conversation_url) parts.push(`URL: ${conv.conversation_url}`);
            return parts.join("\n");
          },
        );

        return {
          content: [{
            type: "text",
            text: `Found ${data.length} conversation(s) matching "${query}":\n\n${results.join("\n\n")}`,
          }],
        };
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: errorMessage }) }],
          isError: true,
        };
      }
    },
  );

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

app.get("*", (c) => c.json({ status: "ok", service: "ChatGPT Conversations MCP", version: "1.0.0" }));

Deno.serve(app.fetch);
