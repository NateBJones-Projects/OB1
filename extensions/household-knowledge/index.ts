#!/usr/bin/env node

/**
 * Extension 1: Household Knowledge Base MCP Server
 *
 * Provides tools for storing and retrieving household facts:
 * - Household items (paint colors, appliances, measurements, etc.)
 * - Vendor contacts (service providers)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Environment validation
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  process.exit(1);
}

// Initialize Supabase client
const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Type definitions
interface HouseholdItem {
  id: string;
  user_id: string;
  name: string;
  category: string | null;
  location: string | null;
  details: Record<string, any>;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface HouseholdVendor {
  id: string;
  user_id: string;
  name: string;
  service_type: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  notes: string | null;
  rating: number | null;
  last_used: string | null;
  created_at: string;
}

// Tool definitions
const TOOLS: Tool[] = [
  {
    name: "add_household_item",
    description: "Add a new household item (paint color, appliance, measurement, document, etc.)",
    inputSchema: {
      type: "object",
      properties: {
        user_id: {
          type: "string",
          description: "User ID (UUID) - typically auth.uid()",
        },
        name: {
          type: "string",
          description: "Name or description of the item",
        },
        category: {
          type: "string",
          description: "Category (e.g. 'paint', 'appliance', 'measurement', 'document')",
        },
        location: {
          type: "string",
          description: "Location in the home (e.g. 'Living Room', 'Kitchen')",
        },
        details: {
          type: "object",
          description: "Flexible metadata as JSON (brand, model, color, size, etc.)",
        },
        notes: {
          type: "string",
          description: "Additional notes or context",
        },
      },
      required: ["user_id", "name"],
    },
  },
  {
    name: "search_household_items",
    description: "Search household items by name, category, or location",
    inputSchema: {
      type: "object",
      properties: {
        user_id: {
          type: "string",
          description: "User ID (UUID)",
        },
        query: {
          type: "string",
          description: "Search term (searches name, category, location, and notes)",
        },
        category: {
          type: "string",
          description: "Filter by specific category",
        },
        location: {
          type: "string",
          description: "Filter by specific location",
        },
      },
      required: ["user_id"],
    },
  },
  {
    name: "get_item_details",
    description: "Get full details of a specific household item by ID",
    inputSchema: {
      type: "object",
      properties: {
        item_id: {
          type: "string",
          description: "Item ID (UUID)",
        },
        user_id: {
          type: "string",
          description: "User ID (UUID) for authorization",
        },
      },
      required: ["item_id", "user_id"],
    },
  },
  {
    name: "add_vendor",
    description: "Add a service provider (plumber, electrician, landscaper, etc.)",
    inputSchema: {
      type: "object",
      properties: {
        user_id: {
          type: "string",
          description: "User ID (UUID)",
        },
        name: {
          type: "string",
          description: "Vendor name",
        },
        service_type: {
          type: "string",
          description: "Type of service (e.g. 'plumber', 'electrician', 'landscaper')",
        },
        phone: {
          type: "string",
          description: "Phone number",
        },
        email: {
          type: "string",
          description: "Email address",
        },
        website: {
          type: "string",
          description: "Website URL",
        },
        notes: {
          type: "string",
          description: "Additional notes",
        },
        rating: {
          type: "number",
          description: "Rating from 1-5",
          minimum: 1,
          maximum: 5,
        },
        last_used: {
          type: "string",
          description: "Date last used (YYYY-MM-DD format)",
        },
      },
      required: ["user_id", "name"],
    },
  },
  {
    name: "list_vendors",
    description: "List service providers, optionally filtered by service type",
    inputSchema: {
      type: "object",
      properties: {
        user_id: {
          type: "string",
          description: "User ID (UUID)",
        },
        service_type: {
          type: "string",
          description: "Filter by service type (e.g. 'plumber', 'electrician')",
        },
      },
      required: ["user_id"],
    },
  },
];

// Tool handlers
async function handleAddHouseholdItem(args: any): Promise<string> {
  const { user_id, name, category, location, details, notes } = args;

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

  return JSON.stringify({
    success: true,
    message: `Added household item: ${name}`,
    item: data,
  }, null, 2);
}

async function handleSearchHouseholdItems(args: any): Promise<string> {
  const { user_id, query, category, location } = args;

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

  return JSON.stringify({
    success: true,
    count: data.length,
    items: data,
  }, null, 2);
}

async function handleGetItemDetails(args: any): Promise<string> {
  const { item_id, user_id } = args;

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

  return JSON.stringify({
    success: true,
    item: data,
  }, null, 2);
}

async function handleAddVendor(args: any): Promise<string> {
  const { user_id, name, service_type, phone, email, website, notes, rating, last_used } = args;

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

  return JSON.stringify({
    success: true,
    message: `Added vendor: ${name}`,
    vendor: data,
  }, null, 2);
}

async function handleListVendors(args: any): Promise<string> {
  const { user_id, service_type } = args;

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

  return JSON.stringify({
    success: true,
    count: data.length,
    vendors: data,
  }, null, 2);
}

// Server setup
const server = new Server(
  {
    name: "household-knowledge",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "add_household_item":
        return { content: [{ type: "text", text: await handleAddHouseholdItem(args) }] };
      case "search_household_items":
        return { content: [{ type: "text", text: await handleSearchHouseholdItems(args) }] };
      case "get_item_details":
        return { content: [{ type: "text", text: await handleGetItemDetails(args) }] };
      case "add_vendor":
        return { content: [{ type: "text", text: await handleAddVendor(args) }] };
      case "list_vendors":
        return { content: [{ type: "text", text: await handleListVendors(args) }] };
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: JSON.stringify({ success: false, error: errorMessage }) }],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Household Knowledge Base MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
