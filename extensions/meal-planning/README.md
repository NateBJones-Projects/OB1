# Extension 4: Meal Planning

## Why This Matters

Your agent can reason across five datasets — what you've cooked before, what's in the pantry, who's home this week (from your family calendar), what people actually liked, and what you need to buy. That's meal planning that actually works. And your spouse needs access too — not to your whole brain, just to the meal plan and the shopping list. This is where you learn to share specific parts of your system with someone else.

## Learning Path: Extension 4 of 6

| Extension | Name | Status |
|-----------|------|--------|
| 1 | Household Knowledge Base | Complete |
| 2 | Home Maintenance Tracker | Complete |
| 3 | Family Calendar | Complete |
| **4** | **Meal Planning** | **<-- You are here** |
| 5 | Professional CRM | Not started |
| 6 | Job Hunt Pipeline | Not started |

https://github.com/user-attachments/assets/cc477f00-bb6b-4f96-9f7d-a6bcd0cf8b60

## What You'll Learn

- Row Level Security (first introduction to multi-user access)
- Shared MCP server (separate server with limited, scoped access)
- JSONB for complex data (ingredients, instructions)
- Auto-generating derivative data (shopping lists from meal plans)
- Cross-extension queries (checking who's home this week from the family calendar)

## What It Does

A complete meal planning system with recipes, weekly meal plans, and auto-generated shopping lists. Includes a separate shared MCP server so your partner can view plans and check off grocery items without accessing your full Open Brain.

**Tables:**
- `recipes` — Your recipe collection with JSONB ingredients and instructions
- `meal_plans` — Weekly meal planning linked to recipes
- `shopping_lists` — Auto-generated grocery lists from meal plans

**Primary MCP Tools (full access):**
- `add_recipe` — Add a recipe with ingredients and instructions
- `search_recipes` — Search by name, cuisine, tags, or ingredient
- `update_recipe` — Update an existing recipe
- `create_meal_plan` — Plan meals for a week
- `get_meal_plan` — View the meal plan for a given week
- `generate_shopping_list` — Auto-generate shopping list from meal plan

**Shared MCP Tools (household access):**
- `view_meal_plan` — View meal plans (read-only)
- `view_recipes` — Browse recipes (read-only)
- `view_shopping_list` — View shopping list
- `mark_item_purchased` — Toggle item purchased status

## Prerequisites

- Working Open Brain setup
- Extensions 1-3 recommended (Extension 3's family_members table is referenced for cross-extension integration)
- Node.js 18+ and npm installed
- **Required reading:** [Row Level Security](../../primitives/rls/) primitive
- **Required reading:** [Shared MCP Server](../../primitives/shared-mcp/) primitive

## Steps

### 1. Create the Database Schema

Run the SQL in `schema.sql` against your Supabase database. This creates three RLS-enabled tables:

```bash
# Option A: Using Supabase SQL Editor (recommended)
# 1. Open https://supabase.com/dashboard/project/YOUR_PROJECT_ID/sql/new
# 2. Paste the contents of schema.sql
# 3. Click "Run"

# Option B: Using psql (if available)
psql $DATABASE_URL -f extensions/meal-planning/schema.sql
```

**Important:** The schema includes Row Level Security policies. Make sure you understand what RLS does before proceeding (see the [RLS primitive](../../primitives/rls/)).

### 2. Install Dependencies

```bash
cd extensions/meal-planning
npm init -y
npm install @modelcontextprotocol/sdk @supabase/supabase-js
npm install -D @types/node typescript
```

### 3. Build Both TypeScript Servers

```bash
npx tsc --init
npx tsc index.ts shared-server.ts --outDir dist --esModuleInterop --moduleResolution node
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

The primary MCP server needs your standard Supabase credentials:

```bash
echo $SUPABASE_URL
echo $SUPABASE_SERVICE_ROLE_KEY
```

The shared server needs a separate household key (see "Setting Up the Shared Server" below).

### 5. Register the Primary MCP Server

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "meal-planning": {
      "command": "node",
      "args": ["/absolute/path/to/OB1/extensions/meal-planning/dist/index.js"],
      "env": {
        "SUPABASE_URL": "your-supabase-url",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key"
      }
    }
  }
}
```

### 6. Test the Primary Server

Restart Claude Desktop and try these prompts:

```
Add a recipe: Chicken Stir-Fry. Ingredients: 1 lb chicken breast, 2 cups broccoli, 1 cup bell peppers, 3 tbsp soy sauce, 2 tbsp oil. Instructions: 1) Cut chicken into cubes. 2) Heat oil in wok. 3) Cook chicken 5 min. 4) Add vegetables, cook 3 min. 5) Add soy sauce, toss well. Tags: quick, healthy, asian. Prep 10 min, cook 15 min, serves 4.

Plan meals for the week of March 17: Monday dinner is the chicken stir-fry, Tuesday dinner is pasta night (custom meal, no recipe), Wednesday dinner is tacos.

Generate a shopping list for the week of March 17.
```

## Setting Up the Shared Server

The shared server is a separate MCP server with limited access for household members. Your spouse installs this on their device to view meal plans and manage the shopping list without accessing your full Open Brain.

### 1. Create a Household Member Role in Supabase

The RLS policies check for `auth.jwt() ->> 'role' = 'household_member'`. You need to create a JWT with this claim:

**Option A: Create a separate Supabase user for your spouse**
1. Go to Supabase Dashboard → Authentication → Users
2. Create a new user with your spouse's email
3. In the SQL Editor, grant the household_member role:

```sql
-- Create a custom claim for this user
UPDATE auth.users
SET raw_app_meta_data = jsonb_set(
  COALESCE(raw_app_meta_data, '{}'),
  '{role}',
  '"household_member"'
)
WHERE email = 'spouse@example.com';
```

**Option B: Use a shared service account**
1. Create a new Supabase API key in Settings → API with limited permissions
2. This is simpler but less granular than per-user authentication

For this guide, we'll use Option B (shared service account).

### 2. Configure the Shared Server Environment

Your spouse's Claude Desktop config:

```json
{
  "mcpServers": {
    "meal-planning-shared": {
      "command": "node",
      "args": ["/absolute/path/to/OB1/extensions/meal-planning/dist/shared-server.js"],
      "env": {
        "SUPABASE_URL": "your-supabase-url",
        "SUPABASE_HOUSEHOLD_KEY": "household-member-api-key"
      }
    }
  }
}
```

**Security note:** The `SUPABASE_HOUSEHOLD_KEY` should be a separate API key with limited permissions. It can only SELECT from recipes/meal_plans and UPDATE shopping_lists due to the RLS policies.

### 3. Test the Shared Server

Your spouse can now use prompts like:

```
What's for dinner this week?
Show me the shopping list for this week.
Mark "chicken breast" as purchased.
Search recipes tagged "quick".
```

They cannot create recipes, modify meal plans, or access other parts of your Open Brain.

## Cross-Extension Integration

**With Family Calendar (Extension 3):**
Your agent can check who's home this week via the `family_members` and `activities` tables to adjust serving sizes. Example prompt:

```
Who's home for dinner this week? Adjust the meal plan servings accordingly.
```

**With Household Knowledge Base (Extension 1):**
Cross-reference pantry inventory: "Do we have the ingredients for chicken stir-fry?" queries both the recipe's ingredients and your knowledge base entries about pantry stock.

**Pattern reuse:**
The RLS patterns you learn here apply directly to Extensions 5 (Professional CRM) and 6 (Job Hunt Pipeline). The shared MCP server pattern is reusable for any future extension where you want to give someone else partial access.

## Expected Outcome

Your agent can now:

- Store and search your recipe collection
- Plan weekly meals with a mix of recipes and custom entries
- Auto-generate shopping lists by aggregating recipe ingredients
- Let your spouse view plans and check off grocery items without full system access

The shared server demonstrates a key Open Brain principle: your data, your rules. You control exactly what someone else can see and do.

## Troubleshooting

**"Missing required environment variables: SUPABASE_HOUSEHOLD_KEY"**
- The shared server needs a separate API key. Create one in Supabase Dashboard → Settings → API, or use the steps in "Setting Up the Shared Server" above.

**RLS policies blocking queries:**
- Verify your user has the `household_member` role set in `raw_app_meta_data`
- Check the RLS policies in the Supabase SQL Editor (they should match the schema.sql)
- Test with service role key first to confirm it's not an RLS issue

**"Cannot find module '@modelcontextprotocol/sdk'"**
- Run `npm install` in the `extensions/meal-planning/` directory

**JSONB ingredient search not working:**
- The `search_recipes` tool uses `.cs.` (contains) operator for JSONB. Make sure the ingredient name matches exactly (case-insensitive).
- For more flexible search, consider adding a GIN index on the ingredients JSONB column.

**Shopping list aggregation is wrong:**
- The current implementation does simple string concatenation for quantities (e.g., "1 cup + 2 cups").
- For production use, you'd want smarter quantity aggregation (parsing units and adding numbers).

**Shared server can see all my data:**
- Double-check the RLS policies are enabled (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`)
- Verify the `household_member` role is set correctly in the JWT claims
- Test by trying to insert/delete from the shared server (should fail)

## Next Steps

**Extension 5: Professional CRM** — You'll apply the RLS skills you just learned to protect professional contact data. The shared server pattern isn't needed here (your work contacts are private), but the multi-entity relationship (contacts → interactions) is the same pattern you used in Extension 3 (family members → activities).

**Key concepts in Extension 5:**
- Contact management with interaction history
- Relationship tracking and follow-up reminders
- RLS for sensitive professional data
- Integration with calendar (Extension 3) for scheduling follow-ups

Continue to [Extension 5: Professional CRM](../professional-crm/)
