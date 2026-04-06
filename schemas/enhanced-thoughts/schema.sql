-- Enhanced Thoughts Columns and Utility RPCs
-- Adds structured columns and utility functions to the Open Brain thoughts table.
-- Safe to run multiple times (fully idempotent).

-- ============================================================
-- 1. NEW COLUMNS
-- ============================================================

ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS sensitivity_tier TEXT DEFAULT 'standard';
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS importance SMALLINT DEFAULT 3;
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS quality_score NUMERIC(5,2) DEFAULT 50;
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS source_type TEXT;
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS enriched BOOLEAN DEFAULT false;

-- Indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_thoughts_type ON thoughts (type);
CREATE INDEX IF NOT EXISTS idx_thoughts_importance ON thoughts (importance DESC);
CREATE INDEX IF NOT EXISTS idx_thoughts_source_type ON thoughts (source_type);

-- Full-text search index (speeds up search_thoughts_text)
CREATE INDEX IF NOT EXISTS idx_thoughts_content_tsvector
  ON thoughts USING gin (to_tsvector('simple', coalesce(content, '')));

-- ============================================================
-- 2. FULL-TEXT SEARCH RPC
--    Supports boolean operators via websearch_to_tsquery
--    ("quoted phrases", AND, OR, -NOT) with ILIKE fallback,
--    pagination, and result count.
-- ============================================================

CREATE OR REPLACE FUNCTION search_thoughts_text(
  p_query TEXT,
  p_limit INTEGER DEFAULT 25,
  p_filter JSONB DEFAULT '{}'::jsonb,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  type TEXT,
  source_type TEXT,
  importance SMALLINT,
  quality_score NUMERIC(5,2),
  sensitivity_tier TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ,
  rank REAL,
  total_count BIGINT
)
LANGUAGE plpgsql
VOLATILE
SET statement_timeout = '25s'
AS $$
BEGIN
  RETURN QUERY
  WITH query_input AS (
    SELECT
      trim(coalesce(p_query, '')) AS raw_query,
      websearch_to_tsquery('simple', trim(coalesce(p_query, ''))) AS ts_query
  ),
  -- Phase 1: GIN-indexed tsvector search (fast, uses index)
  tsvector_hits AS (
    SELECT t.id AS hit_id
    FROM public.thoughts t
    CROSS JOIN query_input q
    WHERE q.raw_query <> ''
      AND to_tsvector('simple', coalesce(t.content, '')) @@ q.ts_query
      AND t.metadata @> coalesce(p_filter, '{}'::jsonb)
    LIMIT 2000
  ),
  -- Phase 2: ILIKE fallback when tsvector finds fewer than needed
  ilike_hits AS (
    SELECT t.id AS hit_id
    FROM public.thoughts t
    CROSS JOIN query_input q
    WHERE q.raw_query <> ''
      AND (SELECT count(*) FROM tsvector_hits) < (p_limit + p_offset)
      AND t.content ILIKE '%' || q.raw_query || '%'
      AND t.metadata @> coalesce(p_filter, '{}'::jsonb)
      AND t.id NOT IN (SELECT th.hit_id FROM tsvector_hits th)
    LIMIT 500
  ),
  all_hits AS (
    SELECT hit_id FROM tsvector_hits
    UNION
    SELECT hit_id FROM ilike_hits
  ),
  hit_count AS (
    SELECT count(*) AS cnt FROM all_hits
  ),
  ranked AS (
    SELECT
      t.id,
      t.content,
      t.type,
      t.source_type,
      t.importance,
      t.quality_score,
      t.sensitivity_tier,
      t.metadata,
      t.created_at,
      (
        greatest(
          ts_rank_cd(
            to_tsvector('simple', coalesce(t.content, '')),
            q.ts_query
          ),
          CASE
            WHEN q.raw_query <> '' AND t.content ILIKE '%' || q.raw_query || '%'
              THEN 0.35
            ELSE 0
          END
        )
        + (coalesce(t.importance, 5) / 20.0)::real
        + (coalesce(t.quality_score, 0.50) / 500.0)::real
      )::real AS rank
    FROM public.thoughts t
    CROSS JOIN query_input q
    WHERE t.id IN (SELECT ah.hit_id FROM all_hits ah)
    ORDER BY rank DESC, t.created_at DESC
  )
  SELECT
    r.id, r.content, r.type, r.source_type, r.importance,
    r.quality_score, r.sensitivity_tier, r.metadata, r.created_at,
    r.rank,
    hc.cnt AS total_count
  FROM ranked r
  CROSS JOIN hit_count hc
  OFFSET greatest(0, coalesce(p_offset, 0))
  LIMIT greatest(1, least(coalesce(p_limit, 25), 100));
END;
$$;

GRANT EXECUTE ON FUNCTION search_thoughts_text(TEXT, INTEGER, JSONB, INTEGER)
  TO authenticated, anon, service_role;

-- ============================================================
-- 3. BRAIN STATS AGGREGATE RPC
--    Returns total count, top types, and top topics as JSONB.
-- ============================================================

CREATE OR REPLACE FUNCTION brain_stats_aggregate(
  p_since_days INTEGER DEFAULT 30,
  p_exclude_restricted BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_total BIGINT;
  v_types JSONB;
  v_topics JSONB;
  v_since TIMESTAMPTZ;
BEGIN
  -- p_since_days = 0 means all-time (no time filter)
  IF p_since_days > 0 THEN
    v_since := now() - (p_since_days || ' days')::interval;
  ELSE
    v_since := '-infinity'::timestamptz;
  END IF;

  -- Total thoughts (all-time)
  SELECT count(*) INTO v_total
  FROM public.thoughts
  WHERE (NOT p_exclude_restricted OR sensitivity_tier IS DISTINCT FROM 'restricted');

  -- Top types within time window
  SELECT coalesce(jsonb_agg(jsonb_build_object('type', t.type, 'count', t.cnt)), '[]'::jsonb)
  INTO v_types FROM (
    SELECT type, count(*) AS cnt FROM public.thoughts
    WHERE created_at >= v_since
      AND (NOT p_exclude_restricted OR sensitivity_tier IS DISTINCT FROM 'restricted')
    GROUP BY type ORDER BY cnt DESC LIMIT 20
  ) t;

  -- Top topics within time window
  SELECT coalesce(jsonb_agg(jsonb_build_object('topic', t.topic, 'count', t.cnt)), '[]'::jsonb)
  INTO v_topics FROM (
    SELECT topic.value AS topic, count(*) AS cnt
    FROM public.thoughts,
         jsonb_array_elements_text(coalesce(metadata->'topics', '[]'::jsonb)) AS topic(value)
    WHERE created_at >= v_since
      AND (NOT p_exclude_restricted OR sensitivity_tier IS DISTINCT FROM 'restricted')
    GROUP BY topic.value ORDER BY cnt DESC LIMIT 20
  ) t;

  RETURN jsonb_build_object('total', v_total, 'top_types', v_types, 'top_topics', v_topics);
END;
$$;

GRANT EXECUTE ON FUNCTION brain_stats_aggregate(INTEGER, BOOLEAN)
  TO authenticated, anon, service_role;

-- ============================================================
-- 4. THOUGHT CONNECTIONS RPC
--    Finds thoughts sharing metadata topics or people with a
--    given thought, ranked by overlap count.
-- ============================================================

CREATE OR REPLACE FUNCTION get_thought_connections(
  p_thought_id UUID,
  p_limit INT DEFAULT 20,
  p_exclude_restricted BOOLEAN DEFAULT true
)
RETURNS TABLE (
  id UUID,
  type TEXT,
  importance SMALLINT,
  preview TEXT,
  created_at TIMESTAMPTZ,
  shared_topics TEXT[],
  shared_people TEXT[],
  overlap_count INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  source_topics TEXT[];
  source_people TEXT[];
BEGIN
  -- Get the source thought's topics and people arrays from metadata
  SELECT
    coalesce(
      (SELECT array_agg(val) FROM jsonb_array_elements_text(t.metadata->'topics') val),
      '{}'::text[]
    ),
    coalesce(
      (SELECT array_agg(val) FROM jsonb_array_elements_text(t.metadata->'people') val),
      '{}'::text[]
    )
  INTO source_topics, source_people
  FROM thoughts t
  WHERE t.id = p_thought_id;

  -- If no topics or people, return empty set
  IF source_topics = '{}'::text[] AND source_people = '{}'::text[] THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      bt.id,
      bt.type,
      bt.importance,
      left(bt.content, 200) AS preview,
      bt.created_at,
      coalesce(
        (SELECT array_agg(val) FROM jsonb_array_elements_text(bt.metadata->'topics') val
         WHERE val = ANY(source_topics)),
        '{}'::text[]
      ) AS shared_topics,
      coalesce(
        (SELECT array_agg(val) FROM jsonb_array_elements_text(bt.metadata->'people') val
         WHERE val = ANY(source_people)),
        '{}'::text[]
      ) AS shared_people
    FROM thoughts bt
    WHERE bt.id != p_thought_id
      AND (NOT p_exclude_restricted OR bt.sensitivity_tier != 'restricted')
      AND (
        EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(bt.metadata->'topics') val
          WHERE val = ANY(source_topics)
        )
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(bt.metadata->'people') val
          WHERE val = ANY(source_people)
        )
      )
  )
  SELECT
    c.id, c.type, c.importance, c.preview, c.created_at,
    c.shared_topics, c.shared_people,
    (coalesce(array_length(c.shared_topics, 1), 0) + coalesce(array_length(c.shared_people, 1), 0))::int AS overlap_count
  FROM candidates c
  ORDER BY overlap_count DESC, c.created_at DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_thought_connections(UUID, INT, BOOLEAN)
  TO authenticated, anon, service_role;

-- ============================================================
-- 5. BACKFILL EXISTING DATA
--    Populates new columns from metadata for rows that already
--    exist. Safe to run multiple times (WHERE ... IS NULL guard).
-- ============================================================

-- Backfill type from metadata
UPDATE thoughts SET type = metadata->>'type'
WHERE type IS NULL AND metadata->>'type' IS NOT NULL
  AND metadata->>'type' IN ('idea','task','person_note','reference','decision','lesson','meeting','journal');

-- Backfill source_type from metadata
UPDATE thoughts SET source_type = metadata->>'source'
WHERE source_type IS NULL AND metadata->>'source' IS NOT NULL;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
