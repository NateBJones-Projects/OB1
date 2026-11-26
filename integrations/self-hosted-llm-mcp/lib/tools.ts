import { McpServer } from "npm:@modelcontextprotocol/sdk@1.24.3/server/mcp.js";
import { z } from "npm:zod@4.1.13";
import type { Deps } from "./types.ts";

type ToolReply = { content: { type: "text"; text: string }[]; isError?: boolean };

const text = (t: string, isError = false): ToolReply => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });
const errorText = (err: unknown): ToolReply => text(`Error: ${(err as Error).message}`, true);

function thoughtTitle(content: string, createdAt?: string): string {
  const firstLine = content.replace(/\s+/g, " ").trim().slice(0, 80);
  const datePrefix = createdAt ? new Date(createdAt).toLocaleDateString() : "Open Brain";
  return firstLine ? `${datePrefix} - ${firstLine}` : `${datePrefix} thought`;
}

const notYet = (): Promise<ToolReply> => Promise.resolve({ content: [{ type: "text", text: "not implemented" }] });

export function buildServer(deps: Deps): McpServer {
  const { store } = deps;
  const thoughtUrl = (id: string): string =>
    `${(deps.getEnv("OPEN_BRAIN_CITATION_BASE_URL") || "https://openbrain.local/thoughts").replace(/\/$/, "")}/${id}`;

  const server = new McpServer({ name: "open-brain", version: "1.0.0" });
  server.registerTool("search", {
    title: "Search Open Brain",
    description:
      "Search Open Brain memories by meaning. Use this read-only compatibility tool when ChatGPT needs search/fetch-style access to stored thoughts.",
    annotations: { readOnlyHint: true },
    inputSchema: { query: z.string().describe("The search query to run against Open Brain thoughts") },
  }, notYet);
  server.registerTool("fetch", {
    title: "Fetch Open Brain Thought",
    description:
      "Fetch one Open Brain thought by ID after using search. Use this read-only compatibility tool to retrieve the full text and metadata for citation.",
    annotations: { readOnlyHint: true },
    inputSchema: { id: z.string().describe("The Open Brain thought ID returned by the search tool") },
  }, async ({ id }) => {
    try {
      const res = await store.fetchThought(id);
      if ("error" in res) return text(`Fetch error: ${res.error}`, true);
      const thought = res.data;
      return text(JSON.stringify({
        id: thought.id,
        title: thoughtTitle(thought.content, thought.created_at),
        text: thought.content,
        url: thoughtUrl(thought.id),
        metadata: { ...thought.metadata, created_at: thought.created_at, updated_at: thought.updated_at },
      }));
    } catch (err) {
      return errorText(err);
    }
  });
  server.registerTool("search_thoughts", {
    title: "Search Thoughts",
    description:
      "Search captured thoughts by meaning. Use this when the user asks about a topic, person, or idea they've previously captured.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      query: z.string().describe("What to search for"),
      limit: z.number().optional().default(10),
      threshold: z.number().optional().default(0.5),
    },
  }, notYet);
  server.registerTool("list_thoughts", {
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
  }, async ({ limit }) => {
    try {
      const res = await store.listThoughts({ limit });
      if ("error" in res) return text(`Error: ${res.error}`, true);
      const results = res.data.map((t, i) => {
        const m = t.metadata || {};
        const tags = Array.isArray(m.topics) ? (m.topics as string[]).join(", ") : "";
        return `${i + 1}. [${new Date(t.created_at).toLocaleDateString()}] (${m.type || "??"}${tags ? " - " + tags : ""})\n   ${t.content}`;
      });
      return text(`${res.data.length} recent thought(s):\n\n${results.join("\n\n")}`);
    } catch (err) {
      return errorText(err);
    }
  });
  server.registerTool("thought_stats", {
    title: "Thought Statistics",
    description: "Get a summary of all captured thoughts: totals, types, top topics, and people.",
    annotations: { readOnlyHint: true },
    inputSchema: {},
  }, notYet);
  server.registerTool("capture_thought", {
    title: "Capture Thought",
    description:
      "Save a new thought to the Open Brain. Generates an embedding and extracts metadata automatically. Use this when the user wants to save something to their brain directly from any AI client — notes, insights, decisions, or migrated content from other systems.",
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      content: z.string().describe(
        "The thought to capture — a clear, standalone statement that will make sense when retrieved later by any AI",
      ),
    },
  }, notYet);
  return server;
}
