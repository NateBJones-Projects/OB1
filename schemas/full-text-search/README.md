# Full-Text Search

> Keyword-based search for thoughts using PostgreSQL's built-in full-text search engine.

## What It Is

A `search_thoughts_text` RPC function that lets you find thoughts by keywords, phrases, or partial matches. This complements OB1's existing `match_thoughts` semantic search — sometimes you want to find the exact thought where you mentioned "quarterly review" or "Dr. Smith", not just thoughts that are semantically similar.

## Why It Matters

Semantic search is great for finding related concepts, but it can miss exact matches. If you captured a thought mentioning a specific person, date, project name, or technical term, keyword search finds it instantly. Together, semantic + text search covers both discovery and retrieval.

## How It Works

PostgreSQL has a built-in full-text search engine that:
1. Converts text into searchable tokens (handles plurals, stop words, etc.)
2. Ranks results by relevance
3. Runs entirely in the database — no external service needed

## Setup

### Step 1: Add a text search index

```sql
-- Create a GIN index for fast full-text search
CREATE INDEX idx_thoughts_fts ON thoughts
USING gin (to_tsvector('english', content));
```

### Step 2: Create the search RPC

```sql
CREATE OR REPLACE FUNCTION search_thoughts_text(
  p_query TEXT,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ,
  rank REAL
)
LANGUAGE sql STABLE
AS $$
  SELECT
    t.id,
    t.content,
    t.metadata,
    t.created_at,
    ts_rank(to_tsvector('english', t.content), websearch_to_tsquery('english', p_query)) AS rank
  FROM thoughts t
  WHERE to_tsvector('english', t.content) @@ websearch_to_tsquery('english', p_query)
  ORDER BY rank DESC
  LIMIT p_limit
  OFFSET p_offset;
$$;
```

### Step 3: Test it

```sql
-- Find thoughts mentioning a specific term
SELECT * FROM search_thoughts_text('quarterly review');

-- Phrase search
SELECT * FROM search_thoughts_text('"machine learning"');

-- Boolean search
SELECT * FROM search_thoughts_text('python OR javascript');
```

## Calling from the MCP Server

The RPC can be called from an Edge Function or directly via the Supabase client:

```typescript
const { data, error } = await supabase.rpc("search_thoughts_text", {
  p_query: "quarterly review",
  p_limit: 10
});
```

## Expected Outcome

After setup, you can search thoughts by keyword with ranked results. The GIN index makes searches fast even on large tables (tested on 75K+ rows).

## Troubleshooting

**Issue: No results for a query that should match**
The `websearch_to_tsquery` parser handles natural language queries, but very short or common words may be treated as stop words. Try more specific terms.

**Issue: Slow queries on large tables**
Make sure the GIN index was created (Step 1). Without it, PostgreSQL does a sequential scan.

## Further Reading

- [PostgreSQL Full-Text Search docs](https://www.postgresql.org/docs/current/textsearch.html)
- [Supabase Full-Text Search guide](https://supabase.com/docs/guides/database/full-text-search)
