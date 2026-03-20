# Thought Management Tools

> Update and delete MCP tools for managing existing thoughts in Open Brain.

## Overview

The core MCP server provides `capture_thought` for writing and `search_thoughts` for reading, but there's no way for your AI client to edit or remove thoughts. This extension adds two tools:

- **`update_thought`** — Edit a thought's content and automatically re-embed and re-classify
- **`delete_thought`** — Remove a thought by ID

These are separate from the core server to keep the base install minimal. Add them when you need your AI to manage thoughts, not just capture them.

## Why You'd Want This

- Fix typos or inaccuracies in captured thoughts
- Reclassify thoughts after reviewing them ("this isn't an idea, it's a task")
- Remove thoughts that are no longer relevant, sensitive, or were captured in error
- Let your AI maintain your second brain over time, not just append to it

## Prerequisites

- Open Brain deployed with the core MCP server
- `OPENROUTER_API_KEY` set in Edge Function secrets
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` available

## Setup

### Option A: Add to existing MCP server

Add these two tool registrations to your `server/index.ts`, after the existing tools:

```typescript
// --- update_thought tool ---
mcpServer.tool(
  "update_thought",
  "Update an existing thought's content. Re-embeds and re-classifies automatically.",
  { id: z.string().uuid(), content: z.string() },
  async ({ id, content }) => {
    const [embedding, metadata] = await Promise.all([
      getEmbedding(content),
      extractMetadata(content),
    ]);
    const { data, error } = await supabase
      .from("thoughts")
      .update({
        content,
        embedding,
        metadata: { ...metadata, source: "mcp", updated: true },
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, content, metadata")
      .single();
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    return { content: [{ type: "text", text: `Updated thought ${data.id}` }] };
  }
);

// --- delete_thought tool ---
mcpServer.tool(
  "delete_thought",
  "Permanently delete a thought by ID.",
  { id: z.string().uuid() },
  async ({ id }) => {
    const { error } = await supabase
      .from("thoughts")
      .delete()
      .eq("id", id);
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    return { content: [{ type: "text", text: `Deleted thought ${id}` }] };
  }
);
```

### Option B: Deploy as separate Edge Function

If you prefer not to modify the core server, deploy these as a standalone Edge Function. See the full implementation in the code block below.

<details>
<summary>Standalone Edge Function (click to expand)</summary>

```typescript
// supabase/functions/thought-management/index.ts
import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

async function getEmbedding(text: string): Promise<number[]> {
  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("OPENROUTER_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: text }),
  });
  const json = await res.json();
  return json.data[0].embedding;
}

async function extractMetadata(text: string) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("OPENROUTER_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      messages: [{
        role: "system",
        content: "Extract metadata from this thought. Return JSON with: people (array), action_items (array), dates_mentioned (array), topics (array), type (one of: observation, task, idea, reference, person_note)."
      }, { role: "user", content: text }],
      response_format: { type: "json_object" },
    }),
  });
  const json = await res.json();
  try { return JSON.parse(json.choices[0].message.content); }
  catch { return { topics: ["uncategorized"], type: "observation" }; }
}

const mcpServer = new McpServer({ name: "thought-management", version: "1.0.0" });

mcpServer.tool(
  "update_thought",
  "Update an existing thought's content. Re-embeds and re-classifies automatically.",
  { id: z.string().uuid(), content: z.string() },
  async ({ id, content }) => {
    const [embedding, metadata] = await Promise.all([
      getEmbedding(content),
      extractMetadata(content),
    ]);
    const { data, error } = await supabase
      .from("thoughts")
      .update({
        content,
        embedding,
        metadata: { ...metadata, source: "mcp", updated: true },
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, content, metadata")
      .single();
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    return { content: [{ type: "text", text: `Updated thought ${data.id}` }] };
  }
);

mcpServer.tool(
  "delete_thought",
  "Permanently delete a thought by ID.",
  { id: z.string().uuid() },
  async ({ id }) => {
    const { error } = await supabase.from("thoughts").delete().eq("id", id);
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    return { content: [{ type: "text", text: `Deleted thought ${id}` }] };
  }
);

const app = new Hono();
const transport = new StreamableHTTPTransport();

app.all("/mcp", async (c) => {
  const key = c.req.header("x-brain-key") || new URL(c.req.url).searchParams.get("key");
  if (key !== Deno.env.get("MCP_ACCESS_KEY")) return c.text("Unauthorized", 401);
  return transport.handleRequest(c);
});

transport.connectToServer(mcpServer);
Deno.serve(app.fetch);
```

</details>

## Expected Outcome

After setup, your AI client can:
- Search for a thought, realize it's outdated, and update it in place
- Remove duplicate or irrelevant thoughts
- Reclassify thoughts (the update re-runs extractMetadata automatically)

## Troubleshooting

**Issue: "No rows updated" when updating**
The thought ID may not exist. Use `search_thoughts` first to find valid IDs.

**Issue: Concerned about accidental deletion**
Consider adding a soft-delete pattern (set a `deleted_at` timestamp instead of removing the row). The hard delete shown here is simpler but irreversible.
