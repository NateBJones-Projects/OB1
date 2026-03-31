/**
 * Extension 1: Household Knowledge Base MCP Server
 *
 * Provides tools for storing and retrieving household facts:
 * - Household items (paint colors, appliances, measurements, etc.)
 * - Vendor contacts (service providers)
 */

import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_PUBLISHABLE_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const OB1_OWNER_USER_ID = Deno.env.get("OB1_OWNER_USER_ID") ?? "";
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY") ?? "";
const ALLOW_LEGACY_MCP_KEY = Deno.env.get("ALLOW_LEGACY_MCP_KEY") === "true";
const DEFAULT_USER_ID = Deno.env.get("DEFAULT_USER_ID");

const authClient = SUPABASE_PUBLISHABLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : null;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-brain-key, x-access-key, accept, mcp-session-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
};

const app = new Hono();

function withCors(response: Response): Response {
  for (const [header, value] of Object.entries(corsHeaders)) {
    response.headers.set(header, value);
  }
  return response;
}

function getAuthorizationServerUrl(): string {
  return `${SUPABASE_URL.replace(/\/$/, "")}/auth/v1`;
}

function getProtectedResourceMetadataUrl(requestUrl: string): string {
  const url = new URL(requestUrl);
  const path = url.pathname.replace(/\/$/, "");
  return new URL(`${path}/.well-known/oauth-protected-resource`, url.origin).toString();
}

function buildProtectedResourceMetadata(requestUrl: string) {
  const metadataUrl = new URL(requestUrl);
  const resourcePath = metadataUrl.pathname.replace(/\/\.well-known\/oauth-protected-resource$/, "").replace(/\/$/, "");
  return {
    resource: new URL(resourcePath || "/", metadataUrl.origin).toString(),
    authorization_servers: [getAuthorizationServerUrl()],
    bearer_methods_supported: ["header"],
    scopes_supported: ["openid", "email", "profile", "offline_access"],
  };
}

function unauthorizedResponse(c: any, description: string): Response {
  return c.json(
    {
      error: "invalid_token",
      error_description: description,
    },
    401,
    {
      ...corsHeaders,
      "WWW-Authenticate": `Bearer resource_metadata="${getProtectedResourceMetadataUrl(c.req.url)}"`,
    },
  );
}

async function authenticateRequest(c: any): Promise<Response | { mode: "oauth" | "legacy" }> {
  const authHeader = c.req.header("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    if (!authClient) {
      return c.json({ error: "SUPABASE_PUBLISHABLE_KEY not configured" }, 500, corsHeaders);
    }
    if (!OB1_OWNER_USER_ID) {
      return c.json({ error: "OB1_OWNER_USER_ID not configured" }, 500, corsHeaders);
    }

    const token = authHeader.slice("Bearer ".length).trim();
    const {
      data: { user },
      error,
    } = await authClient.auth.getUser(token);

    if (error || !user) {
      return unauthorizedResponse(c, "The access token is invalid.");
    }

    if (user.id !== OB1_OWNER_USER_ID) {
      return c.json({ error: "Forbidden" }, 403, corsHeaders);
    }

    return { mode: "oauth" };
  }

  if (ALLOW_LEGACY_MCP_KEY) {
    const provided =
      c.req.header("x-brain-key") ||
      c.req.header("x-access-key") ||
      new URL(c.req.url).searchParams.get("key");

    if (provided && MCP_ACCESS_KEY && provided === MCP_ACCESS_KEY) {
      return { mode: "legacy" };
    }
  }

  return unauthorizedResponse(c, "Authorization required.");
}

app.options("*", (c) => c.text("ok", 200, corsHeaders));

app.get("/.well-known/oauth-protected-resource", (c) => {
  return c.json(buildProtectedResourceMetadata(c.req.url), 200, corsHeaders);
});

app.post("*", async (c) => {
  const authResult = await authenticateRequest(c);
  if (authResult instanceof Response) {
    return authResult;
  }

  // Fix: Claude Desktop connectors don't send the Accept header that
  // StreamableHTTPTransport requires. Build a patched request if missing.
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

  const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );

  const userId = DEFAULT_USER_ID;
  if (!userId) {
    return c.json({ error: "DEFAULT_USER_ID not configured" }, 500, corsHeaders);
  }

  const server = new McpServer(
    { name: "household-knowledge", version: "1.0.0" },
  );

  // Add household item
  server.tool(
    "add_household_item",
    "Add a new household item (paint color, appliance, measurement, document, etc.)",
    {
      name: z.string().describe("Name or description of the item"),
      category: z.string().optional().describe("Category (e.g. 'paint', 'appliance', 'measurement', 'document')"),
      location: z.string().optional().describe("Location in the home (e.g. 'Living Room', 'Kitchen')"),
      details: z.string().optional().describe("Flexible metadata as JSON string (e.g. '{\"brand\": \"Sherwin Williams\", \"color\": \"Sea Salt\"}')"),
      notes: z.string().optional().describe("Additional notes or context"),
    },
    async ({ name, category, location, details, notes }) => {
      try {
        const { data, error } = await supabase
          .from("household_items")
          .insert({
            user_id: userId,
            name,
            category: category || null,
            location: location || null,
            details: details || {},
            notes: notes || null,
          })
          .select()
          .single();

        if (error) {
          throw new Error(`Failed to add household item: ${error.message}`);
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Added household item: ${name}`,
              item: data,
            }, null, 2)
          }]
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: errorMessage }) }],
          isError: true,
        };
      }
    }
  );

  // Search household items
  server.tool(
    "search_household_items",
    "Search household items by name, category, or location",
    {
      query: z.string().optional().describe("Search term (searches name, category, location, and notes)"),
      category: z.string().optional().describe("Filter by specific category"),
      location: z.string().optional().describe("Filter by specific location"),
    },
    async ({ query, category, location }) => {
      try {
        let queryBuilder = supabase
          .from("household_items")
          .select("*")
          .eq("user_id", userId);

        if (category) {
          queryBuilder = queryBuilder.ilike("category", `%${category}%`);
        }

        if (location) {
          queryBuilder = queryBuilder.ilike("location", `%${location}%`);
        }

        if (query) {
          queryBuilder = queryBuilder.or(
            `name.ilike.%${query}%,category.ilike.%${query}%,location.ilike.%${query}%,notes.ilike.%${query}%`
          );
        }

        const { data, error } = await queryBuilder.order("created_at", { ascending: false });

        if (error) {
          throw new Error(`Failed to search household items: ${error.message}`);
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              count: data.length,
              items: data,
            }, null, 2)
          }]
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: errorMessage }) }],
          isError: true,
        };
      }
    }
  );

  // Get item details
  server.tool(
    "get_item_details",
    "Get full details of a specific household item by ID",
    {
      item_id: z.string().describe("Item ID (UUID)"),
    },
    async ({ item_id }) => {
      try {
        const { data, error } = await supabase
          .from("household_items")
          .select("*")
          .eq("id", item_id)
          .eq("user_id", userId)
          .single();

        if (error) {
          throw new Error(`Failed to get item details: ${error.message}`);
        }

        if (!data) {
          throw new Error("Item not found or access denied");
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              item: data,
            }, null, 2)
          }]
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: errorMessage }) }],
          isError: true,
        };
      }
    }
  );

  // Add vendor
  server.tool(
    "add_vendor",
    "Add a service provider (plumber, electrician, landscaper, etc.)",
    {
      name: z.string().describe("Vendor name"),
      service_type: z.string().optional().describe("Type of service (e.g. 'plumber', 'electrician', 'landscaper')"),
      phone: z.string().optional().describe("Phone number"),
      email: z.string().optional().describe("Email address"),
      website: z.string().optional().describe("Website URL"),
      notes: z.string().optional().describe("Additional notes"),
      rating: z.number().min(1).max(5).optional().describe("Rating from 1-5"),
      last_used: z.string().optional().describe("Date last used (YYYY-MM-DD format)"),
    },
    async ({ name, service_type, phone, email, website, notes, rating, last_used }) => {
      try {
        const { data, error } = await supabase
          .from("household_vendors")
          .insert({
            user_id: userId,
            name,
            service_type: service_type || null,
            phone: phone || null,
            email: email || null,
            website: website || null,
            notes: notes || null,
            rating: rating || null,
            last_used: last_used || null,
          })
          .select()
          .single();

        if (error) {
          throw new Error(`Failed to add vendor: ${error.message}`);
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Added vendor: ${name}`,
              vendor: data,
            }, null, 2)
          }]
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: errorMessage }) }],
          isError: true,
        };
      }
    }
  );

  // List vendors
  server.tool(
    "list_vendors",
    "List service providers, optionally filtered by service type",
    {
      service_type: z.string().optional().describe("Filter by service type (e.g. 'plumber', 'electrician')"),
    },
    async ({ service_type }) => {
      try {
        let queryBuilder = supabase
          .from("household_vendors")
          .select("*")
          .eq("user_id", userId);

        if (service_type) {
          queryBuilder = queryBuilder.ilike("service_type", `%${service_type}%`);
        }

        const { data, error } = await queryBuilder.order("name", { ascending: true });

        if (error) {
          throw new Error(`Failed to list vendors: ${error.message}`);
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              count: data.length,
              vendors: data,
            }, null, 2)
          }]
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: errorMessage }) }],
          isError: true,
        };
      }
    }
  );

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  const response = await transport.handleRequest(c);
  return response ? withCors(response) : c.body(null, 204, corsHeaders);
});

app.get("*", (c) =>
  c.json({ status: "ok", service: "Household Knowledge MCP", version: "1.1.0", auth: "oauth-2.1" }, 200, corsHeaders));

Deno.serve(app.fetch);
