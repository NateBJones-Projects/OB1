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
  const response = await transport.handleRequest(c);
  return response ? withCors(response) : c.body(null, 204, corsHeaders);
});

app.get("*", (c) =>
  c.json({ status: "ok", service: "Home Maintenance Tracker", version: "1.1.0", auth: "oauth-2.1" }, 200, corsHeaders));

Deno.serve(app.fetch);
