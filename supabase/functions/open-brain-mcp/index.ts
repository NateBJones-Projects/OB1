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

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
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

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note", "decision", "action_item", "question"
- "sentiment": one of "positive", "neutral", "negative"
Only extract what's explicitly there.`,
        },
        { role: "user", content: text },
      ],
    }),
  });
  const d = await r.json();
  try {
    return JSON.parse(d.choices[0].message.content);
  } catch {
    return { topics: ["uncategorized"], type: "observation", sentiment: "neutral" };
  }
}

// --- MCP Server Setup ---

const server = new McpServer({
  name: "open-brain",
  version: "1.0.0",
});

// Tool 1: Semantic Search
server.registerTool(
  "search_thoughts",
  {
    title: "Search Thoughts",
    description:
      "Search captured thoughts by meaning. Use this when the user asks about a topic, person, or idea they've previously captured.",
    inputSchema: {
      query: z.string().describe("What to search for"),
      limit: z.number().optional().default(10),
      threshold: z.number().optional().default(0.5),
    },
  },
  async ({ query, limit, threshold }) => {
    try {
      const qEmb = await getEmbedding(query);
      const { data, error } = await supabase.rpc("match_thoughts", {
        query_embedding: qEmb,
        match_threshold: threshold,
        match_count: limit,
        filter: {},
      });

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Search error: ${error.message}` }],
          isError: true,
        };
      }

      if (!data || data.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No thoughts found matching "${query}".` }],
        };
      }

      const results = data.map(
        (
          t: {
            content: string;
            metadata: Record<string, unknown>;
            similarity: number;
            created_at: string;
          },
          i: number
        ) => {
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
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${data.length} thought(s):\n\n${results.join("\n\n")}`,
          },
        ],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// Tool 2: List Recent
server.registerTool(
  "list_thoughts",
  {
    title: "List Recent Thoughts",
    description:
      "List recently captured thoughts with optional filters by type, topic, person, or time range.",
    inputSchema: {
      limit: z.number().optional().default(10),
      type: z.string().optional().describe("Filter by type: observation, task, idea, reference, person_note, decision, action_item, question"),
      topic: z.string().optional().describe("Filter by topic tag"),
      person: z.string().optional().describe("Filter by person mentioned"),
      days: z.number().optional().describe("Only thoughts from the last N days"),
    },
  },
  async ({ limit, type, topic, person, days }) => {
    try {
      let q = supabase
        .from("thoughts")
        .select("content, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (type) q = q.contains("metadata", { type });
      if (topic) q = q.contains("metadata", { topics: [topic] });
      if (person) q = q.contains("metadata", { people: [person] });
      if (days) {
        const since = new Date();
        since.setDate(since.getDate() - days);
        q = q.gte("created_at", since.toISOString());
      }

      const { data, error } = await q;

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }

      if (!data || !data.length) {
        return { content: [{ type: "text" as const, text: "No thoughts found." }] };
      }

      const results = data.map(
        (
          t: { content: string; metadata: Record<string, unknown>; created_at: string },
          i: number
        ) => {
          const m = t.metadata || {};
          const tags = Array.isArray(m.topics) ? (m.topics as string[]).join(", ") : "";
          return `${i + 1}. [${new Date(t.created_at).toLocaleDateString()}] (${m.type || "??"}${tags ? " - " + tags : ""})\n   ${t.content}`;
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `${data.length} recent thought(s):\n\n${results.join("\n\n")}`,
          },
        ],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// Tool 3: Stats
server.registerTool(
  "thought_stats",
  {
    title: "Thought Statistics",
    description: "Get a summary of all captured thoughts: totals, types, top topics, and people.",
    inputSchema: {},
  },
  async () => {
    try {
      const { count } = await supabase
        .from("thoughts")
        .select("*", { count: "exact", head: true });

      const { data } = await supabase
        .from("thoughts")
        .select("metadata, created_at")
        .order("created_at", { ascending: false });

      const types: Record<string, number> = {};
      const topics: Record<string, number> = {};
      const people: Record<string, number> = {};

      for (const r of data || []) {
        const m = (r.metadata || {}) as Record<string, unknown>;
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

      if (Object.keys(topics).length) {
        lines.push("", "Top topics:");
        for (const [k, v] of sort(topics)) lines.push(`  ${k}: ${v}`);
      }

      if (Object.keys(people).length) {
        lines.push("", "People mentioned:");
        for (const [k, v] of sort(people)) lines.push(`  ${k}: ${v}`);
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// Tool 4: Capture Thought
server.registerTool(
  "capture_thought",
  {
    title: "Capture Thought",
    description:
      "Save a new thought to the Open Brain. Generates an embedding and extracts metadata automatically. Use this when the user wants to save something to their brain directly from any AI client — notes, insights, decisions, or migrated content from other systems.",
    inputSchema: {
      content: z.string().describe("The thought to capture — a clear, standalone statement that will make sense when retrieved later by any AI"),
    },
  },
  async ({ content }) => {
    try {
      const [embedding, metadata] = await Promise.all([
        getEmbedding(content),
        extractMetadata(content),
      ]);

      const { error } = await supabase.from("thoughts").insert({
        content,
        embedding,
        metadata: { ...metadata, source: "mcp" },
      });

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Failed to capture: ${error.message}` }],
          isError: true,
        };
      }

      const meta = metadata as Record<string, unknown>;
      let confirmation = `Captured as ${meta.type || "thought"}`;
      if (Array.isArray(meta.topics) && meta.topics.length)
        confirmation += ` — ${(meta.topics as string[]).join(", ")}`;
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

// --- Action Tools ---

// Tool 5: Create Action
server.registerTool(
  "create_action",
  {
    title: "Create Action",
    description:
      "Create a new trackable action item. Optionally link to a source thought.",
    inputSchema: {
      content: z.string().describe("What needs to be done"),
      due_date: z.string().optional().describe("Deadline in YYYY-MM-DD format"),
      tags: z.array(z.string()).optional().describe("Categorization tags"),
      thought_id: z.string().optional().describe("UUID of the source thought to link"),
      blocked_by: z.string().optional().describe("What is blocking this action"),
      unblocks: z.string().optional().describe("What this action unblocks when done"),
    },
  },
  async ({ content, due_date, tags, thought_id, blocked_by, unblocks }) => {
    try {
      const row: Record<string, unknown> = { content };
      if (due_date) row.due_date = due_date;
      if (tags && tags.length) row.tags = tags;
      if (thought_id) row.thought_id = thought_id;
      if (blocked_by) row.blocked_by = blocked_by;
      if (unblocks) row.unblocks = unblocks;

      const { data, error } = await supabase
        .from("actions")
        .insert(row)
        .select("id, content, status, due_date, tags")
        .single();

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Failed to create action: ${error.message}` }],
          isError: true,
        };
      }

      let msg = `Action created (${data.id}):\n"${data.content}"`;
      if (data.due_date) msg += `\nDue: ${data.due_date}`;
      if (data.tags?.length) msg += `\nTags: ${data.tags.join(", ")}`;
      if (blocked_by) msg += `\nBlocked by: ${blocked_by}`;
      if (unblocks) msg += `\nUnblocks: ${unblocks}`;

      return { content: [{ type: "text" as const, text: msg }] };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// Tool 6: Update Action
server.registerTool(
  "update_action",
  {
    title: "Update Action",
    description:
      "Update any mutable field on an action: status, due_date, blocked_by, unblocks, or tags.",
    inputSchema: {
      id: z.string().describe("UUID of the action to update"),
      status: z.enum(["open", "in_progress", "done", "cancelled"]).optional().describe("New status"),
      due_date: z.string().optional().describe("New deadline in YYYY-MM-DD format"),
      blocked_by: z.string().optional().describe("What is blocking this action"),
      unblocks: z.string().optional().describe("What this action unblocks"),
      tags: z.array(z.string()).optional().describe("Replace tags with this list"),
    },
  },
  async ({ id, status, due_date, blocked_by, unblocks, tags }) => {
    try {
      const updates: Record<string, unknown> = {};
      if (status !== undefined) updates.status = status;
      if (due_date !== undefined) updates.due_date = due_date;
      if (blocked_by !== undefined) updates.blocked_by = blocked_by;
      if (unblocks !== undefined) updates.unblocks = unblocks;
      if (tags !== undefined) updates.tags = tags;

      if (Object.keys(updates).length === 0) {
        return {
          content: [{ type: "text" as const, text: "No fields to update." }],
        };
      }

      const { data, error } = await supabase
        .from("actions")
        .update(updates)
        .eq("id", id)
        .select("id, content, status, due_date, tags, blocked_by, unblocks")
        .single();

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Failed to update: ${error.message}` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Updated action (${data.id}):\n"${data.content}"\nStatus: ${data.status}${data.due_date ? `\nDue: ${data.due_date}` : ""}${data.blocked_by ? `\nBlocked by: ${data.blocked_by}` : ""}${data.unblocks ? `\nUnblocks: ${data.unblocks}` : ""}${data.tags?.length ? `\nTags: ${data.tags.join(", ")}` : ""}`,
          },
        ],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// Tool 7: Complete Action
server.registerTool(
  "complete_action",
  {
    title: "Complete Action",
    description:
      "Mark an action as done. Requires a completion note documenting what was done, who was unblocked, and what deadline was met.",
    inputSchema: {
      id: z.string().describe("UUID of the action to complete"),
      completion_note: z.string().describe("What was done, who was unblocked, what deadline was met"),
    },
  },
  async ({ id, completion_note }) => {
    try {
      const { data, error } = await supabase
        .from("actions")
        .update({
          status: "done",
          completed_at: new Date().toISOString(),
          completion_note,
        })
        .eq("id", id)
        .select("id, content, completed_at, completion_note")
        .single();

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Failed to complete: ${error.message}` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Action completed (${data.id}):\n"${data.content}"\nCompleted: ${new Date(data.completed_at).toLocaleDateString()}\nNote: ${data.completion_note}`,
          },
        ],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// Tool 8: List Actions
server.registerTool(
  "list_actions",
  {
    title: "List Actions",
    description:
      "List actions filtered by status, recency, or tag. Default: open actions sorted by due_date (nulls last).",
    inputSchema: {
      status: z.enum(["open", "in_progress", "done", "cancelled"]).optional().describe("Filter by status (default: open)"),
      days: z.number().optional().describe("Only actions from the last N days"),
      tag: z.string().optional().describe("Filter by tag"),
      limit: z.number().optional().default(20).describe("Max results"),
    },
  },
  async ({ status, days, tag, limit }) => {
    try {
      let q = supabase
        .from("actions")
        .select("id, content, status, due_date, tags, blocked_by, unblocks, created_at, completed_at, completion_note")
        .limit(limit);

      // Default to open if no status specified
      if (status) {
        q = q.eq("status", status);
      } else {
        q = q.eq("status", "open");
      }

      if (days) {
        const since = new Date();
        since.setDate(since.getDate() - days);
        q = q.gte("created_at", since.toISOString());
      }

      if (tag) {
        q = q.contains("tags", [tag]);
      }

      // Sort by due_date ascending (nulls last) for open/in_progress, by completed_at desc for done
      if (!status || status === "open" || status === "in_progress") {
        q = q.order("due_date", { ascending: true, nullsFirst: false });
      } else {
        q = q.order("completed_at", { ascending: false });
      }

      const { data, error } = await q;

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }

      if (!data || !data.length) {
        return {
          content: [{ type: "text" as const, text: `No ${status || "open"} actions found.` }],
        };
      }

      const results = data.map(
        (a: {
          id: string;
          content: string;
          status: string;
          due_date: string | null;
          tags: string[];
          blocked_by: string | null;
          unblocks: string | null;
          created_at: string;
          completed_at: string | null;
          completion_note: string | null;
        }, i: number) => {
          const parts = [`${i + 1}. [${a.status}] ${a.content}`];
          parts.push(`   ID: ${a.id}`);
          if (a.due_date) parts.push(`   Due: ${a.due_date}`);
          if (a.tags?.length) parts.push(`   Tags: ${a.tags.join(", ")}`);
          if (a.blocked_by) parts.push(`   Blocked by: ${a.blocked_by}`);
          if (a.unblocks) parts.push(`   Unblocks: ${a.unblocks}`);
          if (a.completed_at) parts.push(`   Completed: ${new Date(a.completed_at).toLocaleDateString()}`);
          if (a.completion_note) parts.push(`   Note: ${a.completion_note}`);
          return parts.join("\n");
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `${data.length} action(s):\n\n${results.join("\n\n")}`,
          },
        ],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// Tool 9: Search Actions
server.registerTool(
  "search_actions",
  {
    title: "Search Actions",
    description:
      "Full-text search across action content and completion notes.",
    inputSchema: {
      query: z.string().describe("Search text"),
      limit: z.number().optional().default(10).describe("Max results"),
    },
  },
  async ({ query, limit }) => {
    try {
      // Search content and completion_note using ilike
      const { data, error } = await supabase
        .from("actions")
        .select("id, content, status, due_date, tags, blocked_by, unblocks, completed_at, completion_note, created_at")
        .or(`content.ilike.%${query}%,completion_note.ilike.%${query}%`)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Search error: ${error.message}` }],
          isError: true,
        };
      }

      if (!data || !data.length) {
        return {
          content: [{ type: "text" as const, text: `No actions matching "${query}".` }],
        };
      }

      const results = data.map(
        (a: {
          id: string;
          content: string;
          status: string;
          due_date: string | null;
          tags: string[];
          completed_at: string | null;
          completion_note: string | null;
          created_at: string;
        }, i: number) => {
          const parts = [`${i + 1}. [${a.status}] ${a.content}`];
          parts.push(`   ID: ${a.id}`);
          if (a.due_date) parts.push(`   Due: ${a.due_date}`);
          if (a.tags?.length) parts.push(`   Tags: ${a.tags.join(", ")}`);
          if (a.completion_note) parts.push(`   Completion: ${a.completion_note}`);
          parts.push(`   Created: ${new Date(a.created_at).toLocaleDateString()}`);
          return parts.join("\n");
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `${data.length} action(s) matching "${query}":\n\n${results.join("\n\n")}`,
          },
        ],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// --- Hono App with Auth Check ---

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

  // Accept access key via header OR URL query parameter
  const provided = c.req.header("x-brain-key") || new URL(c.req.url).searchParams.get("key");
  if (!provided || provided !== MCP_ACCESS_KEY) {
    return c.json({ error: "Invalid or missing access key" }, 401);
  }

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

Deno.serve(app.fetch);
