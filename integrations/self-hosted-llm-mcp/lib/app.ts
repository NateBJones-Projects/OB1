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

export function createApp(_deps: Deps): FetchApp {
  return {
    async fetch(request: Request): Promise<Response> {
      if (request.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
      return unauthorizedResponse(extractJsonRpcId(await readBodyText(request)));
    },
  };
}

export function productionDeps(): Deps {
  throw new Error("not implemented");
}
