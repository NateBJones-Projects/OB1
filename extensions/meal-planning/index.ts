#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing required environment variables");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const server = new Server(
  {
    name: "meal-planning",
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
        name: "add_recipe",
        description: "Add a recipe with ingredients and instructions",
        inputSchema: {
          type: "object",
          properties: {
            user_id: { type: "string", description: "User ID (UUID)" },
            name: { type: "string", description: "Recipe name" },
            cuisine: { type: "string", description: "Cuisine type" },
            prep_time_minutes: {
              type: "number",
              description: "Prep time in minutes",
            },
            cook_time_minutes: {
              type: "number",
              description: "Cook time in minutes",
            },
            servings: { type: "number", description: "Number of servings" },
            ingredients: {
              type: "array",
              description:
                "Array of ingredient objects: [{name, quantity, unit}, ...]",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  quantity: { type: "string" },
                  unit: { type: "string" },
                },
              },
            },
            instructions: {
              type: "array",
              description: "Array of instruction strings",
              items: { type: "string" },
            },
            tags: {
              type: "array",
              description: "Tags for categorization",
              items: { type: "string" },
            },
            rating: {
              type: "number",
              description: "Rating 1-5",
            },
            notes: { type: "string", description: "Additional notes" },
          },
          required: ["user_id", "name", "ingredients", "instructions"],
        },
      },
      {
        name: "search_recipes",
        description: "Search recipes by name, cuisine, tags, or ingredient",
        inputSchema: {
          type: "object",
          properties: {
            user_id: { type: "string", description: "User ID (UUID)" },
            query: { type: "string", description: "Search query for name" },
            cuisine: { type: "string", description: "Filter by cuisine" },
            tag: { type: "string", description: "Filter by tag" },
            ingredient: {
              type: "string",
              description: "Search for recipes containing this ingredient",
            },
          },
          required: ["user_id"],
        },
      },
      {
        name: "update_recipe",
        description: "Update an existing recipe",
        inputSchema: {
          type: "object",
          properties: {
            recipe_id: { type: "string", description: "Recipe ID (UUID)" },
            name: { type: "string", description: "Recipe name" },
            cuisine: { type: "string", description: "Cuisine type" },
            prep_time_minutes: {
              type: "number",
              description: "Prep time in minutes",
            },
            cook_time_minutes: {
              type: "number",
              description: "Cook time in minutes",
            },
            servings: { type: "number", description: "Number of servings" },
            ingredients: {
              type: "array",
              description: "Array of ingredient objects",
              items: { type: "object" },
            },
            instructions: {
              type: "array",
              description: "Array of instruction strings",
              items: { type: "string" },
            },
            tags: {
              type: "array",
              description: "Tags for categorization",
              items: { type: "string" },
            },
            rating: { type: "number", description: "Rating 1-5" },
            notes: { type: "string", description: "Additional notes" },
          },
          required: ["recipe_id"],
        },
      },
      {
        name: "create_meal_plan",
        description: "Plan meals for a week",
        inputSchema: {
          type: "object",
          properties: {
            user_id: { type: "string", description: "User ID (UUID)" },
            week_start: {
              type: "string",
              description: "Monday of the week (YYYY-MM-DD)",
            },
            meals: {
              type: "array",
              description:
                "Array of meal entries: [{day_of_week, meal_type, recipe_id?, custom_meal?, servings?, notes?}, ...]",
              items: {
                type: "object",
                properties: {
                  day_of_week: { type: "string" },
                  meal_type: { type: "string" },
                  recipe_id: { type: "string" },
                  custom_meal: { type: "string" },
                  servings: { type: "number" },
                  notes: { type: "string" },
                },
              },
            },
          },
          required: ["user_id", "week_start", "meals"],
        },
      },
      {
        name: "get_meal_plan",
        description: "View the meal plan for a given week",
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
        name: "generate_shopping_list",
        description:
          "Auto-generate a shopping list from a week's meal plan by aggregating recipe ingredients",
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
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "add_recipe": {
        const { data, error } = await supabase
          .from("recipes")
          .insert({
            user_id: args.user_id,
            name: args.name,
            cuisine: args.cuisine,
            prep_time_minutes: args.prep_time_minutes,
            cook_time_minutes: args.cook_time_minutes,
            servings: args.servings,
            ingredients: args.ingredients,
            instructions: args.instructions,
            tags: args.tags || [],
            rating: args.rating,
            notes: args.notes,
            updated_at: new Date().toISOString(),
          })
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

      case "search_recipes": {
        let query = supabase
          .from("recipes")
          .select("*")
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

        if (args.ingredient) {
          // Search within JSONB ingredients array for name field
          query = query.or(
            `ingredients.cs.${JSON.stringify([{ name: args.ingredient }])}`
          );
        }

        const { data, error } = await query.order("created_at", {
          ascending: false,
        });

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

      case "update_recipe": {
        const updates: Record<string, any> = {
          updated_at: new Date().toISOString(),
        };

        if (args.name !== undefined) updates.name = args.name;
        if (args.cuisine !== undefined) updates.cuisine = args.cuisine;
        if (args.prep_time_minutes !== undefined)
          updates.prep_time_minutes = args.prep_time_minutes;
        if (args.cook_time_minutes !== undefined)
          updates.cook_time_minutes = args.cook_time_minutes;
        if (args.servings !== undefined) updates.servings = args.servings;
        if (args.ingredients !== undefined)
          updates.ingredients = args.ingredients;
        if (args.instructions !== undefined)
          updates.instructions = args.instructions;
        if (args.tags !== undefined) updates.tags = args.tags;
        if (args.rating !== undefined) updates.rating = args.rating;
        if (args.notes !== undefined) updates.notes = args.notes;

        const { data, error } = await supabase
          .from("recipes")
          .update(updates)
          .eq("id", args.recipe_id)
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

      case "create_meal_plan": {
        // Insert multiple meal plan entries
        const mealEntries = args.meals.map((meal: any) => ({
          user_id: args.user_id,
          week_start: args.week_start,
          day_of_week: meal.day_of_week,
          meal_type: meal.meal_type,
          recipe_id: meal.recipe_id || null,
          custom_meal: meal.custom_meal || null,
          servings: meal.servings || null,
          notes: meal.notes || null,
        }));

        const { data, error } = await supabase
          .from("meal_plans")
          .insert(mealEntries)
          .select();

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

      case "get_meal_plan": {
        const { data, error } = await supabase
          .from("meal_plans")
          .select(
            `
            *,
            recipes:recipe_id (name, cuisine, prep_time_minutes, cook_time_minutes)
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

      case "generate_shopping_list": {
        // Get the meal plan for the week
        const { data: mealPlan, error: mealError } = await supabase
          .from("meal_plans")
          .select(
            `
            *,
            recipes:recipe_id (id, ingredients, name)
          `
          )
          .eq("user_id", args.user_id)
          .eq("week_start", args.week_start);

        if (mealError) throw mealError;

        // Aggregate ingredients from all recipes
        const itemsMap = new Map();

        mealPlan?.forEach((meal: any) => {
          if (meal.recipes && meal.recipes.ingredients) {
            const ingredients = meal.recipes.ingredients as Array<{
              name: string;
              quantity: string;
              unit: string;
            }>;

            ingredients.forEach((ingredient) => {
              const key = `${ingredient.name}-${ingredient.unit}`;
              if (itemsMap.has(key)) {
                const existing = itemsMap.get(key);
                // Simple addition - in production you'd want smarter quantity aggregation
                existing.quantity = `${existing.quantity} + ${ingredient.quantity}`;
              } else {
                itemsMap.set(key, {
                  name: ingredient.name,
                  quantity: ingredient.quantity,
                  unit: ingredient.unit,
                  purchased: false,
                  recipe_id: meal.recipes.id,
                });
              }
            });
          }
        });

        const items = Array.from(itemsMap.values());

        // Check if shopping list already exists
        const { data: existing } = await supabase
          .from("shopping_lists")
          .select("id")
          .eq("user_id", args.user_id)
          .eq("week_start", args.week_start)
          .single();

        let result;
        if (existing) {
          // Update existing
          const { data, error } = await supabase
            .from("shopping_lists")
            .update({
              items,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id)
            .select()
            .single();

          if (error) throw error;
          result = data;
        } else {
          // Create new
          const { data, error } = await supabase
            .from("shopping_lists")
            .insert({
              user_id: args.user_id,
              week_start: args.week_start,
              items,
            })
            .select()
            .single();

          if (error) throw error;
          result = data;
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
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
  console.error("Server error:", error);
  process.exit(1);
});
