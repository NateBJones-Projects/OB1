// ❌ ANTI-PATTERN — McpServer reconstructed on every HTTP request.
//
// Every tool call by Claude triggers ~4 HTTP requests (initialize +
// notifications/initialized + tools/list + tools/call). With this pattern,
// each request rebuilds the McpServer, re-registers all tools, and creates a
// new Supabase client. Multiplied across multiple connectors and the MCP
// handshake fan-out, this drives invocation counts (and per-request CPU)
// orders of magnitude higher than necessary.

import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const app = new Hono();

app.post("*", async (c) => {
  // Auth check
  const key = c.req.query("key") || c.req.header("x-access-key");
  const expected = Deno.env.get("MCP_ACCESS_KEY");
  if (!key || key !== expected) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // ❌ New Supabase client per request
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ❌ New McpServer per request — rebuilds zod schemas, re-registers tools
  const server = new McpServer({ name: "household-knowledge", version: "1.0.0" });

  server.tool(
    "list_vendors",
    "List service providers, optionally filtered by service type",
    { service_type: z.string().optional() },
    async ({ service_type }) => {
      const { data } = await supabase
        .from("household_vendors")
        .select("*")
        .eq("user_id", Deno.env.get("DEFAULT_USER_ID")!)
        .ilike("service_type", `%${service_type ?? ""}%`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  );

  // ❌ New transport per request, no session reuse
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

// ❌ No OPTIONS handler — preflight 404s, clients retry, retries are billed.

Deno.serve(app.fetch);
