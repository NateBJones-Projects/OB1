import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z } from "zod";
import postgres from "postgres";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { readFileSync } from "fs";

const DATABASE_URL = process.env.DATABASE_URL!;
const MCP_ACCESS_KEY = process.env.MCP_ACCESS_KEY!;
const PORT = parseInt(process.env.PORT || "3000");
const AWS_REGION = process.env.AWS_REGION || "us-west-2";
const AWS_PROFILE = process.env.AWS_PROFILE || "default";
const AWS_CREDENTIALS_FILE = process.env.AWS_SHARED_CREDENTIALS_FILE || `${process.env.HOME || "/root"}/.aws/credentials`;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "amazon.titan-embed-text-v2:0";
const METADATA_MODEL = process.env.METADATA_MODEL || "us.anthropic.claude-haiku-4-5-20251001-v1:0";

const sql = postgres(DATABASE_URL);

function readCredentials() {
  const text = readFileSync(AWS_CREDENTIALS_FILE, "utf8").replace(/\r/g, "");
  const sections: Record<string, Record<string, string>> = {};
  let current = "";
  for (const line of text.split("\n")) {
    const section = line.match(/^\[(.+)\]/);
    if (section) { current = section[1]; sections[current] = {}; continue; }
    const kv = line.match(/^([^=]+)=(.*)$/);
    if (kv && current) sections[current][kv[1].trim()] = kv[2].trim();
  }
  const profile = sections[AWS_PROFILE] || sections["default"];
  if (!profile?.aws_access_key_id) throw new Error(`No credentials found for profile: ${AWS_PROFILE}`);
  return {
    accessKeyId: profile.aws_access_key_id,
    secretAccessKey: profile.aws_secret_access_key,
    ...(profile.aws_session_token ? { sessionToken: profile.aws_session_token } : {}),
  };
}

function makeBedrock() {
  return new BedrockRuntimeClient({
    region: AWS_REGION,
    credentials: readCredentials(),
  });
}

function parseMeta(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return {}; } }
  return raw as Record<string, unknown>;
}

async function getEmbedding(text: string): Promise<number[]> {
  const cmd = new InvokeModelCommand({
    modelId: EMBEDDING_MODEL,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({ inputText: text, dimensions: 1024, normalize: true }),
  });
  const resp = await makeBedrock().send(cmd);
  const body = JSON.parse(new TextDecoder().decode(resp.body));
  return body.embedding;
}

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const cmd = new InvokeModelCommand({
    modelId: METADATA_MODEL,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 512,
      messages: [{
        role: "user",
        content: `Extract metadata from the following thought and return a JSON object with these fields:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what's explicitly there. Return only the JSON object, nothing else.

Thought: ${text}`,
      }],
    }),
  });
  const resp = await makeBedrock().send(cmd);
  const body = JSON.parse(new TextDecoder().decode(resp.body));
  try {
    const match = body.content[0].text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : { topics: ["uncategorized"], type: "observation" };
  } catch {
    return { topics: ["uncategorized"], type: "observation" };
  }
}

async function captureThought(
  content: string,
  provenance: { source?: string; title?: string; url?: string } = {}
): Promise<{ id: string; metadata: Record<string, unknown> }> {
  const [embedding, metadata] = await Promise.all([getEmbedding(content), extractMetadata(content)]);
  const fullMetadata: Record<string, unknown> = {
    ...metadata,
    source: provenance.source || "mcp",
    ...(provenance.title ? { title: provenance.title } : {}),
    ...(provenance.url ? { url: provenance.url } : {}),
  };
  const [{ upsert_thought: result }] = await sql<{ upsert_thought: { id: string } }[]>`
    select upsert_thought(${content}, ${sql.json({ metadata: fullMetadata })})
  `;
  const vecStr = `[${embedding.join(",")}]`;
  await sql`update thoughts set embedding = ${vecStr}::vector where id = ${result.id}::uuid`;
  return { id: result.id, metadata: fullMetadata };
}

// --- MCP Server Setup ---

const server = new McpServer({ name: "open-brain", version: "1.0.0" });

server.registerTool(
  "search_thoughts",
  {
    title: "Search Thoughts",
    description: "Search captured thoughts by meaning. Use this when the user asks about a topic, person, or idea they've previously captured.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      query: z.string().describe("What to search for"),
      limit: z.number().optional().default(10),
      threshold: z.number().optional().default(0.25),
    },
  },
  async ({ query, limit, threshold }) => {
    try {
      const qEmb = await getEmbedding(query);
      const vecStr = `[${qEmb.join(",")}]`;
      const rows = await sql<{ content: string; metadata: Record<string, unknown>; similarity: number; created_at: string }[]>`
        select content, metadata, similarity, created_at
        from match_thoughts(${vecStr}::vector, ${threshold}, ${limit}, '{}'::jsonb)
      `;
      if (!rows.length) return { content: [{ type: "text" as const, text: `No thoughts found matching "${query}".` }] };
      const results = rows.map((t, i) => {
        const m = parseMeta(t.metadata);
        const parts = [
          `--- Result ${i + 1} (${(t.similarity * 100).toFixed(1)}% match) ---`,
          `Captured: ${new Date(t.created_at).toLocaleDateString()}`,
          `Type: ${m.type || "unknown"}`,
        ];
        if (Array.isArray(m.topics) && m.topics.length) parts.push(`Topics: ${(m.topics as string[]).join(", ")}`);
        if (Array.isArray(m.people) && m.people.length) parts.push(`People: ${(m.people as string[]).join(", ")}`);
        if (Array.isArray(m.action_items) && m.action_items.length) parts.push(`Actions: ${(m.action_items as string[]).join("; ")}`);
        parts.push(`\n${t.content}`);
        return parts.join("\n");
      });
      return { content: [{ type: "text" as const, text: `Found ${rows.length} thought(s):\n\n${results.join("\n\n")}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "list_thoughts",
  {
    title: "List Recent Thoughts",
    description: "List recently captured thoughts with optional filters by type, topic, person, or time range.",
    annotations: { readOnlyHint: true },
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
      const rows = await sql<{ content: string; metadata: Record<string, unknown>; created_at: string }[]>`
        select content, metadata, created_at from thoughts
        where true
          ${type ? sql`and metadata @> ${JSON.stringify({ type })}::jsonb` : sql``}
          ${topic ? sql`and metadata @> ${JSON.stringify({ topics: [topic] })}::jsonb` : sql``}
          ${person ? sql`and metadata @> ${JSON.stringify({ people: [person] })}::jsonb` : sql``}
          ${days ? sql`and created_at >= now() - ${`${days} days`}::interval` : sql``}
        order by created_at desc limit ${limit}
      `;
      if (!rows.length) return { content: [{ type: "text" as const, text: "No thoughts found." }] };
      const results = rows.map((t, i) => {
        const m = parseMeta(t.metadata);
        const tags = Array.isArray(m.topics) ? (m.topics as string[]).join(", ") : "";
        return `${i + 1}. [${new Date(t.created_at).toLocaleDateString()}] (${m.type || "??"}${tags ? " - " + tags : ""})\n   ${t.content}`;
      });
      return { content: [{ type: "text" as const, text: `${rows.length} recent thought(s):\n\n${results.join("\n\n")}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "thought_stats",
  {
    title: "Thought Statistics",
    description: "Get a summary of all captured thoughts: totals, types, top topics, and people.",
    annotations: { readOnlyHint: true },
    inputSchema: {},
  },
  async () => {
    try {
      const [{ count }] = await sql<{ count: string }[]>`select count(*)::text as count from thoughts`;
      const rows = await sql<{ metadata: Record<string, unknown>; created_at: string }[]>`
        select metadata, created_at from thoughts order by created_at desc
      `;
      const types: Record<string, number> = {};
      const topics: Record<string, number> = {};
      const people: Record<string, number> = {};
      for (const r of rows) {
        const m = parseMeta(r.metadata);
        if (m.type) types[m.type as string] = (types[m.type as string] || 0) + 1;
        if (Array.isArray(m.topics)) for (const t of m.topics) topics[t as string] = (topics[t as string] || 0) + 1;
        if (Array.isArray(m.people)) for (const p of m.people) people[p as string] = (people[p as string] || 0) + 1;
      }
      const sort = (o: Record<string, number>): [string, number][] => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 10);
      const lines = [
        `Total thoughts: ${count}`,
        `Date range: ${rows.length ? new Date(rows[rows.length - 1].created_at).toLocaleDateString() + " → " + new Date(rows[0].created_at).toLocaleDateString() : "N/A"}`,
        "", "Types:", ...sort(types).map(([k, v]) => `  ${k}: ${v}`),
      ];
      if (Object.keys(topics).length) { lines.push("", "Top topics:"); for (const [k, v] of sort(topics)) lines.push(`  ${k}: ${v}`); }
      if (Object.keys(people).length) { lines.push("", "People mentioned:"); for (const [k, v] of sort(people)) lines.push(`  ${k}: ${v}`); }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "capture_thought",
  {
    title: "Capture Thought",
    description: "Save a new thought to the Open Brain. Generates an embedding and extracts metadata automatically.",
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      content: z.string().describe("The thought to capture — a clear, standalone statement that will make sense when retrieved later by any AI"),
    },
  },
  async ({ content }) => {
    try {
      const { metadata } = await captureThought(content);
      let confirmation = `Captured as ${metadata.type || "thought"}`;
      if (Array.isArray(metadata.topics) && metadata.topics.length) confirmation += ` — ${(metadata.topics as string[]).join(", ")}`;
      if (Array.isArray(metadata.people) && metadata.people.length) confirmation += ` | People: ${(metadata.people as string[]).join(", ")}`;
      if (Array.isArray(metadata.action_items) && metadata.action_items.length) confirmation += ` | Actions: ${(metadata.action_items as string[]).join("; ")}`;
      return { content: [{ type: "text" as const, text: confirmation }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "enrich_thoughts",
  {
    title: "Enrich Untagged Thoughts",
    description: "Run metadata extraction on all thoughts that have no metadata yet.",
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      limit: z.number().optional().default(20).describe("Max thoughts to process in one run"),
    },
  },
  async ({ limit }) => {
    try {
      const rows = await sql<{ id: string; content: string }[]>`
        select id, content from thoughts
        where metadata = '{}'::jsonb or metadata = '{"source":"mcp"}'::jsonb
        order by created_at asc limit ${limit}
      `;
      if (!rows.length) return { content: [{ type: "text" as const, text: "No untagged thoughts found." }] };
      let processed = 0;
      for (const row of rows) {
        const metadata = await extractMetadata(row.content);
        await sql`update thoughts set metadata = ${sql.json({ ...metadata, source: "mcp" })} where id = ${row.id}::uuid`;
        processed++;
      }
      return { content: [{ type: "text" as const, text: `Enriched ${processed} thought(s).` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// --- Hono App with Auth + CORS ---

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-brain-key, accept, mcp-session-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
};

const app = new Hono();
app.options("*", (c) => c.text("ok", 200, corsHeaders));

app.post("/capture-external", async (c) => {
  const provided = c.req.header("x-brain-key") || new URL(c.req.url).searchParams.get("key");
  if (!provided || provided !== MCP_ACCESS_KEY) return c.json({ error: "Invalid or missing access key" }, 401, corsHeaders);
  let body: { content?: string; source?: string; title?: string; url?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400, corsHeaders);
  }
  if (!body.content || body.content.trim() === "") {
    return c.json({ error: "content is required" }, 400, corsHeaders);
  }
  try {
    const { id, metadata } = await captureThought(body.content.trim(), {
      source: body.source,
      title: body.title,
      url: body.url,
    });
    return c.json({ id, type: metadata.type, topics: metadata.topics }, 200, corsHeaders);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500, corsHeaders);
  }
});

app.post("/search-external", async (c) => {
  const provided = c.req.header("x-brain-key") || new URL(c.req.url).searchParams.get("key");
  if (!provided || provided !== MCP_ACCESS_KEY) return c.json({ error: "Invalid or missing access key" }, 401, corsHeaders);
  let body: { query?: string; tag?: string; type?: string; source?: string; date?: string; since?: string; until?: string; limit?: number; threshold?: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400, corsHeaders);
  }
  if (!body.query && !body.tag && !body.type && !body.source && !body.date && !body.since && !body.until) {
    return c.json({ error: "query, tag, type, source, date, since, or until is required" }, 400, corsHeaders);
  }
  const isDate = (s: string | undefined) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (body.date && !isDate(body.date)) return c.json({ error: "date must be YYYY-MM-DD" }, 400, corsHeaders);
  if (body.since && !isDate(body.since)) return c.json({ error: "since must be YYYY-MM-DD" }, 400, corsHeaders);
  if (body.until && !isDate(body.until)) return c.json({ error: "until must be YYYY-MM-DD" }, 400, corsHeaders);
  try {
    const limit = body.limit || 10;

    // Browse mode — date-sorted, no embedding needed. Triggered by any non-query filter.
    if (body.tag || body.type || body.source || body.date || body.since || body.until) {
      const filter: Record<string, unknown> = {};
      if (body.tag) filter.topics = [body.tag];
      if (body.type) filter.type = body.type;
      if (body.source) filter.source = body.source;
      const rows = await sql<{ id: string; content: string; metadata: Record<string, unknown>; created_at: string }[]>`
        select id, content, metadata, created_at from thoughts
        where true
          ${Object.keys(filter).length ? sql`and metadata @> ${sql.json(filter)}::jsonb` : sql``}
          ${body.date ? sql`and created_at::date = ${body.date}::date` : sql``}
          ${body.since ? sql`and created_at::date >= ${body.since}::date` : sql``}
          ${body.until ? sql`and created_at::date <= ${body.until}::date` : sql``}
        order by created_at desc limit ${limit}
      `;
      const results = rows.map(t => ({
        id: t.id,
        content: t.content,
        similarity: null,
        type: (parseMeta(t.metadata).type as string) || "unknown",
        topics: (parseMeta(t.metadata).topics as string[]) || [],
        source: (parseMeta(t.metadata).source as string) || null,
        created_at: t.created_at,
      }));
      return c.json({ results, mode: "browse" }, 200, corsHeaders);
    }

    // Semantic search
    const threshold = body.threshold || 0.25;
    const qEmb = await getEmbedding(body.query!.trim());
    const vecStr = `[${qEmb.join(",")}]`;
    const rows = await sql<{ id: string; content: string; metadata: Record<string, unknown>; similarity: number; created_at: string }[]>`
      select id, content, metadata, similarity, created_at
      from match_thoughts(${vecStr}::vector, ${threshold}, ${limit}, '{}'::jsonb)
    `;
    const results = rows.map(t => ({
      id: t.id,
      content: t.content,
      similarity: Math.round(t.similarity * 100),
      type: (parseMeta(t.metadata).type as string) || "unknown",
      topics: (parseMeta(t.metadata).topics as string[]) || [],
      source: (parseMeta(t.metadata).source as string) || null,
      created_at: t.created_at,
    }));
    return c.json({ results, mode: "search" }, 200, corsHeaders);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500, corsHeaders);
  }
});

app.all("*", async (c) => {
  const provided = c.req.header("x-brain-key") || new URL(c.req.url).searchParams.get("key");
  if (!provided || provided !== MCP_ACCESS_KEY) return c.json({ error: "Invalid or missing access key" }, 401, corsHeaders);
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

(async () => {
  try {
    const cmd = new InvokeModelCommand({
      modelId: EMBEDDING_MODEL,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({ inputText: "startup health check", dimensions: 1024, normalize: true }),
    });
    await makeBedrock().send(cmd);
    console.log(`AWS Bedrock health check passed (profile: ${process.env.AWS_PROFILE || "default"})`);
  } catch (e) {
    console.error("FATAL: Bedrock health check failed:", (e as Error).message);
    process.exit(1);
  }
  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`Open Brain MCP server running on port ${PORT}`);
  });
})();
