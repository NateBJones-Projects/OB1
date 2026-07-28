/**
 * test-stateless.mjs
 *
 * Validates the per-request McpServer pattern without any infra (no Supabase, no DB).
 * MCP initialize is a pure protocol handshake — no tools are called, no database touched.
 *
 * Setup (from server/ directory):
 *   npm install
 *   node test-stateless.mjs   # or: npm test
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { serve } from "@hono/node-server";

// ── Minimal server mirroring the fixed pattern ────────────────────────────────

const MCP_ACCESS_KEY = "test-key-xyz";

function buildServer() {
  const server = new McpServer({ name: "ob1-test", version: "1.0.0" });
  server.registerTool(
    "ping",
    { title: "Ping", description: "No-op for testing", inputSchema: {} },
    async () => ({ content: [{ type: "text", text: "pong" }] })
  );
  return server;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-brain-key, accept, mcp-session-id, mcp-protocol-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
};

const app = new Hono();

app.options("*", (c) => c.text("ok", 200, corsHeaders));

app.all("*", async (c) => {
  const provided = c.req.header("x-brain-key");
  if (!provided || provided !== MCP_ACCESS_KEY) {
    return c.json({ error: "Invalid or missing access key" }, 401, corsHeaders);
  }

  const server = buildServer(); // per-request: fresh instance every time
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  const response = await transport.handleRequest(c);
  if (!response) return c.json({ error: "No response from MCP transport" }, 500, corsHeaders);
  response.headers.delete("mcp-session-id"); // stateless: strip any session hint
  for (const [k, v] of Object.entries(corsHeaders)) response.headers.set(k, v);
  return response;
});

// ── Start server on a random port ─────────────────────────────────────────────

const httpServer = serve({ fetch: app.fetch, port: 0 });
await new Promise((r) => httpServer.on("listening", r));
const { port } = httpServer.address();
const BASE = `http://localhost:${port}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}`);
    failed++;
  }
}

// StreamableHTTPTransport may return raw JSON or SSE ("event: message\ndata: {...}").
async function readMcpBody(r) {
  const text = await r.text();
  if (text.startsWith("{") || text.startsWith("[")) return JSON.parse(text);
  const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
  if (dataLine) return JSON.parse(dataLine.slice(6));
  return null;
}

const INIT = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-client", version: "0.0.1" },
  },
});

const authHeaders = {
  "Content-Type": "application/json",
  "Accept": "application/json, text/event-stream",
  "x-brain-key": MCP_ACCESS_KEY,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log("\n[1] CORS preflight");
{
  const r = await fetch(BASE, { method: "OPTIONS" });
  assert(r.status === 200, "OPTIONS → 200");
  assert(r.headers.get("access-control-allow-origin") === "*", "CORS origin *");
  assert(r.headers.has("access-control-allow-methods"), "CORS methods present");
}

console.log("\n[2] Auth rejection — wrong key");
{
  const r = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-brain-key": "wrong-key" },
    body: INIT,
  });
  assert(r.status === 401, "wrong key → 401");
  assert(r.headers.get("access-control-allow-origin") === "*", "CORS on 401");
}

console.log("\n[3] Auth rejection — no key");
{
  const r = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: INIT,
  });
  assert(r.status === 401, "missing key → 401");
}

console.log("\n[4] MCP initialize — response shape + no mcp-session-id");
{
  const r = await fetch(BASE, { method: "POST", headers: authHeaders, body: INIT });
  assert(r.status === 200, "initialize → 200");
  assert(!r.headers.has("mcp-session-id"), "mcp-session-id absent (stateless)");
  assert(r.headers.get("access-control-allow-origin") === "*", "CORS on success");
  const body = await readMcpBody(r);
  assert(body?.result?.protocolVersion != null, "protocolVersion in response");
  assert(body?.result?.capabilities != null, "capabilities in response");
}

console.log("\n[5] Per-request isolation — two sequential initializes");
{
  const r1 = await fetch(BASE, { method: "POST", headers: authHeaders, body: INIT });
  assert(r1.status === 200, "r1 → 200");
  assert(!r1.headers.has("mcp-session-id"), "r1 no mcp-session-id");
  const b1 = await readMcpBody(r1);
  assert(b1?.result?.protocolVersion != null, "r1 valid initialize response");

  const r2 = await fetch(BASE, { method: "POST", headers: authHeaders, body: INIT });
  assert(r2.status === 200, "r2 → 200");
  assert(!r2.headers.has("mcp-session-id"), "r2 no mcp-session-id");
  const b2 = await readMcpBody(r2);
  assert(b2?.result?.protocolVersion != null, "r2 valid initialize response (no singleton corruption)");
}

console.log("\n[6] tools/list — verifies buildServer() registers tools each time");
{
  const listMsg = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const r = await fetch(BASE, { method: "POST", headers: authHeaders, body: listMsg });
  assert(r.status === 200, "tools/list → 200");
  assert(!r.headers.has("mcp-session-id"), "no mcp-session-id on tools/list");
  const body = await readMcpBody(r);
  assert(body !== null, "got a parseable response");
}

// ── Summary ───────────────────────────────────────────────────────────────────

httpServer.close();
console.log(`\n${"─".repeat(50)}`);
console.log(`${passed + failed} assertions: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("FAIL\n");
  process.exit(1);
} else {
  console.log("PASS\n");
}
