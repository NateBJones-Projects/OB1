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

  const server = new McpServer({ name: "family-calendar", version: "1.0.0" });

  // Tool: add_family_member
  server.tool(
    "add_family_member",
    "Add a person to your household roster",
    {
      name: z.string().describe("Person's name"),
      relationship: z.string().optional().describe("Relationship to you (e.g. 'self', 'spouse', 'child', 'parent')"),
      birth_date: z.string().optional().describe("Birth date (YYYY-MM-DD format)"),
      notes: z.string().optional().describe("Additional notes"),
    },
    async (args) => {
      const { data, error } = await supabase
        .from("family_members")
        .insert({
          user_id: userId,
          name: args.name,
          relationship: args.relationship,
          birth_date: args.birth_date,
          notes: args.notes,
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

  // Tool: add_activity
  server.tool(
    "add_activity",
    "Schedule an activity or recurring event",
    {
      family_member_id: z.string().optional().describe("Family member ID (null for whole family)"),
      title: z.string().describe("Activity title"),
      activity_type: z.string().optional().describe("Type: 'sports', 'medical', 'school', 'social', etc."),
      day_of_week: z.string().optional().describe("For recurring events: 'monday', 'tuesday', etc. Leave null for one-time"),
      start_time: z.string().optional().describe("Start time (HH:MM format)"),
      end_time: z.string().optional().describe("End time (HH:MM format)"),
      start_date: z.string().optional().describe("Start date (YYYY-MM-DD format)"),
      end_date: z.string().optional().describe("End date for recurring (YYYY-MM-DD), null for ongoing"),
      location: z.string().optional().describe("Location"),
      notes: z.string().optional().describe("Additional notes"),
    },
    async (args) => {
      const { data, error } = await supabase
        .from("activities")
        .insert({
          user_id: userId,
          family_member_id: args.family_member_id || null,
          title: args.title,
          activity_type: args.activity_type,
          day_of_week: args.day_of_week,
          start_time: args.start_time,
          end_time: args.end_time,
          start_date: args.start_date,
          end_date: args.end_date,
          location: args.location,
          notes: args.notes,
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

  // Tool: get_week_schedule
  server.tool(
    "get_week_schedule",
    "Get all activities for a given week, grouped by day",
    {
      week_start: z.string().describe("Monday of the week (YYYY-MM-DD format)"),
      family_member_id: z.string().optional().describe("Optional: filter by family member"),
    },
    async (args) => {
      // Calculate week end date
      const weekStart = new Date(args.week_start);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);

      let query = supabase
        .from("activities")
        .select(
          `
          *,
          family_members:family_member_id (name, relationship)
        `
        )
        .eq("user_id", userId)
        .or(
          `and(start_date.lte.${weekEnd.toISOString().split("T")[0]},or(end_date.gte.${args.week_start},end_date.is.null)),day_of_week.not.is.null`
        );

      if (args.family_member_id) {
        query = query.eq("family_member_id", args.family_member_id);
      }

      const { data, error } = await query.order("start_time");

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

  // Tool: search_activities
  server.tool(
    "search_activities",
    "Search activities by title, type, or family member name",
    {
      query: z.string().optional().describe("Search query"),
      activity_type: z.string().optional().describe("Optional: filter by activity type"),
      family_member_id: z.string().optional().describe("Optional: filter by family member"),
    },
    async (args) => {
      let query = supabase
        .from("activities")
        .select(
          `
          *,
          family_members:family_member_id (name, relationship)
        `
        )
        .eq("user_id", userId);

      if (args.query) {
        query = query.ilike("title", `%${args.query}%`);
      }

      if (args.activity_type) {
        query = query.eq("activity_type", args.activity_type);
      }

      if (args.family_member_id) {
        query = query.eq("family_member_id", args.family_member_id);
      }

      const { data, error } = await query.order("start_date", {
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

  // Tool: add_important_date
  server.tool(
    "add_important_date",
    "Add a date to remember (birthday, anniversary, deadline)",
    {
      family_member_id: z.string().optional().describe("Family member ID (null for family-wide)"),
      title: z.string().describe("Event title"),
      date_value: z.string().describe("Date (YYYY-MM-DD format)"),
      recurring_yearly: z.boolean().optional().describe("Does this repeat every year?"),
      reminder_days_before: z.number().optional().describe("Days before to remind (default 7)"),
      notes: z.string().optional().describe("Additional notes"),
    },
    async (args) => {
      const { data, error } = await supabase
        .from("important_dates")
        .insert({
          user_id: userId,
          family_member_id: args.family_member_id || null,
          title: args.title,
          date_value: args.date_value,
          recurring_yearly: args.recurring_yearly || false,
          reminder_days_before: args.reminder_days_before || 7,
          notes: args.notes,
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

  // Tool: get_upcoming_dates
  server.tool(
    "get_upcoming_dates",
    "Get important dates in the next N days",
    {
      days_ahead: z.number().optional().describe("How many days to look ahead (default 30)"),
    },
    async (args) => {
      const daysAhead = args.days_ahead || 30;
      const today = new Date();
      const futureDate = new Date();
      futureDate.setDate(today.getDate() + daysAhead);

      const { data, error } = await supabase
        .from("important_dates")
        .select(
          `
          *,
          family_members:family_member_id (name, relationship)
        `
        )
        .eq("user_id", userId)
        .gte("date_value", today.toISOString().split("T")[0])
        .lte("date_value", futureDate.toISOString().split("T")[0])
        .order("date_value");

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

app.get("*", (c) => c.json({ status: "ok", service: "Family Calendar", version: "1.0.0" }));

Deno.serve(app.fetch);
