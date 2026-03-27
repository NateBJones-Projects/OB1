-- 04-rpcs.sql
-- Eight RPC functions for the Open Brain REST API.
-- All use serial_id as the numeric key and return it as "id" in results.

-- ── 1. upsert_thought ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION upsert_thought(
  p_content TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB AS $$
DECLARE
  v_fingerprint TEXT;
  v_existing_serial BIGINT;
  v_serial BIGINT;
  v_action TEXT;
BEGIN
  v_fingerprint := p_payload->>'content_fingerprint';

  -- Check for existing thought by fingerprint
  IF v_fingerprint IS NOT NULL THEN
    SELECT serial_id INTO v_existing_serial
    FROM thoughts
    WHERE content_fingerprint = v_fingerprint
    LIMIT 1;
  END IF;

  IF v_existing_serial IS NOT NULL THEN
    -- Update existing thought
    UPDATE thoughts SET
      content = p_content,
      embedding = CASE
        WHEN p_payload ? 'embedding' THEN (p_payload->>'embedding')::vector
        ELSE embedding
      END,
      metadata = CASE
        WHEN p_payload ? 'metadata' THEN (p_payload->'metadata')
        ELSE metadata
      END,
      type = COALESCE(p_payload->>'type', type),
      importance = COALESCE((p_payload->>'importance')::SMALLINT, importance),
      quality_score = COALESCE((p_payload->>'quality_score')::NUMERIC, quality_score),
      sensitivity_tier = COALESCE(p_payload->>'sensitivity_tier', sensitivity_tier),
      source_type = COALESCE(p_payload->>'source_type', source_type),
      content_fingerprint = COALESCE(v_fingerprint, content_fingerprint),
      updated_at = now()
    WHERE serial_id = v_existing_serial;

    v_serial := v_existing_serial;
    v_action := 'updated';
  ELSE
    -- Insert new thought
    INSERT INTO thoughts (
      content, embedding, metadata, type, importance,
      quality_score, sensitivity_tier, source_type, content_fingerprint
    ) VALUES (
      p_content,
      CASE WHEN p_payload ? 'embedding' THEN (p_payload->>'embedding')::vector ELSE NULL END,
      COALESCE(p_payload->'metadata', '{}'::jsonb),
      COALESCE(p_payload->>'type', 'idea'),
      COALESCE((p_payload->>'importance')::SMALLINT, 3),
      COALESCE((p_payload->>'quality_score')::NUMERIC, 50),
      COALESCE(p_payload->>'sensitivity_tier', 'standard'),
      COALESCE(p_payload->>'source_type', 'mcp'),
      v_fingerprint
    )
    RETURNING serial_id INTO v_serial;

    v_action := 'created';
  END IF;

  RETURN jsonb_build_object(
    'thought_id', v_serial,
    'action', v_action,
    'content_fingerprint', v_fingerprint
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ── 2. match_thoughts (enhanced semantic search) ────────────────────
CREATE OR REPLACE FUNCTION match_thoughts(
  query_embedding vector(1536),
  match_count INT DEFAULT 10,
  match_threshold FLOAT DEFAULT 0.5,
  filter JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  id BIGINT,
  content TEXT,
  type TEXT,
  source_type TEXT,
  importance SMALLINT,
  quality_score NUMERIC(5,2),
  sensitivity_tier TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ,
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.serial_id AS id,
    t.content,
    t.type,
    t.source_type,
    t.importance,
    t.quality_score,
    t.sensitivity_tier,
    t.metadata,
    t.created_at,
    (1 - (t.embedding <=> query_embedding))::FLOAT AS similarity
  FROM thoughts t
  WHERE t.embedding IS NOT NULL
    AND (1 - (t.embedding <=> query_embedding)) >= match_threshold
    AND (
      NOT COALESCE((filter->>'exclude_restricted')::BOOLEAN, FALSE)
      OR t.sensitivity_tier IS DISTINCT FROM 'restricted'
    )
  ORDER BY t.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ── 3. search_thoughts_text ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_thoughts_text(
  p_query TEXT,
  p_limit INT DEFAULT 20,
  p_filter JSONB DEFAULT '{}'::jsonb,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id BIGINT,
  content TEXT,
  type TEXT,
  source_type TEXT,
  importance SMALLINT,
  quality_score NUMERIC(5,2),
  sensitivity_tier TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ,
  rank FLOAT,
  total_count BIGINT
) AS $$
DECLARE
  v_tsquery tsquery;
  v_total BIGINT;
BEGIN
  v_tsquery := websearch_to_tsquery('english', p_query);

  -- Count total matches for pagination
  SELECT COUNT(*) INTO v_total
  FROM thoughts t
  WHERE t.tsv @@ v_tsquery
    AND (
      NOT COALESCE((p_filter->>'exclude_restricted')::BOOLEAN, FALSE)
      OR t.sensitivity_tier IS DISTINCT FROM 'restricted'
    );

  RETURN QUERY
  SELECT
    t.serial_id AS id,
    t.content,
    t.type,
    t.source_type,
    t.importance,
    t.quality_score,
    t.sensitivity_tier,
    t.metadata,
    t.created_at,
    ts_rank(t.tsv, v_tsquery)::FLOAT AS rank,
    v_total AS total_count
  FROM thoughts t
  WHERE t.tsv @@ v_tsquery
    AND (
      NOT COALESCE((p_filter->>'exclude_restricted')::BOOLEAN, FALSE)
      OR t.sensitivity_tier IS DISTINCT FROM 'restricted'
    )
  ORDER BY ts_rank(t.tsv, v_tsquery) DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ── 4. brain_stats_aggregate ────────────────────────────────────────
CREATE OR REPLACE FUNCTION brain_stats_aggregate(
  p_since_days INT DEFAULT 0,
  p_exclude_restricted BOOL DEFAULT TRUE
)
RETURNS JSONB AS $$
DECLARE
  v_total BIGINT;
  v_types JSONB;
  v_topics JSONB;
  v_cutoff TIMESTAMPTZ;
BEGIN
  -- Calculate cutoff date
  IF p_since_days > 0 THEN
    v_cutoff := now() - (p_since_days || ' days')::INTERVAL;
  ELSE
    v_cutoff := '-infinity'::TIMESTAMPTZ;
  END IF;

  -- Total count
  SELECT COUNT(*) INTO v_total
  FROM thoughts t
  WHERE t.created_at >= v_cutoff
    AND (NOT p_exclude_restricted OR t.sensitivity_tier IS DISTINCT FROM 'restricted');

  -- Type breakdown
  SELECT COALESCE(jsonb_agg(jsonb_build_object('type', sub.type, 'count', sub.cnt)), '[]'::jsonb)
  INTO v_types
  FROM (
    SELECT t.type, COUNT(*) AS cnt
    FROM thoughts t
    WHERE t.created_at >= v_cutoff
      AND (NOT p_exclude_restricted OR t.sensitivity_tier IS DISTINCT FROM 'restricted')
    GROUP BY t.type
    ORDER BY cnt DESC
  ) sub;

  -- Topic breakdown from metadata->'topics' array
  SELECT COALESCE(jsonb_agg(jsonb_build_object('topic', sub.topic, 'count', sub.cnt)), '[]'::jsonb)
  INTO v_topics
  FROM (
    SELECT topic.value #>> '{}' AS topic, COUNT(*) AS cnt
    FROM thoughts t,
         jsonb_array_elements(COALESCE(t.metadata->'topics', '[]'::jsonb)) AS topic(value)
    WHERE t.created_at >= v_cutoff
      AND (NOT p_exclude_restricted OR t.sensitivity_tier IS DISTINCT FROM 'restricted')
    GROUP BY topic.value #>> '{}'
    ORDER BY cnt DESC
  ) sub;

  RETURN jsonb_build_object(
    'total_count', v_total,
    'types', v_types,
    'topics', v_topics
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ── 5. get_thought_connections ──────────────────────────────────────
CREATE OR REPLACE FUNCTION get_thought_connections(
  p_thought_id BIGINT,
  p_limit INT DEFAULT 20,
  p_exclude_restricted BOOL DEFAULT TRUE
)
RETURNS TABLE (
  id BIGINT,
  content TEXT,
  type TEXT,
  importance SMALLINT,
  created_at TIMESTAMPTZ,
  shared_topics JSONB,
  shared_people JSONB,
  overlap_count INT,
  similarity FLOAT,
  score FLOAT
) AS $$
DECLARE
  v_embedding vector(1536);
  v_topics JSONB;
  v_people JSONB;
BEGIN
  -- Get the source thought's embedding and metadata
  SELECT t.embedding, COALESCE(t.metadata->'topics', '[]'::jsonb), COALESCE(t.metadata->'people', '[]'::jsonb)
  INTO v_embedding, v_topics, v_people
  FROM thoughts t
  WHERE t.serial_id = p_thought_id;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      t.serial_id,
      t.content,
      t.type,
      t.importance,
      t.created_at,
      -- Shared topics
      (
        SELECT COALESCE(jsonb_agg(at.value), '[]'::jsonb)
        FROM jsonb_array_elements(COALESCE(t.metadata->'topics', '[]'::jsonb)) AS at(value)
        WHERE at.value IN (SELECT jsonb_array_elements(v_topics))
      ) AS shared_topics,
      -- Shared people
      (
        SELECT COALESCE(jsonb_agg(ap.value), '[]'::jsonb)
        FROM jsonb_array_elements(COALESCE(t.metadata->'people', '[]'::jsonb)) AS ap(value)
        WHERE ap.value IN (SELECT jsonb_array_elements(v_people))
      ) AS shared_people,
      -- Embedding similarity
      CASE
        WHEN t.embedding IS NOT NULL AND v_embedding IS NOT NULL
        THEN (1 - (t.embedding <=> v_embedding))::FLOAT
        ELSE 0.0
      END AS sim
    FROM thoughts t
    WHERE t.serial_id != p_thought_id
      AND (NOT p_exclude_restricted OR t.sensitivity_tier IS DISTINCT FROM 'restricted')
  )
  SELECT
    c.serial_id AS id,
    LEFT(c.content, 200) AS content,
    c.type,
    c.importance,
    c.created_at,
    c.shared_topics,
    c.shared_people,
    (COALESCE(jsonb_array_length(c.shared_topics), 0) + COALESCE(jsonb_array_length(c.shared_people), 0))::INT AS overlap_count,
    c.sim AS similarity,
    (
      0.6 * LEAST(
        (COALESCE(jsonb_array_length(c.shared_topics), 0) + COALESCE(jsonb_array_length(c.shared_people), 0))::FLOAT
        / GREATEST(COALESCE(jsonb_array_length(v_topics), 0) + COALESCE(jsonb_array_length(v_people), 0), 1)::FLOAT,
        1.0
      )
      + 0.4 * c.sim
    )::FLOAT AS score
  FROM candidates c
  WHERE (
    COALESCE(jsonb_array_length(c.shared_topics), 0) + COALESCE(jsonb_array_length(c.shared_people), 0) > 0
    OR c.sim > 0.3
  )
  ORDER BY score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ── 6. find_near_duplicates ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION find_near_duplicates(
  p_threshold FLOAT DEFAULT 0.95,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  thought_id_a BIGINT,
  thought_id_b BIGINT,
  similarity FLOAT,
  content_a TEXT,
  content_b TEXT,
  type_a TEXT,
  type_b TEXT,
  quality_a NUMERIC(5,2),
  quality_b NUMERIC(5,2),
  created_a TIMESTAMPTZ,
  created_b TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.serial_id AS thought_id_a,
    b.serial_id AS thought_id_b,
    (1 - (a.embedding <=> b.embedding))::FLOAT AS similarity,
    a.content AS content_a,
    b.content AS content_b,
    a.type AS type_a,
    b.type AS type_b,
    a.quality_score AS quality_a,
    b.quality_score AS quality_b,
    a.created_at AS created_a,
    b.created_at AS created_b
  FROM thoughts a
  JOIN thoughts b ON a.serial_id < b.serial_id
  WHERE a.embedding IS NOT NULL
    AND b.embedding IS NOT NULL
    AND (1 - (a.embedding <=> b.embedding)) >= p_threshold
  ORDER BY (1 - (a.embedding <=> b.embedding)) DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ── 7. upsert_reflection ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION upsert_reflection(
  p_thought_id BIGINT,
  p_trigger_context TEXT,
  p_options JSONB DEFAULT '[]'::jsonb,
  p_factors JSONB DEFAULT '[]'::jsonb,
  p_conclusion TEXT DEFAULT '',
  p_embedding vector(1536) DEFAULT NULL,
  p_reflection_type TEXT DEFAULT 'general',
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB AS $$
DECLARE
  v_id BIGINT;
  v_action TEXT;
BEGIN
  -- Try to find existing reflection for this thought + type
  SELECT r.id INTO v_id
  FROM reflections r
  WHERE r.thought_id = p_thought_id
    AND r.reflection_type = p_reflection_type
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE reflections SET
      trigger_context = p_trigger_context,
      options = p_options,
      factors = p_factors,
      conclusion = p_conclusion,
      embedding = COALESCE(p_embedding, embedding),
      metadata = p_metadata,
      updated_at = now()
    WHERE reflections.id = v_id;

    v_action := 'updated';
  ELSE
    INSERT INTO reflections (
      thought_id, trigger_context, options, factors,
      conclusion, embedding, reflection_type, metadata
    ) VALUES (
      p_thought_id, p_trigger_context, p_options, p_factors,
      p_conclusion, p_embedding, p_reflection_type, p_metadata
    )
    RETURNING reflections.id INTO v_id;

    v_action := 'created';
  END IF;

  RETURN jsonb_build_object(
    'reflection_id', v_id,
    'action', v_action
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ── 8. match_reflections ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION match_reflections(
  query_embedding vector(1536),
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 10,
  p_reflection_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  id BIGINT,
  thought_id BIGINT,
  trigger_context TEXT,
  conclusion TEXT,
  reflection_type TEXT,
  similarity FLOAT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.thought_id,
    r.trigger_context,
    r.conclusion,
    r.reflection_type,
    (1 - (r.embedding <=> query_embedding))::FLOAT AS similarity,
    r.created_at
  FROM reflections r
  WHERE r.embedding IS NOT NULL
    AND (1 - (r.embedding <=> query_embedding)) >= match_threshold
    AND (p_reflection_type IS NULL OR r.reflection_type = p_reflection_type)
  ORDER BY r.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
