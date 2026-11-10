// Open Brain MCP Server — v1.2.1 (fix: build a fresh MCP server per request)
// Tools: search_thoughts, list_thoughts, thought_stats, capture_thought, update_thought, delete_thought
// stonemonk2/OB1 fork — core 2nd Brain functions only (no wiki layer)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── Embedding ────────────────────────────────────────────────────────────────

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text,
    }),
  });
  if (!r.ok) throw new Error(`Embedding error: ${await r.text()}`);
  const j = await r.json();
  return j.data[0].embedding;
}

// ── Metadata extraction ──────────────────────────────────────────────────────

async function extractMetadata(content: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Extract metadata from this thought/note as JSON with these fields:
- type: string (task|idea|reference|decision|milestone|question|unknown)
- status: string (pending|in-progress|done|cancelled — only for tasks, else omit)
- category: string (optional single category label)
- topics: string[] (2-5 key topics)
- people: string[] (people mentioned, first names or full names)
- actions: string[] (action items if any)
Return only valid JSON, no markdown.`,
        },
        { role: "user", content },
      ],
      max_tokens: 300,
    }),
  });
  if (!r.ok) return {};
  try {
    const j = await r.json();
    return JSON.parse(j.choices[0].message.content);
  } catch {
    return {};
  }
}

// ── MCP Server ───────────────────────────────────────────────────────────────

// A fresh McpServer is built for every request. One shared instance can only be
// attached to a single connection at a time, so reusing it made every request after
// the first on a warm instance fail with "Already connected to a transport".
function createServer(): McpServer {
const server = new McpServer({ name: "open-brain", version: "1.2.1" });

// search_thoughts
server.tool(
  "search_thoughts",
  "Search captured thoughts by meaning using semantic similarity.",
  {
    query: z.string().describe("What to search for"),
    limit: z.number().optional().default(10).describe("Max results (default 10)"),
    threshold: z.number().optional().default(0.5).describe("Similarity threshold 0-1 (default 0.5)"),
  },
  async ({ query, limit, threshold }) => {
    const embedding = await getEmbedding(query);
    const { data, error } = await supabase.rpc("match_thoughts", {
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: limit,
    });
    if (error) throw new Error(error.message);
    if (!data?.length) return { content: [{ type: "text", text: "No matching thoughts found." }] };
    const results = data.map((r: Record<string, unknown>, i: number) => {
      const m = (r.metadata || {}) as Record<string, unknown>;
      const lines = [
        `--- Result ${i + 1} (${Math.round((r.similarity as number) * 100)}% match) ---`,
        `ID: ${r.id}`,
        `Captured: ${new Date(r.created_at as string).toLocaleDateString()}`,
        m.type ? `Type: ${m.type}` : "",
        m.status ? `Status: ${m.status}` : "",
        m.category ? `Category: ${m.category}` : "",
        "",
        r.content as string,
      ].filter(Boolean);
      return lines.join("\n");
    });
    return { content: [{ type: "text", text: `Found ${data.length} thought(s):\n\n${results.join("\n\n")}` }] };
  }
);

// list_thoughts
server.tool(
  "list_thoughts",
  "List recently captured thoughts with optional filters.",
  {
    limit: z.number().optional().default(10).describe("Max results (default 10)"),
    type: z.string().optional().describe("Filter by type: task|idea|reference|decision|milestone|question"),
    status: z.string().optional().describe("Filter by status: pending|in-progress|done|cancelled"),
    category: z.string().optional().describe("Filter by category label"),
    topic: z.string().optional().describe("Filter by topic keyword"),
    person: z.string().optional().describe("Filter by person mentioned"),
    date_from: z.string().optional().describe("ISO date string — show thoughts from this date"),
    date_to: z.string().optional().describe("ISO date string — show thoughts up to this date"),
  },
  async ({ limit, type, status, category, topic, person, date_from, date_to }) => {
    let query = supabase
      .from("thoughts")
      .select("id, content, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(limit!);

    if (type) query = query.eq("metadata->>type", type);
    if (status) query = query.eq("metadata->>status", status);
    if (category) query = query.eq("metadata->>category", category);
    if (topic) query = query.contains("metadata->topics", JSON.stringify([topic]));
    if (person) query = query.contains("metadata->people", JSON.stringify([person]));
    if (date_from) query = query.gte("created_at", date_from);
    if (date_to) query = query.lte("created_at", date_to);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    if (!data?.length) return { content: [{ type: "text", text: "No thoughts found matching those filters." }] };

    const results = data.map((r: Record<string, unknown>, i: number) => {
      const m = (r.metadata || {}) as Record<string, unknown>;
      const lines = [
        `--- Result ${i + 1} ---`,
        `ID: ${r.id}`,
        `Captured: ${new Date(r.created_at as string).toLocaleDateString()}`,
        m.type ? `Type: ${m.type}` : "",
        m.status ? `Status: ${m.status}` : "",
        m.category ? `Category: ${m.category}` : "",
        "",
        r.content as string,
      ].filter(Boolean);
      return lines.join("\n");
    });
    return { content: [{ type: "text", text: `Found ${data.length} thought(s):\n\n${results.join("\n\n")}` }] };
  }
);

// thought_stats
server.tool(
  "thought_stats",
  "Get a summary of all captured thoughts: totals, types, statuses, top topics, and people.",
  {},
  async () => {
    const { data, error, count } = await supabase
      .from("thoughts")
      .select("metadata, created_at", { count: "exact" });
    if (error) throw new Error(error.message);

    const types: Record<string, number> = {};
    const topics: Record<string, number> = {};
    const people: Record<string, number> = {};
    const statuses: Record<string, number> = {};
    const categories: Record<string, number> = {};

    for (const r of data || []) {
      const m = (r.metadata || {}) as Record<string, unknown>;
      if (m.type) types[m.type as string] = (types[m.type as string] || 0) + 1;
      if (m.status) statuses[m.status as string] = (statuses[m.status as string] || 0) + 1;
      if (m.category) categories[m.category as string] = (categories[m.category as string] || 0) + 1;
      if (Array.isArray(m.topics))
        for (const t of m.topics) topics[t as string] = (topics[t as string] || 0) + 1;
      if (Array.isArray(m.people))
        for (const p of m.people) people[p as string] = (people[p as string] || 0) + 1;
    }

    const sort = (o: Record<string, number>): [string, number][] =>
      Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 10);

    const lines: string[] = [
      `Total thoughts: ${count}`,
      `Date range: ${
        data?.length
          ? new Date(data[data.length - 1].created_at).toLocaleDateString() +
            " → " +
            new Date(data[0].created_at).toLocaleDateString()
          : "N/A"
      }`,
      "",
      "Types:",
      ...sort(types).map(([k, v]) => `  ${k}: ${v}`),
    ];
    if (Object.keys(statuses).length) {
      lines.push("", "Task statuses:");
      for (const [k, v] of sort(statuses)) lines.push(`  ${k}: ${v}`);
    }
    if (Object.keys(categories).length) {
      lines.push("", "Categories:");
      for (const [k, v] of sort(categories)) lines.push(`  ${k}: ${v}`);
    }
    if (Object.keys(topics).length) {
      lines.push("", "Top topics:");
      for (const [k, v] of sort(topics)) lines.push(`  ${k}: ${v}`);
    }
    if (Object.keys(people).length) {
      lines.push("", "People mentioned:");
      for (const [k, v] of sort(people)) lines.push(`  ${k}: ${v}`);
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// capture_thought
server.tool(
  "capture_thought",
  "Save a new thought to the Open Brain. Generates an embedding and extracts metadata automatically.",
  {
    content: z.string().describe("The thought to capture — a clear, standalone statement that will make sense when retrieved later by any AI"),
  },
  async ({ content }) => {
    const [embedding, metadata] = await Promise.all([
      getEmbedding(content),
      extractMetadata(content),
    ]);
    const { data, error } = await supabase.rpc("upsert_thought", {
      p_content: content,
      p_payload: metadata,
    });
    if (error) throw new Error(error.message);
    // Store embedding separately
    const id = (data as Record<string, unknown>)?.id;
    if (id) {
      await supabase.from("thoughts").update({ embedding }).eq("id", id);
    }
    const type = (metadata as Record<string, unknown>).type || "unknown";
    const topics = (metadata as Record<string, unknown>).topics;
    const topicStr = Array.isArray(topics) && topics.length ? ` | Topics: ${topics.join(", ")}` : "";
    return {
      content: [{ type: "text", text: `Captured as ${type}${topicStr}` }],
    };
  }
);

// update_thought
server.tool(
  "update_thought",
  "Update an existing thought by ID. Replaces the content and re-generates embedding and metadata.",
  {
    thought_id: z.string().describe("UUID of the thought to update"),
    content: z.string().describe("New content to replace the existing thought"),
  },
  async ({ thought_id, content }) => {
    const [embedding, metadata] = await Promise.all([
      getEmbedding(content),
      extractMetadata(content),
    ]);
    const { error } = await supabase
      .from("thoughts")
      .update({ content, embedding, metadata, updated_at: new Date().toISOString() })
      .eq("id", thought_id);
    if (error) throw new Error(error.message);
    return { content: [{ type: "text", text: `Updated thought ${thought_id}` }] };
  }
);

// delete_thought
server.tool(
  "delete_thought",
  "Permanently delete a thought by ID. Use for removing duplicates or incorrect entries.",
  {
    thought_id: z.string().describe("UUID of the thought to delete"),
  },
  async ({ thought_id }) => {
    const { error } = await supabase.from("thoughts").delete().eq("id", thought_id);
    if (error) throw new Error(error.message);
    return { content: [{ type: "text", text: `Deleted thought ${thought_id}` }] };
  }
);

return server;
}

// ── Hono app + auth middleware ────────────────────────────────────────────────

const app = new Hono();

app.use("*", async (c, next) => {
  const key = c.req.header("x-brain-key") || c.req.query("key");
  if (key !== MCP_ACCESS_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

app.all("*", async (c) => {
  // Fresh server + transport per request (stateless), so repeated or concurrent
  // requests on a warm instance never collide.
  const server = createServer();
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

Deno.serve(app.fetch);
