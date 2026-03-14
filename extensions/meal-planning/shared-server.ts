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

const app = new Hono();

app.post("/mcp", async (c) => {
  const key = c.req.query("key") || c.req.header("x-access-key");
  const expected = Deno.env.get("MCP_HOUSEHOLD_ACCESS_KEY");
  if (!key || key !== expected) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_HOUSEHOLD_KEY")!,
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
  return transport.handleRequest(c);
});

app.get("/", (c) => c.json({ status: "ok", service: "Meal Planning (Shared)", version: "1.0.0" }));

Deno.serve(app.fetch);
