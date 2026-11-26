import { StreamableHTTPTransport } from "npm:@hono/mcp@0.1.1";
import { Hono } from "npm:hono@4.9.2";
import { createSupabaseThoughtStore } from "./thought_store.ts";
import { buildServer } from "./tools.ts";
import type { Deps, FetchApp } from "./types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-brain-key, accept, mcp-session-id, mcp-protocol-version, last-event-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
};

const UNAUTHORIZED_MESSAGE = "Unauthorized: missing or invalid authentication.";

/** Best-effort JSON-RPC id from a raw body: a string, number or null is kept, anything else becomes null. */
function extractJsonRpcId(bodyText: string | null): string | number | null {
  if (!bodyText) return null;
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed && typeof parsed === "object" && "id" in parsed) {
      const id = (parsed as { id: unknown }).id;
      if (typeof id === "string" || typeof id === "number" || id === null) return id;
    }
  } catch {
    // malformed body
  }
  return null;
}

async function readBodyText(req: Request): Promise<string | null> {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "DELETE") return null;
  try {
    return await req.text();
  } catch {
    return null;
  }
}

function unauthorizedResponse(id: string | number | null): Response {
  const body = { jsonrpc: "2.0", error: { code: -32001, message: UNAUTHORIZED_MESSAGE }, id };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

/** One fresh server and transport per request, as in core. */
async function serveMcp(deps: Deps, request: Request): Promise<Response> {
  const server = buildServer(deps);
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  // Claude Desktop connectors omit the Accept header the transport requires (issue #33).
  if (!request.headers.get("accept")?.includes("text/event-stream")) {
    const headers = new Headers(request.headers);
    headers.set("Accept", "application/json, text/event-stream");
    request = new Request(request.url, {
      method: request.method,
      headers,
      body: request.body,
      // @ts-ignore -- duplex is required for a streaming body in Deno
      duplex: "half",
    });
  }
  const hono = new Hono();
  hono.all("*", (c) => transport.handleRequest(c));
  const response = await hono.fetch(request);
  for (const [k, v] of Object.entries(corsHeaders)) response.headers.set(k, v);
  return response;
}

export function createApp(deps: Deps): FetchApp {
  return {
    async fetch(request: Request): Promise<Response> {
      if (request.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
      const provided = request.headers.get("x-brain-key") || new URL(request.url).searchParams.get("key");
      const accessKey = deps.getEnv("MCP_ACCESS_KEY");
      if (!provided || !accessKey || provided !== accessKey) {
        return unauthorizedResponse(extractJsonRpcId(await readBodyText(request)));
      }
      return await serveMcp(deps, request);
    },
  };
}

export function productionDeps(): Deps {
  const getEnv = (name: string) => Deno.env.get(name);
  return {
    getEnv,
    modelFetch: globalThis.fetch,
    store: createSupabaseThoughtStore(getEnv("SUPABASE_URL") ?? "", getEnv("SUPABASE_SERVICE_ROLE_KEY") ?? "", globalThis.fetch),
  };
}
