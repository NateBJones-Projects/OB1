# Enhanced Thoughts Columns and Utility RPCs

> Adds structured columns and utility functions to the Open Brain thoughts table for richer classification, full-text search, statistics, and connection discovery.

## What It Does

This schema extension adds six new columns to the `thoughts` table (`type`, `sensitivity_tier`, `importance`, `quality_score`, `source_type`, `enriched`) so thoughts can be classified, filtered, and ranked without parsing the metadata JSONB every time. It also installs four RPC functions:

- **`search_thoughts_text`** -- Full-text search with boolean operators, ILIKE fallback, pagination, and result counts.
- **`brain_stats_aggregate`** -- Returns total thought count, top types, and top topics as a single JSONB payload.
- **`get_thought_connections`** -- Finds thoughts that share metadata topics or people with a given thought.
- **`backfill_thought_types(p_allowed_types TEXT[])`** -- Populates the new top-level `type` column from `metadata->>'type'`. The default allowlist covers the canonical eight values (`idea`, `task`, `person_note`, `reference`, `decision`, `lesson`, `meeting`, `journal`). Pass a custom array to accept additional values, or pass `NULL` to backfill whatever `metadata->>'type'` contains.

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
5. Navigate to **Database > Functions** and verify the new functions exist: `search_thoughts_text`, `brain_stats_aggregate`, `get_thought_connections`, `backfill_thought_types`
6. If you have existing thoughts with `type` or `source` values stored in the metadata JSONB, the script automatically calls `backfill_thought_types()` with the default canonical allowlist. If your brain uses non-canonical `type` values, re-run `SELECT backfill_thought_types(ARRAY['your','custom','types']);` or `SELECT backfill_thought_types(NULL);` to accept any value

## Expected Outcome

After running the migration:

- The `thoughts` table has six new columns with sensible defaults:
  - `sensitivity_tier TEXT DEFAULT 'standard'` (canonical values: `'standard'`, `'personal'`, `'restricted'`)
  - `importance SMALLINT DEFAULT 3` (scale: 1-5, where 3 is the default)
  - `quality_score NUMERIC(5,2) DEFAULT 50` (scale: 0-100, where 50 is the default)
  - `enriched BOOLEAN DEFAULT false`
  - `type TEXT` (nullable; populated by backfill or writers)
  - `source_type TEXT` (nullable; populated by backfill or writers)
- New indexes on `type`, `importance`, `source_type`, and a GIN tsvector index on `content` for fast full-text search.
- Four new RPC functions callable via the Supabase client or REST API (`search_thoughts_text`, `brain_stats_aggregate`, `get_thought_connections`, `backfill_thought_types`).
- Any existing thoughts with `type` or `source` in their metadata JSONB will have those values copied into the new top-level columns (via `backfill_thought_types()` for `type` with the canonical allowlist, plus an inline `UPDATE` for `source_type`).

## Security

This schema follows stock Open Brain's "service_role only" posture:

- `brain_stats_aggregate` and `get_thought_connections` are `SECURITY DEFINER` with `SET search_path = public` (defense in depth against search-path hijacks). They can read the full `thoughts` table regardless of RLS.
- `search_thoughts_text` is `SECURITY INVOKER` and respects RLS.
- **None of the three RPCs are granted to `anon`.** Execute privilege is limited to `authenticated` and `service_role`. The publishable anon key cannot call them.

If you want to expose any of these to `anon` (for example, a public-read dashboard), add your own `GRANT EXECUTE ... TO anon;` in a follow-up migration and confirm that `p_exclude_restricted := true` (the default) plus your sensitivity-tier hygiene gives you the exposure surface you actually want. This is an explicit opt-in: the default stance is private.

## Troubleshooting

**Issue: "column already exists" warnings**
Solution: These are safe to ignore. The `ADD COLUMN IF NOT EXISTS` syntax prevents errors but may log informational notices.

**Issue: search_thoughts_text returns no results**
Solution: Confirm your thoughts have content populated. Try a simple query first (single word, no operators). If using boolean operators, ensure the syntax matches websearch format ("quoted phrases", word AND word, -excluded).

**Issue: brain_stats_aggregate returns empty types or topics**
Solution: The function filters by `created_at`. Pass `p_since_days := 0` for all-time stats. Also confirm that your thoughts have the `type` column populated. If you use non-canonical type values in `metadata->>'type'` (anything outside `idea`, `task`, `person_note`, `reference`, `decision`, `lesson`, `meeting`, `journal`), call the backfill RPC with your own allowlist, e.g. `SELECT backfill_thought_types(ARRAY['idea','task','article','quote']);`, or `SELECT backfill_thought_types(NULL);` to accept whatever is present.
