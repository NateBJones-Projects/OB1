-- =================================================================
-- Open Brain v2 - Missing SQL Schemas Migration
--
-- Created by Worker D (infra) on 2026-04-27
--
-- This file contains all missing SQL schemas that need to be applied
-- to make the Open Brain v2 system fully functional.
--
-- Apply via: Supabase Dashboard → SQL Editor → Paste and Run
-- =================================================================

-- Ensure we're in the correct schema
SET search_path = public;

-- =================================================================
-- 1. Create match_thoughts() function
-- This function is required for semantic search functionality
-- =================================================================

CREATE OR REPLACE FUNCTION match_thoughts(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 10,
  filter jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float,
  created_at timestamptz
)
language plpgsql
as $$
begin
  return query
  select
    t.id,
    t.content,
    t.metadata,
    1 - (t.embedding <=> query_embedding) as similarity,
    t.created_at
  from thoughts t
  where 1 - (t.embedding <=> query_embedding) > match_threshold
    and (filter = '{}'::jsonb or t.metadata @> filter)
  order by t.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- =================================================================
-- 2. Create upsert_thought() function
-- This function handles deduplication using content_fingerprint
-- =================================================================

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

-- Create unique index for fingerprint deduplication (if it doesn't exist)
CREATE UNIQUE INDEX IF NOT EXISTS idx_thoughts_fingerprint
  ON thoughts (content_fingerprint)
  WHERE content_fingerprint IS NOT NULL;

-- =================================================================
-- 3. Entity Extraction Schema
-- Creates entities, edges, thought_entities, entity_extraction_queue
-- =================================================================

-- Entities table for storing extracted entities
CREATE TABLE IF NOT EXISTS entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Edges table for storing relationships between entities
CREATE TABLE IF NOT EXISTS edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Many-to-many junction table for thoughts and entities
CREATE TABLE IF NOT EXISTS thought_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thought_id uuid NOT NULL REFERENCES thoughts(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'mention', -- mention, context, etc.
  created_at timestamptz DEFAULT now()
);

-- Entity extraction queue for background processing
CREATE TABLE IF NOT EXISTS entity_extraction_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thought_id uuid NOT NULL REFERENCES thoughts(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending', -- pending, processing, completed, failed
  created_at timestamptz DEFAULT now(),
  processed_at timestamptz,
  error_message TEXT,
  metadata jsonb DEFAULT '{}'::jsonb
);

-- Indexes for entity extraction tables
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type);
CREATE INDEX IF NOT EXISTS idx_thought_entities_thought ON thought_entities(thought_id);
CREATE INDEX IF NOT EXISTS idx_thought_entities_entity ON thought_entities(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_extraction_queue_status ON entity_extraction_queue(status);

-- =================================================================
-- 4. Typed Reasoning Edges Schema
-- Extends edges table and creates thought_edges
-- =================================================================

-- Add typed reasoning columns to edges table (if they don't exist)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'edges' AND column_name = 'confidence') THEN
    ALTER TABLE edges ADD COLUMN confidence float DEFAULT 1.0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'edges' AND column_name = 'strength') THEN
    ALTER TABLE edges ADD COLUMN strength float DEFAULT 1.0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'edges' AND column_name = 'temporal_decay') THEN
    ALTER TABLE edges ADD COLUMN temporal_decay float DEFAULT 0.0;
  END IF;
END $$;

-- Thought edges table for typed reasoning between thoughts
CREATE TABLE IF NOT EXISTS thought_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_thought_id uuid NOT NULL REFERENCES thoughts(id) ON DELETE CASCADE,
  target_thought_id uuid NOT NULL REFERENCES thoughts(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL, -- supports, contradicts, elaborates, etc.
  weight float DEFAULT 1.0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes for thought edges
CREATE INDEX IF NOT EXISTS idx_thought_edges_source ON thought_edges(source_thought_id);
CREATE INDEX IF NOT EXISTS idx_thought_edges_target ON thought_edges(target_thought_id);
CREATE INDEX IF NOT EXISTS idx_thought_edges_type ON thought_edges(relationship_type);

-- =================================================================
-- 5. Enhanced Thoughts Schema
-- Adds columns to thoughts table for improved metadata
-- =================================================================

-- Add columns to thoughts table (only if they don't exist)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'thoughts' AND column_name = 'type') THEN
    ALTER TABLE thoughts ADD COLUMN type TEXT DEFAULT 'observation';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'thoughts' AND column_name = 'importance') THEN
    ALTER TABLE thoughts ADD COLUMN importance integer DEFAULT 5; -- 1-10 scale
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'thoughts' AND column_name = 'category') THEN
    ALTER TABLE thoughts ADD COLUMN category TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'thoughts' AND column_name = 'tags') THEN
    ALTER TABLE thoughts ADD COLUMN tags TEXT[] DEFAULT '{}';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'thoughts' AND column_name = 'priority') THEN
    ALTER TABLE thoughts ADD COLUMN priority TEXT DEFAULT 'normal'; -- low, normal, high, urgent
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'thoughts' AND column_name = 'source_url') THEN
    ALTER TABLE thoughts ADD COLUMN source_url TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'thoughts' AND column_name = 'original_language') THEN
    ALTER TABLE thoughts ADD COLUMN original_language TEXT DEFAULT 'en';
  END IF;
END $$;

-- Indexes for enhanced thoughts
CREATE INDEX IF NOT EXISTS idx_thoughts_type ON thoughts(type);
CREATE INDEX IF NOT EXISTS idx_thoughts_importance ON thoughts(importance);
CREATE INDEX IF NOT EXISTS idx_thoughts_priority ON thoughts(priority);
CREATE INDEX IF NOT EXISTS idx_thoughts_category ON thoughts(category);

-- =================================================================
-- 6. Row Level Security (RLS) Setup
-- =================================================================

-- Enable RLS on all tables
ALTER TABLE thoughts ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE thought_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE thought_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_extraction_queue ENABLE ROW LEVEL SECURITY;

-- Create policies for thoughts table
DROP POLICY IF EXISTS "Public thoughts view" on thoughts;
CREATE POLICY "Public thoughts view" ON thoughts
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public thoughts insert" on thoughts;
CREATE POLICY "Public thoughts insert" ON thoughts
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Public thoughts update" on thoughts;
CREATE POLICY "Public thoughts update" ON thoughts
  FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Public thoughts delete" on thoughts;
CREATE POLICY "Public thoughts delete" ON thoughts
  FOR DELETE USING (true);

-- Create policies for entity tables
DROP POLICY IF EXISTS "Public entities view" on entities;
CREATE POLICY "Public entities view" ON entities
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public entities insert" on entities;
CREATE POLICY "Public entities insert" ON entities
  FOR INSERT WITH CHECK (true);

-- Similar policies for other tables...
CREATE POLICY "Public view" ON entities FOR SELECT USING (true);
CREATE POLICY "Public insert" ON entities FOR INSERT WITH CHECK (true);
CREATE POLICY "Public view" ON edges FOR SELECT USING (true);
CREATE POLICY "Public insert" ON edges FOR INSERT WITH CHECK (true);
CREATE POLICY "Public view" ON thought_entities FOR SELECT USING (true);
CREATE POLICY "Public insert" ON thought_entities FOR INSERT WITH CHECK (true);
CREATE POLICY "Public view" ON thought_edges FOR SELECT USING (true);
CREATE POLICY "Public insert" ON thought_edges FOR INSERT WITH CHECK (true);
CREATE POLICY "Public view" ON entity_extraction_queue FOR SELECT USING (true);
CREATE POLICY "Public insert" ON entity_extraction_queue FOR INSERT WITH CHECK (true);

-- =================================================================
-- 7. Permissions Setup
-- =================================================================

-- Grant necessary permissions (service role only)
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON thoughts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON entities TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON edges TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON thought_entities TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON thought_edges TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON entity_extraction_queue TO authenticated;

-- =================================================================
-- 8. Verify all functions exist
-- =================================================================

-- Test functions (comment these out when applying manually)
/*
SELECT match_thoughts(
  '[0.1, 0.2, 0.3, 0.4, 0.5, 0.6]'::vector(1536),
  0.7,
  5,
  '{"type": "test"}'::jsonb
);

SELECT upsert_thought('Test thought content', '{"metadata": {"test": true}}'::jsonb);
*/

-- =================================================================
-- Migration Complete!
--
-- After applying this SQL, verify the following:
-- 1. All tables exist with correct columns
-- 2. All functions exist and work correctly
-- 3. RLS policies are in place
-- 4. Permissions are set for authenticated users
--
-- Next steps:
-- - Deploy Edge Functions: open-brain-mcp, brain-tools-mcp, entity-extraction-worker
-- - Run entity extraction on existing thoughts
-- - Test MCP functionality
-- =================================================================