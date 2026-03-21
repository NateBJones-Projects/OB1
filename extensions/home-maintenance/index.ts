/**
 * Extension 2: Home Maintenance Tracker MCP Server
 *
 * Provides tools for tracking maintenance tasks and logging completed work:
 * - Maintenance tasks (recurring and one-time)
 * - Maintenance logs (history of completed work)
 * - Upcoming task queries
 * - Historical search
 */

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

  const server = new McpServer(
    { name: "home-maintenance", version: "1.0.0" },
  );

  // Tool: add_maintenance_task
  server.tool(
    "add_maintenance_task",
    "Create a new maintenance task (recurring or one-time)",
    {
      name: z.string().describe("Name of the maintenance task"),
      category: z.string().optional().describe("Category (e.g. 'hvac', 'plumbing', 'exterior', 'appliance', 'landscaping')"),
      frequency_days: z.number().optional().describe("How often this task repeats (in days). Null for one-time tasks. E.g. 90 for quarterly, 365 for annual"),
      next_due: z.string().optional().describe("When is this task next due (ISO 8601 date string, e.g. '2026-04-15')"),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional().describe("Priority level"),
      notes: z.string().optional().describe("Additional notes about this task"),
    },
    async (args) => {
      try {
        const { name, category, frequency_days, next_due, priority, notes } = args;

        const { data, error } = await supabase
          .from("maintenance_tasks")
          .insert({
            user_id: userId,
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

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Added maintenance task: ${name}`,
              task: data,
            }, null, 2),
          }],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: errorMessage }) }],
          isError: true,
        };
      }
    },
  );

  // Tool: log_maintenance
  server.tool(
    "log_maintenance",
    "Log that a maintenance task was completed. Automatically updates task's last_completed and calculates next_due.",
    {
      task_id: z.string().describe("ID of the maintenance task (UUID)"),
      completed_at: z.string().optional().describe("When the work was completed (ISO 8601 timestamp). Defaults to now if not provided."),
      performed_by: z.string().optional().describe("Who performed the work (e.g. 'self', vendor name)"),
      cost: z.number().optional().describe("Cost in dollars (or your currency)"),
      notes: z.string().optional().describe("Notes about the work performed"),
      next_action: z.string().optional().describe("Recommendations from the tech/contractor for next time"),
    },
    async (args) => {
      try {
        const { task_id, completed_at, performed_by, cost, notes, next_action } = args;

        // Insert the maintenance log
        // The database trigger will automatically update the parent task's last_completed and next_due
        const { data, error } = await supabase
          .from("maintenance_logs")
          .insert({
            task_id,
            user_id: userId,
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

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Maintenance logged successfully",
              log: data,
              updated_task: task,
            }, null, 2),
          }],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: errorMessage }) }],
          isError: true,
        };
      }
    },
  );

  // Tool: get_upcoming_maintenance
  server.tool(
    "get_upcoming_maintenance",
    "List maintenance tasks due in the next N days",
    {
      days_ahead: z.number().optional().describe("Number of days to look ahead (default 30)"),
    },
    async (args) => {
      try {
        const { days_ahead = 30 } = args;

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() + days_ahead);

        const { data, error } = await supabase
          .from("maintenance_tasks")
          .select("*")
          .eq("user_id", userId)
          .not("next_due", "is", null)
          .lte("next_due", cutoffDate.toISOString())
          .order("next_due", { ascending: true });

        if (error) {
          throw new Error(`Failed to get upcoming maintenance: ${error.message}`);
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              days_ahead,
              count: data.length,
              tasks: data,
            }, null, 2),
          }],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: errorMessage }) }],
          isError: true,
        };
      }
    },
  );

  // Tool: search_maintenance_history
  server.tool(
    "search_maintenance_history",
    "Search maintenance logs by task name, category, or date range",
    {
      task_name: z.string().optional().describe("Filter by task name (partial match)"),
      category: z.string().optional().describe("Filter by category"),
      date_from: z.string().optional().describe("Start date for filtering (ISO 8601 date string)"),
      date_to: z.string().optional().describe("End date for filtering (ISO 8601 date string)"),
    },
    async (args) => {
      try {
        const { task_name, category, date_from, date_to } = args;

        // First, build a query to get relevant task IDs if filtering by name or category
        let taskIds: string[] | null = null;

        if (task_name || category) {
          let taskQuery = supabase
            .from("maintenance_tasks")
            .select("id")
            .eq("user_id", userId);

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
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  success: true,
                  count: 0,
                  logs: [],
                }, null, 2),
              }],
            };
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
          .eq("user_id", userId);

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

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              count: data.length,
              logs: data,
            }, null, 2),
          }],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: errorMessage }) }],
          isError: true,
        };
      }
    },
  );

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

app.get("*", (c) => c.json({ status: "ok", service: "Home Maintenance Tracker", version: "1.0.0" }));

Deno.serve(app.fetch);
