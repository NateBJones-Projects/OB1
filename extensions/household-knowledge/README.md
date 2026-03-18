# Extension 1: Household Knowledge Base

## Why This Matters

You're at the paint store and can't remember what shade of blue is in the living room. Your kid's shoe size changed and you're ordering online from memory. The plumber who fixed the leak last year — what was their number? Every household accumulates hundreds of small facts that matter at exactly the wrong moment. Your Open Brain agent can hold all of them and surface them when you need them.

## Learning Path: Extension 1 of 6

| Extension | Name | Status |
|-----------|------|--------|
| **1** | **Household Knowledge Base** | **<-- You are here** |
| 2 | Home Maintenance Tracker | Not started |
| 3 | Family Calendar | Not started |
| 4 | Meal Planning & Recipes | Not started |
| 5 | Professional CRM | Not started |
| 6 | Job Hunt Pipeline | Not started |

## What It Does

A database and MCP server for storing and retrieving household facts — paint colors, appliance details, vendor contacts, measurements, warranty info, and anything else about your home and family that you'd otherwise forget.

## What You'll Learn

- Basic table design with PostgreSQL
- User-scoped data isolation with environment variables
- Simple MCP tool creation
- JSONB patterns for flexible metadata storage
- Text search with ILIKE patterns
- Building a Supabase-backed MCP server

## Prerequisites

- Working Open Brain setup
- Supabase project configured
- Supabase CLI installed and linked to your project

## Credential Tracker

You'll reference these values during setup. Copy this block into a text editor and fill it in as you go.

> **Already have your Supabase credentials from the [Setup Guide](../../docs/01-getting-started.md)?** You just need the same Project URL and Secret key.

```text
HOUSEHOLD KNOWLEDGE -- CREDENTIAL TRACKER
--------------------------------------

SUPABASE (from your Open Brain setup)
  Project URL:           ____________
  Secret key:            ____________
  Project ref:           ____________

GENERATED DURING SETUP
  Default User ID:       ____________
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

### 2. Generate Your User ID

The extension needs a user ID to scope your data. Generate a UUID and save it in your credential tracker:

```bash
# macOS / Linux
uuidgen | tr '[:upper:]' '[:lower:]'

# Or use any UUID generator — the value just needs to be unique to you
```

Set it as an environment variable for your Edge Function:

```bash
supabase secrets set DEFAULT_USER_ID=your-generated-uuid-here
```

### 3. Deploy the MCP Server

Follow the [Deploy an Edge Function](../../primitives/deploy-edge-function/) guide using these values:

| Setting | Value |
|---------|-------|
| Function name | `household-knowledge-mcp` |
| Download path | `extensions/household-knowledge` |

### 4. Connect to Your AI

Follow the [Remote MCP Connection](../../primitives/remote-mcp/) guide to connect this extension to Claude Desktop, ChatGPT, Claude Code, or any other MCP client.

| Setting | Value |
|---------|-------|
| Connector name | `Household Knowledge` |
| URL | Your **MCP Connection URL** from the credential tracker |

### 5. Test the Extension

Try these commands with Claude:

```
Add a household item: living room paint is Sherwin Williams Sea Salt SW 6204
```

```
Search for paint colors in my household items
```

```
Add a vendor: Mike's Plumbing, phone 555-1234, last used them in December 2025
```

```
List all my plumbers
```

## Cross-Extension Integration

This is the foundation. Future extensions build on the pattern you learn here:

- **JSONB flexibility pattern**: The `details` field in `household_items` uses JSONB to store arbitrary key-value pairs. You'll see this same pattern in Extension 4 (Meal Planning) for recipe ingredients and in Extension 5 (Professional CRM) for contact metadata.

- **Vendor tracking pattern**: The `household_vendors` table introduces a contact management pattern that evolves into full contact tracking in Extension 5 (Professional CRM).

- **User-scoped data**: Every query filters by `user_id`. This pattern is consistent across all extensions and ensures data isolation in multi-user environments.

## Expected Outcome

After completing this extension, you should be able to:

1. Store household facts with flexible metadata
2. Search items by name, category, or location
3. Track service providers with contact information
4. Retrieve specific item details on demand

Your agent will be able to answer questions like:
- "What's the model number of my dishwasher?"
- "When did we last use the electrician?"
- "What paint color is in the bedroom?"
- "Who's a good plumber we've used before?"

## Troubleshooting

For common issues (connection errors, 401s, deployment problems), see [Common Troubleshooting](../../primitives/troubleshooting/).

**Extension-specific issues:**

**"Permission denied" or foreign key errors on insert**
- Verify `DEFAULT_USER_ID` is set: `supabase secrets list` should show it
- The service role key bypasses RLS, so permission errors usually mean a missing env var
- If you ran an older version of `schema.sql` that had `REFERENCES auth.users(id)`, drop and recreate the tables with the updated schema

## Next Steps

**Extension 2: Home Maintenance Tracker** — Learn how to handle recurring tasks, date-based scheduling, and historical logging. The maintenance tracker introduces one-to-many relationships (task → multiple log entries) and time-based queries that surface upcoming work.

[Continue to Extension 2 →](../home-maintenance/README.md)
