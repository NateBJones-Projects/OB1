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
