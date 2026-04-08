export interface Env {
  DB: D1Database;
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  MCP_ACCESS_KEY: string;
}

// ─── Auth ───────────────────────────────────────────────────────────────
function authenticate(request: Request, env: Env): boolean {
  // Check Authorization header first
  const authHeader = request.headers.get("Authorization");
  if (authHeader) {
    const token = authHeader.replace("Bearer ", "");
    if (token === env.MCP_ACCESS_KEY) return true;
  }
  // Fall back to query parameter (for MCP clients that don't support headers)
  const url = new URL(request.url);
  const keyParam = url.searchParams.get("key");
  if (keyParam === env.MCP_ACCESS_KEY) return true;
  return false;
}

// ─── Embedding Generation ───────────────────────────────────────────────
async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  const result = await ai.run("@cf/baai/bge-base-en-v1.5", {
    text: [text],
  });
  return result.data[0];
}

// ─── Metadata Extraction ────────────────────────────────────────────────
async function extractMetadata(ai: Ai, content: string): Promise<object> {
  const result = await ai.run("@cf/meta/llama-3.1-8b-instruct", {
    messages: [
      {
        role: "system",
        content: `Extract metadata from the following thought. Return ONLY valid JSON with these fields:
          - type: one of "idea", "task", "observation", "memory", "question", "reference"
          - topics: array of 1-3 topic tags (lowercase, short)
          - people: array of any people mentioned (empty array if none)
          - sentiment: one of "positive", "negative", "neutral"
          - priority: one of "high", "medium", "low"
        Return ONLY the JSON object, no explanation.`,
      },
      { role: "user", content },
    ],
    max_tokens: 200,
  });

  try {
    const text = (result as any).response;
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { type: "observation", topics: [], people: [], sentiment: "neutral", priority: "medium" };
  } catch {
    return { type: "observation", topics: [], people: [], sentiment: "neutral", priority: "medium" };
  }
}

// ─── Capture a Thought (sync: D1 write, returns immediately) ────────────
async function captureThought(
  env: Env,
  content: string,
  source: string = "mcp"
): Promise<{ id: string }> {
  const id = crypto.randomUUID().replace(/-/g, "");

  // Synchronous: write to D1 immediately — thought is queryable via FTS and list
  await env.DB.prepare(
    `INSERT INTO thoughts (id, content, metadata, source, embedded, created_at, updated_at)
     VALUES (?, ?, '{}', ?, 0, datetime('now'), datetime('now'))`
  )
    .bind(id, content, source)
    .run();

  return { id };
}

// ─── Embed a Thought (async: embedding + metadata + vectorize) ──────────
async function embedThought(env: Env, id: string, content: string, source: string): Promise<void> {
  try {
    const [embedding, metadata] = await Promise.all([
      generateEmbedding(env.AI, content),
      extractMetadata(env.AI, content),
    ]);

    // Update D1 with extracted metadata and mark as embedded
    await env.DB.prepare(
      `UPDATE thoughts SET metadata = ?, embedded = 1, updated_at = datetime('now') WHERE id = ?`
    )
      .bind(JSON.stringify(metadata), id)
      .run();

    // Upsert vector into Vectorize
    await env.VECTORIZE.upsert([
      {
        id,
        values: embedding,
        metadata: {
          source,
          ...(metadata as Record<string, any>),
        },
      },
    ]);
  } catch (err) {
    console.error(`Failed to embed thought ${id}:`, err);
    // Thought remains in D1 with embedded=0 for retry
  }
}

// ─── Embed Any Pending Thoughts (batch) ─────────────────────────────────
async function embedPending(env: Env, limit: number = 10): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT id, content, source FROM thoughts WHERE embedded = 0 ORDER BY created_at ASC LIMIT ?`
  )
    .bind(limit)
    .all();

  if (!results || results.length === 0) return 0;

  await Promise.all(
    results.map((r: any) => embedThought(env, r.id, r.content, r.source))
  );

  return results.length;
}

// ─── Search Thoughts ────────────────────────────────────────────────────
async function searchThoughts(
  env: Env,
  query: string,
  topK: number = 10
): Promise<any[]> {
  // Generate embedding for the query
  const queryEmbedding = await generateEmbedding(env.AI, query);

  // Search Vectorize for similar thoughts
  const vectorResults = await env.VECTORIZE.query(queryEmbedding, {
    topK,
    returnMetadata: "all",
  });

  if (!vectorResults.matches || vectorResults.matches.length === 0) {
    return [];
  }

  // Fetch full thought content from D1
  const ids = vectorResults.matches.map((m) => m.id);
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT id, content, metadata, source, created_at FROM thoughts WHERE id IN (${placeholders})`
  )
    .bind(...ids)
    .all();

  // Merge vector scores with thought content
  const thoughtMap = new Map(results?.map((r: any) => [r.id, r]) || []);
  return vectorResults.matches
    .map((match) => {
      const thought = thoughtMap.get(match.id);
      if (!thought) return null;
      return {
        id: match.id,
        content: (thought as any).content,
        metadata: JSON.parse((thought as any).metadata || "{}"),
        source: (thought as any).source,
        created_at: (thought as any).created_at,
        score: match.score,
      };
    })
    .filter(Boolean);
}

// ─── List Recent Thoughts ───────────────────────────────────────────────
async function listRecent(env: Env, limit: number = 20): Promise<any[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, content, metadata, source, created_at
     FROM thoughts ORDER BY created_at DESC LIMIT ?`
  )
    .bind(limit)
    .all();

  return (results || []).map((r: any) => ({
    ...r,
    metadata: JSON.parse(r.metadata || "{}"),
  }));
}

// ─── JSON-RPC Helpers ───────────────────────────────────────────────────
function jsonrpc(id: any, result: any): Response {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function jsonrpcError(id: any, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
}

// ─── MCP Tool Definitions ───────────────────────────────────────────────
const MCP_TOOLS = [
  {
    name: "capture_thought",
    description:
      "Save a thought, idea, observation, or any piece of information to your Open Brain. The system will automatically generate a semantic embedding and extract metadata.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The thought content to capture",
        },
        source: {
          type: "string",
          description: "Where this thought came from (e.g., 'claude', 'chatgpt', 'manual')",
          default: "mcp",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "search_thoughts",
    description:
      "Search your Open Brain by meaning. Returns thoughts semantically similar to your query, ranked by relevance.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What you're looking for — natural language works best",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default 10)",
          default: 10,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_recent",
    description:
      "List your most recent thoughts, newest first.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Number of thoughts to return (default 20)",
          default: 20,
        },
      },
    },
  },
];

// ─── MCP Protocol Handler ───────────────────────────────────────────────
async function handleMCP(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body: any = await request.json();
  const { method, params, id } = body;

  // Handle notifications (no id = notification, no response expected)
  if (id === undefined || id === null) {
    return new Response(null, { status: 202 });
  }

  switch (method) {
    case "initialize":
      return jsonrpc(id, {
        protocolVersion: "2025-11-25",
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: {
          name: "open-brain",
          version: "1.0.0",
        },
      });

    case "ping":
      return jsonrpc(id, {});

    case "tools/list":
      return jsonrpc(id, { tools: MCP_TOOLS });

    case "tools/call": {
      // Auth required for tool calls
      if (!authenticate(request, env)) {
        return jsonrpcError(id, -32600, "Unauthorized");
      }
      const toolName = params?.name;
      const args = params?.arguments || {};

      switch (toolName) {
        case "capture_thought": {
          const source = args.source || "mcp";
          const result = await captureThought(env, args.content, source);
          // Embed in background — response returns immediately
          ctx.waitUntil(embedThought(env, result.id, args.content, source));
          return jsonrpc(id, {
            content: [
              {
                type: "text",
                text: `Thought captured (id: ${result.id}). Embedding in background — semantic search available shortly.`,
              },
            ],
          });
        }

        case "search_thoughts": {
          const results = await searchThoughts(env, args.query, args.limit || 10);
          if (results.length === 0) {
            return jsonrpc(id, {
              content: [
                { type: "text", text: "No matching thoughts found." },
              ],
            });
          }
          const formatted = results
            .map(
              (r: any, i: number) =>
                `${i + 1}. [${r.score.toFixed(3)}] (${r.created_at}) ${r.content}`
            )
            .join("\n\n");
          return jsonrpc(id, {
            content: [{ type: "text", text: formatted }],
          });
        }

        case "list_recent": {
          const results = await listRecent(env, args.limit || 20);
          if (results.length === 0) {
            return jsonrpc(id, {
              content: [{ type: "text", text: "No thoughts captured yet." }],
            });
          }
          const formatted = results
            .map(
              (r: any, i: number) =>
                `${i + 1}. (${r.created_at}) [${r.source}] ${r.content}`
            )
            .join("\n\n");
          return jsonrpc(id, {
            content: [{ type: "text", text: formatted }],
          });
        }

        default:
          return jsonrpcError(id, -32601, `Unknown tool: ${toolName}`);
      }
    }

    default:
      return jsonrpcError(id, -32601, `Method not found: ${method}`);
  }
}

// ─── Main Router ────────────────────────────────────────────────────────
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/" && request.method === "GET") {
      return new Response("Open Brain on Cloudflare is running.", { status: 200 });
    }

    // OAuth discovery — return 404 so mcp-remote skips OAuth
    if (url.pathname.startsWith("/.well-known/")) {
      return new Response("Not found", { status: 404 });
    }

    // MCP endpoint — handle GET for SSE transport discovery
    if (url.pathname === "/mcp" && request.method === "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    // MCP endpoint — handle DELETE for session cleanup
    if (url.pathname === "/mcp" && request.method === "DELETE") {
      return new Response(null, { status: 200 });
    }

    // MCP endpoint — before auth so initialize handshake works
    if (url.pathname === "/mcp" && request.method === "POST") {
      return handleMCP(request, env, ctx);
    }

    // All other routes require auth
    if (!authenticate(request, env)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // REST: Capture
    if (url.pathname === "/capture" && request.method === "POST") {
      const { content, source } = (await request.json()) as any;
      if (!content) {
        return Response.json({ error: "content is required" }, { status: 400 });
      }
      const src = source || "api";
      const result = await captureThought(env, content, src);
      ctx.waitUntil(embedThought(env, result.id, content, src));
      return Response.json({ ...result, status: "captured, embedding in background" });
    }

    // REST: Search
    if (url.pathname === "/search" && request.method === "POST") {
      const { query, limit } = (await request.json()) as any;
      if (!query) {
        return Response.json({ error: "query is required" }, { status: 400 });
      }
      const results = await searchThoughts(env, query, limit || 10);
      return Response.json({ results });
    }

    // REST: Recent
    if (url.pathname === "/recent" && request.method === "GET") {
      const limit = parseInt(url.searchParams.get("limit") || "20");
      const results = await listRecent(env, limit);
      return Response.json({ results });
    }

    // REST: Process pending embeddings (retry failed or batched)
    if (url.pathname === "/embed-pending" && request.method === "POST") {
      const limit = parseInt(url.searchParams.get("limit") || "10");
      const count = await embedPending(env, limit);
      return Response.json({ processed: count });
    }

    // Slack webhook (optional — for Slack capture)
    if (url.pathname === "/slack" && request.method === "POST") {
      return handleSlack(request, env, ctx);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
};

// ─── Slack Handler (Optional) ───────────────────────────────────────────
async function handleSlack(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await request.text();

  try {
    const json = JSON.parse(body);
    if (json.type === "url_verification") {
      return new Response(json.challenge, { status: 200 });
    }

    if (json.type === "event_callback" && json.event?.type === "message") {
      const event = json.event;

      // Skip bot messages and edits
      if (event.bot_id || event.subtype) {
        return new Response("ok", { status: 200 });
      }

      if (event.text) {
        const result = await captureThought(env, event.text, "slack");
        ctx.waitUntil(embedThought(env, result.id, event.text, "slack"));
      }
    }
  } catch {
    // Not JSON — ignore
  }

  return new Response("ok", { status: 200 });
}
