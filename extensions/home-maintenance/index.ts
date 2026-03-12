#!/usr/bin/env node

/**
 * Extension 2: Home Maintenance Tracker MCP Server
 *
 * Provides tools for tracking maintenance tasks and logging completed work:
 * - Maintenance tasks (recurring and one-time)
 * - Maintenance logs (history of completed work)
 * - Upcoming task queries
 * - Historical search
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
interface MaintenanceTask {
  id: string;
  user_id: string;
  name: string;
  category: string | null;
  frequency_days: number | null;
  last_completed: string | null;
  next_due: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface MaintenanceLog {
  id: string;
  task_id: string;
  user_id: string;
  completed_at: string;
  performed_by: string | null;
  cost: number | null;
  notes: string | null;
  next_action: string | null;
}

// Tool definitions
const TOOLS: Tool[] = [
  {
    name: "add_maintenance_task",
    description: "Create a new maintenance task (recurring or one-time)",
    inputSchema: {
      type: "object",
      properties: {
        user_id: {
          type: "string",
          description: "User ID (UUID)",
        },
        name: {
          type: "string",
          description: "Name of the maintenance task",
        },
        category: {
          type: "string",
          description: "Category (e.g. 'hvac', 'plumbing', 'exterior', 'appliance', 'landscaping')",
        },
        frequency_days: {
          type: "number",
          description: "How often this task repeats (in days). Null for one-time tasks. E.g. 90 for quarterly, 365 for annual",
        },
        next_due: {
          type: "string",
          description: "When is this task next due (ISO 8601 date string, e.g. '2026-04-15')",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high", "urgent"],
          description: "Priority level",
        },
        notes: {
          type: "string",
          description: "Additional notes about this task",
        },
      },
      required: ["user_id", "name"],
    },
  },
  {
    name: "log_maintenance",
    description: "Log that a maintenance task was completed. Automatically updates task's last_completed and calculates next_due.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "ID of the maintenance task (UUID)",
        },
        user_id: {
          type: "string",
          description: "User ID (UUID)",
        },
        completed_at: {
          type: "string",
          description: "When the work was completed (ISO 8601 timestamp). Defaults to now if not provided.",
        },
        performed_by: {
          type: "string",
          description: "Who performed the work (e.g. 'self', vendor name)",
        },
        cost: {
          type: "number",
          description: "Cost in dollars (or your currency)",
        },
        notes: {
          type: "string",
          description: "Notes about the work performed",
        },
        next_action: {
          type: "string",
          description: "Recommendations from the tech/contractor for next time",
        },
      },
      required: ["task_id", "user_id"],
    },
  },
  {
    name: "get_upcoming_maintenance",
    description: "List maintenance tasks due in the next N days",
    inputSchema: {
      type: "object",
      properties: {
        user_id: {
          type: "string",
          description: "User ID (UUID)",
        },
        days_ahead: {
          type: "number",
          description: "Number of days to look ahead (default 30)",
        },
      },
      required: ["user_id"],
    },
  },
  {
    name: "search_maintenance_history",
    description: "Search maintenance logs by task name, category, or date range",
    inputSchema: {
      type: "object",
      properties: {
        user_id: {
          type: "string",
          description: "User ID (UUID)",
        },
        task_name: {
          type: "string",
          description: "Filter by task name (partial match)",
        },
        category: {
          type: "string",
          description: "Filter by category",
        },
        date_from: {
          type: "string",
          description: "Start date for filtering (ISO 8601 date string)",
        },
        date_to: {
          type: "string",
          description: "End date for filtering (ISO 8601 date string)",
        },
      },
      required: ["user_id"],
    },
  },
];

// Tool handlers
async function handleAddMaintenanceTask(args: any): Promise<string> {
  const { user_id, name, category, frequency_days, next_due, priority, notes } = args;

  const { data, error } = await supabase
    .from("maintenance_tasks")
    .insert({
      user_id,
      name,
      category: category || null,
      frequency_days: frequency_days || null,
      next_due: next_due || null,
      priority: priority || "medium",
      notes: notes || null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to add maintenance task: ${error.message}`);
  }

  return JSON.stringify({
    success: true,
    message: `Added maintenance task: ${name}`,
    task: data,
  }, null, 2);
}

async function handleLogMaintenance(args: any): Promise<string> {
  const { task_id, user_id, completed_at, performed_by, cost, notes, next_action } = args;

  // Insert the maintenance log
  // The database trigger will automatically update the parent task's last_completed and next_due
  const { data, error } = await supabase
    .from("maintenance_logs")
    .insert({
      task_id,
      user_id,
      completed_at: completed_at || new Date().toISOString(),
      performed_by: performed_by || null,
      cost: cost || null,
      notes: notes || null,
      next_action: next_action || null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to log maintenance: ${error.message}`);
  }

  // Fetch the updated task to show the new next_due
  const { data: task, error: taskError } = await supabase
    .from("maintenance_tasks")
    .select("*")
    .eq("id", task_id)
    .single();

  if (taskError) {
    console.error("Warning: Could not fetch updated task:", taskError.message);
  }

  return JSON.stringify({
    success: true,
    message: "Maintenance logged successfully",
    log: data,
    updated_task: task,
  }, null, 2);
}

async function handleGetUpcomingMaintenance(args: any): Promise<string> {
  const { user_id, days_ahead = 30 } = args;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() + days_ahead);

  const { data, error } = await supabase
    .from("maintenance_tasks")
    .select("*")
    .eq("user_id", user_id)
    .not("next_due", "is", null)
    .lte("next_due", cutoffDate.toISOString())
    .order("next_due", { ascending: true });

  if (error) {
    throw new Error(`Failed to get upcoming maintenance: ${error.message}`);
  }

  return JSON.stringify({
    success: true,
    days_ahead,
    count: data.length,
    tasks: data,
  }, null, 2);
}

async function handleSearchMaintenanceHistory(args: any): Promise<string> {
  const { user_id, task_name, category, date_from, date_to } = args;

  // First, build a query to get relevant task IDs if filtering by name or category
  let taskIds: string[] | null = null;

  if (task_name || category) {
    let taskQuery = supabase
      .from("maintenance_tasks")
      .select("id")
      .eq("user_id", user_id);

    if (task_name) {
      taskQuery = taskQuery.ilike("name", `%${task_name}%`);
    }

    if (category) {
      taskQuery = taskQuery.ilike("category", `%${category}%`);
    }

    const { data: tasks, error: taskError } = await taskQuery;

    if (taskError) {
      throw new Error(`Failed to search tasks: ${taskError.message}`);
    }

    taskIds = tasks.map(t => t.id);

    if (taskIds.length === 0) {
      // No matching tasks found
      return JSON.stringify({
        success: true,
        count: 0,
        logs: [],
      }, null, 2);
    }
  }

  // Now query maintenance_logs
  let logQuery = supabase
    .from("maintenance_logs")
    .select(`
      *,
      maintenance_tasks (
        id,
        name,
        category
      )
    `)
    .eq("user_id", user_id);

  if (taskIds) {
    logQuery = logQuery.in("task_id", taskIds);
  }

  if (date_from) {
    logQuery = logQuery.gte("completed_at", date_from);
  }

  if (date_to) {
    logQuery = logQuery.lte("completed_at", date_to);
  }

  const { data, error } = await logQuery.order("completed_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to search maintenance history: ${error.message}`);
  }

  return JSON.stringify({
    success: true,
    count: data.length,
    logs: data,
  }, null, 2);
}

// Server setup
const server = new Server(
  {
    name: "home-maintenance",
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
      case "add_maintenance_task":
        return { content: [{ type: "text", text: await handleAddMaintenanceTask(args) }] };
      case "log_maintenance":
        return { content: [{ type: "text", text: await handleLogMaintenance(args) }] };
      case "get_upcoming_maintenance":
        return { content: [{ type: "text", text: await handleGetUpcomingMaintenance(args) }] };
      case "search_maintenance_history":
        return { content: [{ type: "text", text: await handleSearchMaintenanceHistory(args) }] };
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
  console.error("Home Maintenance Tracker MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
