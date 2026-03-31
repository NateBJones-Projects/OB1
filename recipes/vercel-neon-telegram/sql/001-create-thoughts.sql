CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE thoughts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  content TEXT NOT NULL,
  embedding VECTOR(1536),
  metadata JSONB DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'mcp',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX thoughts_embedding_idx ON thoughts USING hnsw (embedding vector_cosine_ops);
CREATE INDEX thoughts_metadata_idx ON thoughts USING gin (metadata);
CREATE INDEX thoughts_created_at_idx ON thoughts (created_at DESC);

-- Auto-update trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER thoughts_updated_at
  BEFORE UPDATE ON thoughts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
