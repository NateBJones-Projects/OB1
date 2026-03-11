# CRM Contacts

> A personal CRM layer for Open Brain — track people, interactions, and relationship context.

## What It Does

Adds a `contacts` table and a `contact_interactions` table to your Supabase database, linked to your existing `thoughts` table. Store information about people you know, log interactions, and let your brain's semantic search surface relationship context when you need it.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/getting-started.md))
- Access to your Supabase SQL Editor

## Steps

<!-- TODO: Matt Hallett to fill in step-by-step instructions -->

1. Open your Supabase SQL Editor
2. Run the migration in `001_create_contacts.sql`
3. Run the migration in `002_create_interactions.sql`
4. Verify both tables were created
5. (Optional) Run `003_seed_example.sql` to see example data
6. Test by inserting a contact and querying it

## Expected Outcome

After running the migrations, your database has two new tables:

**`contacts`** — `id`, `name`, `email`, `company`, `role`, `notes`, `metadata` (jsonb), `created_at`, `updated_at`

**`contact_interactions`** — `id`, `contact_id` (FK), `thought_id` (FK, optional), `interaction_type`, `summary`, `metadata` (jsonb), `created_at`

Row Level Security is enabled on both tables with service-role-only access (matching your `thoughts` table policy). You can query contacts and their linked interactions through SQL or build a dashboard on top of this schema.

## Troubleshooting

**Issue: Foreign key constraint error when inserting interactions**
Solution: Make sure the `contact_id` references an existing contact. Insert the contact first, then log interactions against it.

**Issue: RLS blocking inserts**
Solution: Use your service role key, not the anon key. These tables use the same RLS pattern as `thoughts`.

**Issue: Want to link a thought to a contact but `thought_id` is nullable**
Solution: That's by design — not every interaction maps to a captured thought. When it does, include the `thought_id`. When it doesn't, leave it null.
