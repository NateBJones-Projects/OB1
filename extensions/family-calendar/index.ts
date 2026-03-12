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
    name: "family-calendar",
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
        name: "add_family_member",
        description: "Add a person to your household roster",
        inputSchema: {
          type: "object",
          properties: {
            user_id: { type: "string", description: "User ID (UUID)" },
            name: { type: "string", description: "Person's name" },
            relationship: {
              type: "string",
              description: "Relationship to you (e.g. 'self', 'spouse', 'child', 'parent')",
            },
            birth_date: {
              type: "string",
              description: "Birth date (YYYY-MM-DD format)",
            },
            notes: { type: "string", description: "Additional notes" },
          },
          required: ["user_id", "name"],
        },
      },
      {
        name: "add_activity",
        description: "Schedule an activity or recurring event",
        inputSchema: {
          type: "object",
          properties: {
            user_id: { type: "string", description: "User ID (UUID)" },
            family_member_id: {
              type: "string",
              description: "Family member ID (null for whole family)",
            },
            title: { type: "string", description: "Activity title" },
            activity_type: {
              type: "string",
              description: "Type: 'sports', 'medical', 'school', 'social', etc.",
            },
            day_of_week: {
              type: "string",
              description:
                "For recurring events: 'monday', 'tuesday', etc. Leave null for one-time",
            },
            start_time: {
              type: "string",
              description: "Start time (HH:MM format)",
            },
            end_time: { type: "string", description: "End time (HH:MM format)" },
            start_date: {
              type: "string",
              description: "Start date (YYYY-MM-DD format)",
            },
            end_date: {
              type: "string",
              description: "End date for recurring (YYYY-MM-DD), null for ongoing",
            },
            location: { type: "string", description: "Location" },
            notes: { type: "string", description: "Additional notes" },
          },
          required: ["user_id", "title"],
        },
      },
      {
        name: "get_week_schedule",
        description: "Get all activities for a given week, grouped by day",
        inputSchema: {
          type: "object",
          properties: {
            user_id: { type: "string", description: "User ID (UUID)" },
            week_start: {
              type: "string",
              description: "Monday of the week (YYYY-MM-DD format)",
            },
            family_member_id: {
              type: "string",
              description: "Optional: filter by family member",
            },
          },
          required: ["user_id", "week_start"],
        },
      },
      {
        name: "search_activities",
        description: "Search activities by title, type, or family member name",
        inputSchema: {
          type: "object",
          properties: {
            user_id: { type: "string", description: "User ID (UUID)" },
            query: { type: "string", description: "Search query" },
            activity_type: {
              type: "string",
              description: "Optional: filter by activity type",
            },
            family_member_id: {
              type: "string",
              description: "Optional: filter by family member",
            },
          },
          required: ["user_id"],
        },
      },
      {
        name: "add_important_date",
        description: "Add a date to remember (birthday, anniversary, deadline)",
        inputSchema: {
          type: "object",
          properties: {
            user_id: { type: "string", description: "User ID (UUID)" },
            family_member_id: {
              type: "string",
              description: "Family member ID (null for family-wide)",
            },
            title: { type: "string", description: "Event title" },
            date_value: {
              type: "string",
              description: "Date (YYYY-MM-DD format)",
            },
            recurring_yearly: {
              type: "boolean",
              description: "Does this repeat every year?",
            },
            reminder_days_before: {
              type: "number",
              description: "Days before to remind (default 7)",
            },
            notes: { type: "string", description: "Additional notes" },
          },
          required: ["user_id", "title", "date_value"],
        },
      },
      {
        name: "get_upcoming_dates",
        description: "Get important dates in the next N days",
        inputSchema: {
          type: "object",
          properties: {
            user_id: { type: "string", description: "User ID (UUID)" },
            days_ahead: {
              type: "number",
              description: "How many days to look ahead (default 30)",
            },
          },
          required: ["user_id"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "add_family_member": {
        const { data, error } = await supabase
          .from("family_members")
          .insert({
            user_id: args.user_id,
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

      case "add_activity": {
        const { data, error } = await supabase
          .from("activities")
          .insert({
            user_id: args.user_id,
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

      case "get_week_schedule": {
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
          .eq("user_id", args.user_id)
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

      case "search_activities": {
        let query = supabase
          .from("activities")
          .select(
            `
            *,
            family_members:family_member_id (name, relationship)
          `
          )
          .eq("user_id", args.user_id);

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

      case "add_important_date": {
        const { data, error } = await supabase
          .from("important_dates")
          .insert({
            user_id: args.user_id,
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

      case "get_upcoming_dates": {
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
          .eq("user_id", args.user_id)
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
