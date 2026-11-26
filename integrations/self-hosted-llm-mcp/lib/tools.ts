import { McpServer } from "npm:@modelcontextprotocol/sdk@1.24.3/server/mcp.js";
import { z } from "npm:zod@4.1.13";
import { resolveConfig } from "./config.ts";
import { createModelClient } from "./model_client.ts";
import type { Deps, ModelClient } from "./types.ts";

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
  /** Resolves the configuration for this call and builds the model client. */
  const models = (): ModelClient => {
    const config = resolveConfig(deps.getEnv);
    if (!config.ok) throw new Error("configuration incomplete");
    return createModelClient(config, deps.modelFetch);
  };
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
  }, async ({ query, limit, threshold }) => {
    try {
      const embedded = await models().embed(query);
      if (!embedded.ok) throw new Error(embedded.message);
      const res = await store.matchThoughts(embedded.value, 0.5, 10);
      if ("error" in res) return text(`Search error: ${res.error}`, true);
      return text("");
    } catch (err) {
      return errorText(err);
    }
  });
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
  }, async ({ limit, type, topic, person, days }) => {
    try {
      const res = await store.listThoughts({
        limit,
        ...(type ? { type } : {}),
        ...(topic ? { topic } : {}),
        ...(person ? { person } : {}),
        ...(days ? { days } : {}),
      });
      if ("error" in res) return text(`Error: ${res.error}`, true);
      if (!res.data.length) return text("No thoughts found.");
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
  }, async () => {
    try {
      const res = await store.stats();
      const { count, rows: data } = "data" in res ? res.data : { count: null, rows: [] };
      const types: Record<string, number> = {};
      const topics: Record<string, number> = {};
      const people: Record<string, number> = {};
      for (const r of data) {
        const m = (r.metadata || {}) as Record<string, unknown>;
        if (m.type) types[m.type as string] = (types[m.type as string] || 0) + 1;
        if (Array.isArray(m.topics)) for (const t of m.topics) topics[t as string] = (topics[t as string] || 0) + 1;
        if (Array.isArray(m.people)) for (const p of m.people) people[p as string] = (people[p as string] || 0) + 1;
      }
      const sort = (o: Record<string, number>): [string, number][] =>
        Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 10);
      const lines: string[] = [
        `Total thoughts: ${count}`,
        `Date range: ${
          data.length
            ? new Date(data[data.length - 1].created_at).toLocaleDateString() + " → " +
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
      return text(lines.join("\n"));
    } catch (err) {
      return errorText(err);
    }
  });
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
