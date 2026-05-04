# Enhanced Thoughts Columns and Utility RPCs

> Adds structured columns and utility functions to the Open Brain thoughts table for richer classification, full-text search, statistics, and connection discovery.

## What It Does

This schema extension adds six new columns to the `thoughts` table (`type`, `sensitivity_tier`, `importance`, `quality_score`, `source_type`, `enriched`) so thoughts can be classified, filtered, and ranked without parsing the metadata JSONB every time. It also upgrades `upsert_thought` so metadata-backed writes keep those structured columns in sync. It installs three utility RPC functions:

- **`search_thoughts_text`** -- Full-text search with boolean operators, ILIKE fallback, pagination, and result counts.
- **`brain_stats_aggregate`** -- Returns total thought count, top types, and top topics as a single JSONB payload.
- **`get_thought_connections`** -- Finds thoughts that share metadata topics or people with a given thought.

## Prerequisites

- Working Open Brain setup (see the getting-started guide in `docs/01-getting-started.md`)
- Supabase project with the `thoughts` table, `match_thoughts` function, and `upsert_thought` function already created

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
ENHANCED THOUGHTS -- CREDENTIAL TRACKER
--------------------------------------

SUPABASE (from your Open Brain setup)
  Project URL:           ____________
  Secret key:            ____________

--------------------------------------
```

## Steps

1. Open your Supabase dashboard and navigate to the **SQL Editor**
2. Create a new query and paste the full contents of `schema.sql`
3. Click **Run** to execute the migration
4. Open **Table Editor** and select the `thoughts` table to confirm the new columns appear: `type`, `sensitivity_tier`, `importance`, `quality_score`, `source_type`, `enriched`
5. Navigate to **Database > Functions** and verify three new functions exist: `search_thoughts_text`, `brain_stats_aggregate`, `get_thought_connections`
6. Verify `upsert_thought` still exists. The enhanced version mirrors `metadata.type`, `metadata.source`, `metadata.importance`, `metadata.quality_score`, `metadata.sensitivity_tier`, and task/idea status into top-level columns.
7. If you have existing thoughts with `type` or `source` values stored in the metadata JSONB, the backfill statements at the bottom of the script will have populated the new columns automatically

## Expected Outcome

After running the migration:

- The `thoughts` table has six new columns with dashboard-friendly defaults.
- New indexes on `type`, `importance`, `source_type`, and a GIN tsvector index on `content` for fast full-text search.
- Three new RPC functions callable via the Supabase client or REST API.
- `upsert_thought` remains the canonical write path, but now keeps structured dashboard columns synchronized with metadata payloads.
- Any existing thoughts with `type` or `source` in their metadata JSONB will have those values copied into the new top-level columns.

## Troubleshooting

**Issue: "column already exists" warnings**
Solution: These are safe to ignore. The `ADD COLUMN IF NOT EXISTS` syntax prevents errors but may log informational notices.

**Issue: search_thoughts_text returns no results**
Solution: Confirm your thoughts have content populated. Try a simple query first (single word, no operators). If using boolean operators, ensure the syntax matches websearch format ("quoted phrases", word AND word, -excluded).

**Issue: brain_stats_aggregate returns empty types or topics**
Solution: The function filters by `created_at`. Pass `p_since_days := 0` for all-time stats. Also confirm that your thoughts have the `type` column populated (run the backfill UPDATE if needed).
