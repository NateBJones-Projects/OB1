# Extension 3: Family Calendar

## Why This Matters

Two kids, two parents, overlapping schedules. Soccer practice conflicts with the dentist appointment. Nobody bought the birthday present. The haircut hasn't been scheduled in months. The chaos isn't from lack of caring — it's from lack of a system that can reason across everyone's schedule at once. Your agent can cross-reference both parents' schedules against all kids' events and surface what's falling through the cracks.

## Learning Path: Extension 3 of 6

| Extension | Name | Status |
|-----------|------|--------|
| 1 | Household Knowledge Base | Complete |
| 2 | Home Maintenance Tracker | Complete |
| **3** | **Family Calendar** | **<-- You are here** |
| 4 | Meal Planning | Not started |
| 5 | Professional CRM | Not started |
| 6 | Job Hunt Pipeline | Not started |

## What You'll Learn

- Multi-entity data models (family members → activities relationship)
- Time-based queries and date handling
- Recurring events (weekly activities with day_of_week)
- Nullable foreign keys (activities can belong to one person or the whole family)
- Querying across date ranges

> **Note:** This extension doesn't use Row Level Security. RLS is introduced in Extension 4 (Meal Planning), where shared household access makes it necessary. Extensions 1-3 are single-user systems.

## What It Does

A multi-person family scheduling system. Track activities, important dates, and family members so your agent can spot conflicts, surface upcoming events, and make sure nothing gets forgotten.

**Tables:**
- `family_members` — People in your household
- `activities` — Scheduled events and recurring activities (soccer every Tuesday, one-time dentist appointment)
- `important_dates` — Birthdays, anniversaries, deadlines with optional yearly recurrence

**MCP Tools:**
- `add_family_member` — Add a person to your household roster
- `add_activity` — Schedule a one-time or recurring activity
- `get_week_schedule` — See everyone's schedule for a given week
- `search_activities` — Find activities by title, type, or family member
- `add_important_date` — Track birthdays, anniversaries, deadlines
- `get_upcoming_dates` — Surface dates in the next N days

## Prerequisites

- Working Open Brain setup
- Extensions 1-2 recommended but not required
- Node.js 18+ and npm installed

## Steps

### 1. Create the Database Schema

Run the SQL in `schema.sql` against your Supabase database:

```bash
# Option A: Using Supabase SQL Editor (recommended)
# 1. Open https://supabase.com/dashboard/project/YOUR_PROJECT_ID/sql/new
# 2. Paste the contents of schema.sql
# 3. Click "Run"

# Option B: Using psql (if available)
psql $DATABASE_URL -f extensions/family-calendar/schema.sql
```

### 2. Install Dependencies

```bash
cd extensions/family-calendar
npm init -y
npm install @modelcontextprotocol/sdk @supabase/supabase-js
npm install -D @types/node typescript
```

### 3. Build the TypeScript Server

```bash
npx tsc --init
npx tsc index.ts --outDir dist --esModuleInterop --moduleResolution node
```

Or add to `package.json`:

```json
{
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  }
}
```

### 4. Configure Environment Variables

The MCP server needs Supabase credentials. These should already be set if you completed the Getting Started guide. Verify:

```bash
echo $SUPABASE_URL
echo $SUPABASE_SERVICE_ROLE_KEY
```

### 5. Register the MCP Server

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "family-calendar": {
      "command": "node",
      "args": ["/absolute/path/to/OB1/extensions/family-calendar/dist/index.js"],
      "env": {
        "SUPABASE_URL": "your-supabase-url",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key"
      }
    }
  }
}
```

### 6. Restart Claude Desktop

Restart Claude Desktop to load the new MCP server.

### 7. Test It

Try these prompts:

```
Add my family members: me (Jonathan), spouse (Sarah), and two kids (Emma age 8, Noah age 5).

Add a recurring activity: Emma has soccer practice every Tuesday from 5-6pm at Lincoln Park, starting March 18.

Show me our schedule for the week of March 17.

Add an important date: Emma's birthday is May 15, remind me 7 days before.

What important dates are coming up in the next 30 days?
```

## Cross-Extension Integration

The family calendar sets up the `family_members` table that Meal Planning (Extension 4) depends on — knowing who's home this week determines how many meals to plan.

The multi-entity pattern (family_member → activities) is the same pattern you'll use for contacts → interactions in the Professional CRM (Extension 5).

When you build the Household Knowledge Base (Extension 1), you can cross-reference it here: "Who was Emma's pediatrician again?" can query Extension 1's knowledge base, then "Schedule Emma's checkup" uses this calendar.

## Expected Outcome

Your agent can now:

1. Track everyone's schedule in one place
2. Surface upcoming events and important dates
3. Spot scheduling conflicts (if two activities overlap)
4. Answer questions like "What does Emma have this week?" or "When is Noah's birthday?"
5. Remind you about important dates before they arrive

## Troubleshooting

**"Missing required environment variables"**
- Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set in the MCP config
- Check that the values match your Supabase project (find them in Supabase Dashboard → Project Settings → API)

**"relation 'family_members' does not exist"**
- The schema.sql wasn't run successfully
- Re-run the SQL in the Supabase SQL Editor

**"Cannot find module '@modelcontextprotocol/sdk'"**
- Run `npm install` in the `extensions/family-calendar/` directory

**TypeScript compilation errors:**
- Make sure you have a valid `tsconfig.json` (run `npx tsc --init` if missing)
- Verify you're compiling with `--esModuleInterop` and `--moduleResolution node`

**Activities not showing up in get_week_schedule:**
- Check that `start_date` and `end_date` are set correctly
- For recurring activities, make sure `day_of_week` is lowercase ('monday', not 'Monday')
- The week_start date should be a Monday in YYYY-MM-DD format

## Next Steps

**Extension 4: Meal Planning** — This is where things get interesting. You'll combine what you've learned about scheduling with Row Level Security and a shared MCP server. Your spouse will be able to view meal plans and check off grocery items without accessing your full Open Brain.

**Key concepts in Extension 4:**
- Row Level Security (first introduction to multi-user access)
- Shared MCP server (separate server with limited, scoped access)
- JSONB for complex data (ingredients, instructions)
- Auto-generating derivative data (shopping lists from meal plans)
- Cross-extension queries (checking who's home this week from the family calendar)

Continue to [Extension 4: Meal Planning](../meal-planning/)
