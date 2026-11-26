import type { Deps, FetchApp } from "./types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-brain-key, accept, mcp-session-id, mcp-protocol-version, last-event-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
};

const UNAUTHORIZED_MESSAGE = "Unauthorized: missing or invalid authentication.";

function unauthorizedResponse(): Response {
  const body = { jsonrpc: "2.0", error: { code: -32001, message: UNAUTHORIZED_MESSAGE }, id: null };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

export function createApp(_deps: Deps): FetchApp {
  return {
    fetch(request: Request): Response {
      if (request.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
      return unauthorizedResponse();
    },
  };
}

export function productionDeps(): Deps {
  throw new Error("not implemented");
}
