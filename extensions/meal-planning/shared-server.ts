#!/usr/bin/env node

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

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_HOUSEHOLD_KEY = process.env.SUPABASE_HOUSEHOLD_KEY;

if (!SUPABASE_URL || !SUPABASE_HOUSEHOLD_KEY) {
  throw new Error(
    "Missing required environment variables: SUPABASE_URL and SUPABASE_HOUSEHOLD_KEY"
  );
}

// Create client with household member credentials
const supabase = createClient(SUPABASE_URL, SUPABASE_HOUSEHOLD_KEY);

const server = new Server(
  {
    name: "meal-planning-shared",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "view_meal_plan",
        description: "View the meal plan for a given week (read-only)",
        inputSchema: {
          type: "object",
          properties: {
            user_id: { type: "string", description: "User ID (UUID)" },
            week_start: {
              type: "string",
              description: "Monday of the week (YYYY-MM-DD)",
            },
          },
          required: ["user_id", "week_start"],
        },
      },
      {
        name: "view_recipes",
        description: "Browse or search recipes (read-only)",
        inputSchema: {
          type: "object",
          properties: {
            user_id: { type: "string", description: "User ID (UUID)" },
            query: { type: "string", description: "Search query for name" },
            cuisine: { type: "string", description: "Filter by cuisine" },
            tag: { type: "string", description: "Filter by tag" },
          },
          required: ["user_id"],
        },
      },
      {
        name: "view_shopping_list",
        description: "View the shopping list for a given week",
        inputSchema: {
          type: "object",
          properties: {
            user_id: { type: "string", description: "User ID (UUID)" },
            week_start: {
              type: "string",
              description: "Monday of the week (YYYY-MM-DD)",
            },
          },
          required: ["user_id", "week_start"],
        },
      },
      {
        name: "mark_item_purchased",
        description: "Toggle an item's purchased status on the shopping list",
        inputSchema: {
          type: "object",
          properties: {
            shopping_list_id: {
              type: "string",
              description: "Shopping list ID (UUID)",
            },
            item_name: {
              type: "string",
              description: "Name of the item to mark",
            },
            purchased: {
              type: "boolean",
              description: "New purchased status",
            },
          },
          required: ["shopping_list_id", "item_name", "purchased"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "view_meal_plan": {
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

      case "view_recipes": {
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

      case "view_shopping_list": {
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

      case "mark_item_purchased": {
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

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Shared server error:", error);
  process.exit(1);
});
