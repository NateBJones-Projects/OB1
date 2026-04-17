// ✅ Unified edge function with Mcp-Session-Id reuse.
//
// Key elements:
//  - Singleton McpServer + Supabase client at module scope (no per-request
//    reconstruction)
//  - app.options("*") returns CORS preflights cheaply BEFORE auth
//  - Mcp-Session-Id header is minted on first request and reused on
//    subsequent ones, collapsing the 4-step MCP handshake
//  - Access-Control-Expose-Headers includes mcp-session-id so browser
//    clients (Claude Desktop, claude.ai) can read it off the response

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Hono } from "hono";
import { StreamableHTTPTransport } from "@hono/mcp";
import { server } from "./server.ts";

const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

// ── Session reuse ──────────────────────────────────────────────────────────
type Session = { transport: StreamableHTTPTransport; lastSeen: number };
const sessions = new Map<string, Session>();
const SESSION_TTL_MS = 30 * 60 * 1000;

function pruneExpiredSessions(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of sessions) {
    if (s.lastSeen < cutoff) sessions.delete(id);
  }
}

// ── CORS ───────────────────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-brain-key, x-access-key, accept, mcp-session-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
  "Access-Control-Expose-Headers": "mcp-session-id", // ← critical for browser clients
};

const app = new Hono();

// Preflight returned BEFORE auth — Supabase doesn't bill OPTIONS, but
// unhandled OPTIONS cause client retries that DO bill.
app.options("*", (c) => c.text("ok", 200, corsHeaders));

app.all("*", async (c) => {
  const provided =
    c.req.header("x-brain-key") ||
    c.req.header("x-access-key") ||
    new URL(c.req.url).searchParams.get("key");
  if (!provided || provided !== MCP_ACCESS_KEY) {
    return c.json({ error: "Invalid or missing access key" }, 401, corsHeaders);
  }

  pruneExpiredSessions();

  // Patch missing Accept header for Claude Desktop compatibility (PR #94).
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

  // ── Session lookup or mint ───────────────────────────────────────────────
  const sid = c.req.header("mcp-session-id") || undefined;
  let session = sid ? sessions.get(sid) : undefined;
  let id = sid;

  if (!session) {
    id = crypto.randomUUID();
    const transport = new StreamableHTTPTransport();
    await server.connect(transport); // bind once per session, not per request
    session = { transport, lastSeen: Date.now() };
    sessions.set(id, session);
  } else {
    session.lastSeen = Date.now();
  }

  c.header("Mcp-Session-Id", id!);
  for (const [k, v] of Object.entries(corsHeaders)) c.header(k, v);

  return session.transport.handleRequest(c);
});

Deno.serve(app.fetch);
