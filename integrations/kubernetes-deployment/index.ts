/**
 * Open Brain MCP Server - Kubernetes Self-Hosted Version
 *
 * This is a modified version of the OB1 server that connects directly to
 * PostgreSQL + pgvector instead of Supabase. All MCP tools and the Hono
 * HTTP layer are preserved; only the data access layer is changed.
 *
 * Environment variables:
 *   DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD - PostgreSQL connection
 *   EMBEDDING_API_BASE - Base URL for OpenAI-compatible embedding API
 *   EMBEDDING_API_KEY - API key for the embedding service
 *   EMBEDDING_MODEL - Model name for embeddings (default: text-embedding-3-small)
 *   CHAT_API_BASE - Base URL for OpenAI-compatible chat API (defaults to EMBEDDING_API_BASE)
 *   CHAT_API_KEY - API key for chat service (defaults to EMBEDDING_API_KEY)
 *   CHAT_MODEL - Model name for metadata extraction (default: gpt-4o-mini)
 *   MCP_ACCESS_KEY - Authentication key for MCP endpoint
 *   OPEN_BRAIN_CITATION_BASE_URL - Optional base URL for search/fetch citation links
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { z } from "zod";
import { Pool } from "postgres";

// --- Configuration ---

const DB_HOST = Deno.env.get("DB_HOST") || "127.0.0.1";
const DB_PORT = parseInt(Deno.env.get("DB_PORT") || "5432", 10);
const DB_NAME = Deno.env.get("DB_NAME") || "openbrain";
const DB_USER = Deno.env.get("DB_USER") || "postgres";
const DB_PASSWORD = Deno.env.get("DB_PASSWORD")!;

const EMBEDDING_API_BASE = Deno.env.get("EMBEDDING_API_BASE") || "https://openrouter.ai/api/v1";
const EMBEDDING_API_KEY = Deno.env.get("EMBEDDING_API_KEY") || Deno.env.get("OPENROUTER_API_KEY") || "";
const EMBEDDING_MODEL = Deno.env.get("EMBEDDING_MODEL") || "openai/text-embedding-3-small";

const CHAT_API_BASE = Deno.env.get("CHAT_API_BASE") || EMBEDDING_API_BASE;
const CHAT_API_KEY = Deno.env.get("CHAT_API_KEY") || EMBEDDING_API_KEY;
const CHAT_MODEL = Deno.env.get("CHAT_MODEL") || "openai/gpt-4o-mini";

const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

// --- PostgreSQL Connection Pool ---

const pool = new Pool({
  hostname: DB_HOST,
  port: DB_PORT,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,
}, 20);

type ThoughtMatch = {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
  created_at: string;
};

type ThoughtRecord = {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at?: string | null;
};

const CITATION_BASE_URL =
  Deno.env.get("OPEN_BRAIN_CITATION_BASE_URL") || "https://openbrain.local/thoughts";

// The 0.5 similarity threshold is tuned for OpenAI text-embedding-3-small. Other
// embedding models have differently shaped similarity distributions -- bge-m3, for
// example, has a compressed range where 0.5 silently drops genuinely relevant hits.
// The default is unchanged; this only makes it configurable for non-OpenAI models.
// Override globally with OPEN_BRAIN_MATCH_THRESHOLD or per-call with `threshold`.
const DEFAULT_MATCH_THRESHOLD = parseFloat(
  Deno.env.get("OPEN_BRAIN_MATCH_THRESHOLD") || "0.5"
);

function thoughtTitle(content: string, createdAt?: string): string {
  const firstLine = content.replace(/\s+/g, " ").trim().slice(0, 80);
  const datePrefix = createdAt ? new Date(createdAt).toLocaleDateString() : "Open Brain";
  return firstLine ? `${datePrefix} - ${firstLine}` : `${datePrefix} thought`;
}

function thoughtUrl(id: string): string {
  return `${CITATION_BASE_URL.replace(/\/$/, "")}/${id}`;
}

// --- Embedding & Metadata Extraction ---

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${EMBEDDING_API_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${EMBEDDING_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
    }),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`Embedding API failed: ${r.status} ${msg}`);
  }
  const d = await r.json();
  return d.data[0].embedding;
}

// Structured-output schema for metadata extraction.
//
// `response_format: { type: "json_object" }` is not accepted by every
// OpenAI-compatible endpoint. LM Studio, for instance, rejects it with HTTP 400
// ("'response_format.type' must be 'json_schema' or 'text'"). A real json_schema is
// accepted by OpenAI and by the compatible runtimes, and enforces the shape rather
// than merely requesting it.
//
// Strict mode requires `additionalProperties: false` on every object and every
// property listed in `required`; omitting either is a 400 from OpenAI.
// https://developers.openai.com/api/docs/guides/structured-outputs
const METADATA_SCHEMA = {
  type: "object",
  properties: {
    people: { type: "array", items: { type: "string" } },
    action_items: { type: "array", items: { type: "string" } },
    dates_mentioned: { type: "array", items: { type: "string" } },
    topics: { type: "array", items: { type: "string" } },
    type: {
      type: "string",
      enum: ["observation", "task", "idea", "reference", "person_note"],
    },
  },
  required: ["people", "action_items", "dates_mentioned", "topics", "type"],
  additionalProperties: false,
} as const;

// Flag degraded extractions so they can be found and re-run later:
//   SELECT id, content FROM thoughts WHERE metadata->>'metadata_degraded' = 'true';
// Losing the thought entirely because the metadata model was down is worse than
// storing it with weak metadata -- the content and embedding are the valuable parts.
const METADATA_FALLBACK = {
  topics: ["uncategorized"],
  type: "observation",
  metadata_degraded: true,
};

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  try {
    const r = await fetch(`${CHAT_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CHAT_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "thought_metadata",
            strict: true,
            schema: METADATA_SCHEMA,
          },
        },
        messages: [
          {
            role: "system",
            content: `Extract metadata from the user's captured thought.
- "people": people mentioned (empty if none)
- "action_items": implied to-dos (empty if none)
- "dates_mentioned": dates as YYYY-MM-DD (empty if none)
- "topics": 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what's explicitly there.`,
          },
          { role: "user", content: text },
        ],
      }),
    });

    // Fail loudly instead of silently degrading every capture.
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      console.error(`extractMetadata: chat API ${r.status} ${body.slice(0, 300)}`);
      return METADATA_FALLBACK;
    }

    const d = await r.json();
    const content = d?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      console.error(`extractMetadata: unexpected response shape: ${JSON.stringify(d).slice(0, 300)}`);
      return METADATA_FALLBACK;
    }
    return JSON.parse(content);
  } catch (e) {
    console.error(`extractMetadata failed: ${e instanceof Error ? e.message : e}`);
    return METADATA_FALLBACK;
  }
}

// --- MCP Server Setup ---

function buildServer(): McpServer {
  const server = new McpServer({
    name: "open-brain",
    version: "1.0.0",
  });

  // ChatGPT compatibility: restricted connector surfaces, company knowledge, and deep
  // research look for exact read-only `search` and `fetch` tool shapes.
  server.registerTool(
    "search",
    {
      title: "Search Open Brain",
      description:
        "Search Open Brain memories by meaning. Use this read-only compatibility tool when ChatGPT needs search/fetch-style access to stored thoughts.",
      annotations: {
        readOnlyHint: true,
      },
      inputSchema: {
        query: z.string().describe("The search query to run against Open Brain thoughts"),
      },
    },
    async ({ query }) => {
      try {
        const qEmb = await getEmbedding(query);
        const embStr = `[${qEmb.join(",")}]`;

        const client = await pool.connect();
        try {
          const result = await client.queryObject<ThoughtMatch>(
            `SELECT id, content, metadata, created_at,
                    1 - (embedding <=> $1::vector) AS similarity
             FROM thoughts
             WHERE 1 - (embedding <=> $1::vector) >= $2
             ORDER BY embedding <=> $1::vector
             LIMIT $3`,
            [embStr, DEFAULT_MATCH_THRESHOLD, 10]
          );

          const results = result.rows.map((t) => ({
            id: t.id,
            title: thoughtTitle(t.content, t.created_at),
            url: thoughtUrl(t.id),
          }));

          return {
            content: [{ type: "text" as const, text: JSON.stringify({ results }) }],
          };
        } finally {
          client.release();
        }
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "fetch",
    {
      title: "Fetch Open Brain Thought",
      description:
        "Fetch one Open Brain thought by ID after using search. Use this read-only compatibility tool to retrieve the full text and metadata for citation.",
      annotations: {
        readOnlyHint: true,
      },
      inputSchema: {
        id: z.string().describe("The Open Brain thought ID returned by the search tool"),
      },
    },
    async ({ id }) => {
      try {
        const client = await pool.connect();
        try {
          const result = await client.queryObject<ThoughtRecord>(
            `SELECT id, content, metadata, created_at, updated_at
             FROM thoughts
             WHERE id = $1
             LIMIT 1`,
            [id]
          );

          const thought = result.rows[0];
          if (!thought) {
            return {
              content: [{ type: "text" as const, text: `No thought found for ID ${id}.` }],
              isError: true,
            };
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
          };
        } finally {
          client.release();
        }
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool 1: Semantic Search (replaces supabase.rpc with raw SQL)
  server.registerTool(
    "search_thoughts",
    {
      title: "Search Thoughts",
      description:
        "Search captured thoughts by meaning. Use this when the user asks about a topic, person, or idea they've previously captured.",
      annotations: {
        readOnlyHint: true,
      },
      inputSchema: {
        query: z.string().describe("What to search for"),
        limit: z.number().optional().default(10),
        threshold: z.number().optional().default(DEFAULT_MATCH_THRESHOLD),
      },
    },
    async ({ query, limit, threshold }) => {
      try {
        const qEmb = await getEmbedding(query);
        const embStr = `[${qEmb.join(",")}]`;

        const client = await pool.connect();
        try {
          const result = await client.queryObject<ThoughtMatch>(
            `SELECT id, content, metadata, created_at,
                    1 - (embedding <=> $1::vector) AS similarity
             FROM thoughts
             WHERE 1 - (embedding <=> $1::vector) >= $2
             ORDER BY embedding <=> $1::vector
             LIMIT $3`,
            [embStr, threshold, limit]
          );

          if (!result.rows.length) {
            return {
              content: [{ type: "text" as const, text: `No thoughts found matching "${query}".` }],
            };
          }

          const results = result.rows.map((t, i) => {
            const m = t.metadata || {};
            const parts = [
              `--- Result ${i + 1} (${(t.similarity * 100).toFixed(1)}% match) ---`,
              `Captured: ${new Date(t.created_at).toLocaleDateString()}`,
              `Type: ${m.type || "unknown"}`,
            ];
            if (Array.isArray(m.topics) && m.topics.length)
              parts.push(`Topics: ${(m.topics as string[]).join(", ")}`);
            if (Array.isArray(m.people) && m.people.length)
              parts.push(`People: ${(m.people as string[]).join(", ")}`);
            if (Array.isArray(m.action_items) && m.action_items.length)
              parts.push(`Actions: ${(m.action_items as string[]).join("; ")}`);
            parts.push(`\n${t.content}`);
            return parts.join("\n");
          });

          return {
            content: [
              {
                type: "text" as const,
                text: `Found ${result.rows.length} thought(s):\n\n${results.join("\n\n")}`,
              },
            ],
          };
        } finally {
          client.release();
        }
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool 2: List Recent (replaces supabase query builder with raw SQL)
  server.registerTool(
    "list_thoughts",
    {
      title: "List Recent Thoughts",
      description:
        "List recently captured thoughts with optional filters by type, topic, person, or time range.",
      annotations: {
        readOnlyHint: true,
      },
      inputSchema: {
        limit: z.number().optional().default(10),
        type: z.string().optional().describe("Filter by type: observation, task, idea, reference, person_note"),
        topic: z.string().optional().describe("Filter by topic tag"),
        person: z.string().optional().describe("Filter by person mentioned"),
        days: z.number().optional().describe("Only thoughts from the last N days"),
      },
    },
    async ({ limit, type, topic, person, days }) => {
      try {
        const conditions: string[] = [];
        const params: unknown[] = [];
        let paramIdx = 1;

        if (type) {
          conditions.push(`metadata->>'type' = $${paramIdx}`);
          params.push(type);
          paramIdx++;
        }
        if (topic) {
          conditions.push(`metadata->'topics' ? $${paramIdx}`);
          params.push(topic);
          paramIdx++;
        }
        if (person) {
          conditions.push(`metadata->'people' ? $${paramIdx}`);
          params.push(person);
          paramIdx++;
        }
        if (days) {
          conditions.push(`created_at >= NOW() - INTERVAL '${days} days'`);
        }

        const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

        const client = await pool.connect();
        try {
          const result = await client.queryObject<{
            content: string;
            metadata: Record<string, unknown>;
            created_at: string;
          }>(
            `SELECT content, metadata, created_at
             FROM thoughts
             ${whereClause}
             ORDER BY created_at DESC
             LIMIT $${paramIdx}`,
            [...params, limit]
          );

          if (!result.rows.length) {
            return { content: [{ type: "text" as const, text: "No thoughts found." }] };
          }

          const results = result.rows.map((t, i) => {
            const m = t.metadata || {};
            const tags = Array.isArray(m.topics) ? (m.topics as string[]).join(", ") : "";
            return `${i + 1}. [${new Date(t.created_at).toLocaleDateString()}] (${m.type || "??"}${tags ? " - " + tags : ""})\n   ${t.content}`;
          });

          return {
            content: [
              {
                type: "text" as const,
                text: `${result.rows.length} recent thought(s):\n\n${results.join("\n\n")}`,
              },
            ],
          };
        } finally {
          client.release();
        }
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool 3: Stats (replaces supabase queries with raw SQL)
  server.registerTool(
    "thought_stats",
    {
      title: "Thought Statistics",
      description: "Get a summary of all captured thoughts: totals, types, top topics, and people.",
      annotations: {
        readOnlyHint: true,
      },
      inputSchema: {},
    },
    async () => {
      try {
        const client = await pool.connect();
        try {
          const countResult = await client.queryObject<{ count: number }>(
            "SELECT COUNT(*)::int AS count FROM thoughts"
          );

          const dataResult = await client.queryObject<{
            metadata: Record<string, unknown>;
            created_at: string;
          }>(
            "SELECT metadata, created_at FROM thoughts ORDER BY created_at DESC"
          );

          const count = countResult.rows[0]?.count || 0;
          const data = dataResult.rows;

          const types: Record<string, number> = {};
          const topics: Record<string, number> = {};
          const people: Record<string, number> = {};

          for (const r of data) {
            const m = r.metadata || {};
            if (m.type) types[m.type as string] = (types[m.type as string] || 0) + 1;
            if (Array.isArray(m.topics))
              for (const t of m.topics) topics[t as string] = (topics[t as string] || 0) + 1;
            if (Array.isArray(m.people))
              for (const p of m.people) people[p as string] = (people[p as string] || 0) + 1;
          }

          const sort = (o: Record<string, number>): [string, number][] =>
            Object.entries(o)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 10);

          const lines: string[] = [
            `Total thoughts: ${count}`,
            `Date range: ${
              data.length
                ? new Date(data[data.length - 1].created_at).toLocaleDateString() +
                  " -> " +
                  new Date(data[0].created_at).toLocaleDateString()
                : "N/A"
            }`,
            "",
            "Types:",
            ...sort(types).map(([k, v]) => `  ${k}: ${v}`),
          ];

          if (Object.keys(topics).length) {
            lines.push("", "Top topics:");
            for (const [k, v] of sort(topics)) lines.push(`  ${k}: ${v}`);
          }

          if (Object.keys(people).length) {
            lines.push("", "People mentioned:");
            for (const [k, v] of sort(people)) lines.push(`  ${k}: ${v}`);
          }

          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } finally {
          client.release();
        }
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool 4: Capture Thought (replaces supabase insert with raw SQL)
  server.registerTool(
    "capture_thought",
    {
      title: "Capture Thought",
      description:
        "Save a new thought to the Open Brain. Generates an embedding and extracts metadata automatically.",
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
      inputSchema: {
        content: z.string().describe("The thought to capture"),
      },
    },
    async ({ content }) => {
      try {
        const [embedding, metadata] = await Promise.all([
          getEmbedding(content),
          extractMetadata(content),
        ]);

        const embStr = `[${embedding.join(",")}]`;
        const meta: Record<string, unknown> = { ...metadata, source: "mcp" };

        const client = await pool.connect();
        try {
          await client.queryObject(
            `INSERT INTO thoughts (content, embedding, metadata)
             VALUES ($1, $2::vector, $3::jsonb)`,
            [content, embStr, JSON.stringify(meta)]
          );
        } finally {
          client.release();
        }

        let confirmation = `Captured as ${meta.type || "thought"}`;
        if (Array.isArray(meta.topics) && meta.topics.length)
          confirmation += ` -- ${(meta.topics as string[]).join(", ")}`;
        if (Array.isArray(meta.people) && meta.people.length)
          confirmation += ` | People: ${(meta.people as string[]).join(", ")}`;
        if (Array.isArray(meta.action_items) && meta.action_items.length)
          confirmation += ` | Actions: ${(meta.action_items as string[]).join("; ")}`;

        return {
          content: [{ type: "text" as const, text: confirmation }],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}

// --- Hono App with Auth Check ---

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-brain-key, accept, mcp-session-id, mcp-protocol-version, last-event-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
};

const app = new Hono();

app.options("*", (c) => c.text("ok", 200, corsHeaders));

// Constant-time comparison. A plain `!==` short-circuits on the first differing
// byte, which leaks key material through response timing. Length is compared first
// and non-secretly -- that only reveals the key's length, and bailing early on a
// length mismatch is unavoidable for a fixed-width compare anyway.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

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

  const provided = c.req.header("x-brain-key") || new URL(c.req.url).searchParams.get("key");
  if (!provided || !timingSafeEqual(provided, MCP_ACCESS_KEY)) {
    return c.json({ error: "Invalid or missing access key" }, 401, corsHeaders);
  }

  // Claude Desktop connectors don't send Accept: text/event-stream — patch it in.
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

  const server = buildServer();
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  const response = await transport.handleRequest(c);
  if (!response) return c.json({ error: "No response from MCP transport" }, 500, corsHeaders);
  response.headers.delete("mcp-session-id");
  for (const [k, v] of Object.entries(corsHeaders)) response.headers.set(k, v);
  return response;
});

Deno.serve({ port: parseInt(Deno.env.get("PORT") || "8000", 10) }, app.fetch);
