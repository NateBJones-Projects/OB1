/**
 * delete-thought-mcp — Standalone MCP Edge Function that adds a single tool:
 *   delete_thought(id)
 *
 * The core open-brain MCP server does not expose a delete path. This
 * integration adds one without modifying the core server — deploy alongside
 * your main MCP connector and register as a separate custom connector.
 *
 * Behavior:
 *   - Pre-flight fetch to confirm the thought exists (so the caller gets a
 *     clear "not found" instead of a silent success).
 *   - Hard delete — the row is gone once this returns. Recovery depends on
 *     your database backup strategy (see README).
 *
 * Auth: x-brain-key header OR ?key=... URL query parameter.
 *
 * Env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   MCP_ACCESS_KEY
 *
 * Extension hook:
 *   If you install the thought_audit schema (see `schemas/thought-audit`)
 *   you can extend this function to write an audit row before the delete
 *   so the prior content is preserved for recovery. Left out of the base
 *   integration to keep dependencies minimal.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- MCP Server Setup ---

const server = new McpServer({
  name: "open-brain-delete-thought",
  version: "1.0.0",
});

server.registerTool(
  "delete_thought",
  {
    title: "Delete Thought",
    description:
      "Permanently delete a thought by UUID. The row is hard-deleted — recovery depends on your database backups. Returns a confirmation including the prior content length so the caller can log what was removed.",
    inputSchema: {
      id: z.string().uuid().describe("UUID of the thought to delete"),
    },
  },
  async ({ id }) => {
    try {
      // Pre-flight fetch so "not found" is a clear, distinct outcome.
      const { data: existing, error: fetchError } = await supabase
        .from("thoughts")
        .select("id, content")
        .eq("id", id)
        .single();

      if (fetchError || !existing) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Thought not found: ${id}`,
            },
          ],
          isError: true,
        };
      }

      const { error } = await supabase.from("thoughts").delete().eq("id", id);

      if (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `delete_thought error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }

      const priorLength =
        typeof existing.content === "string" ? existing.content.length : 0;

      return {
        content: [
          {
            type: "text" as const,
            text: `Deleted thought ${id} (prior content length: ${priorLength} chars).`,
          },
        ],
      };
    } catch (err: unknown) {
      return {
        content: [
          { type: "text" as const, text: `Error: ${(err as Error).message}` },
        ],
        isError: true,
      };
    }
  },
);

// --- Hono app with auth + CORS ---

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-brain-key, accept, mcp-session-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
};

const app = new Hono();

app.options("*", (c) => c.text("ok", 200, corsHeaders));

app.all("*", async (c) => {
  const provided =
    c.req.header("x-brain-key") || new URL(c.req.url).searchParams.get("key");
  if (!provided || provided !== MCP_ACCESS_KEY) {
    return c.json({ error: "Invalid or missing access key" }, 401, corsHeaders);
  }

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

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

Deno.serve(app.fetch);
