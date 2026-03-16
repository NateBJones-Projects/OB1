-- ============================================================================
-- Open Brain: Rollback Chunking Columns
-- ============================================================================
--
-- WHO NEEDS THIS:
--   Only users who applied the chunking schema from PR #27 before it was
--   revised. If you set up Open Brain after this change, you can ignore this.
--
-- WHAT HAPPENED:
--   PR #27 (email-history-import) originally added three columns to the
--   thoughts table for RAG-style chunking: parent_id, chunk_index, full_text.
--   After community discussion, we decided to keep the core schema simple.
--   The active community pattern is truncation + fingerprinting, not chunking.
--   See the Discord discussion thread for full context.
--
-- WHAT THIS DOES:
--   1. Drops the chunking columns (parent_id, chunk_index, full_text) if present
--   2. Drops the insert_thought RPC function that referenced them
--   3. Non-destructive: uses IF EXISTS — safe to run even if columns were
--      never added
--
-- BEFORE RUNNING:
--   If you imported emails using the old chunked approach, those child-chunk
--   rows will lose their parent_id/chunk_index linkage. The content is still
--   there — just no longer linked. You may want to delete chunk rows and
--   re-import using the new one-thought-per-email approach.
--
-- HOW TO RUN:
--   Paste this into your Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ============================================================================

-- Drop the chunking columns if they exist
ALTER TABLE thoughts DROP COLUMN IF EXISTS parent_id;
ALTER TABLE thoughts DROP COLUMN IF EXISTS chunk_index;
ALTER TABLE thoughts DROP COLUMN IF EXISTS full_text;

-- Drop the old insert_thought RPC that referenced chunking params
DROP FUNCTION IF EXISTS insert_thought(text, vector, jsonb, uuid, integer, text);

-- Verify: show current thoughts table columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'thoughts'
ORDER BY ordinal_position;
