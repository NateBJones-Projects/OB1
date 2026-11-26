import { McpServer } from "npm:@modelcontextprotocol/sdk@1.24.3/server/mcp.js";
import { z } from "npm:zod@4.1.13";
import type { Deps } from "./types.ts";

type ToolReply = { content: { type: "text"; text: string }[]; isError?: boolean };

const notYet = (): Promise<ToolReply> => Promise.resolve({ content: [{ type: "text", text: "not implemented" }] });

export function buildServer(_deps: Deps): McpServer {
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
  }, notYet);
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
  }, notYet);
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
