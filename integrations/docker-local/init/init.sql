CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS thoughts (
  id BIGSERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  content_fingerprint TEXT,
  embedding vector(1536),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_thoughts_fingerprint
  ON thoughts (content_fingerprint)
  WHERE content_fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_thoughts_created_at ON thoughts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_thoughts_metadata ON thoughts USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_thoughts_embedding ON thoughts USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER thoughts_updated_at
  BEFORE UPDATE ON thoughts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE FUNCTION upsert_thought(p_content TEXT, p_metadata JSONB DEFAULT '{}')
RETURNS BIGINT AS $$
DECLARE
  v_fingerprint TEXT;
  v_id BIGINT;
BEGIN
  v_fingerprint := encode(sha256(convert_to(
    lower(trim(regexp_replace(p_content, '\s+', ' ', 'g'))),
    'UTF8'
  )), 'hex');

  INSERT INTO thoughts (content, content_fingerprint, metadata)
  VALUES (p_content, v_fingerprint, p_metadata)
  ON CONFLICT (content_fingerprint) WHERE content_fingerprint IS NOT NULL DO UPDATE
  SET updated_at = CURRENT_TIMESTAMP,
      metadata = thoughts.metadata || EXCLUDED.metadata
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION match_thoughts(
  query_embedding vector(1536),
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 10,
  filter JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  id BIGINT,
  content TEXT,
  metadata JSONB,
  similarity FLOAT,
  created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.content,
    t.metadata,
    (1 - (t.embedding <=> query_embedding))::FLOAT AS similarity,
    t.created_at
  FROM thoughts t
  WHERE 1 - (t.embedding <=> query_embedding) >= match_threshold
    AND (filter = '{}'::jsonb OR t.metadata @> filter)
  ORDER BY t.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
