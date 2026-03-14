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

const app = new Hono();

app.post("*", async (c) => {
  const key = c.req.query("key") || c.req.header("x-access-key");
  const expected = Deno.env.get("MCP_ACCESS_KEY");
  if (!key || key !== expected) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const server = new McpServer(
    { name: "household-knowledge", version: "1.0.0" },
  );

  // Add household item
  server.tool(
    "add_household_item",
    "Add a new household item (paint color, appliance, measurement, document, etc.)",
    {
      user_id: z.string().describe("User ID (UUID) - typically auth.uid()"),
      name: z.string().describe("Name or description of the item"),
      category: z.string().optional().describe("Category (e.g. 'paint', 'appliance', 'measurement', 'document')"),
      location: z.string().optional().describe("Location in the home (e.g. 'Living Room', 'Kitchen')"),
      details: z.string().optional().describe("Flexible metadata as JSON string (e.g. '{\"brand\": \"Sherwin Williams\", \"color\": \"Sea Salt\"}')"),
      notes: z.string().optional().describe("Additional notes or context"),
    },
    async ({ user_id, name, category, location, details, notes }) => {
      try {
        const { data, error } = await supabase
          .from("household_items")
          .insert({
            user_id,
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
      user_id: z.string().describe("User ID (UUID)"),
      query: z.string().optional().describe("Search term (searches name, category, location, and notes)"),
      category: z.string().optional().describe("Filter by specific category"),
      location: z.string().optional().describe("Filter by specific location"),
    },
    async ({ user_id, query, category, location }) => {
      try {
        let queryBuilder = supabase
          .from("household_items")
          .select("*")
          .eq("user_id", user_id);

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
      user_id: z.string().describe("User ID (UUID) for authorization"),
    },
    async ({ item_id, user_id }) => {
      try {
        const { data, error } = await supabase
          .from("household_items")
          .select("*")
          .eq("id", item_id)
          .eq("user_id", user_id)
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
      user_id: z.string().describe("User ID (UUID)"),
      name: z.string().describe("Vendor name"),
      service_type: z.string().optional().describe("Type of service (e.g. 'plumber', 'electrician', 'landscaper')"),
      phone: z.string().optional().describe("Phone number"),
      email: z.string().optional().describe("Email address"),
      website: z.string().optional().describe("Website URL"),
      notes: z.string().optional().describe("Additional notes"),
      rating: z.number().min(1).max(5).optional().describe("Rating from 1-5"),
      last_used: z.string().optional().describe("Date last used (YYYY-MM-DD format)"),
    },
    async ({ user_id, name, service_type, phone, email, website, notes, rating, last_used }) => {
      try {
        const { data, error } = await supabase
          .from("household_vendors")
          .insert({
            user_id,
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
      user_id: z.string().describe("User ID (UUID)"),
      service_type: z.string().optional().describe("Filter by service type (e.g. 'plumber', 'electrician')"),
    },
    async ({ user_id, service_type }) => {
      try {
        let queryBuilder = supabase
          .from("household_vendors")
          .select("*")
          .eq("user_id", user_id);

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
  return transport.handleRequest(c);
});

app.get("*", (c) => c.json({ status: "ok", service: "Household Knowledge MCP", version: "1.0.0" }));

Deno.serve(app.fetch);
