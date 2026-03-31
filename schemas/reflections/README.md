# Reflections

> Structured reasoning traces linked to thoughts — capture deliberation processes with trigger context, options considered, factors weighed, and conclusions reached.

## What It Does

Adds a `reflections` table and two RPCs (`upsert_reflection`, `match_reflections`) that let you capture and search structured reasoning traces. Each reflection links to a thought and records why a decision was made, what options were considered, what factors influenced the outcome, and what conclusion was reached.

This is useful for AI agents that need to recall past reasoning, or for personal knowledge systems where understanding *why* a decision was made is as important as the decision itself.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- The `thoughts` table must already exist
- pgvector extension enabled (included in the migration)

## Schema Overview

### `reflections` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` (PK) | Auto-generated via `gen_random_uuid()` |
| `thought_id` | `uuid` (FK) | References `thoughts(id)`, set null on delete |
| `trigger_context` | `text` | What prompted this reflection |
| `options` | `jsonb` | Options or paths that were considered |
| `factors` | `jsonb` | Factors, constraints, or trade-offs that were weighed |
| `conclusion` | `text` | The decision or insight reached |
| `confidence` | `real` | Confidence score from 0.0 to 1.0 |
| `reflection_type` | `text` | One of: `decision`, `analysis`, `evaluation`, `planning`, `retrospective` |
| `embedding` | `vector(1536)` | For semantic search over reflections |
| `metadata` | `jsonb` | Arbitrary structured metadata |
| `created_at` | `timestamptz` | Row creation timestamp |
| `updated_at` | `timestamptz` | Auto-updated on row change |

### `upsert_reflection` RPC

Insert or update a reflection by ID. If `p_id` is provided and exists, updates the existing row (merging metadata). If `p_id` is null, inserts a new row.

### `match_reflections` RPC

Semantic similarity search over reflection embeddings. Returns reflections ordered by cosine similarity, with optional filtering by `reflection_type`.

## Step-by-step instructions

1. Open your Supabase Dashboard → SQL Editor → New query.

2. Copy the contents of [`migration.sql`](./migration.sql) and execute it in the SQL Editor.

3. Verify the table exists:

   ```sql
   SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'reflections';
   ```

4. Verify the RPCs exist:

   ```sql
   SELECT routine_name FROM information_schema.routines
   WHERE routine_schema = 'public'
     AND routine_name IN ('upsert_reflection', 'match_reflections');
   ```

5. Test with a sample reflection:

   ```sql
   -- Create a test reflection (replace the thought ID with one from your table)
   SELECT upsert_reflection(
     p_thought_id := '<your-thought-uuid>'::uuid,
     p_trigger_context := 'Should we use PostgreSQL or DynamoDB for the analytics service?',
     p_options := '[{"label": "PostgreSQL", "pros": "SQL, window functions"}, {"label": "DynamoDB", "pros": "Serverless, auto-scaling"}]'::jsonb,
     p_factors := '[{"factor": "Team experience", "weight": 0.8}, {"factor": "Cost", "weight": 0.6}]'::jsonb,
     p_conclusion := 'PostgreSQL — team already has operational experience and we need window functions.',
     p_reflection_type := 'decision'
   );

   -- Verify it was created
   SELECT id, thought_id, reflection_type, conclusion
   FROM reflections
   ORDER BY created_at DESC
   LIMIT 1;
   ```

## Expected Outcome

After running the migration:

- One new table: `reflections`
- Two new RPCs: `upsert_reflection` and `match_reflections`
- Three indexes: on `thought_id`, `reflection_type`, and `embedding` (HNSW)
- One trigger: auto-updates `updated_at` on row change
- Row-level security enabled (service-role access only)
- Grants applied for `service_role` on the table and both functions

## Reflection Types

| Type | When to Use |
|------|------------|
| `decision` | Choosing between concrete options (tech stack, approach, vendor) |
| `analysis` | Breaking down a complex problem into factors |
| `evaluation` | Assessing quality, risk, or fit of something |
| `planning` | Mapping out future actions and selecting an approach |
| `retrospective` | Looking back at an outcome and recording lessons |

## Troubleshooting

**Issue: `relation "public.thoughts" does not exist`**
Solution: Complete your Open Brain setup first. The `thoughts` table must exist before applying this migration. Follow the [Getting Started guide](../../docs/01-getting-started.md).

**Issue: `type "extensions.vector" does not exist`**
Solution: The pgvector extension is not enabled. The migration includes `create extension if not exists vector with schema extensions;` which should handle this automatically. If it fails, enable it manually in your Supabase Dashboard → Database → Extensions → search for "vector" and enable it.

**Issue: `upsert_reflection` returns null**
Solution: The thought ID you passed might not exist in the `thoughts` table. The FK has `on delete set null`, so deleted thoughts won't cause errors, but the `thought_id` column will be null.

## Works Well With

- **Reflection MCP Tools** — MCP tool handlers for `capture_reflection`, `get_reflection`, and `search_reflections`. See `integrations/reflection-mcp/` (coming soon).
