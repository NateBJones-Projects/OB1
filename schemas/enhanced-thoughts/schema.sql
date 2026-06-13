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
-- status / status_updated_at are written by the upsert_thought RPC below.
-- They are also defined by schemas/workflow-status/migration.sql; both files
-- use ADD COLUMN IF NOT EXISTS so applying either (or both) is safe.
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT NULL;
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ DEFAULT now();

-- Indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_thoughts_type ON thoughts (type);
CREATE INDEX IF NOT EXISTS idx_thoughts_importance ON thoughts (importance DESC);
CREATE INDEX IF NOT EXISTS idx_thoughts_source_type ON thoughts (source_type);
CREATE INDEX IF NOT EXISTS idx_thoughts_status ON thoughts (status) WHERE status IS NOT NULL;

-- Full-text search index (speeds up search_thoughts_text)
CREATE INDEX IF NOT EXISTS idx_thoughts_content_tsvector
  ON thoughts USING gin (to_tsvector('simple', coalesce(content, '')));

-- ============================================================
-- 2. FULL-TEXT SEARCH RPC
--    Supports boolean operators via websearch_to_tsquery
--    ("quoted phrases", AND, OR, -NOT) with ILIKE fallback,
--    pagination, and result count.
--
--    v1.1: p_filter now recognizes three reserved control keys that
--    are applied at the data layer instead of as metadata containment:
--      start_date / end_date  — ISO 8601 timestamps; filter created_at
--                               to the [start_date, end_date] range.
--      exclude_restricted     — boolean; when true, drop rows whose
--                               sensitivity_tier is 'restricted'.
--    These keys are stripped from the containment predicate so they do
--    not accidentally require a literal metadata key of the same name.
--    All other p_filter keys keep their original `metadata @> filter`
--    containment behavior. Ported from ExoCortex search-text date
--    filters; UUID id contract preserved.
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
STABLE
SET statement_timeout = '25s'
AS $$
DECLARE
  -- Reserved control keys, peeled off p_filter so they are not treated
  -- as metadata containment requirements.
  v_exclude_restricted BOOLEAN :=
    coalesce((p_filter->>'exclude_restricted')::boolean, false);
  v_start_date TIMESTAMPTZ :=
    CASE WHEN nullif(p_filter->>'start_date', '') IS NOT NULL
      THEN (p_filter->>'start_date')::timestamptz ELSE NULL END;
  v_end_date TIMESTAMPTZ :=
    CASE WHEN nullif(p_filter->>'end_date', '') IS NOT NULL
      THEN (p_filter->>'end_date')::timestamptz ELSE NULL END;
  -- Containment filter with the reserved keys removed.
  v_meta_filter JSONB :=
    coalesce(p_filter, '{}'::jsonb)
      - 'start_date' - 'end_date' - 'exclude_restricted';
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
      AND t.metadata @> v_meta_filter
      AND (NOT v_exclude_restricted
           OR coalesce(t.sensitivity_tier, 'standard') <> 'restricted')
      AND (v_start_date IS NULL OR t.created_at >= v_start_date)
      AND (v_end_date IS NULL OR t.created_at <= v_end_date)
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
      AND t.metadata @> v_meta_filter
      AND (NOT v_exclude_restricted
           OR coalesce(t.sensitivity_tier, 'standard') <> 'restricted')
      AND (v_start_date IS NULL OR t.created_at >= v_start_date)
      AND (v_end_date IS NULL OR t.created_at <= v_end_date)
      AND NOT EXISTS (SELECT 1 FROM tsvector_hits th WHERE th.hit_id = t.id)
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
        -- importance is 1..5; max bonus 5/20 = 0.25
        + (coalesce(t.importance, 3) / 20.0)::real
        -- quality_score is 0..100; max bonus 100/500 = 0.20
        + (coalesce(t.quality_score, 50) / 500.0)::real
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

-- Do NOT grant to `anon`. Stock Open Brain keeps `thoughts` behind RLS
-- (service_role only). Broadening execution to the publishable anon key
-- would expose the entire brain to anyone who knows the project URL.
-- See README "Security" section.
GRANT EXECUTE ON FUNCTION search_thoughts_text(TEXT, INTEGER, JSONB, INTEGER)
  TO authenticated, service_role;

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

-- Do NOT grant to `anon`. This RPC is SECURITY DEFINER and would bypass
-- RLS on the thoughts table. See README "Security" section.
GRANT EXECUTE ON FUNCTION brain_stats_aggregate(INTEGER, BOOLEAN)
  TO authenticated, service_role;

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
STABLE
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
      AND (NOT p_exclude_restricted OR bt.sensitivity_tier IS DISTINCT FROM 'restricted')
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

-- Do NOT grant to `anon`. This RPC is SECURITY DEFINER and exposes
-- a 200-char content preview plus metadata for any thought by UUID;
-- granting to anon would let anyone with the project URL pull content.
-- See README "Security" section.
GRANT EXECUTE ON FUNCTION get_thought_connections(UUID, INT, BOOLEAN)
  TO authenticated, service_role;

-- ============================================================
-- 5. BACKFILL EXISTING DATA
--    Populates new columns from metadata for rows that already
--    exist. Safe to run multiple times (WHERE ... IS NULL guard).
-- ============================================================

-- Backfill `type` from metadata. Wrapped in an RPC so callers can
-- override the allowlist. Default allowlist matches the canonical
-- Open Brain type vocabulary; pass NULL to accept any string value
-- present in metadata->>'type'.
CREATE OR REPLACE FUNCTION backfill_thought_types(
  p_allowed_types TEXT[] DEFAULT ARRAY[
    'idea','task','person_note','reference',
    'decision','lesson','meeting','journal'
  ]
)
RETURNS BIGINT
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_updated BIGINT;
BEGIN
  UPDATE public.thoughts
  SET type = metadata->>'type'
  WHERE type IS NULL
    AND metadata->>'type' IS NOT NULL
    AND (p_allowed_types IS NULL OR metadata->>'type' = ANY(p_allowed_types));

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

-- Do NOT grant to `anon`. This RPC writes to the thoughts table.
GRANT EXECUTE ON FUNCTION backfill_thought_types(TEXT[])
  TO authenticated, service_role;

-- Run the backfill with the default allowlist so the paste-and-run
-- flow still auto-populates `type` for canonical values.
SELECT backfill_thought_types();

-- Backfill source_type from metadata
UPDATE thoughts SET source_type = metadata->>'source'
WHERE source_type IS NULL AND metadata->>'source' IS NOT NULL;

-- ============================================================
-- 6. ENHANCED UPSERT RPC
--    Keeps structured dashboard columns in sync when callers use
--    the base upsert_thought RPC with metadata payloads.
--
--    v1.1 behavior deltas (ported from ExoCortex, UUID-adapted; the
--    {id, fingerprint} return contract and status handling from v1 are
--    preserved unchanged so existing callers and schemas/workflow-status
--    are not affected):
--
--    a) Original-fingerprint fallback dedup. When a thought's content is
--       later corrected, its content_fingerprint changes. A reimport of
--       the ORIGINAL source text would previously insert a stale sibling
--       row that "outvotes" the correction. Update paths (REST/MCP) may
--       append the pre-edit fingerprint to an append-only array
--       metadata.original_fingerprints[]. This RPC now treats an incoming
--       fingerprint that matches that array as a dedup hit on the
--       corrected row (merge metadata; never insert; never touch content).
--       Exact content_fingerprint match still wins over the fallback.
--
--    b) User-edit guard. Keys listed in metadata.user_edits are owned by
--       the human. On the merge path they are stripped from the incoming
--       patch so a later automated import cannot resurrect stale values
--       over a correction. original_fingerprints and user_edits are
--       system-managed: the merge never lets an incoming payload rewrite
--       them, and inserts drop them unless well-formed.
--
--    The dedup fallback path cannot be expressed in ON CONFLICT, so the
--    function now does an explicit lookup (exact fingerprint, then
--    original-fingerprint fallback) and branches into INSERT vs UPDATE.
--    Importance keeps v1's 0-100 clamp (NOT ExoCortex's 0-6) so existing
--    rows are not retroactively rescaled — see README "Changes from v1".
-- ============================================================

CREATE OR REPLACE FUNCTION public.upsert_thought(p_content TEXT, p_payload JSONB DEFAULT '{}')
RETURNS JSONB AS $$
DECLARE
  v_fingerprint TEXT;
  v_result JSONB;
  v_id UUID;
  v_metadata JSONB;
  v_type TEXT;
  v_source_type TEXT;
  v_importance SMALLINT;
  v_quality_score NUMERIC(5,2);
  v_sensitivity_tier TEXT;
  v_status TEXT;
  v_existing_metadata JSONB;
  v_user_edits JSONB := '{}'::jsonb;
  v_protected_keys TEXT[] := ARRAY[]::text[];
  v_inserted BOOLEAN := false;
BEGIN
  v_metadata := COALESCE(p_payload->'metadata', '{}'::jsonb);
  v_type := COALESCE(NULLIF(v_metadata->>'type', ''), 'observation');
  v_source_type := COALESCE(NULLIF(v_metadata->>'source_type', ''), NULLIF(v_metadata->>'source', ''), 'unknown');
  v_importance := CASE
    WHEN COALESCE(v_metadata->>'importance', '') ~ '^[0-9]+(\.[0-9]+)?$'
      THEN LEAST(100, GREATEST(0, ROUND((v_metadata->>'importance')::numeric)))::smallint
    ELSE 50
  END;
  v_quality_score := CASE
    WHEN COALESCE(v_metadata->>'quality_score', '') ~ '^[0-9]+(\.[0-9]+)?$'
      THEN LEAST(100, GREATEST(0, (v_metadata->>'quality_score')::numeric))
    ELSE 70
  END;
  v_sensitivity_tier := COALESCE(NULLIF(v_metadata->>'sensitivity_tier', ''), 'standard');
  v_status := COALESCE(NULLIF(p_payload->>'status', ''), NULLIF(v_metadata->>'status', ''));
  IF v_status IS NULL AND v_type IN ('task', 'idea') THEN
    v_status := 'new';
  END IF;

  v_fingerprint := encode(sha256(convert_to(
    lower(trim(regexp_replace(p_content, '\s+', ' ', 'g'))),
    'UTF8'
  )), 'hex');

  -- (a) Exact-fingerprint lookup first (the v1 ON CONFLICT key).
  SELECT t.id, t.metadata
    INTO v_id, v_existing_metadata
  FROM public.thoughts t
  WHERE t.content_fingerprint = v_fingerprint
  FOR UPDATE;

  -- (a) Original-fingerprint fallback: land on the corrected row instead
  -- of inserting a stale sibling that outvotes the correction.
  IF v_id IS NULL THEN
    SELECT t.id, t.metadata
      INTO v_id, v_existing_metadata
    FROM public.thoughts t
    WHERE jsonb_typeof(t.metadata->'original_fingerprints') = 'array'
      AND t.metadata->'original_fingerprints' ? v_fingerprint
    ORDER BY t.created_at ASC, t.id ASC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_id IS NULL THEN
    -- INSERT path. Imports cannot mint malformed protections: drop
    -- user_edits / original_fingerprints from the inserted metadata
    -- unless they are well-formed (a round-tripped export keeps valid
    -- stamps).
    IF v_metadata ? 'user_edits'
       AND jsonb_typeof(v_metadata->'user_edits') <> 'object' THEN
      v_metadata := v_metadata - 'user_edits';
    END IF;
    IF v_metadata ? 'original_fingerprints'
       AND jsonb_typeof(v_metadata->'original_fingerprints') <> 'array' THEN
      v_metadata := v_metadata - 'original_fingerprints';
    END IF;

    -- Race guard: the explicit lookup above is not atomic with this INSERT,
    -- so a concurrent call with the same content_fingerprint can slip in
    -- between. v1 got this for free from ON CONFLICT; here we catch the
    -- unique_violation, re-read the row the other txn inserted, and fall
    -- through to the UPDATE/merge path so the contract (always return an
    -- existing-or-new {id, fingerprint}) holds.
    BEGIN
      INSERT INTO public.thoughts (
        content,
        content_fingerprint,
        metadata,
        type,
        source_type,
        importance,
        quality_score,
        sensitivity_tier,
        status,
        status_updated_at
      )
      VALUES (
        p_content,
        v_fingerprint,
        v_metadata,
        v_type,
        v_source_type,
        v_importance,
        v_quality_score,
        v_sensitivity_tier,
        v_status,
        CASE WHEN v_status IS NULL THEN NULL ELSE now() END
      )
      RETURNING id INTO v_id;
      v_inserted := true;
    EXCEPTION WHEN unique_violation THEN
      -- Another transaction inserted this fingerprint first. Adopt its row
      -- and continue into the merge branch below.
      SELECT t.id, t.metadata
        INTO v_id, v_existing_metadata
      FROM public.thoughts t
      WHERE t.content_fingerprint = v_fingerprint
      FOR UPDATE;
      -- Restore the caller's incoming metadata for the merge step (the
      -- INSERT-path malformed-protection stripping above does not apply on
      -- the merge path, which has its own user-edit guard).
      v_metadata := COALESCE(p_payload->'metadata', '{}'::jsonb);
    END;
  END IF;

  IF NOT v_inserted THEN
    -- (b) User-edit guard: strip human-owned keys (and the system-managed
    -- user_edits / original_fingerprints maps) from the incoming patch so
    -- the merge can never resurrect stale values over a correction.
    v_user_edits := COALESCE(v_existing_metadata->'user_edits', '{}'::jsonb);
    IF jsonb_typeof(v_user_edits) <> 'object' THEN
      v_user_edits := '{}'::jsonb;
    END IF;
    IF v_user_edits <> '{}'::jsonb THEN
      SELECT COALESCE(array_agg(k), ARRAY[]::text[])
        INTO v_protected_keys
        FROM jsonb_object_keys(v_user_edits) k;
      v_metadata := v_metadata - v_protected_keys;
    END IF;
    v_metadata := v_metadata - 'user_edits';
    v_metadata := v_metadata - 'original_fingerprints';

    -- Recompute status the same way the v1 ON CONFLICT branch did, but
    -- against the existing row's values fetched above.
    UPDATE public.thoughts SET
      updated_at = now(),
      metadata = public.thoughts.metadata || v_metadata,
      type = COALESCE(v_type, public.thoughts.type),
      source_type = COALESCE(v_source_type, public.thoughts.source_type),
      importance = COALESCE(v_importance, public.thoughts.importance),
      quality_score = COALESCE(v_quality_score, public.thoughts.quality_score),
      sensitivity_tier = COALESCE(v_sensitivity_tier, public.thoughts.sensitivity_tier),
      status = COALESCE(v_status, public.thoughts.status),
      status_updated_at = CASE
        WHEN COALESCE(v_status, public.thoughts.status)
             IS DISTINCT FROM public.thoughts.status THEN now()
        ELSE public.thoughts.status_updated_at
      END
    WHERE public.thoughts.id = v_id;
  END IF;

  v_result := jsonb_build_object('id', v_id, 'fingerprint', v_fingerprint);
  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.upsert_thought(TEXT, JSONB) TO service_role;

-- ============================================================
-- 7. SUPERSEDED-AWARE SEMANTIC SEARCH RPC (opt-in variant)
--    match_thoughts_superseded_aware — same shape as the core
--    match_thoughts from docs/01-getting-started.md plus a new
--    superseded_by UUID column. Thoughts that have been replaced
--    (the TARGET of a 'supersedes' edge in schemas/typed-reasoning-edges)
--    receive a 0.8x similarity penalty so fresh thoughts rank above
--    their stale predecessors. Superseded rows are NEVER excluded —
--    only ranked down — so agents can still read historical context.
--
--    The core match_thoughts RPC is NOT replaced: callers opt into this
--    variant by name, mirroring the house pattern from
--    schemas/recency-boosted-match-thoughts.
--
--    Supersession source of truth (verified against the repo, not the
--    ExoCortex inventory): public.thought_edges, relation = 'supersedes',
--    where from_thought_id is the newer replacement (A) and to_thought_id
--    is the older/stale thought (B) — see schemas/typed-reasoning-edges
--    relation vocabulary. superseded_by returns the newest superseder's id
--    (from_thought_id of the most recent 'supersedes' edge pointing at the
--    row, by edge created_at), or NULL.
--
--    PREREQUISITE: schemas/typed-reasoning-edges must be applied (it
--    creates public.thought_edges). If that table is absent this function
--    is not created and a NOTICE is raised; the rest of this migration
--    still applies. Re-run after installing typed-reasoning-edges to add
--    it.
--
--    PERFORMANCE (ported from the ExoCortex rerank-plan fix): the inner
--    query oversamples 3x using the vector index (its LIMIT is an
--    optimization fence, so the planner runs it with the same fast plan as
--    the core match_thoughts), then a LATERAL probe looks up supersession
--    per candidate row and the small window is re-ranked by penalized
--    similarity. This avoids the materialization regression that ordering
--    by a penalized expression over the full table would cause.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'thought_edges'
  ) THEN
    RAISE NOTICE
      'enhanced-thoughts: skipping match_thoughts_superseded_aware — '
      'public.thought_edges not found. Apply schemas/typed-reasoning-edges '
      'first, then re-run this migration to install it.';
    RETURN;
  END IF;

  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.match_thoughts_superseded_aware(
      query_embedding vector(1536),
      match_threshold float DEFAULT 0.7,
      match_count int DEFAULT 10,
      filter jsonb DEFAULT '{}'::jsonb
    )
    RETURNS TABLE (
      id uuid,
      content text,
      metadata jsonb,
      similarity float,
      created_at timestamptz,
      superseded_by uuid
    )
    LANGUAGE sql
    STABLE
    SET statement_timeout = '30s'
    AS $body$
      SELECT
        sub.id,
        sub.content,
        sub.metadata,
        CASE
          WHEN sl.newest_superseder IS NOT NULL THEN sub.base_similarity * 0.8
          ELSE sub.base_similarity
        END AS similarity,
        sub.created_at,
        sl.newest_superseder AS superseded_by
      FROM (
        -- Core single-phase NN query, oversampled 3x for re-ranking. The
        -- LIMIT fences this subquery so the planner runs it with the same
        -- fast plan the core match_thoughts uses.
        SELECT
          t.id,
          t.content,
          t.metadata,
          t.created_at,
          1 - (t.embedding <=> query_embedding) AS base_similarity
        FROM public.thoughts t
        WHERE t.embedding IS NOT NULL
          AND (filter = '{}'::jsonb OR t.metadata @> filter)
          AND 1 - (t.embedding <=> query_embedding) >= match_threshold
        ORDER BY t.embedding <=> query_embedding
        LIMIT greatest(1, least(match_count, 200)) * 3
      ) sub
      LEFT JOIN LATERAL (
        -- Newest superseder: the from_thought_id of the most recent
        -- 'supersedes' edge pointing at this thought. Ordered by the edge's
        -- created_at (UUID ids are not a recency signal), tie-broken by the
        -- monotonic BIGSERIAL edge id so the result is deterministic.
        SELECT te.from_thought_id AS newest_superseder
        FROM public.thought_edges te
        WHERE te.relation = 'supersedes'
          AND te.to_thought_id = sub.id
        ORDER BY te.created_at DESC, te.id DESC
        LIMIT 1
      ) sl ON true
      ORDER BY similarity DESC, sub.base_similarity DESC
      LIMIT greatest(1, least(match_count, 200));
    $body$;
  $fn$;

  EXECUTE 'GRANT EXECUTE ON FUNCTION public.match_thoughts_superseded_aware('
       || 'vector(1536), float, int, jsonb) TO service_role';
END $$;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
