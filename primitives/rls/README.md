# Row Level Security (RLS)

Row Level Security (RLS) is PostgreSQL's built-in mechanism for controlling which rows in a table are visible or modifiable by different users. Instead of managing access control in your application code, you define policies directly on the database — so security is enforced at the data layer regardless of how you connect (MCP, REST API, direct SQL).

## Why RLS Matters for Open Brain Extensions

When you build an Open Brain extension that stores personal data (recipes, contacts, job applications), you need a way to ensure:

- Each user only sees their own data
- Household members can share access to certain tables (meal plans, shopping lists)
- Service workers (like MCP servers) can operate with appropriate permissions
- You don't accidentally leak data between users

RLS is the foundation that makes multi-user and shared-access extensions possible.

## Prerequisites

- A Supabase project with at least one table created
- Basic understanding of SQL and PostgreSQL
- Familiarity with Supabase authentication (users have UUIDs via `auth.uid()`)

## How PostgreSQL Policies Work in Supabase

Supabase uses PostgreSQL's RLS system with a few key conventions:

1. **Authentication context**: Supabase automatically sets the database user based on the JWT token passed in requests. You can access the current user's ID with `auth.uid()`.

2. **Policies are additive**: If multiple policies apply to a query, a row is returned if ANY policy allows it (they're OR'd together).

3. **Service role bypasses RLS**: The `service_role` key bypasses RLS entirely — useful for admin operations, but be careful not to use it when you want RLS enforced.

4. **Four policy types**:
   - `SELECT` — who can read rows
   - `INSERT` — who can create rows
   - `UPDATE` — who can modify rows
   - `DELETE` — who can remove rows

## Common RLS Patterns

### Pattern 1: User-Scoped (Each User Sees Only Their Own Data)

This is the most common pattern for personal data like notes, tasks, or journal entries.

**Step 1**: Enable RLS on the table:

```sql
ALTER TABLE personal_notes ENABLE ROW LEVEL SECURITY;
```

**Step 2**: Create policies for each operation:

```sql
-- Users can view only their own notes
CREATE POLICY "Users can view their own notes"
  ON personal_notes
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert notes with their own user_id
CREATE POLICY "Users can insert their own notes"
  ON personal_notes
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update only their own notes
CREATE POLICY "Users can update their own notes"
  ON personal_notes
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete only their own notes
CREATE POLICY "Users can delete their own notes"
  ON personal_notes
  FOR DELETE
  USING (auth.uid() = user_id);
```

**Expected Outcome**: Each authenticated user sees only rows where `user_id` matches their Supabase auth UUID. Other users' data is completely invisible.

### Pattern 2: Team/Household-Scoped (Family Members Share Access)

For extensions like meal planning or shared shopping lists, you want a "household" concept where multiple users can access the same data.

**Prerequisites**: You need a `households` table and a `household_members` junction table:

```sql
CREATE TABLE households (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE household_members (
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member',
  PRIMARY KEY (household_id, user_id)
);

CREATE TABLE shared_shopping_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  quantity INTEGER,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Step 1**: Enable RLS:

```sql
ALTER TABLE shared_shopping_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
```

**Step 2**: Create household access policies:

```sql
-- Users can view shopping lists for households they belong to
CREATE POLICY "Household members can view shared shopping lists"
  ON shared_shopping_lists
  FOR SELECT
  USING (
    household_id IN (
      SELECT household_id
      FROM household_members
      WHERE user_id = auth.uid()
    )
  );

-- Users can insert items for their households
CREATE POLICY "Household members can add items"
  ON shared_shopping_lists
  FOR INSERT
  WITH CHECK (
    household_id IN (
      SELECT household_id
      FROM household_members
      WHERE user_id = auth.uid()
    )
  );

-- Users can update items in their households
CREATE POLICY "Household members can update items"
  ON shared_shopping_lists
  FOR UPDATE
  USING (
    household_id IN (
      SELECT household_id
      FROM household_members
      WHERE user_id = auth.uid()
    )
  );

-- Users can delete items from their households
CREATE POLICY "Household members can delete items"
  ON shared_shopping_lists
  FOR DELETE
  USING (
    household_id IN (
      SELECT household_id
      FROM household_members
      WHERE user_id = auth.uid()
    )
  );

-- Household members can see their household membership
CREATE POLICY "Users can view their household memberships"
  ON household_members
  FOR SELECT
  USING (user_id = auth.uid());

-- Users can view households they belong to
CREATE POLICY "Members can view their households"
  ON households
  FOR SELECT
  USING (
    id IN (
      SELECT household_id
      FROM household_members
      WHERE user_id = auth.uid()
    )
  );
```

**Expected Outcome**: Multiple users who are members of the same household can all see and modify the same shopping list items. Users who aren't in the household see nothing.

### Pattern 3: Public + Private (Some Rows Visible to All, Some Restricted)

For content that has both public and private items (blog posts, recipes, portfolio items).

**Prerequisites**: Your table needs a visibility column:

```sql
CREATE TABLE recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  ingredients TEXT[],
  instructions TEXT,
  visibility TEXT DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Step 1**: Enable RLS:

```sql
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
```

**Step 2**: Create mixed-visibility policies:

```sql
-- Anyone can view public recipes; authenticated users can view their own
CREATE POLICY "Public recipes are visible to all"
  ON recipes
  FOR SELECT
  USING (
    visibility = 'public'
    OR auth.uid() = user_id
  );

-- Only authenticated users can insert recipes
CREATE POLICY "Authenticated users can create recipes"
  ON recipes
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can only update their own recipes
CREATE POLICY "Users can update their own recipes"
  ON recipes
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can only delete their own recipes
CREATE POLICY "Users can delete their own recipes"
  ON recipes
  FOR DELETE
  USING (auth.uid() = user_id);
```

**Expected Outcome**: Public recipes are visible to everyone (even unauthenticated users). Private recipes are only visible to their creator. Only the creator can modify or delete their own recipes.

## Step-by-Step Guide for Enabling RLS on a Table

1. **Navigate to the Supabase SQL Editor**:
   - Go to your project dashboard
   - Click "SQL Editor" in the left sidebar
   - Click "New query"

2. **Enable RLS on your table**:

   ```sql
   ALTER TABLE your_table_name ENABLE ROW LEVEL SECURITY;
   ```

3. **Create a SELECT policy** (decide who can read):

   ```sql
   CREATE POLICY "Users can view their own rows"
     ON your_table_name
     FOR SELECT
     USING (auth.uid() = user_id);
   ```

4. **Create INSERT/UPDATE/DELETE policies** as needed:

   ```sql
   CREATE POLICY "Users can insert their own rows"
     ON your_table_name
     FOR INSERT
     WITH CHECK (auth.uid() = user_id);
   ```

5. **Test with the Supabase client**:
   - Use the `supabase-js` client with a user JWT (not the service role)
   - Query the table and verify you only see appropriate rows
   - Try inserting data and confirm the policy allows/blocks as expected

6. **Verify RLS is active**:

   ```sql
   SELECT schemaname, tablename, rowsecurity
   FROM pg_tables
   WHERE tablename = 'your_table_name';
   ```

   The `rowsecurity` column should be `true`.

## Troubleshooting

### Issue 1: I enabled RLS but now I can't see any data

**Cause**: RLS is enabled but you haven't created any policies, or your policies don't match your query context.

**Solution**:
- Check if policies exist:

  ```sql
  SELECT * FROM pg_policies WHERE tablename = 'your_table_name';
  ```

- If no policies exist, create at least a SELECT policy
- Verify `auth.uid()` returns a value (run `SELECT auth.uid();` in SQL editor while authenticated)
- Make sure you're using the `anon` or `authenticated` role, not the `service_role` key

### Issue 2: My service role key bypasses RLS

**Cause**: This is intentional behavior. The `service_role` key has superuser privileges and ignores all RLS policies.

**Solution**:
- Use the `anon` key for unauthenticated operations
- Use the `authenticated` role (via user JWT tokens) for authenticated operations
- Only use `service_role` for admin tasks where you explicitly want to bypass RLS
- If your MCP server is using `service_role`, consider switching to user-scoped JWTs or use a dedicated service account with limited privileges

### Issue 3: Policies aren't working with my MCP server

**Cause**: MCP servers often use the `service_role` key, which bypasses RLS. Alternatively, the authentication context isn't being passed correctly.

**Solution**:
- Verify which key your MCP server is using (check the server config)
- If using `service_role`: Either accept that RLS is bypassed, or refactor to use user tokens
- If using `anon`/user tokens: Ensure the JWT is being passed in the `Authorization` header
- Test policies directly in the SQL editor with `SELECT auth.uid();` to confirm authentication context
- Consider implementing user-scoped RLS even with `service_role` by adding a `user_id` parameter to your queries and filtering explicitly

## Extensions That Use This

- [Meal Planning](../../extensions/meal-planning/) — All tables (recipes, meal_plans, shopping_lists) use RLS to enable shared household access
- [Professional CRM](../../extensions/professional-crm/) — RLS protects contacts, interactions, and opportunities
- [Job Hunt Pipeline](../../extensions/job-hunt/) — RLS secures the entire 5-table job search schema

## Further Reading

- [Supabase Row Level Security Guide](https://supabase.com/docs/guides/auth/row-level-security)
- [PostgreSQL Policy Documentation](https://www.postgresql.org/docs/current/sql-createpolicy.html)
- [Supabase Auth Helpers](https://supabase.com/docs/guides/auth/auth-helpers) — for implementing user authentication in your application
- [Understanding PostgreSQL RLS Performance](https://supabase.com/blog/postgres-rls-performance) — optimization tips for complex policies
