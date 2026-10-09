# Hybrid Search

> Vector search plus full-text search in one function, fused with reciprocal rank fusion, so exact terms surface alongside semantic matches.

## What It Does

Adds a `hybrid_match_thoughts` database function that searches the `thoughts` table by vector similarity and exact text, then merges both result lists. Exact terms such as names, IDs, and error strings can surface even when semantic search ranks them poorly.

The lists are combined with reciprocal rank fusion (RRF): each thought scores `1 / (60 + rank)` in each list where it appears, and the scores are added. A thought that ranks in both lists receives the strongest combined score.

The recipe adds one expression index and one function. It does not alter the `thoughts` table or the core MCP server.

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- Access to run SQL against the Open Brain database through the Supabase SQL Editor or `psql`
- Thoughts with embeddings already stored

This recipe does not require another contribution. [`schemas/enhanced-thoughts`](../../schemas/enhanced-thoughts/) provides a separate text-only function named `search_thoughts_text`; this recipe combines vector and text rankings.

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
HYBRID SEARCH -- CREDENTIAL TRACKER
--------------------------------------

FROM YOUR OPEN BRAIN SETUP
  Project URL:           ____________
  Secret key:            ____________

--------------------------------------
```

No new credentials are created by this recipe.

## Steps

1. Open the Supabase dashboard and select **SQL Editor**. For self-hosted Postgres, connect with `psql` instead.

   ✅ **Done when:** You can run a query against `public.thoughts`.

2. Create a query, paste the full contents of [`hybrid-search.sql`](hybrid-search.sql), and run it.

   > [!WARNING]
   > Building the index briefly blocks writes to `thoughts`. On a large brain, run this during a quiet period.

   ✅ **Done when:** The query finishes without an error.

3. Refresh planner statistics:

   ```sql
   analyze public.thoughts;
   ```

   ✅ **Done when:** PostgreSQL reports that `ANALYZE` completed.

4. Confirm the function and index exist:

   ```sql
   select proname
   from pg_proc
   where proname = 'hybrid_match_thoughts';

   select indexname
   from pg_indexes
   where schemaname = 'public'
     and indexname = 'idx_thoughts_content_fts_english';
   ```

   ✅ **Done when:** Each query returns one row.

5. Run a test search. This borrows an existing thought embedding, so no embedding API call is needed. Replace `your exact term` with a distinctive word or ID already stored in the brain.

   ```sql
   select left(content, 80) as content, similarity, rrf_score
   from hybrid_match_thoughts(
     (select embedding from thoughts where embedding is not null limit 1),
     'your exact term',
     5
   );
   ```

   ✅ **Done when:** The query returns up to five ranked rows and a thought containing the exact term appears near the top.

6. Optional: call the function from application code without modifying the core MCP server.

   ```ts
   const { data, error } = await supabase.rpc("hybrid_match_thoughts", {
     query_embedding: queryEmbedding,
     query_text: query,
     match_count: 10,
     filter: {},
   });
   ```

   ✅ **Done when:** The response rows include `rrf_score` along with the standard thought fields.

## Function Reference

| Argument | Type | Default | Purpose |
|----------|------|---------|---------|
| `query_embedding` | `vector(1536)` | required | Embedding of the query for the vector leg |
| `query_text` | `text` | required | Raw query for the full-text leg |
| `match_count` | `int` | `10` | Rows to return, clamped to 1–50 |
| `filter` | `jsonb` | `'{}'` | Requires matching thoughts' metadata to contain this object |
| `since` | `timestamptz` | `null` | Only include thoughts created at or after this time |

The function returns `id`, `content`, `metadata`, `similarity`, `created_at`, and `rrf_score`, ordered by `rrf_score` descending. It ranks results without a similarity cutoff.

## Expected Outcome

After completing the steps:

- `idx_thoughts_content_fts_english` exists on `public.thoughts`.
- `hybrid_match_thoughts` exists and returns up to `match_count` rows.
- Exact terms can outrank semantically similar rows that do not contain the term.

A result ranked first in both legs scores about `0.033` (`1/61 + 1/61`). A result present in only one leg scores about `0.016` or less.

## Troubleshooting

**Issue: `ERROR: return type mismatch in function declared to return record`**
Solution: Your `thoughts.id` column is not a UUID. The self-hosted Kubernetes integration uses `bigint` IDs. Change `id uuid` to `id bigint` in the function's `returns table` list before running the SQL.

**Issue: Exact terms do not surface**
Solution: `plainto_tsquery` requires each meaningful query word to be present. Search for the distinctive term alone, such as `ZX-4471`, instead of a full question. Common words are ignored.

**Issue: `NOTICE: text-search query doesn't contain lexemes`**
Solution: The query was empty or contained only common words. The notice is harmless; the vector leg still returns results.

**Issue: Searches are slow after installation**
Solution: Run `analyze public.thoughts;` again. Fresh statistics help PostgreSQL choose the new index.

**Issue: `function hybrid_match_thoughts(...) does not exist` from application code**
Solution: Use the exact RPC argument names: `query_embedding`, `query_text`, `match_count`, and `filter`. Do not pass `match_threshold`.
