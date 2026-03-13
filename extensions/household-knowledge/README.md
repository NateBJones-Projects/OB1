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
- Foreign key relationships to user accounts
- Simple MCP tool creation
- JSONB patterns for flexible metadata storage
- Text search with ILIKE patterns
- Building a Supabase-backed MCP server

## Prerequisites

- Working Open Brain setup
- Supabase project configured
- Node.js 18+ installed
- Basic understanding of SQL and TypeScript

## Credential Tracker

You'll reference these values during setup. Copy this block into a text editor and fill it in as you go.

> **Already have your Supabase credentials from the [Setup Guide](../../docs/01-getting-started.md)?** You just need the same Project URL and Secret key.

```text
HOUSEHOLD KNOWLEDGE -- CREDENTIAL TRACKER
--------------------------------------

SUPABASE (from your Open Brain setup)
  Project URL:           ____________
  Secret key:            ____________

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

### 2. Install Dependencies

```bash
cd extensions/household-knowledge
npm install
```

### 3. Configure Environment Variables

Create a `.env` file in this directory:

```env
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 4. Build the MCP Server

```bash
npm run build
```

### 5. Add to Your MCP Configuration

Add this extension to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "household-knowledge": {
      "command": "node",
      "args": ["/path/to/extensions/household-knowledge/build/index.js"],
      "env": {
        "SUPABASE_URL": "your_supabase_url",
        "SUPABASE_SERVICE_ROLE_KEY": "your_service_role_key"
      }
    }
  }
}
```

### 6. Restart Claude Desktop

Restart Claude Desktop to load the new MCP server.

### 7. Test the Extension

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

### "Cannot connect to Supabase"

- Verify your `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are correct
- Check that your Supabase project is active
- Ensure Row Level Security (RLS) policies allow service role access

### "Tool not found" in Claude

- Verify the MCP server is configured in `claude_desktop_config.json`
- Check that the path to `index.js` is absolute and correct
- Restart Claude Desktop after configuration changes
- Check Claude's MCP logs for connection errors

### "Permission denied" errors

- The service role key bypasses RLS, so this suggests a configuration issue
- Verify the user_id being passed exists in `auth.users`
- Check that foreign key constraints are not blocking inserts

### TypeScript build errors

- Ensure you've run `npm install` first
- Check that Node.js version is 18 or higher: `node --version`
- Delete `node_modules` and `package-lock.json`, then reinstall

## Next Steps

**Extension 2: Home Maintenance Tracker** — Learn how to handle recurring tasks, date-based scheduling, and historical logging. The maintenance tracker introduces one-to-many relationships (task → multiple log entries) and time-based queries that surface upcoming work.

[Continue to Extension 2 →](../home-maintenance/README.md)
