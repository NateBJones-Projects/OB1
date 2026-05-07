-- =============================================================
-- DOK Pipeline Tables
-- Custom addition for progressive knowledge enrichment
-- Run AFTER the base OB1 schema (steps 01-05)
-- Run: Supabase SQL Editor → New query → paste and Run
-- =============================================================

-- DOK2/3/4 enriched entries (DOK1 = base thoughts table)
CREATE TABLE dok_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thought_id UUID REFERENCES thoughts(id) ON DELETE CASCADE,
  dok_level INTEGER NOT NULL CHECK (dok_level BETWEEN 2 AND 4),
  title TEXT,
  content TEXT NOT NULL,
  embedding vector(1536),
  tags TEXT[] DEFAULT '{}',
  project TEXT,
  source TEXT,
  -- DOK4 SPOV fields
  spov_type TEXT CHECK (spov_type IN ('truth', 'myth')),
  confidence NUMERIC(3,2) CHECK (confidence BETWEEN 0.1 AND 0.95),
  validation_status TEXT DEFAULT 'pending'
    CHECK (validation_status IN ('pending','validated','challenged','broken','revised','superseded')),
  validation_history JSONB DEFAULT '[]',
  source_insights TEXT[] DEFAULT '{}',
  contrarian_position TEXT,
  supporting_evidence TEXT,
  challenge_to TEXT,
  -- Lineage
  parent_ids UUID[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Vector index for DOK entries
CREATE INDEX ON dok_levels USING hnsw (embedding vector_cosine_ops);

-- Index for filtering by DOK level
CREATE INDEX ON dok_levels (dok_level, created_at DESC);

-- Index for validation status queries
CREATE INDEX ON dok_levels (validation_status) WHERE validation_status != 'validated';

-- Auto-update updated_at
CREATE TRIGGER dok_levels_updated_at
  BEFORE UPDATE ON dok_levels
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Cross-references between DOK entries
CREATE TABLE cross_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES dok_levels(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES dok_levels(id) ON DELETE CASCADE,
  relationship_type TEXT,
  similarity NUMERIC(5,4),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ON cross_references (source_id);
CREATE INDEX ON cross_references (target_id);

-- Pipeline state tracking (replaces Qdrant metadata points)
CREATE TABLE pipeline_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- DOK-level search function (extends Nate's match_thoughts)
CREATE OR REPLACE FUNCTION match_dok_levels(
  query_embedding vector(1536),
  dok_level_filter INTEGER DEFAULT NULL,
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 15
)
RETURNS TABLE (
  id UUID,
  thought_id UUID,
  dok_level INTEGER,
  title TEXT,
  content TEXT,
  tags TEXT[],
  project TEXT,
  spov_type TEXT,
  confidence NUMERIC,
  validation_status TEXT,
  similarity FLOAT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id, d.thought_id, d.dok_level, d.title, d.content, d.tags,
    d.project, d.spov_type, d.confidence, d.validation_status,
    1 - (d.embedding <=> query_embedding) AS similarity,
    d.created_at
  FROM dok_levels d
  WHERE (dok_level_filter IS NULL OR d.dok_level = dok_level_filter)
    AND 1 - (d.embedding <=> query_embedding) > match_threshold
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- RLS on DOK tables
ALTER TABLE dok_levels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON dok_levels FOR ALL
  USING (auth.role() = 'service_role');
GRANT ALL ON TABLE dok_levels TO service_role;

ALTER TABLE cross_references ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON cross_references FOR ALL
  USING (auth.role() = 'service_role');
GRANT ALL ON TABLE cross_references TO service_role;

ALTER TABLE pipeline_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON pipeline_state FOR ALL
  USING (auth.role() = 'service_role');
GRANT ALL ON TABLE pipeline_state TO service_role;
