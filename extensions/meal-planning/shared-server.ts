/**
 * Shared Meal Planning MCP Server
 *
 * This is a separate server with limited, read-focused access for household members.
 * Your spouse can view meal plans, browse recipes, and mark items as purchased
 * without accessing your full Open Brain system.
 *
 * Security model:
 * - Uses a separate Supabase service role key with household_member JWT claims
 * - Can only SELECT from recipes and meal_plans
 * - Can UPDATE shopping_lists (to mark items purchased)
 * - Cannot create/delete recipes or meal plans
 */

import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_HOUSEHOLD_KEY = Deno.env.get("SUPABASE_HOUSEHOLD_KEY")!;
const SUPABASE_PUBLISHABLE_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const OB1_OWNER_USER_ID = Deno.env.get("OB1_OWNER_USER_ID") ?? "";
const MCP_HOUSEHOLD_ACCESS_KEY = Deno.env.get("MCP_HOUSEHOLD_ACCESS_KEY") ?? "";
const ALLOW_LEGACY_MCP_KEY = Deno.env.get("ALLOW_LEGACY_MCP_KEY") === "true";
const allowedUserIds = (Deno.env.get("MCP_HOUSEHOLD_ALLOWED_USER_IDS") || OB1_OWNER_USER_ID)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

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
    if (!allowedUserIds.length) {
      return c.json({ error: "MCP_HOUSEHOLD_ALLOWED_USER_IDS not configured" }, 500, corsHeaders);
    }

    const token = authHeader.slice("Bearer ".length).trim();
    const {
      data: { user },
      error,
    } = await authClient.auth.getUser(token);

    if (error || !user) {
      return unauthorizedResponse(c, "The access token is invalid.");
    }

    if (!allowedUserIds.includes(user.id)) {
      return c.json({ error: "Forbidden" }, 403, corsHeaders);
    }

    return { mode: "oauth" };
  }

  if (ALLOW_LEGACY_MCP_KEY) {
    const provided =
      c.req.header("x-brain-key") ||
      c.req.header("x-access-key") ||
      new URL(c.req.url).searchParams.get("key");

    if (provided && MCP_HOUSEHOLD_ACCESS_KEY && provided === MCP_HOUSEHOLD_ACCESS_KEY) {
      return { mode: "legacy" };
    }
  }

  return unauthorizedResponse(c, "Authorization required.");
}

app.options("*", (c) => c.text("ok", 200, corsHeaders));

app.get("/.well-known/oauth-protected-resource", (c) => {
  return c.json(buildProtectedResourceMetadata(c.req.url), 200, corsHeaders);
});

app.post("/mcp", async (c) => {
  const authResult = await authenticateRequest(c);
  if (authResult instanceof Response) {
    return authResult;
  }

  const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_HOUSEHOLD_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );

  const server = new McpServer({ name: "meal-planning-shared", version: "1.0.0" });

  // view_meal_plan tool
  server.tool(
    "view_meal_plan",
    "View the meal plan for a given week (read-only)",
    {
      user_id: z.string().describe("User ID (UUID)"),
      week_start: z.string().describe("Monday of the week (YYYY-MM-DD)"),
    },
    async (args) => {
      const { data, error } = await supabase
        .from("meal_plans")
        .select(
          `
          *,
          recipes:recipe_id (name, cuisine, prep_time_minutes, cook_time_minutes, servings)
        `
        )
        .eq("user_id", args.user_id)
        .eq("week_start", args.week_start)
        .order("day_of_week")
        .order("meal_type");

      if (error) throw error;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  // view_recipes tool
  server.tool(
    "view_recipes",
    "Browse or search recipes (read-only)",
    {
      user_id: z.string().describe("User ID (UUID)"),
      query: z.string().optional().describe("Search query for name"),
      cuisine: z.string().optional().describe("Filter by cuisine"),
      tag: z.string().optional().describe("Filter by tag"),
    },
    async (args) => {
      let query = supabase
        .from("recipes")
        .select("id, name, cuisine, prep_time_minutes, cook_time_minutes, servings, tags, rating")
        .eq("user_id", args.user_id);

      if (args.query) {
        query = query.ilike("name", `%${args.query}%`);
      }

      if (args.cuisine) {
        query = query.eq("cuisine", args.cuisine);
      }

      if (args.tag) {
        query = query.contains("tags", [args.tag]);
      }

      const { data, error } = await query.order("name");

      if (error) throw error;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  // view_shopping_list tool
  server.tool(
    "view_shopping_list",
    "View the shopping list for a given week",
    {
      user_id: z.string().describe("User ID (UUID)"),
      week_start: z.string().describe("Monday of the week (YYYY-MM-DD)"),
    },
    async (args) => {
      const { data, error } = await supabase
        .from("shopping_lists")
        .select("*")
        .eq("user_id", args.user_id)
        .eq("week_start", args.week_start)
        .single();

      if (error) throw error;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  // mark_item_purchased tool
  server.tool(
    "mark_item_purchased",
    "Toggle an item's purchased status on the shopping list",
    {
      shopping_list_id: z.string().describe("Shopping list ID (UUID)"),
      item_name: z.string().describe("Name of the item to mark"),
      purchased: z.boolean().describe("New purchased status"),
    },
    async (args) => {
      // Fetch the current shopping list
      const { data: list, error: fetchError } = await supabase
        .from("shopping_lists")
        .select("items")
        .eq("id", args.shopping_list_id)
        .single();

      if (fetchError) throw fetchError;

      // Update the specific item's purchased status
      const items = list.items as Array<{
        name: string;
        quantity: string;
        unit: string;
        purchased: boolean;
        recipe_id?: string;
      }>;

      const updatedItems = items.map((item) => {
        if (item.name === args.item_name) {
          return { ...item, purchased: args.purchased };
        }
        return item;
      });

      // Save back to database
      const { data, error } = await supabase
        .from("shopping_lists")
        .update({
          items: updatedItems,
          updated_at: new Date().toISOString(),
        })
        .eq("id", args.shopping_list_id)
        .select()
        .single();

      if (error) throw error;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  const response = await transport.handleRequest(c);
  return response ? withCors(response) : c.body(null, 204, corsHeaders);
});

app.get("/", (c) =>
  c.json(
    {
      status: "ok",
      service: "Meal Planning (Shared)",
      version: "1.1.0",
      auth: "oauth-2.1",
    },
    200,
    corsHeaders,
  ));

Deno.serve(app.fetch);
