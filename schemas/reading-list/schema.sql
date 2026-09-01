-- Reading List
-- Standalone table for tracking books, articles, podcasts, and videos
-- with status (want to read → reading → finished), 1-5 ratings, review
-- notes, and tags. Listed in the repo README as a planned schema.
--
-- Does NOT modify the core thoughts table.
-- Safe to run multiple times (fully idempotent).

-- ============================================================
-- 1. TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS reading_list (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  author        TEXT,
  type          TEXT NOT NULL DEFAULT 'book'
                CHECK (type IN ('book', 'article', 'podcast', 'video')),
  status        TEXT NOT NULL DEFAULT 'want_to_read'
                CHECK (status IN ('want_to_read', 'reading', 'finished', 'abandoned')),
  rating        SMALLINT
                CHECK (rating BETWEEN 1 AND 5),
  review_notes  TEXT,
  url           TEXT,
  started_date  DATE,
  finished_date DATE,
  tags          JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A finish date before the start date is always a data-entry error
  CONSTRAINT reading_list_dates_ordered
    CHECK (finished_date IS NULL OR started_date IS NULL OR finished_date >= started_date)
);

-- ============================================================
-- 2. INDEXES
-- ============================================================

-- The two most common filters: "what am I reading" / "what do I want to read"
CREATE INDEX IF NOT EXISTS idx_reading_list_status
  ON reading_list (status);

CREATE INDEX IF NOT EXISTS idx_reading_list_type
  ON reading_list (type);

-- Rated-items queries ("my 5-star books") skip unrated rows entirely
CREATE INDEX IF NOT EXISTS idx_reading_list_rating
  ON reading_list (rating) WHERE rating IS NOT NULL;

-- Tag containment queries: tags @> '["ai"]'
CREATE INDEX IF NOT EXISTS idx_reading_list_tags
  ON reading_list USING gin (tags);

-- Reading-history timeline
CREATE INDEX IF NOT EXISTS idx_reading_list_finished
  ON reading_list (finished_date DESC) WHERE finished_date IS NOT NULL;

-- ============================================================
-- 3. KEEP updated_at FRESH
-- ============================================================

CREATE OR REPLACE FUNCTION reading_list_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reading_list_updated_at ON reading_list;
CREATE TRIGGER trg_reading_list_updated_at
  BEFORE UPDATE ON reading_list
  FOR EACH ROW
  EXECUTE FUNCTION reading_list_touch_updated_at();

-- ============================================================
-- 4. CONVENIENCE VIEW — the shelf you look at most
-- ============================================================

CREATE OR REPLACE VIEW currently_reading AS
  SELECT id, title, author, type, url, started_date, tags
  FROM reading_list
  WHERE status = 'reading'
  ORDER BY started_date DESC NULLS LAST, created_at DESC;

-- ============================================================
-- 5. OPTIONAL: ROW LEVEL SECURITY
--    The standard Open Brain setup accesses tables with the
--    service role key (which bypasses RLS), so RLS is left
--    disabled by default — matching the core thoughts table and
--    the readwise-books schema. If you expose this table to
--    authenticated or anon clients (e.g. a public dashboard),
--    uncomment and adapt:
-- ============================================================

-- ALTER TABLE reading_list ENABLE ROW LEVEL SECURITY;
--
-- CREATE POLICY "authenticated can manage reading list"
--   ON reading_list FOR ALL
--   TO authenticated
--   USING (true)
--   WITH CHECK (true);
