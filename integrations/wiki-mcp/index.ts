/**
 * wiki-mcp — Standalone MCP Edge Function exposing the persistent-wiki tools.
 *
 * Adds three tools for the durable, human-override-safe wiki pages introduced
 * by the `schemas/wiki-pages` schema:
 *
 *   wiki_list_pages   — enumerate active wiki pages (with section counts).
 *   wiki_get_page     — fetch one page by slug, including all its sections and
 *                       any pending generated drafts.
 *   wiki_write_section — write/refresh a section through the regen guard. The
 *                       guard parks the write as a PENDING draft (rather than
 *                       overwriting) when the target section is human-owned.
 *
 * Why a separate Edge Function?
 *   The core `open-brain` MCP server (server/index.ts) is curated and does not
 *   expose the wiki surface. This integration adds it without modifying the
 *   core server. Deploy it alongside your main connector and register it as a
 *   separate custom connector in Claude Desktop (Settings → Connectors → Add
 *   custom connector → paste URL).
 *
 * Depends on: the `schemas/wiki-pages` schema (tables `wiki_pages`,
 *   `wiki_sections`, `wiki_section_revisions` and the `wiki_write_section`
 *   RPC). Apply that schema before deploying this function.
 *
 * The regen guard (why writes can "park"):
 *   wiki_write_section always writes with origin='generated' — agents are
 *   generators, never owners. If the target section is human-owned
 *   (origin='manual' or locked), the DB RPC does NOT overwrite it; it parks the
 *   new text in the section's pending buffer and returns action='pending'. A
 *   human accepts the draft separately (wiki_accept_pending). This tool surfaces
 *   that action verbatim so the caller knows whether the write landed
 *   (created / updated) or parked for review (pending) — and must NOT retry on
 *   pending.
 *
 * ID contract:
 *   Open Brain ids are UUIDs. page_id is validated as a UUID string and passed
 *   through untouched — never parsed as a number.
 *
 * Auth: x-brain-key header OR ?key=... URL query parameter (same pattern as the
 *   core server — see server/index.ts).
 *
 * Env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
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
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// The actor recorded against generated writes and revisions in the wiki tables.
const WIKI_ACTOR = "wiki-mcp";

type WikiPageRow = {
  id: string;
  slug: string;
  title: string;
  page_kind: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type WikiSectionRow = {
  id: string;
  section_key: string;
  heading: string | null;
  display_order: number;
  origin: string;
  body_md: string;
  pending_generated_md: string | null;
  pending_generated_at: string | null;
  generation_source: Record<string, unknown>;
  evidence_thought_ids: string[];
  locked: boolean;
  created_at: string;
  updated_at: string;
};

// --- MCP Server Setup (built per request — see #261) ---

function buildServer(): McpServer {
  const server = new McpServer({
    name: "open-brain-wiki",
    version: "1.0.0",
  });

  // Tool 1: wiki_list_pages — enumerate available wiki pages.
  server.registerTool(
    "wiki_list_pages",
    {
      title: "Wiki List Pages",
      description:
        "List persistent wiki pages (topic summaries, entity profiles, etc.), most recently updated first, with a section count for each. Use this to discover available pages before fetching one with wiki_get_page. Only active pages are returned.",
      annotations: {
        readOnlyHint: true,
      },
      inputSchema: {
        page_kind: z
          .string()
          .max(40)
          .optional()
          .describe("Filter by page kind (e.g. topic, entity, autobiography, custom)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .default(50)
          .describe("Max rows to return (default 50, max 200)"),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .default(0)
          .describe("Pagination offset (default 0)"),
      },
    },
    async ({ page_kind, limit, offset }) => {
      try {
        const lim = limit ?? 50;
        const off = offset ?? 0;

        let q = supabase
          .from("wiki_pages")
          .select(
            "id, slug, title, page_kind, status, metadata, created_at, updated_at",
          )
          .eq("status", "active")
          .order("updated_at", { ascending: false })
          .range(off, off + lim - 1);

        const kind = page_kind?.trim();
        if (kind) q = q.eq("page_kind", kind);

        const { data, error } = await q;
        if (error) {
          return {
            content: [
              { type: "text" as const, text: `wiki_list_pages error: ${error.message}` },
            ],
            isError: true,
          };
        }

        const rows = (data ?? []) as WikiPageRow[];

        // Count non-deleted sections per page in a single follow-up query.
        const pageIds = rows.map((r) => r.id);
        const sectionCounts: Record<string, number> = {};
        if (pageIds.length > 0) {
          const { data: scData, error: scErr } = await supabase
            .from("wiki_sections")
            .select("page_id")
            .in("page_id", pageIds)
            .is("deleted_at", null);
          if (scErr) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `wiki_sections count error: ${scErr.message}`,
                },
              ],
              isError: true,
            };
          }
          for (const sc of (scData ?? []) as { page_id: string }[]) {
            sectionCounts[sc.page_id] = (sectionCounts[sc.page_id] ?? 0) + 1;
          }
        }

        const pages = rows.map((r) => ({
          ...r,
          section_count: sectionCounts[r.id] ?? 0,
        }));

        const text =
          pages.length === 0
            ? "No wiki pages found."
            : pages
                .map(
                  (p, i) =>
                    `${off + i + 1}. [${p.page_kind}] ${p.slug} — ${p.title} ` +
                    `(${p.section_count} section${p.section_count === 1 ? "" : "s"}, id=${p.id})`,
                )
                .join("\n");

        return {
          content: [{ type: "text" as const, text }],
          structuredContent: { pages, count: pages.length, offset: off, limit: lim },
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // Tool 2: wiki_get_page — fetch one page by slug, with all its sections.
  server.registerTool(
    "wiki_get_page",
    {
      title: "Wiki Get Page",
      description:
        "Fetch a wiki page by slug, including all of its sections (body_md and any pending_generated_md draft). Use this to read a page and to obtain its page_id and section keys before calling wiki_write_section. pending_generated_md is an agent-generated draft awaiting human acceptance on a human-owned section.",
      annotations: {
        readOnlyHint: true,
      },
      inputSchema: {
        slug: z
          .string()
          .min(1)
          .max(200)
          .describe("Page slug (the URL-safe identifier shown by wiki_list_pages)"),
      },
    },
    async ({ slug }) => {
      try {
        const wantedSlug = slug.trim();
        if (!wantedSlug) {
          return {
            content: [{ type: "text" as const, text: "slug is required" }],
            isError: true,
          };
        }

        const { data: page, error: pageErr } = await supabase
          .from("wiki_pages")
          .select(
            "id, slug, title, page_kind, status, metadata, created_at, updated_at",
          )
          .eq("slug", wantedSlug)
          .maybeSingle();

        if (pageErr) {
          return {
            content: [
              { type: "text" as const, text: `wiki_get_page error: ${pageErr.message}` },
            ],
            isError: true,
          };
        }
        if (!page) {
          return {
            content: [
              { type: "text" as const, text: `Wiki page '${wantedSlug}' not found.` },
            ],
            isError: true,
          };
        }

        const pageRow = page as WikiPageRow;

        const { data: sections, error: secErr } = await supabase
          .from("wiki_sections")
          .select(
            "id, section_key, heading, display_order, origin, body_md, pending_generated_md, pending_generated_at, generation_source, evidence_thought_ids, locked, created_at, updated_at",
          )
          .eq("page_id", pageRow.id)
          .is("deleted_at", null)
          .order("display_order", { ascending: true });

        if (secErr) {
          return {
            content: [
              { type: "text" as const, text: `wiki_sections error: ${secErr.message}` },
            ],
            isError: true,
          };
        }

        const sectionRows = (sections ?? []) as WikiSectionRow[];
        const sectionLines = sectionRows.map(
          (s) =>
            `  [${s.section_key}] ${s.heading ?? "(no heading)"} ` +
            `(origin=${s.origin}${s.locked ? ", locked" : ""}` +
            `${s.pending_generated_md ? ", has pending draft" : ""})`,
        );

        const text = [
          `[${pageRow.page_kind}] ${pageRow.slug}: ${pageRow.title} (id=${pageRow.id})`,
          `Sections (${sectionRows.length}):`,
          ...(sectionLines.length ? sectionLines : ["  (none)"]),
        ].join("\n");

        return {
          content: [{ type: "text" as const, text }],
          structuredContent: { page: pageRow, sections: sectionRows },
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // Tool 3: wiki_write_section — write/refresh a section through the regen guard.
  server.registerTool(
    "wiki_write_section",
    {
      title: "Wiki Write Section",
      description:
        "Write or refresh a wiki section. Always writes as origin='generated' (agents are generators — this is enforced and cannot be overridden). IMPORTANT: if the target section is human-owned (origin='manual' or locked), the write does NOT overwrite it — it is parked as a pending draft and action='pending' is returned. Do NOT retry when action='pending'; the draft is queued for a human to review and accept. action='created' or action='updated' means the write was applied. Identify the section with page_id (a UUID, from wiki_get_page) and section_key.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        page_id: z
          .string()
          .uuid()
          .describe("Wiki page UUID (from wiki_get_page or wiki_list_pages)"),
        section_key: z
          .string()
          .min(1)
          .max(120)
          .describe("Section key, e.g. 'summary', 'context', 'notes'"),
        body_md: z
          .string()
          .max(50_000)
          .describe("Markdown body for the section"),
        heading: z
          .string()
          .max(500)
          .optional()
          .describe("Optional section heading text"),
      },
    },
    async ({ page_id, section_key, body_md, heading }) => {
      try {
        const pageId = page_id.trim();
        const sectionKey = section_key.trim();
        if (!sectionKey) {
          return {
            content: [{ type: "text" as const, text: "section_key is required" }],
            isError: true,
          };
        }

        // The regen guard, origin enforcement, and revision snapshotting all
        // live in the wiki_write_section RPC — a single DB-side guard every
        // writer shares. We always pass p_origin='generated'.
        const rpcParams: Record<string, unknown> = {
          p_page_id: pageId,
          p_section_key: sectionKey,
          p_body_md: body_md,
          p_origin: "generated",
          p_actor: WIKI_ACTOR,
        };
        const trimmedHeading = heading?.trim();
        if (trimmedHeading) rpcParams.p_heading = trimmedHeading;

        const { data, error } = await supabase.rpc("wiki_write_section", rpcParams);
        if (error) {
          return {
            content: [
              { type: "text" as const, text: `wiki_write_section error: ${error.message}` },
            ],
            isError: true,
          };
        }

        const result: Record<string, unknown> =
          data && typeof data === "object"
            ? (data as Record<string, unknown>)
            : { result: data };
        const action = typeof result.action === "string" ? result.action : "unknown";
        const sectionId = typeof result.section_id === "string" ? result.section_id : null;

        // Surface the regen-guard outcome verbatim so the caller knows whether
        // the write landed or parked for human review.
        const actionMessage =
          action === "pending"
            ? "action=pending — section is human-owned; your draft was parked for human review. Do NOT retry."
            : action === "created"
              ? "action=created — new section written."
              : action === "updated"
                ? "action=updated — section refreshed in place."
                : `action=${action}.`;

        const text =
          `wiki_write_section [${sectionKey}] on page ${pageId}: ${actionMessage}` +
          (sectionId ? `\n  · section_id: ${sectionId}` : "");

        return {
          content: [{ type: "text" as const, text }],
          structuredContent: {
            ...result,
            page_id: pageId,
            section_key: sectionKey,
            origin: "generated",
          },
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  return server;
}

// --- Hono app with auth + CORS ---

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-brain-key, accept, mcp-session-id, mcp-protocol-version, last-event-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
};

// JSON-RPC error code for unauthorized requests. Per the JSON-RPC 2.0 spec the
// -32099..-32000 range is reserved for implementation-defined server errors;
// -32001 is the conventional "Unauthorized" code used by MCP clients/servers.
//
// We return a JSON-RPC envelope (HTTP 200) instead of a bare HTTP 401 because
// strict MCP hosts (Codex CLI, Claude Code) treat bare HTTP 4xx responses as
// transport-level failures and tear the connection down rather than surfacing
// the error to the application. Wrapping the rejection keeps the connection
// alive so clients can recover (e.g. prompt for a new key).
const JSON_RPC_UNAUTHORIZED_CODE = -32001;
const UNAUTHORIZED_MESSAGE = "Unauthorized: missing or invalid authentication.";

async function readBodyText(req: Request): Promise<string | null> {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "DELETE") {
    return null;
  }
  try {
    return await req.text();
  } catch {
    return null;
  }
}

function extractJsonRpcId(bodyText: string | null): string | number | null {
  if (!bodyText) return null;
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed && typeof parsed === "object" && "id" in parsed) {
      const id = (parsed as { id: unknown }).id;
      if (typeof id === "string" || typeof id === "number" || id === null) {
        return id;
      }
    }
  } catch {
    // fall through — malformed body
  }
  return null;
}

function unauthorizedResponse(id: string | number | null): Response {
  const body = {
    jsonrpc: "2.0",
    error: { code: JSON_RPC_UNAUTHORIZED_CODE, message: UNAUTHORIZED_MESSAGE },
    id,
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

const app = new Hono();

// CORS preflight — required for browser/Electron-based clients (Claude Desktop).
app.options("*", (c) => c.text("ok", 200, corsHeaders));

app.all("*", async (c) => {
  // Accept the access key via header OR URL query parameter.
  const provided =
    c.req.header("x-brain-key") || new URL(c.req.url).searchParams.get("key");
  if (!provided || provided !== MCP_ACCESS_KEY) {
    const bodyText = await readBodyText(c.req.raw);
    const id = extractJsonRpcId(bodyText);
    return unauthorizedResponse(id);
  }

  // Claude Desktop connectors don't send the Accept header that
  // StreamableHTTPTransport requires. Patch it in when missing.
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

  // Build the MCP server per request (no shared singleton) — matches the core
  // server's per-request construction landed in #261.
  const server = buildServer();
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  const response = await transport.handleRequest(c);
  if (!response) {
    return c.json({ error: "No response from MCP transport" }, 500, corsHeaders);
  }
  response.headers.delete("mcp-session-id");
  for (const [k, v] of Object.entries(corsHeaders)) response.headers.set(k, v);
  return response;
});

Deno.serve(app.fetch);
