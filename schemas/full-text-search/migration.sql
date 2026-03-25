-- Full-Text Search for Open Brain
-- Adds keyword-based search to complement existing semantic vector search.
--
-- Prerequisites: public.thoughts table exists

-- 1. Create a GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS idx_thoughts_fts ON public.thoughts
USING gin (to_tsvector('english', content));

-- 2. Create the search RPC
CREATE OR REPLACE FUNCTION public.search_thoughts_text(
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
  FROM public.thoughts t
  WHERE to_tsvector('english', t.content) @@ websearch_to_tsquery('english', p_query)
  ORDER BY rank DESC
  LIMIT p_limit
  OFFSET p_offset;
$$;

-- Grant access to service_role
GRANT EXECUTE ON FUNCTION public.search_thoughts_text TO service_role;
