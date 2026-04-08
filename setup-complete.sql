-- SQL Setup for Open Brain
-- Run this in the Supabase SQL Editor for your own project.
-- Recommended for the local Ollama path in this repo: use vector(768) with nomic-embed-text.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS thoughts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  content text NOT NULL,
  embedding vector(768),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_thoughts_embedding ON thoughts
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_thoughts_metadata ON thoughts USING gin (metadata);
CREATE INDEX IF NOT EXISTS idx_thoughts_created_at ON thoughts (created_at DESC);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS thoughts_updated_at ON thoughts;
CREATE TRIGGER thoughts_updated_at
  BEFORE UPDATE ON thoughts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE FUNCTION match_thoughts(
  query_embedding vector(768),
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
  FROM thoughts t
  WHERE 1 - (t.embedding <=> query_embedding) > match_threshold
    AND (filter = '{}'::jsonb OR t.metadata @> filter)
  ORDER BY t.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

ALTER TABLE thoughts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON thoughts;
CREATE POLICY "Service role full access"
  ON thoughts
  FOR ALL
  USING (auth.role() = 'service_role');

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.thoughts TO service_role;

ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS content_fingerprint TEXT;

DROP INDEX IF EXISTS idx_thoughts_fingerprint;
CREATE UNIQUE INDEX idx_thoughts_fingerprint
  ON thoughts (content_fingerprint)
  WHERE content_fingerprint IS NOT NULL;

CREATE OR REPLACE FUNCTION upsert_thought(p_content TEXT, p_payload JSONB DEFAULT '{}')
RETURNS JSONB AS $$
DECLARE
  v_fingerprint TEXT;
  v_result JSONB;
  v_id UUID;
BEGIN
  v_fingerprint := encode(sha256(convert_to(
    lower(trim(regexp_replace(p_content, '\s+', ' ', 'g'))),
    'UTF8'
  )), 'hex');

  INSERT INTO thoughts (content, content_fingerprint, metadata)
  VALUES (p_content, v_fingerprint, COALESCE(p_payload->'metadata', '{}'::jsonb))
  ON CONFLICT (content_fingerprint) WHERE content_fingerprint IS NOT NULL DO UPDATE
  SET updated_at = now(),
      metadata = thoughts.metadata || COALESCE(EXCLUDED.metadata, '{}'::jsonb)
  RETURNING id INTO v_id;

  v_result := jsonb_build_object('id', v_id, 'fingerprint', v_fingerprint);
  RETURN v_result;
END;
$$ LANGUAGE plpgsql;
