-- 05-text-search-index.sql
-- Adds full-text search support to thoughts via a tsvector column,
-- GIN index, and auto-update trigger.

-- Step 1: Add tsv column if it doesn't exist
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS tsv tsvector;

-- Step 2: Backfill existing rows that have no tsvector yet
UPDATE thoughts SET tsv = to_tsvector('english', content) WHERE tsv IS NULL;

-- Step 3: Create GIN index for fast full-text queries
CREATE INDEX IF NOT EXISTS idx_thoughts_tsv ON thoughts USING GIN (tsv);

-- Step 4: Auto-update trigger on content changes
CREATE OR REPLACE FUNCTION thoughts_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.tsv := to_tsvector('english', COALESCE(NEW.content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_thoughts_tsv ON thoughts;
CREATE TRIGGER trg_thoughts_tsv
  BEFORE INSERT OR UPDATE OF content ON thoughts
  FOR EACH ROW EXECUTE FUNCTION thoughts_tsv_trigger();
