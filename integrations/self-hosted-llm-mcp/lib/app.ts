import type { Deps, FetchApp } from "./types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-brain-key, accept, mcp-session-id, mcp-protocol-version, last-event-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
};

export function createApp(_deps: Deps): FetchApp {
  return {
    fetch(request: Request): Response {
      if (request.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
      throw new Error("not implemented");
    },
  };
}

export function productionDeps(): Deps {
  throw new Error("not implemented");
}
