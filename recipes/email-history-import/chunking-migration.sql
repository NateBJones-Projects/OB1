-- Email History Import: Chunking Support
--
-- Adds parent-child linking for long emails that get split into chunks.
-- These columns are nullable — existing thoughts are unaffected.
--
-- This is safe to run multiple times (uses IF NOT EXISTS).
--
-- Rollback:
--   DROP FUNCTION IF EXISTS insert_thought(text, vector(1536), jsonb, uuid, integer);
--   DROP INDEX IF EXISTS thoughts_parent_id;
--   ALTER TABLE thoughts DROP COLUMN IF EXISTS chunk_index;
--   ALTER TABLE thoughts DROP COLUMN IF EXISTS parent_id;

-- 1. Add chunking columns to thoughts table
ALTER TABLE thoughts
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES thoughts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS chunk_index integer;

-- 2. Index for fast lookup of chunks by parent
CREATE INDEX IF NOT EXISTS thoughts_parent_id
  ON thoughts (parent_id)
  WHERE parent_id IS NOT NULL;

-- 3. RPC function for inserting thoughts with all columns
--    Bypasses PostgREST schema cache issues for newly added columns.
--    See: https://github.com/supabase/supabase/issues/3044
CREATE OR REPLACE FUNCTION insert_thought(
  p_content text,
  p_embedding vector(1536),
  p_metadata jsonb,
  p_parent_id uuid DEFAULT NULL,
  p_chunk_index integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO thoughts (content, embedding, metadata, parent_id, chunk_index)
  VALUES (p_content, p_embedding, p_metadata, p_parent_id, p_chunk_index)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;
