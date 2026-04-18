# Text Search Trigram Index

> Adds a `pg_trgm` GIN index on `public.thoughts.content` so `search_thoughts_text` ILIKE fallback queries run in ~150ms instead of ~8s.

## What It Does

Installs the `pg_trgm` extension and creates a trigram GIN index on `public.thoughts.content`. The `search_thoughts_text` RPC from the enhanced-thoughts schema runs a tsvector phase first, then falls back to `ILIKE '%query%'` whenever tsvector returns fewer hits than requested -- which happens for most real-world queries. Without a trigram index that fallback sequential-scans the entire table.

**Before/after (89K-thought brain):**

| Query | Before | After |
|-------|--------|-------|
| Rare-word ILIKE fallback | ~8s (seq scan) | ~100-150ms (bitmap index scan) |
| Common-word tsvector hit | unchanged | unchanged |

## Why It Matters

`search_thoughts_text` powers every text search that goes through Open Brain's MCP layer. Leading-wildcard patterns like `ILIKE '%foo%'` cannot use the existing tsvector GIN index (tsvector is word-level, ILIKE is substring-level), so the planner defaults to a full sequential scan. At ~90K rows that's a 7-8 second wait on every rare-word lookup.

`pg_trgm` breaks text into 3-character trigrams and builds a GIN index the planner *can* use for substring matching. No changes to `search_thoughts_text` are needed -- the planner picks up the new index automatically. Queries that previously seq-scanned now run as bitmap index scans.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- [`schemas/enhanced-thoughts`](https://github.com/NateBJones-Projects/OB1/pull/191) installed (defines `search_thoughts_text` and the base tsvector index)
- Supabase project with write access to run migrations

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
TEXT SEARCH TRIGRAM INDEX -- CREDENTIAL TRACKER
--------------------------------------

SUPABASE (from your Open Brain setup)
  Project URL:           ____________
  Secret key:            ____________

--------------------------------------
```

## Steps

1. Open your Supabase dashboard and navigate to the **SQL Editor**
2. Create a new query and paste the full contents of `schema.sql`
3. Click **Run** to execute the migration (the `CREATE INDEX` will briefly lock the `thoughts` table against writes; ~1-2 minutes at 90K rows)
4. Navigate to **Database > Extensions** and confirm `pg_trgm` is enabled
5. Navigate to **Database > Indexes** (or run the verification query below) and confirm `idx_thoughts_content_trgm` exists on `public.thoughts`

## Expected Outcome

After running the migration:

- The `pg_trgm` extension is installed in the database.
- A GIN trigram index named `idx_thoughts_content_trgm` exists on `public.thoughts(content)`.
- The next `search_thoughts_text` call whose ILIKE fallback fires will complete in ~100-150ms instead of ~8s.

## Verification

Run the following in the SQL Editor. The `Bitmap Index Scan on idx_thoughts_content_trgm` line in the plan confirms the planner is using the new index:

```sql
EXPLAIN ANALYZE
SELECT id
FROM public.thoughts
WHERE content ILIKE '%somerarewordfromyourbrain%'
LIMIT 25;
```

Expected plan (abbreviated):

```
Limit
  ->  Bitmap Heap Scan on thoughts
        Recheck Cond: (content ~~* '%somerarewordfromyourbrain%'::text)
        ->  Bitmap Index Scan on idx_thoughts_content_trgm
              Index Cond: (content ~~* '%somerarewordfromyourbrain%'::text)
Execution Time: ~100-200 ms
```

If you instead see `Seq Scan on thoughts`, the index was not created or the planner has stale statistics -- run `ANALYZE public.thoughts;` and try again.

## Rollback

```sql
DROP INDEX IF EXISTS public.idx_thoughts_content_trgm;
```

The `pg_trgm` extension is left installed; it is harmless on its own and may be used by other contributions.

## Tradeoffs

- **Storage:** ~20-40MB on a 90K-thought brain. Scales linearly with total content size.
- **Build lock:** Regular (non-CONCURRENT) `CREATE INDEX` briefly locks `public.thoughts` against writes during the build (~1-2 minutes at 90K rows). If you're running live capture and can't tolerate a brief write pause, switch the statement to `CREATE INDEX CONCURRENTLY` and remove the surrounding `BEGIN/COMMIT` -- concurrent index builds cannot run inside a transaction.
- **Write amplification:** Small per-row overhead on `INSERT` and `UPDATE` of `content` (the index needs to be maintained). Imperceptible at typical personal-brain write rates.

## Troubleshooting

**Issue: "extension pg_trgm does not exist" error**
Solution: Your Supabase project predates automatic extension availability. In the SQL Editor, run `CREATE EXTENSION pg_trgm;` as a superuser or contact Supabase support. The migration uses `CREATE EXTENSION IF NOT EXISTS`, which works on all current Supabase projects.

**Issue: `EXPLAIN ANALYZE` still shows `Seq Scan on thoughts`**
Solution: Run `ANALYZE public.thoughts;` to refresh planner statistics, then retry. The planner needs accurate row counts before it will choose an index scan over a seq scan on small tables.

**Issue: Migration hangs on `CREATE INDEX`**
Solution: Check for long-running transactions holding locks on `thoughts` (look at `pg_stat_activity`). The index build needs to acquire a `SHARE` lock on the table. If you can't stop the blocking transaction, switch to `CREATE INDEX CONCURRENTLY` (see Tradeoffs).

## References

- [PostgreSQL `pg_trgm` documentation](https://www.postgresql.org/docs/current/pgtrgm.html) -- official reference for trigram matching and index operator classes
- [`schemas/enhanced-thoughts` (PR #191)](https://github.com/NateBJones-Projects/OB1/pull/191) -- defines `search_thoughts_text`, the consumer of this index
