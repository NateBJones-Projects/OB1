# Extension 2: Home Maintenance Tracker

## Why This Matters

The HVAC tech mentioned the pump was showing wear 18 months ago. The warranty on the water heater expires next month. The gutters haven't been cleaned since... when exactly? Without a system, these connections never get made — you just get expensive surprises. Your agent can track every maintenance task, remind you what's coming due, and keep a complete history so nothing slips through.

## Learning Path: Extension 2 of 6

| Extension | Name | Status |
|-----------|------|--------|
| 1 | Household Knowledge Base | Complete |
| **2** | **Home Maintenance Tracker** | **<-- You are here** |
| 3 | Family Calendar | Not started |
| 4 | Meal Planning & Recipes | Not started |
| 5 | Professional CRM | Not started |
| 6 | Job Hunt Pipeline | Not started |

## What It Does

A maintenance scheduling and history system. Track recurring tasks, log completed work, and let your agent surface what needs attention before it becomes an emergency.

## What You'll Learn

- Date handling and scheduling logic in PostgreSQL
- One-to-many relationships (task → multiple log entries)
- Automatic timestamp updates with triggers
- Time-based queries (upcoming tasks, date ranges)
- Computed fields (calculating next_due based on frequency)
- Historical logging patterns

## Prerequisites

- Working Open Brain setup
- Supabase project configured
- Supabase CLI installed and linked to your project
- Extension 1 recommended but not required

## Credential Tracker

You'll reference these values during setup. Copy this block into a text editor and fill it in as you go.

> **Already have your Supabase credentials from the [Setup Guide](../../docs/01-getting-started.md)?** You just need the same Project URL and Secret key.

```text
HOME MAINTENANCE -- CREDENTIAL TRACKER
--------------------------------------

SUPABASE (from your Open Brain setup)
  Project URL:           ____________
  Secret key:            ____________
  Project ref:           ____________

GENERATED DURING SETUP
  MCP Access Key:        ____________
  MCP Server URL:        ____________
  MCP Connection URL:    ____________

--------------------------------------
```

## Steps

### 1. Set Up the Database Schema

Run the SQL in `schema.sql` in your Supabase SQL Editor:

```bash
# Navigate to your Supabase project SQL editor
# https://supabase.com/dashboard/project/YOUR_PROJECT_ID/sql/new
```

Copy and paste the contents of `schema.sql` and click Run.

### 2. Deploy the MCP Server

Follow the [Deploy an Edge Function](../../primitives/deploy-edge-function/) guide using these values:

| Setting | Value |
|---------|-------|
| Function name | `home-maintenance-mcp` |
| Download path | `extensions/home-maintenance` |

### 3. Connect to Your AI

Follow the [Remote MCP Connection](../../primitives/remote-mcp/) guide to connect this extension to Claude Desktop, ChatGPT, Claude Code, or any other MCP client.

| Setting | Value |
|---------|-------|
| Connector name | `Home Maintenance` |
| URL | Your **MCP Connection URL** from the credential tracker |

### 4. Test the Extension

Try these commands with Claude:

```
Add a maintenance task: HVAC filter replacement, every 90 days, next due April 15th
```

```
Log maintenance: I just changed the HVAC filter, cost $45, did it myself
```

```
What maintenance is coming up in the next 30 days?
```

```
Show me the history for HVAC maintenance
```

## Cross-Extension Integration

The maintenance tracker introduces patterns you'll see throughout the remaining extensions:

- **Task → Log entries pattern**: A parent record (maintenance_task) with multiple child records (maintenance_logs). This same one-to-many pattern appears in:
  - Extension 5 (Professional CRM): contact → interaction logs
  - Extension 6 (Job Hunt Pipeline): application → interview logs

- **Auto-calculated dates**: The `log_maintenance` tool automatically updates `last_completed` and calculates `next_due` based on `frequency_days`. This computed field pattern shows how your database can maintain derived state without manual updates.

- **Time-based queries**: The `get_upcoming_maintenance` tool demonstrates how to query for records in a date range — essential for calendar systems (Extension 3) and deadline tracking (Extension 6).

- **Historical search**: The `search_maintenance_history` tool shows how to search across both parent and child tables with date filtering.

### Connection to Extension 1

If you built Extension 1 (Household Knowledge Base), you can reference your `household_vendors` when logging maintenance. The `performed_by` field in maintenance logs can store vendor names, creating an informal link between systems. In a production setup, you might add a foreign key to make this relationship explicit.

## Expected Outcome

After completing this extension, you should be able to:

1. Create recurring and one-time maintenance tasks
2. Log completed maintenance with cost and notes
3. Automatically calculate next due dates based on frequency
4. Query upcoming maintenance within a time window
5. Search maintenance history by task, category, or date range

Your agent will be able to answer questions like:
- "What maintenance is due this month?"
- "When did we last service the HVAC?"
- "How much have we spent on plumbing maintenance this year?"
- "What did the electrician recommend last time?"

## Troubleshooting

For common issues (connection errors, 401s, deployment problems), see [Common Troubleshooting](../../primitives/troubleshooting/).

**Extension-specific issues:**

**"next_due not updating after logging maintenance"**
- Verify that the task has a `frequency_days` value set
- Check that the `log_maintenance` tool completed successfully
- For one-time tasks (frequency_days = null), next_due remains null

**"Date parsing errors"**
- Ensure dates are in ISO 8601 format: `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM:SSZ`

## Next Steps

**Extension 3: Family Calendar** — Build on your date-handling skills to create a shared calendar system with event reminders and conflict detection. The calendar extends the time-based query patterns you learned here and introduces more complex date logic (recurring events, all-day vs. timed events, timezone handling).

[Continue to Extension 3 →](../family-calendar/README.md)
