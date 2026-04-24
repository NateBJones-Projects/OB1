-- Readwise Books Cache
-- Side-table for book-level metadata so highlights stored in `thoughts`
-- can reference a book_id without denormalising title/author into every
-- highlight row. Populated by the readwise-capture integration and the
-- readwise-import recipe.
--
-- Safe to run multiple times (fully idempotent).

-- ============================================================
-- 1. TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS readwise_books (
  book_id           BIGINT PRIMARY KEY,           -- Readwise's user_book_id
  title             TEXT NOT NULL,
  author            TEXT,
  category          TEXT,                          -- books | articles | podcasts | tweets | supplementals
  source            TEXT,                          -- kindle | reader | instapaper | apple_books | hypothesis | ...
  source_url        TEXT,
  cover_image_url   TEXT,
  num_highlights    INTEGER DEFAULT 0,
  tags              JSONB DEFAULT '[]'::jsonb,
  last_highlight_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_readwise_books_title
  ON readwise_books (title);
CREATE INDEX IF NOT EXISTS idx_readwise_books_author
  ON readwise_books (author);
CREATE INDEX IF NOT EXISTS idx_readwise_books_category
  ON readwise_books (category);

-- ============================================================
-- 2. GET HIGHLIGHTS FOR A BOOK
--    Returns highlights in the order you encountered them in the
--    source (by `location`), with `highlighted_at` as a tiebreaker.
--    NULLIF guards against empty-string metadata values from
--    older imports; empty string would otherwise crash ::bigint.
-- ============================================================

CREATE OR REPLACE FUNCTION get_book_highlights(
  p_book_id BIGINT,
  p_limit INTEGER DEFAULT 500
)
RETURNS TABLE (
  id             UUID,
  content        TEXT,
  note           TEXT,
  location       BIGINT,
  location_type  TEXT,
  highlighted_at TIMESTAMPTZ,
  metadata       JSONB
)
LANGUAGE sql STABLE
AS $$
  SELECT
    t.id,
    t.content,
    t.metadata->>'note' AS note,
    NULLIF(t.metadata->>'location', '')::bigint AS location,
    t.metadata->>'location_type' AS location_type,
    (t.metadata->>'highlighted_at')::timestamptz AS highlighted_at,
    t.metadata
  FROM thoughts t
  WHERE t.source_type = 'readwise'
    AND (t.metadata->>'readwise_book_id')::bigint = p_book_id
  ORDER BY
    NULLIF(t.metadata->>'location', '')::bigint NULLS LAST,
    (t.metadata->>'highlighted_at')::timestamptz NULLS LAST
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION get_book_highlights(BIGINT, INTEGER)
  TO authenticated, anon, service_role;

-- ============================================================
-- 3. INCREMENT HIGHLIGHT COUNT
--    Called by the readwise-capture Edge Function on each new
--    highlight insert. Keeps num_highlights and last_highlight_at
--    fresh without requiring a COUNT over the thoughts table.
-- ============================================================

CREATE OR REPLACE FUNCTION increment_book_highlight_count(
  p_book_id BIGINT,
  p_highlighted_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE readwise_books
  SET
    num_highlights = num_highlights + 1,
    last_highlight_at = GREATEST(
      COALESCE(last_highlight_at, '-infinity'::timestamptz),
      COALESCE(p_highlighted_at, '-infinity'::timestamptz)
    ),
    updated_at = now()
  WHERE book_id = p_book_id;
$$;

GRANT EXECUTE ON FUNCTION increment_book_highlight_count(BIGINT, TIMESTAMPTZ)
  TO authenticated, anon, service_role;

-- Reload PostgREST schema cache so the new RPCs are immediately callable.
NOTIFY pgrst, 'reload schema';
