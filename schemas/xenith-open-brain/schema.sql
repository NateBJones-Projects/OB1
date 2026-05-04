-- Xenith Open Brain base schema
-- Creates a 2560-dimensional Open Brain store for Qwen3-Embedding-4B,
-- plus Xenith metadata indexes and a low-confidence triage queue.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1. BASE THOUGHT STORE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.thoughts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  content text NOT NULL,
  embedding vector(2560),
  metadata jsonb DEFAULT '{}'::jsonb,
  captured_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  content_fingerprint text
);

-- pgvector's HNSW/IVFFlat indexes for `vector` currently cap indexed
-- dimensions at 2000. Qwen3-Embedding-4B returns 2560 dimensions, so
-- keep exact vector search for now instead of creating an ANN index.
-- For larger datasets, revisit halfvec indexing or dimensionality reduction.

CREATE INDEX IF NOT EXISTS idx_thoughts_metadata
  ON public.thoughts USING gin (metadata);

CREATE INDEX IF NOT EXISTS idx_thoughts_created_at
  ON public.thoughts (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_thoughts_captured_at
  ON public.thoughts (captured_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_thoughts_fingerprint
  ON public.thoughts (content_fingerprint)
  WHERE content_fingerprint IS NOT NULL;

-- ============================================================
-- 2. XENITH METADATA INDEXES
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'thoughts_program_id_required'
  ) THEN
    ALTER TABLE public.thoughts
      ADD CONSTRAINT thoughts_program_id_required
      CHECK (metadata->>'program_id' IS NOT NULL) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_thoughts_program_id
  ON public.thoughts ((metadata->>'program_id'));

CREATE INDEX IF NOT EXISTS idx_thoughts_workstream
  ON public.thoughts ((metadata->>'workstream'));

CREATE INDEX IF NOT EXISTS idx_thoughts_attributed_to
  ON public.thoughts ((metadata->>'attributed_to'));

CREATE INDEX IF NOT EXISTS idx_thoughts_metadata_type
  ON public.thoughts ((metadata->>'type'));

CREATE INDEX IF NOT EXISTS idx_thoughts_needs_review
  ON public.thoughts ((metadata->>'needs_review'))
  WHERE metadata ? 'needs_review';

-- ============================================================
-- 3. UPDATED_AT TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS thoughts_updated_at ON public.thoughts;
CREATE TRIGGER thoughts_updated_at
  BEFORE UPDATE ON public.thoughts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 4. VECTOR SEARCH RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.match_thoughts(
  query_embedding vector(2560),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10,
  filter jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  id uuid,
  content text,
  metadata jsonb,
  similarity float,
  created_at timestamptz
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.content,
    t.metadata,
    1 - (t.embedding <=> query_embedding) AS similarity,
    t.created_at
  FROM public.thoughts t
  WHERE t.embedding IS NOT NULL
    AND 1 - (t.embedding <=> query_embedding) > match_threshold
    AND (filter = '{}'::jsonb OR t.metadata @> filter)
  ORDER BY t.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ============================================================
-- 5. DEDUPLICATING UPSERT RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.upsert_thought(
  p_content text,
  p_payload jsonb DEFAULT '{}'
)
RETURNS jsonb AS $$
DECLARE
  v_fingerprint text;
  v_result jsonb;
  v_id uuid;
BEGIN
  v_fingerprint := encode(sha256(convert_to(
    lower(trim(regexp_replace(p_content, '\s+', ' ', 'g'))),
    'UTF8'
  )), 'hex');

  INSERT INTO public.thoughts (content, content_fingerprint, metadata)
  VALUES (p_content, v_fingerprint, COALESCE(p_payload->'metadata', '{}'::jsonb))
  ON CONFLICT (content_fingerprint) WHERE content_fingerprint IS NOT NULL DO UPDATE
  SET updated_at = now(),
      metadata = public.thoughts.metadata || COALESCE(EXCLUDED.metadata, '{}'::jsonb)
  RETURNING id INTO v_id;

  v_result := jsonb_build_object('id', v_id, 'fingerprint', v_fingerprint);
  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 6. LOW-CONFIDENCE TRIAGE QUEUE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.thoughts_pending (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content text NOT NULL,
  embedding vector(2560),
  candidate_metadata jsonb,
  confidence numeric(3,2),
  surrounding_context text,
  source_ref text,
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_thoughts_pending_created_at
  ON public.thoughts_pending (created_at DESC)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_thoughts_pending_confidence
  ON public.thoughts_pending (confidence)
  WHERE resolved_at IS NULL;

-- ============================================================
-- 7. SECURITY AND GRANTS
-- ============================================================

ALTER TABLE public.thoughts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thoughts_pending ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'thoughts'
      AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access"
      ON public.thoughts
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'thoughts_pending'
      AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access"
      ON public.thoughts_pending
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.thoughts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.thoughts_pending TO service_role;
GRANT EXECUTE ON FUNCTION public.match_thoughts(vector, float, int, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_thought(text, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
