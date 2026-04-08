import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.47.10";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;
const OLLAMA_BASE_URL = Deno.env.get("OLLAMA_BASE_URL") ?? "http://127.0.0.1:11434";
const OLLAMA_EMBED_MODEL = Deno.env.get("OLLAMA_EMBED_MODEL") ?? "nomic-embed-text";
const OLLAMA_CHAT_MODEL = Deno.env.get("OLLAMA_CHAT_MODEL") ?? "qwen3.5:2b-q4_K_M";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-brain-key, accept, mcp-session-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
};

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, prompt: text }),
  });
  if (!r.ok) throw new Error(`Ollama embeddings failed: ${r.status} ${await r.text()}`);
  const d = await r.json();
  if (!Array.isArray(d.embedding)) throw new Error("Missing embedding array");
  return d.embedding;
}

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const r = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_CHAT_MODEL,
        format: "json",
        stream: false,
        options: { num_predict: 120, temperature: 0 },
        messages: [
          {
            role: "system",
            content:
              `Return valid JSON only with keys people, action_items, dates_mentioned, topics, type. Keep it minimal and only use explicitly present information.`,
          },
          { role: "user", content: text },
        ],
      }),
    });
    if (!r.ok) throw new Error(`Ollama metadata extraction failed: ${r.status} ${await r.text()}`);
    const d = await r.json();
    try {
      return JSON.parse(d.message.content);
    } catch {
      return { topics: ["uncategorized"], type: "observation" };
    }
  } catch {
    return { topics: ["uncategorized"], type: "observation" };
  } finally {
    clearTimeout(timeout);
  }
}

function sse(data: unknown) {
  return `event: message\ndata: ${JSON.stringify(data)}\n\n`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const key = req.headers.get("x-brain-key") || url.searchParams.get("key");
  if (!key || key !== MCP_ACCESS_KEY) {
    return Response.json({ error: "Invalid or missing access key" }, { status: 401, headers: corsHeaders });
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (body?.method === "tools/list") {
      const payload = {
        jsonrpc: "2.0",
        id: body.id,
        result: {
          tools: [
            { name: "search_thoughts", description: "Search captured thoughts by meaning.", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number", default: 10 }, threshold: { type: "number", default: 0.5 } }, required: ["query"] } },
            { name: "list_thoughts", description: "List recently captured thoughts.", inputSchema: { type: "object", properties: { limit: { type: "number", default: 10 }, type: { type: "string" }, topic: { type: "string" }, person: { type: "string" }, days: { type: "number" } } } },
            { name: "thought_stats", description: "Get summary statistics for thoughts.", inputSchema: { type: "object", properties: {} } },
            { name: "capture_thought", description: "Save a new thought.", inputSchema: { type: "object", properties: { content: { type: "string" } }, required: ["content"] } },
          ],
        },
      };
      return new Response(sse(payload), { headers: { ...corsHeaders, "content-type": "text/event-stream" } });
    }

    if (body?.method === "tools/call") {
      const name = body?.params?.name;
      const args = body?.params?.arguments ?? {};
      try {
        let text = "";
        if (name === "capture_thought") {
          const content = String(args.content ?? "");
          const [embedding, metadata] = await Promise.all([getEmbedding(content), extractMetadata(content)]);
          const { data: upsertResult, error: upsertError } = await supabase.rpc("upsert_thought", {
            p_content: content,
            p_payload: { metadata: { ...metadata, source: "local-mcp" } },
          });
          if (upsertError) throw new Error(upsertError.message);
          const thoughtId = upsertResult?.id;
          const { error: embError } = await supabase.from("thoughts").update({ embedding }).eq("id", thoughtId);
          if (embError) throw new Error(embError.message);
          text = `Captured thought ${thoughtId}`;
        } else if (name === "search_thoughts") {
          const qEmb = await getEmbedding(String(args.query ?? ""));
          const { data, error } = await supabase.rpc("match_thoughts", {
            query_embedding: qEmb,
            match_threshold: Number(args.threshold ?? 0.5),
            match_count: Number(args.limit ?? 10),
            filter: {},
          });
          if (error) throw new Error(error.message);
          text = JSON.stringify(data ?? [], null, 2);
        } else if (name === "list_thoughts") {
          let q = supabase.from("thoughts").select("content, metadata, created_at").order("created_at", { ascending: false }).limit(Number(args.limit ?? 10));
          if (args.type) q = q.contains("metadata", { type: args.type });
          if (args.topic) q = q.contains("metadata", { topics: [args.topic] });
          if (args.person) q = q.contains("metadata", { people: [args.person] });
          if (args.days) {
            const since = new Date();
            since.setDate(since.getDate() - Number(args.days));
            q = q.gte("created_at", since.toISOString());
          }
          const { data, error } = await q;
          if (error) throw new Error(error.message);
          text = JSON.stringify(data ?? [], null, 2);
        } else if (name === "thought_stats") {
          const { count } = await supabase.from("thoughts").select("*", { count: "exact", head: true });
          text = JSON.stringify({ total: count ?? 0 });
        } else {
          throw new Error(`Unknown tool: ${name}`);
        }

        const payload = { jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text }] } };
        return new Response(sse(payload), { headers: { ...corsHeaders, "content-type": "text/event-stream" } });
      } catch (err) {
        const payload = { jsonrpc: "2.0", id: body.id, error: { code: -32000, message: err instanceof Error ? err.message : String(err) } };
        return new Response(sse(payload), { status: 200, headers: { ...corsHeaders, "content-type": "text/event-stream" } });
      }
    }
  }

  return Response.json({ ok: true, service: "local-open-brain-mcp" }, { headers: corsHeaders });
});
