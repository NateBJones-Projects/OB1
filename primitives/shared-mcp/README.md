# Shared MCP Server

A guide to building scoped MCP servers that give other people limited access to specific parts of your Open Brain.

https://github.com/user-attachments/assets/f488e495-fe2a-4ccc-a834-fc6ab5a0ed41

## When You Need This

You've built your Open Brain—a personal knowledge system with thoughts, contacts, goals, and work data. But now you want to share *part* of it with someone else:

- Your spouse needs access to meal plans and shopping lists
- A collaborator needs to see project tasks but not your personal notes
- A family member needs to update shared calendars without seeing your work
- A team member needs read-only access to specific documentation

You don't want to give them your entire MCP server with full database access. You need a **shared MCP server**—a separate server with scoped credentials, limited table access, and controlled permissions.

## The Security Model

A shared MCP server provides isolation through three layers:

### 1. Scoped Credentials

Create a separate database user/role with limited permissions:
- Different API key or database password
- Can only access specific tables
- Can be revoked without affecting your main server

### 2. Limited Table Access

Explicitly define which tables are available:
- Use Row-Level Security (RLS) policies
- Grant table-level permissions to the scoped role
- Hide sensitive tables entirely from the shared role

### 3. Read-Only vs Read-Write

Control operations per table:
- Some tables are read-only (view recipes, view meal plans)
- Some tables allow updates (shopping list items)
- Some tables allow inserts (adding new items)
- Sensitive operations (delete) can be blocked entirely

## Prerequisites

Before building a shared MCP server:

- Working Open Brain installation with your primary MCP server
- Supabase project (or PostgreSQL database with RLS support)
- Node.js 18+ installed
- Understanding of database roles and permissions
- The other person's Claude Desktop config access (or ability to share config)

## Build Guide

### Step 1: Decide What to Share

Create a mapping of tables and operations:

```
Table: meal_plans
  - Operations: SELECT
  - Why: Spouse can view planned meals

Table: recipes
  - Operations: SELECT
  - Why: Spouse can view recipe details

Table: shopping_list_items
  - Operations: SELECT, INSERT, UPDATE
  - Why: Spouse can view, add, and check off items

Table: thoughts (NOT SHARED)
Table: contacts (NOT SHARED)
Table: work_projects (NOT SHARED)
```

Be explicit. Default to not sharing unless there's a clear reason.

### Step 2: Create a Scoped Database Role

In Supabase SQL Editor (or via psql):

```sql
-- Create a new database role for shared access
CREATE ROLE household_member LOGIN PASSWORD 'secure_password_here';

-- Grant connection to the database
GRANT CONNECT ON DATABASE postgres TO household_member;

-- Grant usage on the schema
GRANT USAGE ON SCHEMA public TO household_member;

-- Grant specific table permissions
GRANT SELECT ON public.meal_plans TO household_member;
GRANT SELECT ON public.recipes TO household_member;
GRANT SELECT, INSERT, UPDATE ON public.shopping_list_items TO household_member;

-- Set up Row-Level Security (optional, for finer control)
ALTER TABLE shopping_list_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Household members see shared lists"
  ON shopping_list_items
  FOR SELECT
  TO household_member
  USING (household_id = current_setting('app.current_household')::uuid);

CREATE POLICY "Household members update shared lists"
  ON shopping_list_items
  FOR UPDATE
  TO household_member
  USING (household_id = current_setting('app.current_household')::uuid);
```

**For Supabase specifically**: Create a service role key with restricted permissions through the Supabase dashboard, or use connection pooling with different credentials.

### Step 3: Build a Separate MCP Server

Create a new MCP server project (TypeScript example):

```typescript
// shared-server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createClient } from "@supabase/supabase-js";

// Use separate environment variables for scoped access
const supabaseUrl = process.env.SHARED_SUPABASE_URL!;
const supabaseKey = process.env.SHARED_SUPABASE_KEY!; // Limited key

const supabase = createClient(supabaseUrl, supabaseKey);

const server = new Server(
  {
    name: "household-shared-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Only expose tools for shared tables
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "view_meal_plans",
        description: "View upcoming meal plans",
        inputSchema: {
          type: "object",
          properties: {
            days: { type: "number", description: "Number of days to view" },
          },
        },
      },
      {
        name: "view_shopping_list",
        description: "View current shopping list",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "add_shopping_item",
        description: "Add item to shopping list",
        inputSchema: {
          type: "object",
          properties: {
            item: { type: "string" },
            quantity: { type: "string" },
          },
          required: ["item"],
        },
      },
      {
        name: "update_shopping_item",
        description: "Mark shopping item as purchased",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string" },
            purchased: { type: "boolean" },
          },
          required: ["id", "purchased"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "view_meal_plans": {
      const days = request.params.arguments?.days || 7;
      const { data, error } = await supabase
        .from("meal_plans")
        .select("*")
        .gte("date", new Date().toISOString().split("T")[0])
        .order("date", { ascending: true })
        .limit(days);

      if (error) throw error;
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    case "view_shopping_list": {
      const { data, error } = await supabase
        .from("shopping_list_items")
        .select("*")
        .eq("purchased", false)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    case "add_shopping_item": {
      const { item, quantity } = request.params.arguments as {
        item: string;
        quantity?: string;
      };
      const { data, error } = await supabase
        .from("shopping_list_items")
        .insert({ item, quantity: quantity || "1", purchased: false })
        .select();

      if (error) throw error;
      return {
        content: [
          { type: "text", text: `Added: ${JSON.stringify(data, null, 2)}` },
        ],
      };
    }

    case "update_shopping_item": {
      const { id, purchased } = request.params.arguments as {
        id: string;
        purchased: boolean;
      };
      const { data, error } = await supabase
        .from("shopping_list_items")
        .update({ purchased })
        .eq("id", id)
        .select();

      if (error) throw error;
      return {
        content: [
          { type: "text", text: `Updated: ${JSON.stringify(data, null, 2)}` },
        ],
      };
    }

    default:
      throw new Error(`Unknown tool: ${request.params.name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Shared MCP server running on stdio");
}

main().catch(console.error);
```

### Step 4: Configure Separate Environment Variables

Create a `.env.shared` file:

```bash
# Shared MCP Server Environment Variables
SHARED_SUPABASE_URL=https://your-project.supabase.co
SHARED_SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...  # LIMITED KEY

# Optional: Household ID for RLS
SHARED_HOUSEHOLD_ID=uuid-here
```

Add to `package.json`:

```json
{
  "name": "household-shared-server",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node --env-file=.env.shared dist/shared-server.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^0.5.0",
    "@supabase/supabase-js": "^2.39.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.3.0"
  }
}
```

### Step 5: Deploy Independently

Add to the other person's Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "household-shared": {
      "command": "node",
      "args": [
        "--env-file=/absolute/path/to/.env.shared",
        "/absolute/path/to/shared-server/dist/shared-server.js"
      ]
    }
  }
}
```

**Key points:**
- This config goes on *their* machine, not yours
- They need Node.js installed
- They need the compiled server code and `.env.shared` file
- They do NOT need access to your main MCP server or credentials

### Step 6: Test the Access Boundaries

Verify the security model works:

```typescript
// Test script: test-boundaries.ts
import { createClient } from "@supabase/supabase-js";

const sharedClient = createClient(
  process.env.SHARED_SUPABASE_URL!,
  process.env.SHARED_SUPABASE_KEY!
);

async function testBoundaries() {
  console.log("Testing allowed access...");

  // Should succeed: reading meal plans
  const { data: meals, error: mealsError } = await sharedClient
    .from("meal_plans")
    .select("*");
  console.log("meal_plans:", mealsError ? "BLOCKED" : "ALLOWED");

  // Should succeed: reading shopping list
  const { data: shopping, error: shoppingError } = await sharedClient
    .from("shopping_list_items")
    .select("*");
  console.log("shopping_list_items (SELECT):", shoppingError ? "BLOCKED" : "ALLOWED");

  // Should fail: reading thoughts
  const { data: thoughts, error: thoughtsError } = await sharedClient
    .from("thoughts")
    .select("*");
  console.log("thoughts:", thoughtsError ? "BLOCKED ✓" : "ALLOWED (BAD)");

  // Should fail: deleting from shopping list
  const { error: deleteError } = await sharedClient
    .from("shopping_list_items")
    .delete()
    .eq("id", "test-id");
  console.log("shopping_list_items (DELETE):", deleteError ? "BLOCKED ✓" : "ALLOWED (BAD)");
}

testBoundaries();
```

Expected output:

```
meal_plans: ALLOWED
shopping_list_items (SELECT): ALLOWED
thoughts: BLOCKED ✓
shopping_list_items (DELETE): BLOCKED ✓
```

## Concrete Example: Spouse Access to Meal Planning

**Scenario**: You and your spouse share meal planning and grocery shopping. Your spouse wants to:
- See what's planned for dinner this week
- Add items to the shopping list
- Check off items when shopping
- View recipes for planned meals

But should NOT be able to:
- Read your personal thoughts or journal entries
- Access your work projects
- See your personal contacts
- Modify anything outside meal planning

**Implementation**:

1. **Tables shared**: `meal_plans`, `recipes`, `shopping_list_items`
2. **Operations**:
   - `meal_plans`: SELECT only
   - `recipes`: SELECT only
   - `shopping_list_items`: SELECT, INSERT, UPDATE (no DELETE)
3. **Credentials**: Separate Supabase service role key with table-level grants
4. **Deployment**: Compiled MCP server on spouse's laptop, configured in their Claude Desktop

**User experience for your spouse**:

```
Spouse: "What's for dinner this week?"
Claude: [calls view_meal_plans tool] "Here's the meal plan:
- Monday: Chicken tacos
- Tuesday: Pasta primavera
- Wednesday: Leftover night
..."

Spouse: "Add milk and eggs to the shopping list"
Claude: [calls add_shopping_item twice] "Added milk and eggs to the list."

Spouse: "Show me the recipe for chicken tacos"
Claude: [calls view_recipe tool] "Here's the recipe: ..."
```

Behind the scenes, Claude uses the shared MCP server—never touching your personal data.

## Expected Outcome

After following this guide, you will have:

1. A scoped database role with limited table access
2. A separate MCP server implementation with restricted tools
3. Independent deployment on another person's machine
4. Verified security boundaries preventing unauthorized access
5. A working shared-access pattern you can replicate for other use cases

The other person can now use Claude to interact with shared data, while your personal Open Brain remains completely private.

## Troubleshooting

### Issue 1: "Permission denied for table X"

**Symptom**: The shared server throws permission errors when trying to access a table.

**Cause**: The scoped database role doesn't have the necessary grants.

**Solution**:

```sql
-- Check current permissions
SELECT grantee, privilege_type, table_name
FROM information_schema.role_table_grants
WHERE grantee = 'household_member';

-- Grant missing permissions
GRANT SELECT ON public.meal_plans TO household_member;
GRANT SELECT, INSERT, UPDATE ON public.shopping_list_items TO household_member;
```

### Issue 2: Shared server can access tables it shouldn't

**Symptom**: The scoped role can read tables that should be private (e.g., `thoughts`, `contacts`).

**Cause**: The Supabase service role key has admin privileges, or the database role has excessive grants.

**Solution**:

```sql
-- Revoke all permissions first
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM household_member;

-- Grant only what's needed
GRANT SELECT ON public.meal_plans TO household_member;
GRANT SELECT ON public.recipes TO household_member;
GRANT SELECT, INSERT, UPDATE ON public.shopping_list_items TO household_member;

-- Verify no extra grants exist
SELECT grantee, privilege_type, table_name
FROM information_schema.role_table_grants
WHERE grantee = 'household_member';
```

For Supabase: Create a custom JWT with limited claims, or use connection pooling with role-based credentials.

### Issue 3: Changes not syncing between users

**Symptom**: You add a meal plan, but your spouse doesn't see it when they query.

**Cause**: Different database connections, caching, or RLS policies blocking visibility.

**Solution**:
1. Check both users are connecting to the same database:

   ```bash
   # Your .env
   echo $SUPABASE_URL

   # Their .env.shared
   echo $SHARED_SUPABASE_URL
   ```

2. Verify RLS policies allow visibility:

   ```sql
   -- Check RLS is enabled
   SELECT tablename, rowsecurity
   FROM pg_tables
   WHERE schemaname = 'public';

   -- If RLS is enabled, check policies
   SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
   FROM pg_policies
   WHERE tablename = 'meal_plans';
   ```

3. Disable RLS if not needed:

   ```sql
   ALTER TABLE meal_plans DISABLE ROW LEVEL SECURITY;
   ```

### Issue 4: MCP server won't start on spouse's machine

**Symptom**: Claude Desktop shows "MCP server failed to start" or tools don't appear.

**Cause**: Missing Node.js, incorrect paths, or environment variable issues.

**Solution**:
1. Verify Node.js version:

   ```bash
   node --version  # Should be 18+
   ```

2. Test the server manually:

   ```bash
   node --env-file=/path/to/.env.shared /path/to/dist/shared-server.js
   ```

3. Check Claude Desktop logs:

   ```bash
   # macOS
   tail -f ~/Library/Logs/Claude/mcp*.log
   ```

4. Verify absolute paths in config:

   ```json
   {
     "mcpServers": {
       "household-shared": {
         "command": "node",
         "args": [
           "--env-file=/Users/spouse/shared-mcp/.env.shared",
           "/Users/spouse/shared-mcp/dist/shared-server.js"
         ]
       }
     }
   }
   ```

## Extensions That Use This

- [Meal Planning](../../extensions/meal-planning/) — Includes a dedicated shared-server.ts for household grocery list and meal plan access

## Next Steps

- **Audit regularly**: Review what's shared and revoke access when no longer needed
- **Monitor usage**: Set up logging to see what queries the shared server receives
- **Iterate on permissions**: Start with read-only, add write permissions as trust builds
- **Document for users**: Create a simple guide for the other person explaining what they can ask Claude to do
- **Consider other use cases**: Team collaboration, family calendars, shared project tracking

You now have a reusable pattern for sharing parts of your Open Brain without compromising privacy.
