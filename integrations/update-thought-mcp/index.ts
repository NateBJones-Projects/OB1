/**
 * update-thought-mcp — Standalone MCP Edge Function that adds a single tool:
 *   update_thought(id, content?, metadata_patch?, if_unchanged_since?)
 *
 * Why a separate Edge Function?
 *   The core `open-brain` MCP server (server/index.ts) is curated and does not
 *   expose an update path. This integration adds one without modifying the
 *   core server. Deploy it alongside your main MCP connector and register it
 *   as a separate custom connector in Claude Desktop (or your client of
 *   choice).
 *
 * Behavior:
 *   - `content` — when provided, overwrites the thought text and regenerates
 *     the embedding. Omit to leave content unchanged.
 *   - `metadata_patch` — shallow-merged into the existing metadata JSONB.
 *     Keys not present in the patch are left alone.
 *   - `if_unchanged_since` — optional ISO 8601 timestamp (with offset). When
 *     provided, the update is rejected with a STALE_READ error if the stored
 *     `updated_at` has advanced past that reference. Omit for last-write-wins
 *     behavior (backward compatible).
 *
 * Auth: x-brain-key header OR ?key=... URL query parameter (same pattern as
 * the core server — see server/index.ts).
 *
 * Env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   OPENROUTER_API_KEY        — only used when `content` is provided
 *   MCP_ACCESS_KEY
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
    }),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`OpenRouter embeddings failed: ${r.status} ${msg}`);
  }
  const d = await r.json();
  return d.data[0].embedding;
}

// --- MCP Server Setup ---

const server = new McpServer({
  name: "open-brain-update-thought",
  version: "1.0.0",
});

server.registerTool(
  "update_thought",
  {
    title: "Update Thought",
    description:
      "Update an existing thought by ID. Provide `content` to overwrite the text and regenerate its embedding, `metadata_patch` to shallow-merge changes into the existing metadata, or both. Keys not mentioned in `metadata_patch` are left unchanged. Pass `if_unchanged_since` (ISO 8601 timestamp from your last read) for optimistic concurrency — the update is rejected with STALE_READ if another writer has touched the row since then.",
    inputSchema: {
      id: z.string().uuid().describe("UUID of the thought to update"),
      content: z
        .string()
        .min(1)
        .max(50_000)
        .optional()
        .describe("New text content — triggers re-embedding when provided"),
      metadata_patch: z
        .record(z.unknown())
        .optional()
        .describe(
          "Partial metadata to shallow-merge into the existing metadata JSONB. New keys are added; existing keys are overwritten; keys not mentioned are left alone.",
        ),
      if_unchanged_since: z
        .string()
        .datetime({ offset: true })
        .optional()
        .describe(
          "Optional ISO 8601 timestamp (with timezone). When provided, the update is rejected with STALE_READ if the stored updated_at has advanced past this reference. Pass the updated_at value from your most recent read to guard against lost-update conflicts. Omit to keep last-write-wins behavior.",
        ),
    },
  },
  async ({ id, content, metadata_patch, if_unchanged_since }) => {
    try {
      // Fetch existing row. We need updated_at for the concurrency check and
      // metadata for the shallow-merge.
      const { data: existing, error: fetchError } = await supabase
        .from("thoughts")
        .select("id, content, metadata, created_at, updated_at")
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

      // Optimistic concurrency check. Reject if stored updated_at is strictly
      // newer than the caller's reference timestamp.
      if (if_unchanged_since) {
        const storedMs = new Date(
          (existing.updated_at as string) ?? (existing.created_at as string),
        ).getTime();
        const clientMs = new Date(if_unchanged_since).getTime();
        if (
          Number.isFinite(storedMs) &&
          Number.isFinite(clientMs) &&
          storedMs > clientMs
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `STALE_READ: thought has been modified since ${if_unchanged_since}. ` +
                  `Current updated_at: ${existing.updated_at}. Re-fetch and retry.`,
              },
            ],
            isError: true,
          };
        }
      }

      const updates: Record<string, unknown> = {};

      if (content !== undefined) {
        if (!OPENROUTER_API_KEY) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  "OPENROUTER_API_KEY is not set on this Edge Function; content updates cannot re-embed.",
              },
            ],
            isError: true,
          };
        }
        const embedding = await getEmbedding(content);
        updates.content = content;
        updates.embedding = `[${embedding.join(",")}]`;
      }

      if (metadata_patch !== undefined) {
        const merged = {
          ...((existing.metadata as Record<string, unknown>) || {}),
          ...metadata_patch,
        };
        updates.metadata = merged;
      }

      if (Object.keys(updates).length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No changes supplied; thought ${id} unchanged.`,
            },
          ],
        };
      }

      const { data, error } = await supabase
        .from("thoughts")
        .update(updates)
        .eq("id", id)
        .select("id, content, metadata, created_at, updated_at")
        .single();

      if (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `update_thought error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }

      const parts = [
        `Updated thought ${data.id}`,
        content !== undefined ? "  · content replaced and re-embedded" : null,
        metadata_patch !== undefined ? "  · metadata merged" : null,
        `  · updated_at: ${data.updated_at}`,
      ].filter(Boolean);

      return {
        content: [{ type: "text" as const, text: parts.join("\n") }],
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

  // Same Accept-header workaround as the core server — Claude Desktop's custom
  // connectors do not send `text/event-stream` by default.
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
