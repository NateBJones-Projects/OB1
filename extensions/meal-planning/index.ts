import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const app = new Hono();

app.post("*", async (c) => {
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


  const key = c.req.query("key") || c.req.header("x-access-key");
  const expected = Deno.env.get("MCP_ACCESS_KEY");
  if (!key || key !== expected) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const userId = Deno.env.get("DEFAULT_USER_ID");
  if (!userId) {
    return c.json({ error: "DEFAULT_USER_ID not configured" }, 500);
  }

  const server = new McpServer({ name: "meal-planning", version: "1.0.0" });

  // add_recipe tool
  server.tool(
    "add_recipe",
    "Add a recipe with ingredients and instructions",
    {
      name: z.string().describe("Recipe name"),
      cuisine: z.string().optional().describe("Cuisine type"),
      prep_time_minutes: z.number().optional().describe("Prep time in minutes"),
      cook_time_minutes: z.number().optional().describe("Cook time in minutes"),
      servings: z.number().optional().describe("Number of servings"),
      ingredients: z.array(z.object({
        name: z.string(),
        quantity: z.string(),
        unit: z.string(),
      })).describe("Array of ingredient objects: [{name, quantity, unit}, ...]"),
      instructions: z.array(z.string()).describe("Array of instruction strings"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
      rating: z.number().optional().describe("Rating 1-5"),
      notes: z.string().optional().describe("Additional notes"),
    },
    async (args) => {
      const { data, error } = await supabase
        .from("recipes")
        .insert({
          user_id: userId,
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
  );

  // search_recipes tool
  server.tool(
    "search_recipes",
    "Search recipes by name, cuisine, tags, or ingredient",
    {
      query: z.string().optional().describe("Search query for name"),
      cuisine: z.string().optional().describe("Filter by cuisine"),
      tag: z.string().optional().describe("Filter by tag"),
      ingredient: z.string().optional().describe("Search for recipes containing this ingredient"),
    },
    async (args) => {
      let query = supabase
        .from("recipes")
        .select("*")
        .eq("user_id", userId);

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
  );

  // update_recipe tool
  server.tool(
    "update_recipe",
    "Update an existing recipe",
    {
      recipe_id: z.string().describe("Recipe ID (UUID)"),
      name: z.string().optional().describe("Recipe name"),
      cuisine: z.string().optional().describe("Cuisine type"),
      prep_time_minutes: z.number().optional().describe("Prep time in minutes"),
      cook_time_minutes: z.number().optional().describe("Cook time in minutes"),
      servings: z.number().optional().describe("Number of servings"),
      ingredients: z.array(z.object({
        name: z.string(),
        quantity: z.string(),
        unit: z.string(),
      })).optional().describe("Array of ingredient objects"),
      instructions: z.array(z.string()).optional().describe("Array of instruction strings"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
      rating: z.number().optional().describe("Rating 1-5"),
      notes: z.string().optional().describe("Additional notes"),
    },
    async (args) => {
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
  );

  // create_meal_plan tool
  server.tool(
    "create_meal_plan",
    "Plan meals for a week",
    {
      week_start: z.string().describe("Monday of the week (YYYY-MM-DD)"),
      meals: z.array(z.object({
        day_of_week: z.string(),
        meal_type: z.string(),
        recipe_id: z.string().optional(),
        custom_meal: z.string().optional(),
        servings: z.number().optional(),
        notes: z.string().optional(),
      })).describe("Array of meal entries: [{day_of_week, meal_type, recipe_id?, custom_meal?, servings?, notes?}, ...]"),
    },
    async (args) => {
      // Insert multiple meal plan entries
      const mealEntries = args.meals.map((meal: any) => ({
        user_id: userId,
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
  );

  // get_meal_plan tool
  server.tool(
    "get_meal_plan",
    "View the meal plan for a given week",
    {
      week_start: z.string().describe("Monday of the week (YYYY-MM-DD)"),
    },
    async (args) => {
      const { data, error } = await supabase
        .from("meal_plans")
        .select(
          `
          *,
          recipes:recipe_id (name, cuisine, prep_time_minutes, cook_time_minutes)
        `
        )
        .eq("user_id", userId)
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

  // generate_shopping_list tool
  server.tool(
    "generate_shopping_list",
    "Auto-generate a shopping list from a week's meal plan by aggregating recipe ingredients",
    {
      week_start: z.string().describe("Monday of the week (YYYY-MM-DD)"),
    },
    async (args) => {
      // Get the meal plan for the week
      const { data: mealPlan, error: mealError } = await supabase
        .from("meal_plans")
        .select(
          `
          *,
          recipes:recipe_id (id, ingredients, name)
        `
        )
        .eq("user_id", userId)
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
        .eq("user_id", userId)
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
            user_id: userId,
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
  );

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

app.get("*", (c) => c.json({ status: "ok", service: "Meal Planning", version: "1.0.0" }));

Deno.serve(app.fetch);
