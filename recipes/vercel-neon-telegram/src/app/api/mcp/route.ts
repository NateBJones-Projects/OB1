export const maxDuration = 30;

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { captureThought } from "@/lib/capture";
import { searchThoughts, listThoughts } from "@/lib/db";
import { generateEmbedding } from "@/lib/ai";

const MAX_CONTENT_LENGTH = 10_000;

function createOpenBrainMcp(): McpServer {
  const server = new McpServer({
    name: "open-brain",
    version: "1.0.0",
  });

  server.tool(
    "capture_thought",
    "Save a thought to your Open Brain. It will be automatically embedded and classified.",
    { content: z.string().max(MAX_CONTENT_LENGTH).describe("The thought, note, or observation to capture") },
    async ({ content }) => {
      const rl = checkRateLimit();
      if (!rl.ok) {
        return { content: [{ type: "text" as const, text: "Rate limit exceeded. Try again in a minute." }] };
      }
      const result = await captureThought(content, "mcp");
      return {
        content: [
          {
            type: "text" as const,
            text: `Captured thought (${result.metadata.type}). Topics: ${result.metadata.topics.join(", ") || "none"}.${
              result.metadata.action_items.length
                ? ` Action items: ${result.metadata.action_items.join("; ")}`
                : ""
            }`,
          },
        ],
      };
    },
  );

  server.tool(
    "search_thoughts",
    "Search your Open Brain by meaning using semantic vector search.",
    {
      query: z.string().describe("What to search for"),
      threshold: z.number().min(0).max(1).optional().describe("Similarity threshold (0-1, default 0.7)"),
      limit: z.number().min(1).max(50).optional().describe("Max results (default 10)"),
      type: z.string().optional().describe("Filter by type: observation, task, idea, reference, person_note, decision, meeting_note"),
      topic: z.string().optional().describe("Filter by topic tag"),
    },
    async ({ query, threshold, limit, type, topic }) => {
      const queryEmbedding = await generateEmbedding(query);
      const filter: Record<string, string> = {};
      if (type) filter.type = type;
      if (topic) filter.topics = topic;

      const results = await searchThoughts(queryEmbedding, {
        threshold: threshold ?? 0.7,
        limit: limit ?? 10,
        filter: Object.keys(filter).length > 0 ? filter : undefined,
      });

      if (results.length === 0) {
        return { content: [{ type: "text" as const, text: "No matching thoughts found." }] };
      }

      const text = results
        .map(
          (t, i) =>
            `${i + 1}. [${t.metadata.type}] (${Math.round((t.similarity ?? 0) * 100)}% match, ${t.source})\n   ${t.content}\n   Topics: ${t.metadata.topics.join(", ") || "none"} | ${t.created_at}`,
        )
        .join("\n\n");

      return { content: [{ type: "text" as const, text }] };
    },
  );

  server.tool(
    "list_thoughts",
    "Browse recent thoughts in your Open Brain chronologically.",
    {
      limit: z.number().min(1).max(50).optional().describe("Max results (default 20)"),
      type: z.string().optional().describe("Filter by type"),
      topic: z.string().optional().describe("Filter by topic tag"),
      since: z.string().optional().describe("Only thoughts after this ISO date"),
    },
    async ({ limit, type, topic, since }) => {
      const results = await listThoughts({ limit: limit ?? 20, type, topic, since });

      if (results.length === 0) {
        return { content: [{ type: "text" as const, text: "No thoughts found." }] };
      }

      const text = results
        .map(
          (t, i) =>
            `${i + 1}. [${t.metadata.type}] (${t.source})\n   ${t.content}\n   Topics: ${t.metadata.topics.join(", ") || "none"} | ${t.created_at}`,
        )
        .join("\n\n");

      return { content: [{ type: "text" as const, text }] };
    },
  );

  return server;
}

export async function POST(req: Request) {
  const { error } = requireAuth(req);
  if (error) return error;

  try {
    const body = await req.json();

    const server = createOpenBrainMcp();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);

    const mcpReq = new Request(req.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: req.headers.get("accept") ?? "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
    });

    const res = await transport.handleRequest(mcpReq, { parsedBody: body });

    if (!res) {
      return Response.json({ error: "No response from MCP server" }, { status: 500 });
    }

    return new Response(res.body, {
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
    });
  } catch (err) {
    console.error("[mcp] POST error:", err);
    return Response.json({ error: "MCP request failed" }, { status: 500 });
  }
}

export async function GET() {
  return Response.json(
    { error: "This endpoint is stateless. Use POST for all MCP requests." },
    { status: 405 },
  );
}

export async function HEAD() {
  return new Response(null, {
    status: 200,
    headers: { "MCP-Protocol-Version": "2025-03-26" },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { Allow: "GET, POST, DELETE, HEAD, OPTIONS" },
  });
}

export async function DELETE() {
  return new Response(null, { status: 204 });
}
